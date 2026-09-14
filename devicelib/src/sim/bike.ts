/** A simulated FTMS smart trainer (optionally a Zwift Hub with the Zwift protocol) on the mock transport. */
import { ByteReader, ByteWriter, startsWithBytes } from '../core/bytes.ts';
import { realClock, type Clock } from '../core/clock.ts';
import { UUID } from '../core/uuid.ts';
import { decodeMessage } from '../protocols/zwift/protobuf.ts';
import { decodeHubSimulationGrade, RIDE_ON } from '../protocols/zwift/zap.ts';
import { MockPeripheral, type MockServiceSpec } from '../transport/mock.ts';

export interface SimBikeOptions {
  name?: string;
  /** Add the Zwift protocol service, like a Zwift Hub. */
  zwiftHub?: boolean;
  clock?: Clock;
}

export class SimulatedBike {
  readonly peripheral: MockPeripheral;
  cadenceRpm = 85;
  /** Rider power on flat road at the neutral gear. */
  flatPowerW = 150;
  mode: 'idle' | 'sim' | 'erg' | 'resistance' = 'idle';
  gradePct = 0;
  targetPowerW = 0;
  level = 0;
  gearRatio = 2.4;
  hasControl = false;
  started = false;
  /** Frames written to the Zwift Sync RX characteristic, as hex. */
  readonly zwiftCommands: string[] = [];
  #clock: Clock;
  #timer: unknown;

  constructor(opts: SimBikeOptions = {}) {
    this.#clock = opts.clock ?? realClock;
    const services: MockServiceSpec[] = [
      {
        uuid: UUID.FTMS,
        characteristics: [
          { uuid: UUID.INDOOR_BIKE_DATA, properties: { notify: true } },
          { uuid: UUID.FTMS_CONTROL_POINT, properties: { write: true, indicate: true } },
          { uuid: UUID.FTMS_STATUS, properties: { notify: true } },
          { uuid: UUID.SUPPORTED_RESISTANCE_RANGE, properties: { read: true }, value: new ByteWriter().s16(10).s16(1000).u16(10).toBytes() },
          { uuid: UUID.SUPPORTED_POWER_RANGE, properties: { read: true }, value: new ByteWriter().s16(0).s16(1500).u16(1).toBytes() },
        ],
      },
      { uuid: UUID.CYCLING_POWER, characteristics: [{ uuid: UUID.CYCLING_POWER_MEASUREMENT, properties: { notify: true } }] },
    ];
    if (opts.zwiftHub) {
      services.push({
        uuid: UUID.ZWIFT_SERVICE,
        characteristics: [
          { uuid: UUID.ZWIFT_ASYNC, properties: { notify: true } },
          { uuid: UUID.ZWIFT_SYNC_RX, properties: { write: true, writeWithoutResponse: true } },
          { uuid: UUID.ZWIFT_SYNC_TX, properties: { indicate: true } },
        ],
      });
    }
    this.peripheral = new MockPeripheral({
      name: opts.name ?? (opts.zwiftHub ? 'Zwift Hub 1234' : 'SIM BIKE'),
      advertisedServices: [UUID.FTMS],
      services,
    });
    this.peripheral.onWrite(UUID.FTMS_CONTROL_POINT, (d) => this.#onControl(d));
    if (opts.zwiftHub) this.peripheral.onWrite(UUID.ZWIFT_SYNC_RX, (d) => this.#onZwift(d));
  }

  get powerW(): number {
    if (this.cadenceRpm <= 0) return 0;
    const gearFactor = this.gearRatio / 2.4;
    switch (this.mode) {
      case 'erg':
        return this.targetPowerW;
      case 'resistance':
        return Math.round(40 + this.level * 2.5 * (this.cadenceRpm / 85));
      case 'sim':
        return Math.max(0, Math.round((this.flatPowerW + this.gradePct * 30) * gearFactor));
      default:
        return this.flatPowerW;
    }
  }

  #onControl(d: Uint8Array): void {
    const op = d[0]!;
    const r = new ByteReader(d, 1);
    let result = 0x01;
    if (op === 0x00) this.hasControl = true;
    else if (!this.hasControl) result = 0x05;
    else if (op === 0x07) this.started = true;
    else if (op === 0x08) this.started = false;
    else if (op === 0x11) {
      r.s16();
      this.gradePct = r.s16() / 100;
      this.mode = 'sim';
    } else if (op === 0x05) {
      this.targetPowerW = r.s16();
      this.mode = 'erg';
    } else if (op === 0x04) {
      this.level = r.u8();
      this.mode = 'resistance';
    } else result = 0x02;
    this.peripheral.notify(UUID.FTMS_CONTROL_POINT, Uint8Array.of(0x80, op, result));
  }

  #onZwift(d: Uint8Array): void {
    this.zwiftCommands.push(Array.from(d, (b) => b.toString(16).padStart(2, '0')).join(' '));
    if (startsWithBytes(d, RIDE_ON)) {
      this.peripheral.notify(UUID.ZWIFT_SYNC_TX, Uint8Array.of(...RIDE_ON, 0x02, 0x00));
      return;
    }
    const grade = decodeHubSimulationGrade(d);
    if (grade !== undefined) {
      this.gradePct = grade;
      this.mode = 'sim';
      return;
    }
    if (d[0] === 0x04) {
      for (const f of decodeMessage(d.subarray(1))) {
        if (f.field !== 5 || typeof f.value === 'number') continue;
        for (const g of decodeMessage(f.value)) if (g.field === 2 && typeof g.value === 'number') this.gearRatio = g.value / 10000;
      }
    }
  }

  /** Indoor Bike Data with speed, cadence and power (flags 0x0044). */
  frame(): Uint8Array {
    const speed = this.cadenceRpm * 0.35 * (this.gearRatio / 2.4);
    return new ByteWriter().u16(0x0044).u16(speed * 100).u16(this.cadenceRpm * 2).s16(this.powerW).toBytes();
  }

  step(): void {
    this.peripheral.notify(UUID.INDOOR_BIKE_DATA, this.frame());
  }

  start(periodMs = 250): void {
    this.stop();
    this.#timer = this.#clock.setInterval(() => {
      if (this.peripheral.connected) this.step();
    }, periodMs);
  }

  stop(): void {
    if (this.#timer !== undefined) this.#clock.clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
