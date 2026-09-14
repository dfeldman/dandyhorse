/** A simulated FTMS treadmill on the mock transport, for tests and for games without hardware. */
import { ByteReader, ByteWriter } from '../core/bytes.ts';
import { realClock, type Clock } from '../core/clock.ts';
import { UUID } from '../core/uuid.ts';
import { MockPeripheral, type MockServiceSpec } from '../transport/mock.ts';

export interface SimTreadmillOptions {
  name?: string;
  /** Add the Horizon vendor service (0xFFF3/0xFFF4), like a Horizon 7.0AT. */
  horizonVendorService?: boolean;
  maxSpeedKmh?: number;
  maxInclinePct?: number;
  /** km/h per unit of the Set Target Speed field: 0.01 per the FTMS spec, 0.1 on Horizon 7-series firmware. Defaults to 0.1 with the Horizon service. */
  speedCommandUnitKmh?: number;
  /**
   * Behave like the Horizon 7.0AT measured in docs/hardware/horizon-7.0at.md, beyond its speed units: Treadmill
   * Data carries the selected speed, distance, energy, heart rate 0 and elapsed time but no incline (flags 0x0584);
   * the machine sends no Fitness Machine Status at all, not even when its own buttons are pressed; Speed Range
   * holds its mph limits (0.5 to 12 mph as 50, 1200, 10) in the km/h field.
   */
  horizonFirmware?: boolean;
  clock?: Clock;
}

export class SimulatedTreadmill {
  readonly peripheral: MockPeripheral;
  speedKmh = 0;
  inclinePct = 0;
  targetSpeedKmh = 0;
  targetInclinePct = 0;
  running = false;
  hasControl = false;
  distanceM = 0;
  elapsedS = 0;
  /** Control point op codes the simulator refuses with "not supported". */
  refuse = new Set<number>();
  readonly speedCommandUnitKmh: number;
  readonly horizonFirmware: boolean;
  readonly minSpeedKmh = 0.8;
  readonly maxSpeedKmh: number;
  #clock: Clock;
  #timer: unknown;

  constructor(opts: SimTreadmillOptions = {}) {
    this.#clock = opts.clock ?? realClock;
    this.speedCommandUnitKmh = opts.speedCommandUnitKmh ?? (opts.horizonVendorService ? 0.1 : 0.01);
    this.horizonFirmware = !!opts.horizonFirmware;
    const maxSpeed = opts.maxSpeedKmh ?? (this.horizonFirmware ? 19.3 : 20);
    this.maxSpeedKmh = maxSpeed;
    const speedRange = this.horizonFirmware ? new ByteWriter().u16(50).u16(1200).u16(10) : new ByteWriter().u16(80).u16(maxSpeed * 100).u16(10);
    const maxIncline = opts.maxInclinePct ?? 15;
    const services: MockServiceSpec[] = [
      {
        uuid: UUID.FTMS,
        characteristics: [
          { uuid: UUID.TREADMILL_DATA, properties: { notify: true } },
          { uuid: UUID.FTMS_CONTROL_POINT, properties: { write: true, indicate: true } },
          { uuid: UUID.FTMS_STATUS, properties: { notify: true } },
          { uuid: UUID.SUPPORTED_SPEED_RANGE, properties: { read: true }, value: speedRange.toBytes() },
          { uuid: UUID.SUPPORTED_INCLINE_RANGE, properties: { read: true }, value: new ByteWriter().s16(0).s16(maxIncline * 10).u16(5).toBytes() },
        ],
      },
    ];
    if (opts.horizonVendorService) {
      services.push({
        uuid: UUID.VENDOR_FFF0,
        characteristics: [
          { uuid: UUID.VENDOR_FFF3, properties: { write: true, writeWithoutResponse: true } },
          { uuid: UUID.VENDOR_FFF4, properties: { notify: true } },
        ],
      });
    }
    this.peripheral = new MockPeripheral({
      name: opts.name ?? (opts.horizonVendorService ? 'HORIZON 7.0AT' : 'SIM TREADMILL'),
      advertisedServices: [UUID.FTMS],
      services,
    });
    this.peripheral.onWrite(UUID.FTMS_CONTROL_POINT, (d) => this.#onControl(d));
  }

  #onControl(d: Uint8Array): void {
    const op = d[0]!;
    let result = 0x01;
    if (this.refuse.has(op)) result = 0x02;
    else if (op === 0x00) this.hasControl = true;
    else if (!this.hasControl) result = 0x05;
    else if (op === 0x07) this.running = true;
    else if (op === 0x08) {
      this.running = false;
      this.targetSpeedKmh = 0;
    } else if (op === 0x02) {
      this.targetSpeedKmh = Math.round(new ByteReader(d, 1).u16() * this.speedCommandUnitKmh * 100) / 100;
      this.running = this.targetSpeedKmh > 0 || this.running;
    } else if (op === 0x03) this.targetInclinePct = new ByteReader(d, 1).s16() / 10;
    else result = 0x02;
    this.peripheral.notify(UUID.FTMS_CONTROL_POINT, Uint8Array.of(0x80, op, result));
  }

  // ---- the machine's own buttons, as the person on it presses them ----

  /** Start: the belt runs at its target, or at the slowest speed. */
  userStart(): void {
    this.running = true;
    if (this.targetSpeedKmh <= 0) this.targetSpeedKmh = this.minSpeedKmh;
    this.#userStatus(Uint8Array.of(0x04));
  }

  /** Stop (or the safety key): the belt spins down. */
  userStop(): void {
    this.running = false;
    this.targetSpeedKmh = 0;
    this.#userStatus(Uint8Array.of(0x02, 0x01));
  }

  /** Speed + or -: moves the target by deltaKmh within the belt's limits, while it runs. */
  userSpeed(deltaKmh: number): void {
    if (!this.running) return;
    this.targetSpeedKmh = Math.min(this.maxSpeedKmh, Math.max(this.minSpeedKmh, Math.round((this.targetSpeedKmh + deltaKmh) * 100) / 100));
    this.#userStatus(new ByteWriter().u8(0x05).u16(this.targetSpeedKmh * 100).toBytes());
  }

  /** FTMS machines report button presses in Machine Status; the Horizon firmware reports nothing. */
  #userStatus(d: Uint8Array): void {
    if (!this.horizonFirmware && this.peripheral.connected) this.peripheral.notify(UUID.FTMS_STATUS, d);
  }

  /** Advance the belt by dtMs and notify one Treadmill Data frame. */
  step(dtMs = 250): void {
    const dt = dtMs / 1000;
    const goal = this.running ? this.targetSpeedKmh : 0;
    this.speedKmh += Math.sign(goal - this.speedKmh) * Math.min(Math.abs(goal - this.speedKmh), 2 * dt);
    this.inclinePct += Math.sign(this.targetInclinePct - this.inclinePct) * Math.min(Math.abs(this.targetInclinePct - this.inclinePct), 1 * dt);
    this.distanceM += (this.speedKmh / 3.6) * dt;
    if (this.running) this.elapsedS += dt;
    this.peripheral.notify(UUID.TREADMILL_DATA, this.frame());
  }

  /**
   * Treadmill Data with speed, distance, incline and elapsed time (flags 0x040C). With horizonFirmware, the frame
   * the real 7.0AT sends (flags 0x0584): the selected speed, distance, energy, heart rate 0, elapsed time.
   */
  frame(): Uint8Array {
    if (this.horizonFirmware) {
      return new ByteWriter()
        .u16(0x0584)
        .u16((this.running ? this.targetSpeedKmh : 0) * 100)
        .u24(this.distanceM)
        .u16(this.distanceM * 0.07) // total energy, kcal (roughly 75 kg walking)
        .u16(0)
        .u8(0)
        .u8(0) // heart rate: none
        .u16(this.elapsedS)
        .toBytes();
    }
    return new ByteWriter()
      .u16(0x040c)
      .u16(this.speedKmh * 100)
      .u24(this.distanceM)
      .s16(this.inclinePct * 10)
      .s16(0)
      .u16(this.elapsedS)
      .toBytes();
  }

  start(periodMs = 250): void {
    this.stop();
    this.#timer = this.#clock.setInterval(() => {
      if (this.peripheral.connected) this.step(periodMs);
    }, periodMs);
  }

  stop(): void {
    if (this.#timer !== undefined) this.#clock.clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
