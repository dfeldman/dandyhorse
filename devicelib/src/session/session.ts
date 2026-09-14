/**
 * One connected device: connect, identify, pick a driver, run the tick loop, merge telemetry,
 * translate game requests (grade, gears, power, speed) into what the device can do, and reconnect.
 */
import { realClock, sleep, type Clock } from '../core/clock.ts';
import { DeviceError } from '../core/errors.ts';
import { Emitter } from '../core/events.ts';
import { Logger } from '../core/log.ts';
import type { Capabilities, DeviceClass, DeviceData, LoadTarget, RiderProfile, Targets, Telemetry, WorkoutCommand } from '../core/types.ts';
import { DEFAULT_RIDER, noCapabilities } from '../core/types.ts';
import { UUID } from '../core/uuid.ts';
import { createDriver, detectStandardProtocol, hasDriver, hasFtmsData } from '../protocols/index.ts';
import { INFORMATIONAL_FLAGS, type DeviceDriver, type DriverNotice } from '../protocols/driver.ts';
import type { QuirkFlag } from '../quirks/flags.generated.ts';
import { Quirks, type QuirkOverrides } from '../quirks/quirks.ts';
import { matchDevice, variantsFor } from '../registry/matcher.ts';
import { protocolDisplayName } from '../registry/protocolNames.ts';
import type { RegistryEntry } from '../registry/types.ts';
import { Gatt, type GattSnapshot } from '../transport/gatt.ts';
import type { BleConnection, BleDevice } from '../transport/types.ts';
import { TelemetryTracker } from './metrics.ts';
import { gradeToLevel, levelToGrade } from './physics.ts';

export interface RoadSettings {
  windMps: number;
  crr: number;
  /** FTMS wind resistance coefficient, kg/m. QZ sends 0.25. */
  cwKgPerM: number;
  /** Drag area for speed estimates, m^2. */
  cdA: number;
}

export interface GearSettings {
  /** Number of virtual gears. */
  count: number;
  /** The gear the session starts in; also the "neutral" gear for emulated gears. */
  initial: number;
  /** Emulated gears on simulation trainers: grade added per gear above neutral (QZ uses 0.5 %). */
  gradePerGearPct: number;
  /** Emulated gears on resistance bikes: levels added per gear above neutral. */
  levelsPerGear: number;
}

export interface SessionOptions {
  log?: Logger;
  clock?: Clock;
  rider?: Partial<RiderProfile>;
  /** user_option values chosen for this device (see variantsFor / SessionInfo.variants). */
  userOptions?: string[];
  quirkOverrides?: QuirkOverrides;
  /**
   * Which protocol to use when a device speaks both FTMS and its own ("native") protocol.
   * auto (default): follow the registry's recommendation. ftms: FTMS whenever present.
   * native: the vendor protocol, or a raw capture of it when devicelib does not implement it yet.
   * Can be changed on a live session with setProtocolPreference().
   */
  protocolPreference?: ProtocolPreference;
  /** Use the Zwift protocol on trainers that have it (native gears). Default false. */
  zwiftProtocol?: boolean;
  /** Allow incomplete or side-effecting vendor control paths. Default false. */
  vendorControl?: boolean;
  /** Skip identification and use this protocol id. */
  forceProtocol?: string;
  tickMs?: number;
  staleMs?: number;
  /** Run the tick loop on a timer. Tests set this false and call tick(). Default true. */
  autoTick?: boolean;
  autoReconnect?: boolean;
  reconnectDelaysMs?: number[];
  /** Start the workout clock on first movement. Default true. */
  autoStart?: boolean;
  road?: Partial<RoadSettings>;
  gears?: Partial<GearSettings>;
  /** Override the grade -> resistance level mapping for bikes without simulation. */
  gradeToLevel?: (gradePct: number, range: { min: number; max: number; step: number }) => number;
}

export type SessionState = 'connecting' | 'ready' | 'reconnecting' | 'disconnected' | 'failed';

export type ProtocolPreference = 'auto' | 'ftms' | 'native';

/** What a "FTMS vs native" switch in the UI can offer for this device. */
export interface ProtocolOptions {
  preference: ProtocolPreference;
  ftmsAvailable: boolean;
  /** The device's own protocol, when the registry knows one other than FTMS. */
  native?: { id: string; name: string; implemented: boolean };
  /** True when both choices exist, i.e. the switch is worth showing. */
  switchable: boolean;
}

/** Why a protocol was chosen, for display and debugging. */
export type ProtocolSelection = 'registry' | 'preferred-ftms' | 'fallback-ftms' | 'standard' | 'raw' | 'forced';

export interface DeviceInformation {
  manufacturer?: string;
  model?: string;
  firmware?: string;
  hardware?: string;
  software?: string;
}

export interface SessionInfo {
  deviceId: string;
  deviceName: string | undefined;
  deviceClass: DeviceClass;
  protocolId: string;
  /** A friendly name to show users, e.g. "Bluetooth FTMS" or "Horizon (Johnson Health Tech)". */
  protocolName: string;
  selection: ProtocolSelection;
  /** One sentence on why, e.g. "FTMS preferred over Horizon (Johnson Health Tech)". */
  selectionNote: string;
  protocolOptions: ProtocolOptions;
  entry?: { id: string; doc: string; recommend: string; notes?: string };
  /** Model variants the user could pick, when the registry cannot tell them apart. */
  variants: { option: string; entryId: string; deviceClass: string }[];
  /** Quirk flags on this device that the driver does not act on yet. */
  unhandledFlags: QuirkFlag[];
  /** Quirk flags in force for this device, after user overrides. */
  quirkFlags: QuirkFlag[];
  deviceInformation: DeviceInformation;
  gatt: GattSnapshot;
}

export interface SessionEvents {
  state: SessionState;
  telemetry: Telemetry;
  data: DeviceData;
  notice: DriverNotice;
  info: SessionInfo;
  error: Error;
}

interface Resolved {
  log: Logger;
  clock: Clock;
  rider: RiderProfile;
  userOptions: string[];
  quirkOverrides: QuirkOverrides;
  protocolPreference: ProtocolPreference;
  zwiftProtocol: boolean;
  vendorControl: boolean;
  forceProtocol: string | undefined;
  tickMs: number;
  staleMs: number;
  autoTick: boolean;
  autoReconnect: boolean;
  reconnectDelaysMs: number[];
  autoStart: boolean;
  road: RoadSettings;
  gears: GearSettings;
  gradeToLevel: NonNullable<SessionOptions['gradeToLevel']>;
}

function resolve(o: SessionOptions): Resolved {
  return {
    log: o.log ?? new Logger({ source: 'devicelib' }),
    clock: o.clock ?? realClock,
    rider: { ...DEFAULT_RIDER, ...o.rider },
    userOptions: o.userOptions ?? [],
    quirkOverrides: o.quirkOverrides ?? {},
    protocolPreference: o.protocolPreference ?? 'auto',
    zwiftProtocol: o.zwiftProtocol ?? false,
    vendorControl: o.vendorControl ?? false,
    forceProtocol: o.forceProtocol,
    tickMs: o.tickMs ?? 200,
    staleMs: o.staleMs ?? 3000,
    autoTick: o.autoTick ?? true,
    autoReconnect: o.autoReconnect ?? true,
    reconnectDelaysMs: o.reconnectDelaysMs ?? [500, 1000, 2000, 5000, 10000, 10000, 10000],
    autoStart: o.autoStart ?? true,
    road: { windMps: 0, crr: 0.004, cwKgPerM: 0.25, cdA: 0.4, ...o.road },
    gears: { count: 24, initial: 12, gradePerGearPct: 0.5, levelsPerGear: 1, ...o.gears },
    gradeToLevel: o.gradeToLevel ?? ((g, r) => gradeToLevel(g, r)),
  };
}

const TEXT = new TextDecoder();

async function readDeviceInformation(gatt: Gatt, log: Logger): Promise<DeviceInformation> {
  const info: DeviceInformation = {};
  const fields: [keyof DeviceInformation, string][] = [
    ['manufacturer', UUID.MANUFACTURER_NAME],
    ['model', UUID.MODEL_NUMBER],
    ['firmware', UUID.FIRMWARE_REVISION],
    ['hardware', UUID.HARDWARE_REVISION],
    ['software', UUID.SOFTWARE_REVISION],
  ];
  for (const [key, uuid] of fields) {
    const c = gatt.char(uuid, UUID.DEVICE_INFORMATION);
    if (!c?.properties.read) continue;
    try {
      const s = TEXT.decode(await c.read()).replace(/\0+$/, '').trim();
      if (s) info[key] = s;
    } catch (err) {
      log.debug(`could not read ${key}: ${String(err)}`);
    }
  }
  return info;
}

/** Flags that stay meaningful when the session switches a device from its vendor protocol to FTMS. */
const PORTABLE_FLAGS: ReadonlySet<QuirkFlag> = new Set<QuirkFlag>([
  ...INFORMATIONAL_FLAGS,
  'nonsense_speed_on_connect',
  // Describes the device's FTMS firmware, so it matters most after switching to FTMS.
  'speed_sent_in_tenth_kmh',
]);

const MACHINE_CLASSES: ReadonlySet<DeviceClass> = new Set(['treadmill', 'bike', 'elliptical', 'rower']);

export class DeviceSession {
  readonly device: BleDevice;
  readonly events: Emitter<SessionEvents>;
  readonly log: Logger;
  #o: Resolved;
  #state: SessionState = 'connecting';
  #conn: BleConnection | undefined;
  #gatt: Gatt | undefined;
  #driver: DeviceDriver | undefined;
  #info: SessionInfo | undefined;
  #devInfo: DeviceInformation | undefined;
  #tracker: TelemetryTracker;
  #telemetry: Telemetry | undefined;
  #tickHandle: unknown;
  #ticking = false;
  #closing = false;
  #offDisconnect: (() => void) | undefined;
  #warned = new Set<string>();
  // Desired state from the game.
  #speedKmh: number | undefined;
  #inclinePct: number | undefined;
  #load: LoadTarget | undefined;
  #gear: number;

  private constructor(device: BleDevice, opts: SessionOptions) {
    this.device = device;
    this.#o = resolve(opts);
    this.log = this.#o.log.child(device.name ?? device.id);
    this.events = new Emitter<SessionEvents>((err, ev) => this.log.error(`"${String(ev)}" listener threw: ${String(err)}`));
    this.#gear = this.#o.gears.initial;
    this.#tracker = new TelemetryTracker({
      staleMs: this.#o.staleMs,
      rider: this.#o.rider,
      deviceClass: 'unknown',
      autoStart: this.#o.autoStart,
      crr: this.#o.road.crr,
      cdA: this.#o.road.cdA,
    });
  }

  /** Connect to a device already chosen (e.g. from adapter.requestDevice) and get it ready. */
  static async connect(device: BleDevice, opts: SessionOptions = {}): Promise<DeviceSession> {
    const s = new DeviceSession(device, opts);
    try {
      await s.#open();
    } catch (err) {
      s.#setState('failed');
      await s.#conn?.disconnect().catch(() => undefined);
      s.#offDisconnect?.();
      throw err;
    }
    if (s.#o.autoTick) s.#tickHandle = s.#o.clock.setInterval(() => void s.tick(), s.#o.tickMs);
    return s;
  }

  get state(): SessionState {
    return this.#state;
  }

  get info(): SessionInfo {
    if (!this.#info) throw new DeviceError('disconnected', 'session is not connected yet');
    return this.#info;
  }

  get capabilities(): Capabilities {
    return this.#driver?.capabilities() ?? noCapabilities();
  }

  get deviceClass(): DeviceClass {
    return this.#info?.deviceClass ?? 'unknown';
  }

  /** True for treadmills, bikes, ellipticals and rowers; false for sensors. */
  get isMachine(): boolean {
    return MACHINE_CLASSES.has(this.deviceClass);
  }

  get telemetry(): Telemetry | undefined {
    return this.#telemetry;
  }

  get gear(): number {
    return this.#gear;
  }

  get workoutState(): 'idle' | 'running' | 'paused' {
    return this.#tracker.state;
  }

  // ------------------------------------------------------------------ game-facing controls

  /** Treadmill belt speed. Applied on the next tick. */
  setTargetSpeed(kmh: number | undefined): void {
    this.#speedKmh = kmh;
  }

  setTargetIncline(pct: number | undefined): void {
    this.#inclinePct = pct;
  }

  /**
   * Road grade. Trainers simulate it (with the fixed wind and rolling resistance from `road`),
   * resistance bikes get a mapped level, and treadmills and ellipticals get it as incline.
   */
  setGrade(gradePct: number): void {
    this.#load = { mode: 'sim', gradePct, windMps: this.#o.road.windMps, crr: this.#o.road.crr, cwKgPerM: this.#o.road.cwKgPerM };
  }

  setRoad(road: Partial<RoadSettings>): void {
    this.#o.road = { ...this.#o.road, ...road };
    if (this.#load?.mode === 'sim') this.setGrade(this.#load.gradePct);
  }

  /** ERG mode. */
  setTargetPower(watts: number): void {
    this.#load = { mode: 'erg', powerW: watts };
  }

  setResistance(level: number): void {
    this.#load = { mode: 'resistance', level };
  }

  setGear(gear: number): void {
    this.#gear = Math.min(this.#o.gears.count, Math.max(1, Math.round(gear)));
  }

  shiftUp(): number {
    this.setGear(this.#gear + 1);
    return this.#gear;
  }

  shiftDown(): number {
    this.setGear(this.#gear - 1);
    return this.#gear;
  }

  async start(): Promise<void> {
    this.#tracker.state = 'running';
    await this.#command('start');
  }

  async pause(): Promise<void> {
    this.#tracker.state = 'paused';
    await this.#command('pause');
  }

  /** Stop the workout. Treadmills stop the belt; the speed target is cleared. */
  async stop(): Promise<void> {
    this.#tracker.state = 'idle';
    this.#speedKmh = undefined;
    await this.#command('stop');
  }

  resetTotals(): void {
    this.#tracker.resetTotals();
  }

  /**
   * Diagnostics: send a raw frame on the device's control channel (the FTMS control point for
   * FTMS devices) and resolve with the device's answer. The session's own targets stay in force,
   * so clear the matching target first or the next tick may override the raw command.
   */
  async sendRawControl(data: Uint8Array): Promise<string> {
    const driver = this.#driver;
    if (!driver?.rawControl) throw new DeviceError('not_supported', `${this.#info?.protocolName ?? 'this driver'} has no raw control channel`);
    return driver.rawControl(data);
  }

  /**
   * Diagnostics: the frame setTargetSpeed would send for `kmh`, in the device's own units (quirks
   * applied, no clamping), or undefined when the driver has no speed command.
   */
  encodeSpeedTarget(kmh: number): Uint8Array | undefined {
    return this.#driver?.encodeSpeedTarget?.(kmh);
  }

  /** Diagnostics: read any readable characteristic. The read is traced like all other traffic. */
  async readRaw(uuid: string | number): Promise<Uint8Array> {
    const c = this.#gatt?.char(uuid);
    if (!c?.properties.read) throw new DeviceError('not_supported', `characteristic ${String(uuid)} is not readable on this device`);
    return c.read();
  }

  async disconnect(): Promise<void> {
    this.#closing = true;
    if (this.#tickHandle !== undefined) this.#o.clock.clearInterval(this.#tickHandle);
    this.#tickHandle = undefined;
    this.#offDisconnect?.();
    await this.#driver?.stop().catch(() => undefined);
    this.#driver = undefined;
    await this.#conn?.disconnect().catch(() => undefined);
    this.#tracker.markDisconnected();
    this.#setState('disconnected');
  }

  /** One control-and-telemetry cycle. Runs on a timer unless autoTick is false. */
  async tick(): Promise<Telemetry> {
    if (!this.#ticking && this.#state === 'ready' && this.#driver) {
      this.#ticking = true;
      try {
        await this.#driver.apply(this.#effectiveTargets());
      } catch (err) {
        this.log.warn(`apply failed: ${String(err)}`);
      } finally {
        this.#ticking = false;
      }
    }
    const grade = this.#load?.mode === 'sim' ? this.#load.gradePct : undefined;
    const tel = this.#tracker.snapshot(this.#o.clock.now(), grade);
    if (grade !== undefined) tel.targetGradePct = grade;
    if (this.deviceClass === 'bike') tel.gear = this.#gear;
    this.#telemetry = tel;
    this.events.emit('telemetry', tel);
    return tel;
  }

  // ------------------------------------------------------------------ internals

  #setState(s: SessionState): void {
    if (s === this.#state) return;
    this.#state = s;
    this.log.info(`state: ${s}`);
    this.events.emit('state', s);
  }

  #warnOnce(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    this.log.warn(message);
  }

  async #command(c: WorkoutCommand): Promise<void> {
    if (this.#state !== 'ready' || !this.#driver) return;
    try {
      await this.#driver.command(c);
    } catch (err) {
      this.log.warn(`${c} failed: ${String(err)}`);
    }
  }

  async #open(): Promise<void> {
    this.#setState(this.#info ? 'reconnecting' : 'connecting');
    const conn = await this.device.connect();
    this.#conn = conn;
    this.#offDisconnect ??= this.device.onDisconnect(() => void this.#onLinkLost());
    const gatt = new Gatt(await conn.discover(), this.log.child('gatt'));
    this.log.debug(`GATT table:\n${gatt.describe()}`);
    this.#gatt = gatt;
    this.#devInfo ??= await readDeviceInformation(gatt, this.log);
    await this.#attach(gatt);
  }

  /** Pick the protocol, create and start its driver, and publish SessionInfo. */
  async #attach(gatt: Gatt): Promise<void> {
    const o = this.#o;
    const choice = this.#chooseProtocol(gatt);
    const entry = choice.entry;
    let quirks = Quirks.fromEntry(entry, o.quirkOverrides);
    if (entry && choice.protocolId !== entry.protocol) {
      // The entry's flags describe its own protocol; carry only portable flags and the params.
      quirks = new Quirks(entry.flags.filter((f) => PORTABLE_FLAGS.has(f)), entry.params, o.quirkOverrides);
    }
    const driver = createDriver(choice.protocolId, {
      gatt,
      deviceName: this.device.name,
      entry,
      quirks,
      log: this.log.child(choice.protocolId),
      clock: o.clock,
      options: { zwiftProtocol: o.zwiftProtocol, vendorControl: o.vendorControl },
      classHint: entry?.class as DeviceClass | undefined,
    });
    driver.events.on('data', (d) => {
      if (this.#driver !== driver) return;
      this.#tracker.ingest(d, o.clock.now());
      this.events.emit('data', d);
    });
    driver.events.on('notice', (n) => {
      if (this.#driver === driver) this.#onNotice(n);
    });
    this.#driver = driver;
    try {
      await driver.start();
    } catch (err) {
      this.#driver = undefined;
      await driver.stop().catch(() => undefined);
      throw err;
    }
    this.#tracker.opts = { ...this.#tracker.opts, deviceClass: driver.deviceClass };

    const unhandled = quirks.unhandled(driver.handledFlags);
    if (unhandled.length) this.log.warn(`quirks not implemented by the ${driver.protocolId} driver yet: ${unhandled.join(', ')}`);
    this.#info = {
      deviceId: this.device.id,
      deviceName: this.device.name,
      deviceClass: driver.deviceClass,
      protocolId: driver.protocolId,
      protocolName: driver.protocolName,
      selection: choice.selection,
      selectionNote: choice.note,
      protocolOptions: choice.options,
      entry: entry ? { id: entry.id, doc: entry.doc, recommend: entry.recommend, ...(entry.notes ? { notes: entry.notes } : {}) } : undefined,
      variants: variantsFor(this.device.name).map((v) => ({ option: v.option, entryId: v.entry.id, deviceClass: v.entry.class })),
      unhandledFlags: unhandled,
      quirkFlags: [...quirks.flags],
      deviceInformation: this.#devInfo ?? {},
      gatt: gatt.snapshot(),
    };
    this.log.info(`${this.#info.protocolName} (${choice.note})`);
    this.events.emit('info', this.#info);
    this.#setState('ready');
  }

  get protocolPreference(): ProtocolPreference {
    return this.#o.protocolPreference;
  }

  /** Switch between FTMS and the device's native protocol on the live connection. */
  async setProtocolPreference(pref: ProtocolPreference): Promise<void> {
    if (pref === this.#o.protocolPreference) return;
    this.#o.protocolPreference = pref;
    if (this.#state !== 'ready' || !this.#gatt) return;
    const old = this.#driver;
    this.#driver = undefined;
    await old?.stop().catch(() => undefined);
    try {
      await this.#attach(this.#gatt);
    } catch (err) {
      this.log.error(`could not switch protocol: ${String(err)}`);
      this.#setState('failed');
      throw err;
    }
  }

  #chooseProtocol(gatt: Gatt): { protocolId: string; selection: ProtocolSelection; note: string; entry?: RegistryEntry; options: ProtocolOptions } {
    const o = this.#o;
    const pref = o.protocolPreference;
    const ftms = gatt.has(UUID.FTMS) && hasFtmsData(gatt);
    const match = o.forceProtocol
      ? undefined
      : matchDevice({
          name: this.device.name,
          advertisedServices: this.device.advertisedServices ? new Set(this.device.advertisedServices) : undefined,
          gatt: gatt.uuids(),
          options: new Set(o.userOptions),
        });
    const entry = match?.entry;
    const nativeId = entry && entry.protocol !== 'ftms' ? entry.protocol : undefined;
    const options: ProtocolOptions = {
      preference: pref,
      ftmsAvailable: ftms,
      switchable: ftms && nativeId !== undefined,
      ...(nativeId ? { native: { id: nativeId, name: protocolDisplayName(nativeId), implemented: hasDriver(nativeId) } } : {}),
    };
    const pick = (protocolId: string, selection: ProtocolSelection, note: string) => ({ protocolId, selection, note, entry, options });

    if (o.forceProtocol) return pick(o.forceProtocol, 'forced', 'protocol forced by the app');
    if (!entry) {
      const std = detectStandardProtocol(gatt);
      return std === 'raw' ? pick('raw', 'raw', 'unknown device; capturing raw traffic') : pick(std, 'standard', `not in the registry; using ${protocolDisplayName(std)}`);
    }
    if (entry.recommend === 'skip') this.log.warn(`registry marks ${entry.id} as not worth supporting${entry.notes ? `: ${entry.notes}` : ''}`);
    if (!nativeId) return pick('ftms', 'registry', `matched registry entry ${entry.id}`);

    const vendor = protocolDisplayName(nativeId);
    const implemented = hasDriver(nativeId);
    if (pref === 'native') {
      return implemented
        ? pick(nativeId, 'registry', `${vendor} chosen over FTMS`)
        : pick(nativeId, 'raw', `${vendor} is not implemented yet; capturing raw traffic`);
    }
    if (ftms && (pref === 'ftms' || entry.recommend === 'prefer_ftms')) {
      return pick('ftms', 'preferred-ftms', pref === 'ftms' ? `FTMS chosen over ${vendor}` : `FTMS preferred over ${vendor}`);
    }
    if (implemented) return pick(nativeId, 'registry', `matched registry entry ${entry.id}`);
    if (ftms) {
      const risky = entry.flags.includes('prefer_proprietary_if_vendor_service') ? " (this device's FTMS is known to be unreliable)" : '';
      return pick('ftms', 'fallback-ftms', `${vendor} is not implemented yet; using FTMS${risky}`);
    }
    const std = detectStandardProtocol(gatt);
    if (std !== 'raw') return pick(std, 'standard', `${vendor} is not implemented yet; reading ${protocolDisplayName(std)}`);
    return pick(nativeId, 'raw', `${vendor} is not implemented yet; capturing raw traffic`);
  }

  #onNotice(n: DriverNotice): void {
    if (n.kind === 'stopped_by_user' || n.kind === 'paused_by_user') {
      // Do not fight the person on the machine: drop the speed target until the game sets a new one.
      this.#speedKmh = undefined;
      this.#tracker.state = 'paused';
    } else if (n.kind === 'started_by_user' && this.#tracker.state !== 'running') {
      this.#tracker.state = 'running';
    }
    this.events.emit('notice', n);
  }

  async #onLinkLost(): Promise<void> {
    if (this.#closing || this.#state === 'reconnecting') return;
    this.log.warn('connection lost');
    this.#tracker.markDisconnected();
    const old = this.#driver;
    this.#driver = undefined;
    await old?.stop().catch(() => undefined);
    if (!this.#o.autoReconnect) {
      this.#setState('disconnected');
      return;
    }
    this.#setState('reconnecting');
    for (const delay of this.#o.reconnectDelaysMs) {
      await sleep(this.#o.clock, delay);
      if (this.#closing) return;
      try {
        await this.#open();
        this.log.info('reconnected');
        return;
      } catch (err) {
        this.log.warn(`reconnect failed: ${String(err)}`);
        this.#setState('reconnecting');
      }
    }
    this.#setState('failed');
    this.events.emit('error', new DeviceError('disconnected', 'gave up reconnecting'));
  }

  /** Turn the game's requests into targets this device can actually take. */
  #effectiveTargets(): Targets {
    const caps = this.capabilities;
    const cls = this.deviceClass;
    const g = this.#o.gears;
    const t: Targets = {};
    if (this.#speedKmh !== undefined) {
      if (caps.speed) t.speedKmh = this.#speedKmh;
      else this.#warnOnce('speed', 'this device does not accept speed commands');
    }
    if (this.#inclinePct !== undefined) {
      if (caps.incline) t.inclinePct = this.#inclinePct;
      else this.#warnOnce('incline', 'this device does not accept incline commands');
    }
    const load = this.#load;
    if (!load) return t;
    const gearSteps = this.#gear - g.initial;
    const range = caps.limits.resistance;

    if (load.mode === 'sim') {
      if ((cls === 'treadmill' || cls === 'elliptical') && caps.incline) {
        if (this.#inclinePct === undefined) t.inclinePct = load.gradePct;
      } else if (caps.simulation) {
        t.load = caps.nativeGears ? load : { ...load, gradePct: load.gradePct + gearSteps * g.gradePerGearPct };
        if (caps.nativeGears) t.gear = this.#gear;
      } else if (caps.resistance && range) {
        t.load = { mode: 'resistance', level: this.#o.gradeToLevel(load.gradePct, range) + gearSteps * g.levelsPerGear };
      } else {
        this.#warnOnce('sim', 'this device cannot take a grade (no simulation, resistance or incline control)');
      }
    } else if (load.mode === 'erg') {
      if (caps.erg) t.load = load;
      else this.#warnOnce('erg', 'this device does not support target power (ERG)');
    } else {
      if (caps.resistance) t.load = { mode: 'resistance', level: load.level + gearSteps * g.levelsPerGear };
      else if (caps.simulation && range === undefined) {
        const grade = levelToGrade(load.level, { min: 0, max: 100, step: 1 });
        t.load = { mode: 'sim', gradePct: grade, windMps: this.#o.road.windMps, crr: this.#o.road.crr, cwKgPerM: this.#o.road.cwKgPerM };
      } else this.#warnOnce('resistance', 'this device does not accept resistance commands');
    }
    return t;
  }
}
