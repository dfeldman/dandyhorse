/**
 * Merges driver data into the Telemetry snapshot: freshness, estimated values and integrated totals.
 * Distance and energy are always integrated here; device totals are often lifetime counters.
 */
import type { DeviceClass, DeviceData, MetricKey, RiderProfile, Telemetry } from '../core/types.ts';
import { bikeSpeedForPower, kcalFromWork, treadmillKcalPerMin, treadmillPowerW } from './physics.ts';

const MOTION: ReadonlySet<MetricKey> = new Set(['speedKmh', 'cadenceRpm', 'powerW', 'strokeRatePerMin', 'stepRatePerMin']);
const DROP_WHEN_STALE: ReadonlySet<MetricKey> = new Set(['heartRateBpm', 'paceSecPer500m']);

export interface TrackerOptions {
  staleMs: number;
  rider: RiderProfile;
  deviceClass: DeviceClass;
  /** Start the workout clock on the first movement. */
  autoStart: boolean;
  /** Road model used to estimate speed for bikes that do not report it. */
  crr: number;
  cdA: number;
}

export type WorkoutState = 'idle' | 'running' | 'paused';

export class TelemetryTracker {
  opts: TrackerOptions;
  state: WorkoutState = 'idle';
  distanceM = 0;
  elapsedS = 0;
  movingS = 0;
  energyKcal = 0;
  #latest = new Map<MetricKey, { v: number; t: number }>();
  #lastDataAt = -Infinity;
  #lastTick: number | undefined;

  constructor(opts: TrackerOptions) {
    this.opts = opts;
  }

  ingest(data: DeviceData, now: number): void {
    for (const [k, v] of Object.entries(data) as [MetricKey, number | undefined][]) {
      if (typeof v === 'number' && Number.isFinite(v)) this.#latest.set(k, { v, t: now });
    }
    this.#lastDataAt = now;
  }

  /** The link dropped: motion reads as zero from now on. */
  markDisconnected(): void {
    this.#lastDataAt = -Infinity;
    for (const [k, e] of this.#latest) if (MOTION.has(k)) e.t = -Infinity;
  }

  resetTotals(): void {
    this.distanceM = 0;
    this.elapsedS = 0;
    this.movingS = 0;
    this.energyKcal = 0;
  }

  snapshot(now: number, gradePct: number | undefined): Telemetry {
    const o = this.opts;
    const tel: Telemetry = {
      t: now,
      distanceM: 0,
      elapsedS: 0,
      movingS: 0,
      energyKcal: 0,
      computed: [],
      fresh: now - this.#lastDataAt <= o.staleMs,
    };
    const out = tel as unknown as Record<string, number>;
    for (const [k, e] of this.#latest) {
      const stale = now - e.t > o.staleMs;
      if (!stale) out[k] = e.v;
      else if (MOTION.has(k)) out[k] = 0;
      else if (!DROP_WHEN_STALE.has(k)) out[k] = e.v;
    }

    const cls = o.deviceClass;
    if (cls === 'treadmill' && tel.powerW === undefined && tel.speedKmh !== undefined) {
      tel.powerW = treadmillPowerW(tel.speedKmh, tel.inclinePct ?? 0, o.rider.weightKg);
      tel.computed.push('powerW');
    }
    if (cls === 'bike' && tel.speedKmh === undefined && tel.powerW !== undefined) {
      const v = bikeSpeedForPower(tel.powerW, gradePct ?? 0, {
        massKg: o.rider.weightKg + o.rider.bikeWeightKg,
        crr: o.crr,
        cdA: o.cdA,
      });
      tel.speedKmh = v * 3.6;
      tel.computed.push('speedKmh');
    }

    const moving = (tel.speedKmh ?? 0) > 0 || (tel.cadenceRpm ?? 0) > 0 || (tel.powerW ?? 0) > 0 || (tel.strokeRatePerMin ?? 0) > 0;
    if (this.state === 'idle' && moving && o.autoStart) this.state = 'running';
    const dt = this.#lastTick === undefined ? 0 : Math.min(2, Math.max(0, (now - this.#lastTick) / 1000));
    this.#lastTick = now;
    if (this.state === 'running') {
      this.elapsedS += dt;
      if (moving) this.movingS += dt;
      this.distanceM += ((tel.speedKmh ?? 0) / 3.6) * dt;
      if (moving && tel.powerW !== undefined) {
        this.energyKcal += cls === 'treadmill' ? (treadmillKcalPerMin(tel.powerW, o.rider.weightKg) * dt) / 60 : kcalFromWork(tel.powerW * dt);
      }
    }
    tel.distanceM = this.distanceM;
    tel.elapsedS = this.elapsedS;
    tel.movingS = this.movingS;
    tel.energyKcal = this.energyKcal;
    return tel;
  }
}
