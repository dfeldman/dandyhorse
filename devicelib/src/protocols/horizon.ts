/**
 * Horizon / Johnson Health Tech treadmill vendor protocol (service 0xFFF0, write 0xFFF3, notify 0xFFF4).
 * See docs/devices/treadmills/horizon.md.
 *
 * Status: telemetry is implemented. Control is opt-in (options.vendorControl) and incomplete:
 * the full init writes six user profiles to the console, overwriting the owner's profiles, so it is
 * not implemented. Most Horizons also expose FTMS, which the session prefers (recommend: prefer_ftms).
 */
import { concat, crc16CcittFalse, hex, roundToStep, clamp } from '../core/bytes.ts';
import type { Capabilities, DeviceClass, DeviceData, Targets, WorkoutCommand } from '../core/types.ts';
import { noCapabilities } from '../core/types.ts';
import { UUID } from '../core/uuid.ts';
import type { QuirkFlag } from '../quirks/flags.generated.ts';
import type { BleCharacteristic } from '../transport/types.ts';
import { BaseDriver, chunks, INFORMATIONAL_FLAGS, prefersWithResponse } from './driver.ts';

const MPH_PER_KMH = 0.621371;
const KMH_PER_MPH = 1.609344;

// ---------------------------------------------------------------- codec

/** 55 AA <id LE> <group> <cmd> <len LE> <crc LE> <payload>. CRC-16/CCITT-FALSE over the payload; 0 when empty. */
export function horizonFrame(id: number, group: number, command: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const crc = payload.length ? crc16CcittFalse(payload) : 0;
  const header = Uint8Array.of(0x55, 0xaa, id & 0xff, (id >> 8) & 0xff, group, command, payload.length & 0xff, payload.length >> 8, crc & 0xff, crc >> 8);
  return concat(header, payload);
}

export const horizon = {
  hello: (): Uint8Array => horizonFrame(0x0001, 0x01, 0x02),
  /** Always tenths of a mph on the wire, whatever the console's units. */
  setSpeed: (id: number, kmh: number): Uint8Array => {
    const s = Math.round(kmh * MPH_PER_KMH * 10);
    return horizonFrame(id, 0x03, 0x05, Uint8Array.of(0x00, s & 0xff, s >> 8, 0x00));
  },
  setIncline: (id: number, pct: number): Uint8Array => {
    const i = Math.round(pct * 10);
    return horizonFrame(id, 0x03, 0x06, Uint8Array.of(i & 0xff, i >> 8, 0x00));
  },
  /** Fixed "manual workout" start with a precomputed CRC (default flavour). */
  start: (): Uint8Array =>
    Uint8Array.of(0x55, 0xaa, 0x11, 0x00, 0x03, 0x02, 0x11, 0x00, 0x84, 0xbe, 0x00, 0x00, 0x08, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01),
  pause: (id: number): Uint8Array => horizonFrame(id, 0x03, 0x03, Uint8Array.of(0x00)),
  resume: (id: number): Uint8Array => horizonFrame(id, 0x03, 0x03, Uint8Array.of(0x01)),
  stop: (id: number): Uint8Array => horizonFrame(id, 0x01, 0x14),
};

/** Joins 20-byte notifications into whole frames. */
export class HorizonReassembler {
  #buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    this.#buf = concat(this.#buf, chunk);
    const frames: Uint8Array[] = [];
    for (;;) {
      const start = this.#buf.indexOf(0x55);
      if (start < 0) {
        this.#buf = new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buf = this.#buf.slice(start);
      if (this.#buf.length < 8) break;
      const total = (this.#buf[6]! | (this.#buf[7]! << 8)) + 10;
      if (this.#buf.length < total) break;
      frames.push(this.#buf.slice(0, total));
      this.#buf = this.#buf.slice(total);
    }
    return frames;
  }
}

/** Speed and incline from a status frame, or undefined for frames without them. */
export function parseHorizonStatus(f: Uint8Array): DeviceData | undefined {
  if (f.length < 10 || f[0] !== 0x55 || f[1] !== 0xaa) return undefined;
  const command = f[5];
  if (command === 0x17 && f.length > 70) {
    return { speedKmh: ((f[24]! | (f[25]! << 8)) / 100) * KMH_PER_MPH, inclinePct: f[30]! / 10 };
  }
  if (command === 0x12 && f.length > 70) {
    return { speedKmh: ((f[61]! | (f[62]! << 8)) / 1000) * KMH_PER_MPH, inclinePct: f[63]! / 10 };
  }
  if (f.length === 29) return { speedKmh: (f[14]! | (f[15]! << 8)) / 10 };
  return undefined;
}

/** The console's own stop button sends this pause frame. */
export function isConsolePause(f: Uint8Array): boolean {
  return f.length === 11 && f[4] === 0x03 && f[5] === 0x03 && f[10] === 0x00;
}

// ---------------------------------------------------------------- driver

const HANDLED: readonly QuirkFlag[] = [
  ...INFORMATIONAL_FLAGS,
  'proprietary_init_overwrites_user_profiles',
  'nonsense_speed_on_connect',
  // FTMS-only; the vendor protocol has its own speed units.
  'speed_sent_in_tenth_kmh',
];

export class HorizonDriver extends BaseDriver {
  readonly protocolId = 'horizon';
  readonly protocolName = 'Horizon (Johnson Health Tech)';
  readonly deviceClass: DeviceClass = 'treadmill';
  readonly handledFlags = HANDLED;
  #tx: BleCharacteristic | undefined;
  #asm = new HorizonReassembler();
  #msgId = 0x10;
  #caps = noCapabilities();
  #lastSpeed: string | undefined;
  #lastIncline: string | undefined;
  #connectedAt = 0;

  capabilities(): Capabilities {
    return this.#caps;
  }

  async start(): Promise<void> {
    const g = this.ctx.gatt;
    this.#tx = g.char(UUID.VENDOR_FFF3);
    const rx = g.char(UUID.VENDOR_FFF4);
    if (!this.#tx || !rx) throw new Error('Horizon service (0xFFF3/0xFFF4) not found');
    this.#connectedAt = this.ctx.clock.now();
    await this.listen(rx, (d) => this.#onChunk(d));
    await this.#write(horizon.hello());

    const q = this.ctx.quirks;
    const control = this.ctx.options.vendorControl;
    this.#caps = {
      ...noCapabilities(),
      speed: control,
      incline: control,
      startStop: control,
      limits: {
        speedKmh: { min: 0.8, max: q.num('speed_max_kmh', 22), step: q.num('speed_step_kmh', 0.1) },
        inclinePct: { min: q.num('incline_min', 0), max: q.num('incline_max', 15), step: q.num('incline_step', 0.5) },
      },
    };
    if (control) {
      this.notice('warning', 'Horizon vendor control without the profile init: the belt may ignore commands. Prefer FTMS.');
    }
  }

  #onChunk(d: Uint8Array): void {
    for (const f of this.#asm.push(d)) {
      if (isConsolePause(f)) {
        this.notice('paused_by_user', 'paused from the console');
        this.emitData({ speedKmh: 0 });
        continue;
      }
      const data = parseHorizonStatus(f);
      if (!data) continue;
      // The first speed after connecting is garbage on this protocol.
      if (this.ctx.clock.now() - this.#connectedAt < 3000) delete data.speedKmh;
      this.emitData(data);
    }
  }

  async #write(frame: Uint8Array): Promise<void> {
    const tx = this.#tx!;
    const withResponse = prefersWithResponse(tx, this.ctx.quirks);
    for (const c of chunks(frame)) await tx.write(c, withResponse);
  }

  #nextId(): number {
    this.#msgId = (this.#msgId + 1) & 0xffff;
    return this.#msgId;
  }

  override async apply(t: Targets): Promise<void> {
    if (!this.ctx.options.vendorControl) return;
    const lim = this.#caps.limits;
    if (t.speedKmh !== undefined) {
      const v = clamp(roundToStep(t.speedKmh, lim.speedKmh!.step), 0, lim.speedKmh!.max);
      const key = v.toFixed(1);
      if (key !== this.#lastSpeed) {
        this.#lastSpeed = key;
        await this.#write(horizon.setSpeed(this.#nextId(), v));
      }
    }
    if (t.inclinePct !== undefined) {
      const v = clamp(roundToStep(t.inclinePct, lim.inclinePct!.step), lim.inclinePct!.min, lim.inclinePct!.max);
      const key = v.toFixed(1);
      if (key !== this.#lastIncline) {
        this.#lastIncline = key;
        await this.#write(horizon.setIncline(this.#nextId(), v));
      }
    }
  }

  override async command(c: WorkoutCommand): Promise<void> {
    if (!this.ctx.options.vendorControl) return;
    const frame = c === 'start' ? horizon.start() : c === 'pause' ? horizon.pause(this.#nextId()) : horizon.stop(this.#nextId());
    this.log.debug(`horizon ${c}: ${hex(frame)}`);
    await this.#write(frame);
    this.#lastSpeed = undefined;
  }
}
