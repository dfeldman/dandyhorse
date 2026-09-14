/**
 * Zwift protocol ("ZAP") client for Zwift Hub-style trainers. See docs/devices/zwift-protocol.md.
 * Every message is <type byte><protobuf>. Grade and gear ratio go here; ERG stays on FTMS (as QZ does).
 */
import { concat, hex, startsWithBytes } from '../../core/bytes.ts';
import { withTimeout, type Clock } from '../../core/clock.ts';
import { Emitter } from '../../core/events.ts';
import type { Logger } from '../../core/log.ts';
import type { DeviceData } from '../../core/types.ts';
import { UUID } from '../../core/uuid.ts';
import type { Gatt } from '../../transport/gatt.ts';
import type { BleCharacteristic } from '../../transport/types.ts';
import { decodeMessage, PbWriter, unzigzag } from './protobuf.ts';

export const RIDE_ON = Uint8Array.from('RideOn', (c) => c.charCodeAt(0));
export const INFO_REQUEST = Uint8Array.of(0x00, 0x08, 0x00);
export const GEAR_RATIO_REQUEST = Uint8Array.of(0x00, 0x08, 0x88, 0x04);
export const DEVICE_INFO_REQUEST = Uint8Array.of(0x41, 0x08, 0x05);

export const MSG = {
  RIDING_DATA: 0x03,
  HUB_COMMAND: 0x04,
  LOG_TEXT: 0x2a,
  DEVICE_INFO: 0x3c,
} as const;

/** Zwift's 24 virtual gears as ratio x 10000, decoded from Zwift's own messages (gear 12 = 2.4 is the default). */
export const ZWIFT_GEAR_RATIOS_X10000: readonly number[] = [
  7500, 8700, 9900, 11100, 12300, 13800, 15300, 16800, 18600, 20400, 22200, 24000, 26099, 28200, 30300, 32400, 34900, 37400, 39900, 42399, 45400, 48400, 51400, 54899,
];

export const ZWIFT_GEAR_RATIOS: readonly number[] = ZWIFT_GEAR_RATIOS_X10000.map((v) => v / 10000);

export function rideOnHandshake(): Uint8Array {
  return concat(RIDE_ON, Uint8Array.of(0x02, 0x01));
}

export interface HubSimulation {
  gradePct: number;
  /** m/s; omitted when undefined, as Zwift does. */
  windMps?: number;
  /** Zwift uses 0.51. */
  cwa?: number;
  /** Zwift uses 0.004. */
  crr?: number;
}

/** HubCommand.Simulation: 04 22 <len> [08 wind] 10 <zigzag grade*100> [18 cwa] [20 crr]. */
export function hubSimulation(s: HubSimulation): Uint8Array {
  const sim = new PbWriter();
  if (s.windMps !== undefined) sim.sint(1, s.windMps * 100);
  sim.sint(2, s.gradePct * 100);
  if (s.cwa !== undefined) sim.varint(3, s.cwa * 10000);
  if (s.crr !== undefined) sim.varint(4, s.crr * 100000);
  return concat(Uint8Array.of(MSG.HUB_COMMAND), new PbWriter().message(4, sim).toBytes());
}

/** HubCommand.Physical.GearRatioX10000: 04 2A <len> 10 <varint>. */
export function hubGearRatio(ratio: number): Uint8Array {
  const phys = new PbWriter().varint(2, ratio * 10000);
  return concat(Uint8Array.of(MSG.HUB_COMMAND), new PbWriter().message(5, phys).toBytes());
}

/** HubCommand.PowerTarget: 04 18 <varint W>. */
export function hubPowerTarget(watts: number): Uint8Array {
  return concat(Uint8Array.of(MSG.HUB_COMMAND), new PbWriter().varint(3, Math.max(0, watts)).toBytes());
}

/** Riding data (type 0x03): power, cadence, speed x100, heart rate. */
export function parseRidingData(frame: Uint8Array): DeviceData {
  const out: DeviceData = {};
  for (const f of decodeMessage(frame.subarray(1))) {
    if (typeof f.value !== 'number') continue;
    if (f.field === 1) out.powerW = f.value;
    else if (f.field === 2) out.cadenceRpm = f.value;
    else if (f.field === 3) out.speedKmh = f.value / 100;
    else if (f.field === 4 && f.value > 0) out.heartRateBpm = f.value;
  }
  return out;
}

/** Decode the grade out of a simulation command (useful for tests and emulators). */
export function decodeHubSimulationGrade(frame: Uint8Array): number | undefined {
  if (frame[0] !== MSG.HUB_COMMAND) return undefined;
  for (const f of decodeMessage(frame.subarray(1))) {
    if (f.field !== 4 || typeof f.value === 'number') continue;
    for (const g of decodeMessage(f.value)) if (g.field === 2 && typeof g.value === 'number') return unzigzag(g.value) / 100;
  }
  return undefined;
}

export interface ZapEvents {
  data: DeviceData;
}

export class ZapClient {
  readonly events = new Emitter<ZapEvents>();
  active = false;
  #gatt: Gatt;
  #log: Logger;
  #clock: Clock;
  #rx: BleCharacteristic | undefined;
  #withResponse = true;
  #handshake: (() => void) | undefined;
  #lastGradeX100: number | undefined;
  #lastRatio: number | undefined;
  #unsubs: (() => Promise<void>)[] = [];

  constructor(gatt: Gatt, log: Logger, clock: Clock) {
    this.#gatt = gatt;
    this.#log = log;
    this.#clock = clock;
  }

  /** Subscribe and send RideOn. Resolves true when the trainer accepted the handshake. */
  async start(): Promise<boolean> {
    const g = this.#gatt;
    this.#rx = g.char(UUID.ZWIFT_SYNC_RX, UUID.ZWIFT_SERVICE);
    if (!this.#rx) return false;
    this.#withResponse = !this.#rx.properties.writeWithoutResponse;
    const async = g.char(UUID.ZWIFT_ASYNC, UUID.ZWIFT_SERVICE);
    const syncTx = g.char(UUID.ZWIFT_SYNC_TX, UUID.ZWIFT_SERVICE);
    if (async) this.#unsubs.push(await async.subscribe((d) => this.#onMessage(d)));
    if (syncTx) this.#unsubs.push(await syncTx.subscribe((d) => this.#onMessage(d)));
    const replied = new Promise<void>((resolve) => {
      this.#handshake = resolve;
    });
    await this.#write(rideOnHandshake());
    const ok = await withTimeout(replied, 2000, this.#clock, 'RideOn').then(
      () => true,
      () => false,
    );
    if (!ok) this.#log.warn('no RideOn reply from the trainer; sending Zwift commands anyway');
    this.active = true;
    return ok;
  }

  async stop(): Promise<void> {
    this.active = false;
    for (const off of this.#unsubs.splice(0)) await off().catch(() => undefined);
  }

  /** Forget what was last sent, so the next grade and gear go out even if unchanged (e.g. after ERG). */
  invalidate(): void {
    this.#lastGradeX100 = undefined;
    this.#lastRatio = undefined;
  }

  async setGrade(gradePct: number): Promise<void> {
    const x100 = Math.round(gradePct * 100);
    if (x100 === this.#lastGradeX100) return;
    await this.#write(hubSimulation({ gradePct: x100 / 100 }));
    this.#lastGradeX100 = x100;
  }

  /** 1-based index into ZWIFT_GEAR_RATIOS. The trainer ignores gears until it has seen a grade. */
  async setGear(gear: number): Promise<void> {
    const idx = Math.min(ZWIFT_GEAR_RATIOS_X10000.length, Math.max(1, Math.round(gear))) - 1;
    const ratio = ZWIFT_GEAR_RATIOS_X10000[idx]! / 10000;
    if (ratio === this.#lastRatio) return;
    if (this.#lastGradeX100 === undefined) await this.setGrade(0);
    await this.#write(hubGearRatio(ratio));
    await this.#write(GEAR_RATIO_REQUEST);
    this.#lastRatio = ratio;
  }

  async #write(data: Uint8Array): Promise<void> {
    if (!this.#rx) return;
    await this.#rx.write(data, this.#withResponse);
  }

  #onMessage(d: Uint8Array): void {
    if (startsWithBytes(d, RIDE_ON)) {
      this.#handshake?.();
      this.#handshake = undefined;
      return;
    }
    const type = d[0];
    if (type === MSG.RIDING_DATA) {
      try {
        this.events.emit('data', parseRidingData(d));
      } catch (err) {
        this.#log.debug(`bad riding data ${hex(d)}: ${String(err)}`);
      }
    } else if (type === MSG.LOG_TEXT) {
      this.#log.debug(`trainer says: ${String.fromCharCode(...d.subarray(1).filter((b) => b >= 0x20 && b < 0x7f))}`);
    }
  }
}
