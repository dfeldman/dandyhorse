/**
 * The player's workout: pedal effort relative to their steady pace (1.0), the session clock, and, once the
 * platform supplies them, device readings and the target the player chose. The game never controls the
 * exercise machine; it only reads it. Until device data arrives the player is assumed to pedal steadily;
 * developers can override it (`[` and `]`, or window.kingdomTrek.setEffort).
 */
export interface EffortReading {
  speed?: number | null
  cadence?: number | null
  power?: number | null
  heartRate?: number | null
}

/** Effort steps for the developer keys: up to 20× steady pace, so testing takes minutes, not hours. */
const LADDER = [0, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10, 20]

export class EffortSource {
  private override: number | null = null
  private reading: EffortReading = {}
  private goal: EffortReading = {}
  /** Lifetime Energy earned when this session started. */
  energyAtStart = 0

  /** Current effort; 1.0 is steady pace. */
  value(): number {
    return this.override ?? 1
  }

  /** Force an effort (developer tools, tests). null returns to the default. */
  set(effort: number | null): void {
    this.override = effort === null ? null : Math.max(0, Math.min(LADDER[LADDER.length - 1], effort))
  }

  /** One step up or down the developer ladder. */
  nudge(dir: 1 | -1): void {
    const v = this.value()
    const next = dir > 0 ? LADDER.find((x) => x > v + 1e-9) : [...LADDER].reverse().find((x) => x < v - 1e-9)
    this.set(next ?? v)
  }

  /** Where device data will arrive; mapping it to effort is future work. */
  feed(reading: EffortReading): void {
    this.reading = { ...this.reading, ...reading }
  }

  /** The target the player chose on the platform (speed, power or heart rate). */
  setTarget(target: EffortReading): void {
    this.goal = { ...target }
  }

  get last(): EffortReading {
    return this.reading
  }

  /** HUD text for the target and the live reading. With no device yet: effort as a % of steady pace. */
  describe(): { target: string; now: string } {
    return { target: show(this.goal) ?? '—', now: show(this.reading) ?? `${Math.round(this.value() * 100)}%` }
  }
}

function show(r: EffortReading): string | null {
  if (r.power != null) return `${Math.round(r.power)} W`
  if (r.speed != null) return `${r.speed.toFixed(1)} km/h`
  if (r.heartRate != null) return `${Math.round(r.heartRate)} bpm`
  if (r.cadence != null) return `${Math.round(r.cadence)} rpm`
  return null
}

/** 83 → "1:23"; 3723 → "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
