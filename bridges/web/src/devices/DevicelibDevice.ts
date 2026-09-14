// A fitness machine or heart-rate strap over Bluetooth, driven by devicelib (../../devicelib, PLAN.md §9.5).
//
// devicelib does the protocol work: it identifies the device against its registry and applies that model's quirks
// (the Horizon 7-series reads target speed in tenths of a km/h), frames FTMS, queues control-point writes and
// reconnects. This class keeps the bridge's own rules on top of it (PLAN.md §9.4):
//  - nothing is written unless the bridge commands it this tick: devicelib's tick runs only inside setTargets();
//  - a stop on the machine latches userStopped: no Start and no targets until the user restarts it or resumes;
//  - a machine that refuses control is read-only until it grants control again;
//  - E-STOP takes control, sends target speed 0, then Stop;
//  - readings go null when the device goes quiet, so the server sees the gap.
// FTMS only, even where devicelib also speaks the machine's own protocol (owner's decision, 2026-09-13).
// Given one of devicelib's simulated treadmills it runs the same code over devicelib's mock transport and reports
// itself as `simulated`, so the server allows it in debug sessions only and it is never saved as the user's device.
import { reactive } from 'vue'
import {
  DeviceSession, Logger, MockAdapter, UUID, WebBluetoothAdapter, defaultOptionalServices, fromHex, ftmsCodec, hex,
  type BleAdapter, type BleDevice, type Clock, type DeviceData, type SimulatedTreadmill, type DriverNotice, type LogRecord, type Range as LibRange,
  type SessionInfo, type SessionState, type TraceRecord,
} from '@bikebike/devicelib'
import type { Commanded, DeviceRole, DeviceStatus, Range } from '../types'
import { BaseDevice } from './FitnessDevice'
import { errorMessage, requireBluetooth } from './bluetooth'

export interface DeviceEvent {
  t: number
  kind: 'info' | 'data' | 'status' | 'cp' | 'error'
  text: string
  hex?: string
}

export interface OpResult {
  sent: string
  /** devicelib's answer: success, not_supported, invalid_parameter, failed, control_not_permitted, timeout, error */
  result: string
}

const KMH = 3.6
/** No data notification for this long while connected: clear the readings so the server sees nulls and pauses the
 *  session. Some treadmills notify slower than 1 Hz, hence 4 s. Straps get 5 s. */
const DATA_TIMEOUT_MS = 4000
const HR_TIMEOUT_MS = 5000
/** devicelib retries for about 40 s after a drop; after that the bridge keeps trying every 5 s (PLAN.md §9.4). */
const RECONNECT_MS = 5000
const MAX_EVENTS = 200

let webAdapter: WebBluetoothAdapter | null = null
function browserAdapter(): BleAdapter {
  requireBluetooth() // a readable reason when this browser has no Web Bluetooth
  return (webAdapter ??= new WebBluetoothAdapter())
}

function si(r: LibRange | undefined, per = 1): Range | null {
  return r ? { min: r.min / per, max: r.max / per, step: r.step / per } : null
}

export class DevicelibDevice extends BaseDevice {
  session: DeviceSession | null = null
  bleDevice: BleDevice | null = null
  /** devicelib's simulated treadmill behind this device, when it is one (the console's buttons press it) */
  readonly simulator: SimulatedTreadmill | null
  /** Every byte both ways plus devicelib's log, newest last, for the Exercise device console. */
  readonly events: DeviceEvent[] = reactive([])
  readonly info = reactive({
    protocolName: null as string | null,
    selectionNote: null as string | null,
    /** devicelib registry entry, e.g. horizon_7_series; null for a plain FTMS device it does not know */
    entryId: null as string | null,
    quirkFlags: [] as string[],
    hasControlPoint: false,
    /** The machine refused control or took it back: the bridge only watches until it grants control again. */
    controlRefused: false,
    feature: null as ftmsCodec.FtmsFeature | null,
    /** The machine's own Supported Range bytes as hex, by kind */
    rawRanges: {} as Record<string, string>,
    lastData: null as Record<string, number | null> | null,
    lastStatus: null as string | null,
  })
  private readonly adapter: BleAdapter | null
  private readonly clock: Clock | null
  private readonly logger: Logger
  private wanted = false
  private lastDataAt = 0
  private watch: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private offs: (() => void)[] = []

  constructor(role: DeviceRole, opts: { adapter?: BleAdapter; simulator?: SimulatedTreadmill; clock?: Clock } = {}) {
    super(role, role === 'hrm' ? 'hrm' : 'treadmill', {
      name: role === 'hrm' ? 'Heart rate monitor' : 'FTMS device',
      address: '',
      // what the server stores for the device row; 'sim' is reserved for the bridge's simulators (speedAllowed)
      protocol: role === 'hrm' ? 'hrs' : 'ftms',
    })
    this.simulator = opts.simulator ?? null
    this.adapter = opts.adapter ?? (opts.simulator ? new MockAdapter([opts.simulator.peripheral]) : null)
    this.clock = opts.clock ?? null
    this.logger = new Logger({ source: role, level: 'debug', sinks: [{ log: (r) => this.onLog(r), trace: (r) => this.onTrace(r) }] })
  }

  /** Opens the browser's chooser (call it first thing in a click handler), then connects. */
  async connect(): Promise<void> {
    this.state.status = 'connecting'
    this.state.error = null
    let device: BleDevice
    try {
      const adapter = this.adapter ?? browserAdapter()
      // Every service devicelib's registry knows is requested here: Web Bluetooth hides the rest, and the Horizon
      // 7-series is recognised (and its speed units fixed) by its vendor service 0xFFF0.
      device = await adapter.requestDevice({
        services: [this.role === 'hrm' ? UUID.HEART_RATE : UUID.FTMS],
        optionalServices: defaultOptionalServices(),
      })
    } catch (e) {
      this.fail(e)
      throw e
    }
    await this.connectTo(device)
  }

  /** Connect to a device already chosen (reconnects, tests, devicelib's simulators). */
  async connectTo(device: BleDevice): Promise<void> {
    this.wanted = true
    this.bleDevice = device
    this.state.name = device.name || this.state.name
    this.state.address = `ble:${device.id}` // device rows and their preferences are keyed by this (PLAN.md §9.2)
    this.state.status = 'connecting'
    this.state.error = null
    try {
      const session = await DeviceSession.connect(device, {
        log: this.logger,
        autoTick: false,
        protocolPreference: 'ftms',
        ...(this.clock ? { clock: this.clock } : {}),
        ...(this.role === 'hrm' ? { forceProtocol: 'heart_rate' } : {}),
      })
      if (!this.wanted) {
        await session.disconnect() // disconnected while connecting
        return
      }
      this.attach(session)
    } catch (e) {
      this.fail(e)
      this.scheduleReconnect()
      throw e
    }
  }

  async disconnect(): Promise<void> {
    this.wanted = false
    if (this.watch) { clearInterval(this.watch); this.watch = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    const s = this.session
    this.detach()
    if (s) await s.disconnect().catch(() => undefined)
    this.simulator?.stop()
    this.state.status = 'disconnected'
    this.clearActual()
  }

  /**
   * Called by the bridge's control tick (every 250 ms) only while this bridge drives the machine. The targets are
   * handed to devicelib, which sends what changed. Nothing is sent from anywhere else, so a bridge that loses
   * control, is read-only, or has E-STOP latched never moves the machine, not even after a reconnect.
   */
  async setTargets(c: Commanded): Promise<void> {
    const s = this.session
    const driving = this.state.status === 'connected' || this.state.status === 'simulated'
    if (this.role !== 'fitness' || !s || s.state !== 'ready' || !driving || this.state.userStopped) return
    if (this.state.type === 'treadmill') {
      // m/s -> km/h, snapped to 0.001 km/h so rounding noise cannot tip a tenth-of-a-km/h machine to the next step
      s.setTargetSpeed(c.speed == null ? undefined : Math.round(c.speed * KMH * 1000) / 1000)
      s.setTargetIncline(c.incline ?? undefined)
    } else if (c.power != null) {
      s.setTargetPower(c.power)
    } else if (c.grade != null) {
      // the bridge's simulation defaults (PLAN.md §9.4), not devicelib's road
      s.setRoad({ windMps: c.wind ?? 0, crr: c.crr ?? 0.004, cwKgPerM: c.cw ?? 0.51 })
      s.setGrade(c.grade)
    }
    await s.tick()
  }

  /**
   * E-STOP (PLAN.md §9.4): take control, target speed 0 (a treadmill), then Stop, whether or not the game controlled
   * speed. 0 is 0 in any units, so this is safe on firmware with unusual speed units.
   */
  async stop(): Promise<void> {
    const s = this.session
    if (this.role !== 'fitness' || !s || s.state !== 'ready') return
    this.clearTargets()
    if (!this.info.hasControlPoint) return
    await s.sendRawControl(ftmsCodec.cmd.requestControl())
    if (this.state.type === 'treadmill') await s.sendRawControl(Uint8Array.of(ftmsCodec.OP.SET_SPEED, 0, 0))
    await s.stop() // devicelib: Request Control, then Stop (08 01)
  }

  /** Diagnostics: one raw control-point frame through devicelib's queue, with the machine's answer. */
  async rawControl(bytes: Uint8Array): Promise<OpResult> {
    const sent = hex(bytes)
    const s = this.session
    if (!s || s.state !== 'ready') return { sent, result: 'not connected' }
    try {
      return { sent, result: await s.sendRawControl(bytes) }
    } catch (e) {
      return { sent, result: `error: ${errorMessage(e)}` }
    }
  }

  /** The Set Target Speed frame a game's request for `kmh` would produce on this machine (quirks applied). */
  speedFrame(kmh: number): Uint8Array {
    return this.session?.encodeSpeedTarget(kmh) ?? ftmsCodec.cmd.setSpeed(kmh)
  }

  /** Readings go null once the device has been quiet too long. Runs every second; public for tests. */
  checkQuiet(now: number): void {
    if (this.state.status !== 'connected' && this.state.status !== 'readonly' && this.state.status !== 'simulated') return
    const limit = this.role === 'hrm' ? HR_TIMEOUT_MS : DATA_TIMEOUT_MS
    if (now - this.lastDataAt < limit) return
    if (Object.values(this.actual).some((v) => v != null)) {
      this.push('info', `no data for ${limit / 1000} s: clearing readings`)
      this.clearActual()
    }
  }

  // ---------------------------------------------------------------- devicelib session

  private attach(s: DeviceSession): void {
    const cls = s.deviceClass
    if (this.role === 'fitness' && cls !== 'treadmill' && cls !== 'bike') {
      this.wanted = false
      void s.disconnect()
      throw new Error(`${this.state.name} is ${cls === 'unknown' ? 'not an exercise machine the bridge recognises' : `a ${cls}`}; the bridge drives treadmills and bikes`)
    }
    this.detach()
    this.session = s
    this.offs = [
      s.events.on('data', (d) => this.onData(d)),
      s.events.on('state', (st) => this.onState(st)),
      s.events.on('notice', (n) => this.onNotice(n)),
      s.events.on('info', (i) => this.onInfo(i)),
    ]
    this.onInfo(s.info)
    this.onState(s.state)
    this.startWatch()
    if (this.role === 'fitness') void this.readDiagnostics(s)
  }

  private detach(): void {
    for (const off of this.offs.splice(0)) off()
    this.session = null
  }

  private onInfo(i: SessionInfo): void {
    if (this.role === 'fitness' && (i.deviceClass === 'treadmill' || i.deviceClass === 'bike')) this.state.type = i.deviceClass
    this.info.protocolName = i.protocolName
    this.info.selectionNote = i.selectionNote
    this.info.entryId = i.entry?.id ?? null
    this.info.quirkFlags = [...i.quirkFlags]
    if (this.role === 'hrm') {
      this.state.features = { protocolName: i.protocolName }
      return
    }
    const caps = this.session?.capabilities
    this.info.hasControlPoint = !!caps?.startStop
    const lim = caps?.limits ?? {}
    // devicelib's limits: the registry's figures for a known model, else what the machine reports (PLAN.md §9.5)
    this.state.features = {
      speed: !!caps?.speed, incline: !!caps?.incline, power: !!caps?.erg, grade: !!caps?.simulation,
      speedRange: si(lim.speedKmh, KMH), inclineRange: si(lim.inclinePct), powerRange: si(lim.powerW),
      protocolName: i.protocolName, registryEntry: i.entry?.id ?? null, quirks: [...i.quirkFlags],
    }
  }

  private onState(st: SessionState): void {
    if (st === 'ready') {
      this.state.status = this.controlStatus()
      this.state.error = null
      return
    }
    // Not ready: no readings. The next handshake decides about control afresh.
    this.info.controlRefused = false
    this.clearActual()
    this.state.status = st === 'connecting' ? 'connecting' : 'disconnected'
    if (st === 'failed') {
      // devicelib gave up; the bridge keeps trying every few seconds for as long as the user wants the device
      const dead = this.session
      this.detach()
      void dead?.disconnect().catch(() => undefined)
      this.state.error = 'connection lost; still trying'
      this.scheduleReconnect()
    }
  }

  private controlStatus(): DeviceStatus {
    if (this.role === 'hrm') return 'connected'
    if (!this.info.hasControlPoint || this.info.controlRefused) return 'readonly'
    return this.simulator ? 'simulated' : 'connected'
  }

  private setControlRefused(refused: boolean): void {
    if (this.info.controlRefused === refused) return
    this.info.controlRefused = refused
    this.push('info', refused ? 'the machine refused control: watching only' : 'the machine granted control')
    if (this.session?.state === 'ready') this.state.status = this.controlStatus()
  }

  private onNotice(n: DriverNotice): void {
    this.push('status', n.message)
    if (n.kind === 'stopped_by_user' || n.kind === 'paused_by_user') {
      // Latch until the user restarts the machine or presses Resume control in the bridge.
      this.state.userStopped = true
      this.clearTargets()
    } else if (n.kind === 'started_by_user') {
      this.state.userStopped = false
    }
  }

  private clearTargets(): void {
    this.session?.setTargetSpeed(undefined)
    this.session?.setTargetIncline(undefined)
  }

  private onData(d: DeviceData): void {
    this.lastDataAt = performance.now()
    const a = this.actual
    const bpm = d.heartRateBpm
    if (bpm !== undefined) a.heartRate = bpm > 0 ? bpm : null // 0 means no contact
    if (this.role === 'hrm') return
    if (d.speedKmh !== undefined) a.speed = d.speedKmh / KMH
    if (this.state.type === 'treadmill') {
      if (d.inclinePct !== undefined) a.incline = d.inclinePct
    } else if (d.cadenceRpm !== undefined) {
      a.cadence = d.cadenceRpm
    }
    if (d.powerW !== undefined) a.power = d.powerW
    this.info.lastData = { speed: a.speed, incline: a.incline, cadence: a.cadence, power: a.power, heartRate: a.heartRate }
  }

  private startWatch(): void {
    this.lastDataAt = performance.now()
    if (this.watch) return
    this.watch = setInterval(() => this.checkQuiet(performance.now()), 1000)
  }

  private async readDiagnostics(s: DeviceSession): Promise<void> {
    const read = async (uuid: string): Promise<Uint8Array | null> => {
      try { return await s.readRaw(uuid) } catch { return null }
    }
    const f = await read(UUID.FTMS_FEATURE)
    if (f) this.info.feature = ftmsCodec.parseFeature(f)
    const ranges: [string, string][] = [['speed', UUID.SUPPORTED_SPEED_RANGE], ['incline', UUID.SUPPORTED_INCLINE_RANGE], ['power', UUID.SUPPORTED_POWER_RANGE]]
    for (const [kind, uuid] of ranges) {
      const b = await read(uuid)
      if (b) this.info.rawRanges[kind] = hex(b)
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer || !this.bleDevice) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.wanted || !this.bleDevice || this.session) return
      this.push('info', 'reconnecting…')
      this.connectTo(this.bleDevice).catch(() => { /* connectTo schedules the next attempt */ })
    }, RECONNECT_MS)
  }

  private fail(e: unknown): void {
    this.state.status = 'disconnected'
    this.state.error = errorMessage(e)
    this.push('error', this.state.error)
  }

  // ---------------------------------------------------------------- the console's live stream

  private onLog(r: LogRecord): void {
    this.push(r.level === 'warn' || r.level === 'error' ? 'error' : 'info', r.message)
  }

  /** devicelib traces every byte written, read or notified. The control state comes from the machine's own answers. */
  private onTrace(r: TraceRecord): void {
    if (r.char === UUID.FTMS_CONTROL_POINT) {
      if (r.dir === 'tx') {
        this.push('cp', `write ${r.hex}`)
        return
      }
      const res = ftmsCodec.parseResponse(fromHex(r.hex))
      if (!res) {
        this.push('cp', 'unparsed control point indication', r.hex)
        return
      }
      this.push('cp', `response to ${ftmsCodec.OP_NAMES[res.op] ?? `op 0x${res.op.toString(16)}`}: ${res.result}`, r.hex)
      if (res.op === ftmsCodec.OP.REQUEST_CONTROL) this.setControlRefused(res.result !== 'success')
      else if (res.result === 'control_not_permitted') this.setControlRefused(true)
      return
    }
    if (r.char === UUID.FTMS_STATUS && r.dir === 'rx') {
      const op = fromHex(r.hex)[0] ?? -1
      const name = ftmsCodec.STATUS_NAMES[op] ?? `status 0x${op.toString(16)}`
      this.info.lastStatus = name
      this.push('status', name, r.hex)
      if (op === ftmsCodec.STATUS.CONTROL_PERMISSION_LOST) this.setControlRefused(true)
      return
    }
    if (r.dir === 'rx' && (r.char === UUID.TREADMILL_DATA || r.char === UUID.INDOOR_BIKE_DATA)) {
      const b = fromHex(r.hex)
      const d = r.char === UUID.TREADMILL_DATA ? ftmsCodec.parseTreadmillData(b) : ftmsCodec.parseIndoorBikeData(b)
      const text = Object.entries(d).map(([k, v]) => `${k}=${Math.round((v as number) * 100) / 100}`).join(' ')
      this.push('data', text || 'no fields', r.hex)
      return
    }
    if (r.dir === 'read') this.push('info', `read ${r.label}`, r.hex)
  }

  private push(kind: DeviceEvent['kind'], text: string, hexText?: string): void {
    this.events.push({ t: Date.now(), kind, text, hex: hexText })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }
}
