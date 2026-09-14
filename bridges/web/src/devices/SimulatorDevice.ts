import { reactive } from 'vue'
import type { Commanded, DeviceType } from '../types'
import { BaseDevice } from './FitnessDevice'

export interface SimControls {
  /** actual tracks commanded with a 2 s first-order lag */
  follow: boolean
  /** slider overrides used when follow is off (treadmill: speed m/s, incline %; bike: cadence rpm, power W) */
  speed: number
  incline: number
  cadence: number
  power: number
  /** target the belt is heading to after the user pressed the machine's own +/- buttons (treadmill) */
  manualSpeed: number | null
  /** connected but every reading is null (a stalled data stream) */
  noData: boolean
}

const TAU = 2 // seconds

function lag(current: number | null, target: number, dt: number): number {
  if (current == null) return target * (1 - Math.exp(-dt / TAU))
  const a = 1 - Math.exp(-dt / TAU)
  const next = current + (target - current) * a
  return Math.abs(next - target) < 1e-4 ? target : next
}

/** Fake treadmill or bike: actual follows commanded with lag, or is driven by sliders. */
export class SimulatorDevice extends BaseDevice {
  readonly controls: SimControls = reactive({ follow: true, speed: 0, incline: 0, cadence: 85, power: 150, manualSpeed: null, noData: false })
  private commanded: Commanded | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0

  constructor(readonly deviceType: DeviceType) {
    super('fitness', deviceType, {
      name: deviceType === 'treadmill' ? 'Simulated treadmill' : 'Simulated bike', address: `sim:${deviceType}`, protocol: 'sim',
      features: deviceType === 'treadmill'
        ? { speed: true, incline: true, speedRange: { min: 0, max: 8, step: 0.1 / 3.6 }, inclineRange: { min: -3, max: 15, step: 0.5 } }
        : { grade: true, power: true, powerRange: { min: 0, max: 2000, step: 1 } },
    })
  }

  async connect(): Promise<void> {
    this.state.status = 'simulated'
    this.lastTick = performance.now()
    if (!this.timer) this.timer = setInterval(() => this.tick(), 200)
    this.tick()
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state.status = 'disconnected'
    this.clearActual()
  }

  async setTargets(commanded: Commanded): Promise<void> {
    if (this.state.userStopped) return // a stopped machine ignores targets until the user restarts it
    // a fresh command from the bridge overrides whatever the "user" dialed on the machine
    if (this.commanded && this.deviceType === 'treadmill' && commanded.speed !== this.commanded.speed) this.controls.manualSpeed = null
    this.commanded = { ...commanded }
  }

  async stop(): Promise<void> {
    this.commanded = { ...(this.commanded ?? { speed: null, incline: null, power: null, grade: null, wind: null, crr: null, cw: null }), speed: 0, power: 0 }
    this.controls.manualSpeed = null
  }

  /** Simulate the machine being switched off (Bluetooth disconnects) and back on. */
  powerOff(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state.status = 'disconnected'
    this.clearActual()
  }
  powerOn(): void {
    void this.connect()
  }

  /** "User pressed STOP" on the machine (FTMS Machine Status 0x02). The belt spins down and stays stopped. */
  userPressStop(): void {
    this.state.userStopped = true
    this.controls.manualSpeed = null
    this.commanded = null
  }

  /** "User pressed START" on the machine (FTMS Machine Status 0x04). */
  userPressStart(): void {
    this.state.userStopped = false
  }

  /** "User pressed +0.5 km/h" on the machine's own buttons. */
  userPressSpeed(deltaMps: number): void {
    const base = this.controls.manualSpeed ?? this.actual.speed ?? this.commanded?.speed ?? 0
    this.controls.manualSpeed = Math.max(0, base + deltaMps)
  }

  private tick(): void {
    const now = performance.now()
    const dt = Math.min(1, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    const c = this.commanded
    const ctl = this.controls
    if (this.deviceType === 'treadmill') {
      if (this.state.userStopped) {
        this.actual.speed = lag(this.actual.speed, 0, dt)
      } else if (ctl.follow) {
        const targetSpeed = ctl.manualSpeed ?? c?.speed ?? this.actual.speed ?? 0
        this.actual.speed = lag(this.actual.speed, targetSpeed, dt)
        this.actual.incline = lag(this.actual.incline, c?.incline ?? this.actual.incline ?? 0, dt)
      } else {
        this.actual.speed = ctl.speed
        this.actual.incline = ctl.incline
      }
      // a treadmill's "power" is a rough estimate to make the metrics grid interesting
      this.actual.cadence = this.actual.speed && this.actual.speed > 0.3 ? Math.round(150 + this.actual.speed * 5) : null
      this.actual.power = null
    } else {
      if (ctl.follow) {
        const targetPower = c?.power ?? (c?.grade != null ? 120 + c.grade * 15 : ctl.power)
        this.actual.power = lag(this.actual.power, Math.max(0, targetPower), dt)
        this.actual.cadence = lag(this.actual.cadence, ctl.cadence, dt)
      } else {
        this.actual.power = ctl.power
        this.actual.cadence = ctl.cadence
      }
      // trainers do not measure these: actual = commanded
      this.actual.grade = c?.grade ?? null
      this.actual.wind = c?.wind ?? null
      this.actual.crr = c?.crr ?? null
      this.actual.cw = c?.cw ?? null
      this.actual.speed = null
    }
    if (ctl.noData) this.clearActual()
    // round for tidy JSON
    for (const k of ['speed', 'incline', 'power', 'cadence'] as const) {
      const v = this.actual[k]
      if (v != null) this.actual[k] = Math.round(v * 1000) / 1000
    }
  }
}

/** Fake heart-rate strap driven by a slider (with a little wobble). */
export class SimulatorHrm extends BaseDevice {
  readonly controls = reactive({ heartRate: 120, wobble: true })
  private timer: ReturnType<typeof setInterval> | null = null
  private phase = 0

  constructor() {
    super('hrm', 'hrm', { name: 'Simulated heart rate monitor', address: 'sim:hrm', protocol: 'sim' })
  }
  async connect(): Promise<void> {
    this.state.status = 'simulated'
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }
  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state.status = 'disconnected'
    this.clearActual()
  }
  async setTargets(): Promise<void> {}
  async stop(): Promise<void> {}
  private tick(): void {
    this.phase += 0.3
    const w = this.controls.wobble ? Math.round(Math.sin(this.phase) * 2) : 0
    this.actual.heartRate = Math.max(30, Math.round(this.controls.heartRate + w))
  }
}
