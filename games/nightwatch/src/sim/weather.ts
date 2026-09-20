/**
 * The night's weather: a few spells (mist, rain, fog, storm) placed by the seed, each fading in and out.
 * The sim reads the strongest spell (it raises ships' needs, and storms push ships about); the renderer reads the mix.
 */
import { Config, type WeatherMode } from '../config.ts'
import { clamp, makeRng, smoothstep } from '../rng.ts'

export type WeatherKind = 'clear' | 'mist' | 'rain' | 'fog' | 'storm'

export interface WeatherSpell { kind: WeatherKind; start: number; end: number }

/** How much of each kind is in the air, 0–1. A storm brings its own rain. */
export interface WeatherMix { mist: number; rain: number; fog: number; storm: number }

const POOLS: Record<WeatherMode, WeatherKind[]> = {
  calm: ['mist', 'mist', 'fog'],
  mixed: ['fog', 'mist', 'rain', 'fog', 'storm'],
  wild: ['storm', 'fog', 'rain', 'storm', 'fog'],
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear', mist: 'Sea mist', rain: 'Rain', fog: 'Fog', storm: 'Storm',
}
export const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: '', mist: '💨', rain: '🌧️', fog: '🌁', storm: '⛈️',
}

export class WeatherPlan {
  readonly spells: WeatherSpell[] = []
  readonly duration: number
  private readonly phase: number

  constructor(seed: number, duration: number, mode: WeatherMode = 'mixed') {
    this.duration = duration
    const rng = makeRng(seed, 'weather')
    this.phase = rng.range(0, 100)
    const pool = POOLS[mode] ?? POOLS.mixed
    const count = Math.max(1, Math.round((duration / 600) * (Config.WEATHER_RATE[mode] ?? 0.9)))
    const lo = Config.WARMUP + 40
    const hi = duration - Config.DAWN_TIME
    let storms = 0
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const len = Math.min(rng.range(...Config.WEATHER_LEN), (hi - lo) * 0.3)
        if (len < 40) break
        const start = rng.range(lo, hi - len)
        const end = start + len
        if (this.spells.some((s) => start < s.end + 45 && end > s.start - 45)) continue
        let kind = rng.pick(pool)
        // a storm needs room to build, and a mixed night gets one at most
        if (kind === 'storm' && ((mode === 'mixed' && storms >= 1) || duration < 1200)) kind = 'fog'
        if (kind === 'storm') storms++
        this.spells.push({ kind, start, end })
        break
      }
    }
    this.spells.sort((a, b) => a.start - b.start)
  }

  private strength(s: WeatherSpell, t: number): number {
    const f = Config.WEATHER_FADE
    return smoothstep(s.start, s.start + f, t) * (1 - smoothstep(s.end - f, s.end, t))
  }

  mix(t: number): WeatherMix {
    const m: WeatherMix = { mist: 0, rain: 0, fog: 0, storm: 0 }
    for (const s of this.spells) {
      if (t < s.start || t > s.end || s.kind === 'clear') continue
      const k = s.kind
      m[k] = Math.max(m[k], this.strength(s, t))
    }
    m.rain = Math.max(m.rain, m.storm)
    return m
  }

  /** The spell in charge at t (at least half strength), else clear. */
  kindAt(t: number): WeatherKind {
    for (const s of this.spells) if (t >= s.start && t <= s.end && this.strength(s, t) >= 0.5) return s.kind
    return 'clear'
  }

  /** Extra need for a ship on watch over [a, b]: the worst weather it will meet. */
  needBetween(a: number, b: number): number {
    let worst = 0
    for (let t = a; t <= b; t += 4) worst = Math.max(worst, Config.WEATHER_NEED[this.kindAt(t)] ?? 0)
    return worst
  }

  /** The strongest kind over [a, b], for the timetable's icon. */
  worstBetween(a: number, b: number): WeatherKind {
    let worst: WeatherKind = 'clear'
    for (let t = a; t <= b; t += 4) {
      const k = this.kindAt(t)
      if ((Config.WEATHER_NEED[k] ?? 0) > (Config.WEATHER_NEED[worst] ?? 0)) worst = k
    }
    return worst
  }

  /** Storm gusts: a slow, irregular push in −0.3..1. */
  gust(t: number): number {
    const p = this.phase
    return clamp(0.3 + 0.45 * Math.sin(t * 0.37 + p) + 0.3 * Math.sin(t * 0.93 + p * 1.7) + 0.2 * Math.sin(t * 2.1 + p * 0.3), -0.3, 1)
  }
}
