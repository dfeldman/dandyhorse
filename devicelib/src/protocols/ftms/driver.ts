/**
 * Generic FTMS driver for treadmills, bikes, ellipticals and rowers, with the quirk flags from
 * docs/devices/quirks.md. The Zwift protocol rides along for Zwift Hub-style trainers.
 */
import { clamp, hex, roundToStep } from '../../core/bytes.ts';
import { sleep } from '../../core/clock.ts';
import { DeviceError } from '../../core/errors.ts';
import type { Capabilities, DeviceClass, DeviceData, LoadTarget, Range, Targets, WorkoutCommand } from '../../core/types.ts';
import { noCapabilities } from '../../core/types.ts';
import { UUID } from '../../core/uuid.ts';
import type { QuirkFlag } from '../../quirks/flags.generated.ts';
import type { Gatt } from '../../transport/gatt.ts';
import { BaseDriver, INFORMATIONAL_FLAGS, prefersWithResponse, type DriverContext } from '../driver.ts';
import { parseHeartRate } from '../sensors.ts';
import { ZapClient } from '../zwift/zap.ts';
import {
  cmd,
  parseCrossTrainerData,
  parseIndoorBikeData,
  parseInclineRange,
  parsePowerRange,
  parseResistanceRange,
  parseRowerData,
  parseSpeedRange,
  parseTreadmillData,
  STATUS,
  type FtmsResult,
} from './codec.ts';
import { ControlPoint, DEFAULT_CONTROL_TIMEOUT_MS } from './controlPoint.ts';

const KMH_PER_MPH = 1.609344;

const HANDLED: readonly QuirkFlag[] = [
  ...INFORMATIONAL_FLAGS,
  'skip_control_refresh',
  'request_control_twice',
  'request_control_with_code',
  'reset_before_control',
  'start_via_stop_opcode',
  'inject_start_before_sim',
  'wait_for_console_start',
  'write_with_response_required',
  'subscribe_ftms_service_only',
  'backoff_on_control_not_permitted',
  'keepalive_start_every_second',
  'init_right_after_discovery',
  'speed_control_unsupported',
  'incline_control_unsupported',
  'speed_sent_in_mph',
  'speed_sent_in_tenth_kmh',
  'speed_reported_in_mph',
  'nonsense_speed_on_connect',
  'incline_not_reported',
  'incline_report_unreliable',
  'incline_no_half_percent',
  'incline_fixed_report',
  'sim_unsupported',
  'erg_unsupported',
  'resistance_uint16_x10',
  'resistance_uint8_x10',
  'resistance_via_sim_grade',
  'resistance_report_div10',
  'resistance_report_ignore',
  'resistance_level_x2',
  'resistance_rate_limited',
  'resistance_not_reported',
  'resistance_control_unsupported',
  'power_not_reported',
  'cadence_ghost_when_freewheeling',
  'stroke_rate_whole_spm',
  'ignore_zero_power_samples',
  'energy_div10',
  'metrics_need_cadence',
  'zwift_zap_service',
  'zap_gear_needs_grade_first',
];

const DATA_CHAR: Partial<Record<DeviceClass, string>> = {
  treadmill: UUID.TREADMILL_DATA,
  bike: UUID.INDOOR_BIKE_DATA,
  rower: UUID.ROWER_DATA,
  elliptical: UUID.CROSS_TRAINER_DATA,
};

/** Class from the FTMS data characteristics present; a registry hint wins when its characteristic exists. */
export function detectFtmsClass(gatt: Gatt, hint?: DeviceClass): DeviceClass {
  if (hint && DATA_CHAR[hint] && gatt.has(DATA_CHAR[hint]!)) return hint;
  if (gatt.has(UUID.TREADMILL_DATA)) return 'treadmill';
  if (gatt.has(UUID.INDOOR_BIKE_DATA)) return 'bike';
  if (gatt.has(UUID.ROWER_DATA)) return 'rower';
  if (gatt.has(UUID.CROSS_TRAINER_DATA)) return hint === 'treadmill' || hint === 'bike' ? hint : 'elliptical';
  return hint ?? 'unknown';
}

type Channel = 'speed' | 'incline' | 'load';

export class FtmsDriver extends BaseDriver {
  readonly protocolId = 'ftms';
  readonly deviceClass: DeviceClass;
  readonly handledFlags = HANDLED;
  #cp: ControlPoint | undefined;
  #zap: ZapClient | undefined;
  #ranges: { speed?: Range; incline?: Range; resistance?: Range; power?: Range } = {};
  #caps: Capabilities = noCapabilities();
  #sent = new Map<Channel, string>();
  #lastWriteAt = new Map<Channel, number>();
  #connectedAt = 0;
  #speedCommanded = false;
  #simStarted = false;
  #needHandshake = false;
  #backoffUntil = 0;
  #lastKeepalive = 0;
  #lastPower: number | undefined;
  #primaryDataAt = -Infinity;

  constructor(ctx: DriverContext) {
    super(ctx);
    this.deviceClass = detectFtmsClass(ctx.gatt, ctx.classHint);
  }

  get protocolName(): string {
    return this.#zap?.active ? 'Bluetooth FTMS + Zwift protocol' : 'Bluetooth FTMS';
  }

  capabilities(): Capabilities {
    return this.#caps;
  }

  async start(): Promise<void> {
    const { gatt, quirks: q, clock } = this.ctx;
    this.#connectedAt = clock.now();
    const inFtms = (uuid: string) => gatt.char(uuid, UUID.FTMS) ?? gatt.char(uuid);

    // Telemetry: the class's own data characteristic, with Cross Trainer Data as a fallback.
    const primary = DATA_CHAR[this.deviceClass];
    const primaryChar = primary ? inFtms(primary) : undefined;
    if (primaryChar) await this.listen(primaryChar, (d) => this.#onData(primary!, d));
    const cross = inFtms(UUID.CROSS_TRAINER_DATA);
    if (cross && cross !== primaryChar) await this.listen(cross, (d) => this.#onData(UUID.CROSS_TRAINER_DATA, d));
    if (!primaryChar && !cross) this.log.warn('no FTMS data characteristic found; telemetry will be empty');

    const status = inFtms(UUID.FTMS_STATUS);
    if (status && (status.properties.notify || status.properties.indicate)) await this.listen(status, (d) => this.#onStatus(d));

    if (!q.has('subscribe_ftms_service_only')) {
      const hr = gatt.char(UUID.HEART_RATE_MEASUREMENT, UUID.HEART_RATE);
      if (hr) await this.listen(hr, (d) => this.emitData({ heartRateBpm: parseHeartRate(d) }));
    }

    await this.#readRanges();

    const cpChar = inFtms(UUID.FTMS_CONTROL_POINT);
    if (cpChar) {
      this.#cp = new ControlPoint(cpChar, {
        clock,
        log: this.log.child('cp'),
        withResponse: prefersWithResponse(cpChar, q),
        timeoutMs: q.num('control_timeout_ms', DEFAULT_CONTROL_TIMEOUT_MS),
      });
      await this.#cp.start();
      if (q.has('wait_for_console_start')) this.notice('info', 'waiting for the start button on the console');
      else await this.#handshake(true);
    } else {
      this.log.info('no FTMS control point: read-only');
    }

    if (this.ctx.options.zwiftProtocol && this.deviceClass === 'bike' && gatt.has(UUID.ZWIFT_SERVICE)) {
      this.#zap = new ZapClient(gatt, this.log.child('zap'), clock);
      this.#zap.events.on('data', (d) => {
        // Zwift riding data only fills in when FTMS goes quiet.
        if (clock.now() - this.#primaryDataAt > 2000) this.emitData(d);
      });
      await this.#zap.start();
    }
    this.#caps = this.#computeCaps();
  }

  override async stop(): Promise<void> {
    await this.#zap?.stop();
    await this.#cp?.stop();
    await super.stop();
  }

  async #readRanges(): Promise<void> {
    const read = async (uuid: string, parse: (d: Uint8Array) => Range): Promise<Range | undefined> => {
      const c = this.ctx.gatt.char(uuid);
      if (!c?.properties.read) return undefined;
      try {
        const r = parse(await c.read());
        return r.max > r.min ? r : undefined;
      } catch (err) {
        this.log.debug(`could not read range ${uuid}: ${String(err)}`);
        return undefined;
      }
    };
    this.#ranges = {
      speed: await read(UUID.SUPPORTED_SPEED_RANGE, parseSpeedRange),
      incline: await read(UUID.SUPPORTED_INCLINE_RANGE, parseInclineRange),
      resistance: await read(UUID.SUPPORTED_RESISTANCE_RANGE, parseResistanceRange),
      power: await read(UUID.SUPPORTED_POWER_RANGE, parsePowerRange),
    };
  }

  async #handshake(initial: boolean): Promise<void> {
    const cp = this.#cp;
    if (!cp) return;
    const q = this.ctx.quirks;
    if (q.has('reset_before_control')) {
      await cp.send(cmd.requestControl());
      await cp.send(cmd.reset());
    }
    const code = q.params['request_control_bytes'];
    const request = Array.isArray(code) ? Uint8Array.from(code as number[]) : cmd.requestControl();
    let r = await cp.send(request);
    if (q.has('request_control_twice')) {
      await sleep(this.ctx.clock, 500);
      r = await cp.send(request);
    }
    if (r !== 'success' && r !== 'timeout') this.log.warn(`request control answered ${r}`);
    // Bikes and rowers start streaming on Start; treadmills would start the belt, so they wait for a command.
    if (initial && (this.deviceClass === 'bike' || this.deviceClass === 'rower')) {
      await cp.send(q.has('start_via_stop_opcode') ? cmd.stop() : cmd.start());
    }
    this.#needHandshake = false;
  }

  #computeCaps(): Capabilities {
    const q = this.ctx.quirks;
    const cp = !!this.#cp;
    const caps = noCapabilities();
    caps.startStop = cp;
    const c = this.deviceClass;
    if (c === 'treadmill') {
      caps.speed = cp && !q.has('speed_control_unsupported');
      caps.incline = cp && !q.has('incline_control_unsupported');
    } else if (c === 'bike') {
      caps.simulation = cp && !q.has('sim_unsupported');
      caps.erg = cp && !q.has('erg_unsupported');
      caps.resistance = cp && !q.has('resistance_control_unsupported');
      caps.nativeGears = !!this.#zap?.active;
    } else if (c === 'elliptical') {
      caps.incline = cp && !q.has('incline_control_unsupported') && (this.#ranges.incline !== undefined || q.optNum('incline_max') !== undefined);
      caps.resistance = cp && !q.has('resistance_control_unsupported');
    } else if (c === 'rower') {
      caps.resistance = cp && !q.has('resistance_control_unsupported');
    }

    const speed = this.#ranges.speed;
    if (c === 'treadmill') {
      caps.limits.speedKmh = {
        min: q.num('speed_min_kmh', speed?.min ?? 0.5),
        max: q.num('speed_max_kmh', speed?.max ?? 20),
        step: q.num('speed_step_kmh', speed?.step || 0.1),
      };
    }
    if (c === 'treadmill' || c === 'elliptical') {
      const inc = this.#ranges.incline;
      let step = q.num('incline_step', inc?.step || 0.5);
      if (q.has('incline_no_half_percent')) step = Math.max(step, 1);
      caps.limits.inclinePct = { min: q.num('incline_min', inc?.min ?? 0), max: q.num('incline_max', inc?.max ?? 15), step };
    }
    if (caps.resistance) {
      const res = this.#ranges.resistance;
      const max = q.optNum('max_resistance') ?? q.optNum('level_max') ?? q.optNum('resistance_max') ?? res?.max ?? 100;
      caps.limits.resistance = { min: q.num('resistance_min', res?.min ?? 1), max, step: 1 };
    }
    if (this.#ranges.power) caps.limits.powerW = this.#ranges.power;
    return caps;
  }

  // ------------------------------------------------------------------ telemetry

  #onData(uuid: string, d: Uint8Array): void {
    const q = this.ctx.quirks;
    let data: DeviceData;
    if (uuid === UUID.INDOOR_BIKE_DATA) data = parseIndoorBikeData(d);
    else if (uuid === UUID.TREADMILL_DATA) data = parseTreadmillData(d);
    else if (uuid === UUID.ROWER_DATA) data = parseRowerData(d, q.has('stroke_rate_whole_spm'));
    else {
      // Cross Trainer Data is only used on its own class, or until the primary characteristic speaks.
      if (this.deviceClass !== 'elliptical' && this.ctx.clock.now() - this.#primaryDataAt < 3000) return;
      data = parseCrossTrainerData(d);
    }
    if (uuid !== UUID.CROSS_TRAINER_DATA || this.deviceClass === 'elliptical') this.#primaryDataAt = this.ctx.clock.now();
    this.emitData(this.#fixup(data));
  }

  /** Apply read-side quirks. */
  #fixup(data: DeviceData): DeviceData {
    const q = this.ctx.quirks;
    const now = this.ctx.clock.now();
    if (data.speedKmh !== undefined && q.has('speed_reported_in_mph')) data.speedKmh *= KMH_PER_MPH;
    if (q.has('nonsense_speed_on_connect') && !this.#speedCommanded && now - this.#connectedAt < 5000) delete data.speedKmh;
    if (q.has('incline_not_reported') || q.has('incline_report_unreliable')) delete data.inclinePct;
    const fixed = q.optNum('incline_fixed');
    if (q.has('incline_fixed_report') && fixed !== undefined) data.inclinePct = fixed;
    if (data.resistanceLevel !== undefined && q.has('resistance_report_div10')) data.resistanceLevel /= 10;
    if (data.resistanceLevel !== undefined && q.has('resistance_level_x2')) data.resistanceLevel /= 2;
    if (q.has('resistance_report_ignore') || q.has('resistance_not_reported')) delete data.resistanceLevel;
    if (data.deviceEnergyKcal !== undefined && q.has('energy_div10')) data.deviceEnergyKcal /= 10;
    if (q.has('power_not_reported')) delete data.powerW;
    if (q.has('ignore_zero_power_samples') && data.powerW === 0 && (this.#lastPower ?? 0) > 0) delete data.powerW;
    if (data.powerW !== undefined) this.#lastPower = data.powerW;
    if (q.has('cadence_ghost_when_freewheeling') && data.powerW === 0 && data.cadenceRpm !== undefined) data.cadenceRpm = 0;
    if (q.has('metrics_need_cadence') && (data.strokeRatePerMin === 0 || data.cadenceRpm === 0)) {
      data.powerW = 0;
      delete data.paceSecPer500m;
      if (data.speedKmh !== undefined) data.speedKmh = 0;
    }
    return data;
  }

  #onStatus(d: Uint8Array): void {
    const op = d[0];
    const q = this.ctx.quirks;
    if (op === STATUS.STARTED_OR_RESUMED_BY_USER || (q.has('wait_for_console_start') && op === 0x02 && d[1] === 0x01)) {
      this.notice('started_by_user', 'started from the console');
      if (q.has('wait_for_console_start')) void this.#handshake(true);
    } else if (op === STATUS.STOPPED_OR_PAUSED_BY_USER) {
      this.notice(d[1] === 0x02 ? 'paused_by_user' : 'stopped_by_user', d[1] === 0x02 ? 'paused from the console' : 'stopped from the console');
    } else if (op === STATUS.STOPPED_BY_SAFETY_KEY) {
      this.notice('stopped_by_user', 'safety key pulled');
    } else if (op === STATUS.CONTROL_PERMISSION_LOST) {
      this.#needHandshake = true;
      this.#sent.clear();
      this.notice('control_lost', 'the machine took back control; requesting it again');
    }
  }

  // ------------------------------------------------------------------ control

  override async apply(targets: Targets): Promise<void> {
    const cp = this.#cp;
    if (!cp) return;
    const now = this.ctx.clock.now();
    if (now < this.#backoffUntil) return;
    if (this.#needHandshake) await this.#handshake(false);
    const q = this.ctx.quirks;
    if (q.has('keepalive_start_every_second') && now - this.#lastKeepalive >= 1000) {
      this.#lastKeepalive = now;
      await cp.send(cmd.start());
    }
    const caps = this.#caps;
    if (targets.speedKmh !== undefined && caps.speed) await this.#applySpeed(targets.speedKmh);
    if (targets.inclinePct !== undefined && caps.incline) await this.#applyIncline(targets.inclinePct);
    if (targets.load) await this.#applyLoad(targets.load, targets.gear);
  }

  override async command(c: WorkoutCommand): Promise<void> {
    const cp = this.#cp;
    if (!cp) return;
    if (c === 'start') {
      if (!this.ctx.quirks.has('skip_control_refresh')) await cp.send(cmd.requestControl());
      await cp.send(cmd.start());
    } else {
      // Like start: take control first, so a stop still works after the machine took control back.
      if (!this.ctx.quirks.has('skip_control_refresh')) await cp.send(cmd.requestControl());
      await cp.send(c === 'pause' ? cmd.pause() : cmd.stop());
      this.#sent.delete('speed');
    }
  }

  /** Diagnostics: a raw control-point frame, queued with everything else. */
  async rawControl(data: Uint8Array): Promise<string> {
    if (!this.#cp) throw new DeviceError('not_supported', 'this device has no FTMS control point');
    const op = data[0];
    // Forget what the tick loop last sent on this channel, so the next real target goes out again.
    if (op === 0x02 || op === 0x08) this.#sent.delete('speed');
    else if (op === 0x03) this.#sent.delete('incline');
    else if (op === 0x04 || op === 0x05 || op === 0x11) this.#sent.delete('load');
    return this.#cp.send(data);
  }

  async #send(channel: Channel, data: Uint8Array, refresh: 'none' | 'control' | 'control+start'): Promise<FtmsResult | 'unchanged' | 'deferred'> {
    const cp = this.#cp!;
    const q = this.ctx.quirks;
    const key = hex(data);
    if (this.#sent.get(channel) === key) return 'unchanged';
    const now = this.ctx.clock.now();
    if (channel === 'load' && q.has('resistance_rate_limited')) {
      const min = q.num('write_min_interval_ms', 1500);
      if (now - (this.#lastWriteAt.get(channel) ?? -Infinity) < min) return 'deferred';
    }
    if (refresh !== 'none' && !q.has('skip_control_refresh')) {
      await cp.send(cmd.requestControl());
      if (refresh === 'control+start') await cp.send(cmd.start());
    }
    const r = await cp.send(data);
    this.#lastWriteAt.set(channel, now);
    if (r === 'control_not_permitted') {
      this.#sent.delete(channel);
      this.#needHandshake = true;
      if (q.has('backoff_on_control_not_permitted')) this.#backoffUntil = now + 3000;
    } else {
      // Success, timeout, or a refusal we should not repeat every tick.
      this.#sent.set(channel, key);
      if (r === 'not_supported' || r === 'invalid_parameter' || r === 'failed') this.log.warn(`${channel} command ${key} refused: ${r}`);
    }
    return r;
  }

  async #applySpeed(kmh: number): Promise<void> {
    const lim = this.#caps.limits.speedKmh!;
    const tenths = this.ctx.quirks.has('speed_sent_in_tenth_kmh');
    // With tenths on the wire, rounding happens below (upwards), not to the nearest step here.
    let v = clamp(tenths ? kmh : roundToStep(kmh, lim.step), 0, lim.max);
    if (v > 0 && v < lim.min) v = lim.min;
    if (v <= 0) {
      await this.#send('speed', cmd.pause(), 'none');
      return;
    }
    this.#speedCommanded = true;
    await this.#send('speed', this.encodeSpeedTarget(v), 'control+start');
  }

  /**
   * The Set Target Speed frame for this device, in the units its firmware reads (quirks applied).
   * No clamping: #applySpeed clamps first, and diagnostics tools send what the user typed.
   */
  encodeSpeedTarget(kmh: number): Uint8Array {
    const q = this.ctx.quirks;
    const wire = q.has('speed_sent_in_mph') ? kmh / KMH_PER_MPH : kmh;
    if (q.has('speed_sent_in_tenth_kmh')) {
      // Horizon 7-series firmware reads the 0.01 km/h field as 0.1 km/h. Round up so a console that
      // truncates to 0.1 mph shows the intended value, after snapping to 0.001 km/h so float noise
      // (2 km/h arriving as 2.000016 from m/s) does not round up a whole tenth.
      return cmd.setSpeedRaw(Math.ceil(Math.round(wire * 1000) / 100 - 1e-9));
    }
    return cmd.setSpeed(Math.round(wire * 100) / 100);
  }

  async #applyIncline(pct: number): Promise<void> {
    const lim = this.#caps.limits.inclinePct!;
    const v = clamp(roundToStep(pct, lim.step), lim.min, lim.max);
    const r = await this.#send('incline', cmd.setIncline(v), 'control');
    const q = this.ctx.quirks;
    if (r !== 'unchanged' && r !== 'deferred' && (q.has('incline_not_reported') || q.has('incline_report_unreliable'))) {
      this.emitData({ inclinePct: v });
    }
  }

  async #applyLoad(load: LoadTarget, gear: number | undefined): Promise<void> {
    const q = this.ctx.quirks;
    const caps = this.#caps;
    if (load.mode === 'sim') {
      if (!caps.simulation) return;
      if (this.#zap?.active) {
        await this.#zap.setGrade(load.gradePct);
        if (gear !== undefined) await this.#zap.setGear(gear);
        return;
      }
      if (q.has('inject_start_before_sim') && !this.#simStarted) {
        await this.#cp!.send(cmd.start());
        this.#simStarted = true;
      }
      await this.#send('load', cmd.setSimulation(load), 'none');
    } else if (load.mode === 'erg') {
      if (!caps.erg) return;
      // ERG stays on FTMS even with the Zwift protocol; the trainer drops its simulation state.
      this.#zap?.invalidate();
      await this.#send('load', cmd.setPower(Math.round(load.powerW)), 'none');
    } else {
      if (!caps.resistance) return;
      this.#zap?.invalidate();
      const lim = caps.limits.resistance!;
      const level = clamp(Math.round(load.level), lim.min, lim.max);
      const r = await this.#send('load', this.#encodeResistance(level), 'none');
      if (r !== 'unchanged' && r !== 'deferred' && (q.has('resistance_report_ignore') || q.has('resistance_not_reported'))) {
        this.emitData({ resistanceLevel: level });
      }
    }
  }

  #encodeResistance(level: number): Uint8Array {
    const q = this.ctx.quirks;
    if (q.has('resistance_via_sim_grade')) {
      const grade = (level - q.num('flat_level', 0)) * q.num('grade_per_level', 1);
      return cmd.setSimulation({ gradePct: grade, windMps: 0, crr: 0.004, cwKgPerM: 0.25 });
    }
    if (q.has('resistance_uint16_x10')) return cmd.setResistanceU16x10(level);
    if (q.has('resistance_uint8_x10')) return cmd.setResistanceU8x10(level);
    if (q.has('resistance_level_x2')) return cmd.setResistanceRaw(level * 2);
    return cmd.setResistanceRaw(level);
  }
}
