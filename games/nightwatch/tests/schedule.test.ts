import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { buildSchedule, needFor } from '../src/sim/schedule.ts'
import { WeatherPlan } from '../src/sim/weather.ts'

const plan = (seed: number, minutes: number, difficulty = 1, convoys = false) => {
  const duration = minutes * 60
  const weather = new WeatherPlan(seed, duration, 'mixed')
  return { duration, weather, ships: buildSchedule(seed, duration, difficulty, weather, convoys) }
}

describe('the timetable', () => {
  it('fits every workout length, from the warm-up to before dawn', () => {
    for (const minutes of [5, 10, 15, 20, 30, 45, 60, 90]) {
      for (let seed = 1; seed <= 12; seed++) {
        const { duration, ships } = plan(seed, minutes)
        expect(ships.length).toBeGreaterThan(0)
        expect(ships[0]!.watchStart).toBeCloseTo(Config.WARMUP, 6)
        const lastEnd = Math.max(...ships.map((s) => s.watchEnd))
        expect(lastEnd).toBeLessThanOrEqual(duration - Config.COOLDOWN + 1e-6)
        for (const s of ships) {
          expect(s.watchEnd - s.watchStart).toBeGreaterThanOrEqual(Math.min(Config.MIN_WATCH, duration) - 1e-6)
          expect(s.approachEnd).toBeGreaterThan(s.watchStart)
          expect(s.approachEnd).toBeLessThan(s.watchEnd)
        }
      }
    }
  })

  it('ends the last watch right at the cool-down in longer workouts', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { duration, ships } = plan(seed, 30)
      expect(ships.at(-1)!.watchEnd).toBeCloseTo(duration - Config.COOLDOWN, 3)
    }
  })

  it('never overlaps two ships on a normal night, and leaves a rest between them', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { ships } = plan(seed, 30)
      for (let i = 1; i < ships.length; i++) {
        expect(ships[i]!.watchStart - ships[i - 1]!.watchEnd).toBeGreaterThanOrEqual(Config.REST_BASE + Config.REST_PER_LEVEL - Config.REST_JITTER - 1e-6)
      }
    }
  })

  it('starts gentle, and never runs two sprints back to back', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { ships } = plan(seed, 30)
      expect(ships[0]!.level).toBe(1)
      for (let i = 1; i < ships.length; i++) expect(ships[i]!.level === 4 && ships[i - 1]!.level === 4).toBe(false)
    }
  })

  it('has one big ship in the middle of workouts of 15 minutes or more', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { duration, ships } = plan(seed, 30)
      const big = ships.filter((s) => s.bigOne)
      expect(big).toHaveLength(1)
      expect(big[0]!.kind).toBe('liner')
      expect(big[0]!.watchStart / duration).toBeGreaterThan(Config.BIG_ONE_AT - 0.001)
      expect(big[0]!.watchStart / duration).toBeLessThan(0.75)
      expect(plan(seed, 10).ships.some((s) => s.bigOne)).toBe(false)
    }
  })

  it('is a real interval workout: about a third of the night above steady pace', () => {
    let above = 0, onWatch = 0, total = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { duration, ships } = plan(seed, 30)
      total += duration
      for (const s of ships) {
        onWatch += s.watchEnd - s.watchStart
        if (s.need > Config.STEADY) above += s.watchEnd - s.watchStart
      }
    }
    expect(above / total).toBeGreaterThan(0.25)
    expect(above / total).toBeLessThan(0.45)
    expect(onWatch / total).toBeGreaterThan(0.55)
    expect(onWatch / total).toBeLessThan(0.8)
  })

  it('makes harder ships shorter', () => {
    const byLevel: number[][] = [[], [], [], [], []]
    for (let seed = 1; seed <= 30; seed++) for (const s of plan(seed, 30).ships) if (!s.bigOne) byLevel[s.level]!.push(s.watchEnd - s.watchStart)
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    expect(mean(byLevel[1]!)).toBeGreaterThan(mean(byLevel[2]!))
    expect(mean(byLevel[2]!)).toBeGreaterThan(mean(byLevel[3]!))
    expect(mean(byLevel[3]!)).toBeGreaterThan(mean(byLevel[4]!))
  })

  it('adds the weather to a ship’s need and scales needs with difficulty', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { weather, ships } = plan(seed, 30)
      for (const s of ships) {
        expect(s.need).toBe(Math.round(needFor(s.level, 1) + weather.needBetween(s.watchStart, s.watchEnd)))
      }
    }
    expect(needFor(3, 1)).toBe(Config.LEVELS[3])
    expect(needFor(3, 1.08)).toBeGreaterThan(needFor(3, 1))
    expect(needFor(3, 0.88)).toBeLessThan(needFor(3, 1))
    expect(needFor(2, 1)).toBe(Config.STEADY)
  })

  it('is the same for the same seed, and different for another', () => {
    const a = plan(7, 30).ships, b = plan(7, 30).ships, c = plan(8, 30).ships
    expect(a).toEqual(b)
    expect(a.map((s) => s.name)).not.toEqual(c.map((s) => s.name))
  })

  it('gives every ship a different name', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const names = plan(seed, 90).ships.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('sends convoys only when asked (hard), late in the night, and still before dawn', () => {
    let convoys = 0
    for (let seed = 1; seed <= 30; seed++) {
      expect(plan(seed, 30).ships.some((s) => s.convoy)).toBe(false)
      const { duration, ships } = plan(seed, 30, 1.08, true)
      for (const s of ships.filter((x) => x.convoy)) {
        convoys++
        expect(s.watchStart / duration).toBeGreaterThan(Config.CONVOY_FROM)
        expect(s.watchEnd).toBeLessThanOrEqual(duration - Config.COOLDOWN + 1e-6)
        expect(s.level).toBeLessThanOrEqual(2)
      }
    }
    expect(convoys).toBeGreaterThan(5)
  })
})

describe('the weather', () => {
  it('keeps spells apart and inside the night', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const mode of ['calm', 'mixed', 'wild'] as const) {
        const w = new WeatherPlan(seed, 1800, mode)
        for (let i = 0; i < w.spells.length; i++) {
          const s = w.spells[i]!
          expect(s.start).toBeGreaterThanOrEqual(Config.WARMUP)
          expect(s.end).toBeLessThanOrEqual(1800 - Config.DAWN_TIME)
          if (i > 0) expect(s.start).toBeGreaterThan(w.spells[i - 1]!.end)
        }
        if (mode === 'calm') expect(w.spells.every((s) => s.kind !== 'storm' && s.kind !== 'rain')).toBe(true)
        if (mode === 'mixed') expect(w.spells.filter((s) => s.kind === 'storm').length).toBeLessThanOrEqual(1)
      }
    }
  })

  it('fades a spell in and out', () => {
    const w = new WeatherPlan(3, 1800, 'wild')
    const s = w.spells[0]!
    const k = s.kind === 'storm' ? 'storm' : s.kind === 'clear' ? 'fog' : s.kind
    expect(w.mix(s.start - 1)[k]).toBe(0)
    expect(w.mix((s.start + s.end) / 2)[k]).toBe(1)
    expect(w.mix(s.start + Config.WEATHER_FADE / 2)[k]).toBeGreaterThan(0)
    expect(w.mix(s.start + Config.WEATHER_FADE / 2)[k]).toBeLessThan(1)
    expect(w.kindAt((s.start + s.end) / 2)).toBe(s.kind)
  })

  it('has no storms in short workouts', () => {
    for (let seed = 1; seed <= 30; seed++) expect(new WeatherPlan(seed, 900, 'wild').spells.some((s) => s.kind === 'storm')).toBe(false)
  })
})
