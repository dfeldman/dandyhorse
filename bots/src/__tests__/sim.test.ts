import { describe, expect, it } from 'vitest'
import { Legs, cadenceFor, gaussian, makeRng, speedFor, wattsAt } from '../sim.ts'
import { minutesOfDay, slots, trainingDays } from '../schedule.ts'

const MODEL = { watts: 180, variability: 15, fatiguePerMinute: 0.005, skillPerMonth: 0.01 }

describe('the rider model', () => {
  it('is the same ride every time for the same seed', () => {
    const a = new Legs(MODEL, 0, 42)
    const b = new Legs(MODEL, 0, 42)
    for (const t of [1, 10, 60, 300]) expect(a.power(t)).toBe(b.power(t))
    expect(new Legs(MODEL, 0, 43).power(60)).not.toBe(a.power(60))
  })

  it('holds roughly the target power through a session', () => {
    const legs = new Legs(MODEL, 0, 7)
    const samples: number[] = []
    for (let t = 60; t <= 1800; t += 5) samples.push(legs.power(t))
    const mean = samples.reduce((n, v) => n + v, 0) / samples.length
    // around the target, a little under it because of the fade
    expect(mean).toBeGreaterThan(140)
    expect(mean).toBeLessThan(190)
  })

  it('wanders rather than jumps', () => {
    const legs = new Legs(MODEL, 0, 3)
    let biggest = 0
    let last = legs.power(30)
    for (let t = 31; t < 600; t++) {
      const now = legs.power(t)
      biggest = Math.max(biggest, Math.abs(now - last))
      last = now
    }
    // a second apart, a rider's power does not move by half their variability
    expect(biggest).toBeLessThan(MODEL.variability)
  })

  it('starts gently and fades with the minutes', () => {
    const legs = new Legs({ ...MODEL, variability: 0 }, 0, 1)
    expect(legs.power(1)).toBeLessThan(legs.power(60))
    const early = new Legs({ ...MODEL, variability: 0 }, 0, 1).power(300)
    const late = new Legs({ ...MODEL, variability: 0 }, 0, 1)
    late.power(300)
    expect(late.power(3600)).toBeLessThan(early)
  })

  it('was weaker months ago', () => {
    expect(wattsAt(MODEL, 0)).toBe(180)
    expect(wattsAt(MODEL, 12)).toBeCloseTo(180 / 1.01 ** 12, 5)
    expect(wattsAt(MODEL, 12)).toBeLessThan(wattsAt(MODEL, 1))
    expect(wattsAt(MODEL, -5)).toBe(180) // never extrapolates into the future
  })

  it('makes a plausible cadence', () => {
    const rng = makeRng(5)
    for (let i = 0; i < 50; i++) {
      const c = cadenceFor(180, rng)
      expect(c).toBeGreaterThanOrEqual(55)
      expect(c).toBeLessThanOrEqual(105)
    }
  })

  it('has a normal-ish gaussian', () => {
    const rng = makeRng(11)
    const xs = Array.from({ length: 4000 }, () => gaussian(rng))
    const mean = xs.reduce((n, v) => n + v, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((n, v) => n + (v - mean) ** 2, 0) / xs.length)
    expect(Math.abs(mean)).toBeLessThan(0.1)
    expect(sd).toBeGreaterThan(0.9)
    expect(sd).toBeLessThan(1.1)
  })
})

describe('the schedule', () => {
  it('reads a time of day, and falls back to seven', () => {
    expect(minutesOfDay('07:15')).toBe(435)
    expect(minutesOfDay('5:45')).toBe(345)
    expect(minutesOfDay('nonsense')).toBe(420)
    expect(minutesOfDay('23:59')).toBe(1439)
  })

  it('picks that many distinct weekdays, the same ones each time', () => {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const days = trainingDays(n, makeRng(9))
      expect(days.length).toBe(n)
      expect(new Set(days).size).toBe(n)
      expect(days.every((d) => d >= 0 && d <= 6)).toBe(true)
    }
    expect(trainingDays(3, makeRng(9))).toEqual(trainingDays(3, makeRng(9)))
    expect(trainingDays(9, makeRng(1)).length).toBe(7)
  })

  it('makes slots in the past, newest first, roughly as often as the habit says', () => {
    const now = Date.UTC(2026, 9, 19, 12, 0, 0)
    const list = slots({ daysPerWeek: 4, timeOfDay: '07:15', jitterMinutes: 45, sessionMinutes: 40, sessionJitter: 10 },
                       8, makeRng(4), now)
    expect(list.length).toBeGreaterThan(20)
    expect(list.length).toBeLessThanOrEqual(8 * 4)
    // never today or later: a backfilled ride in the future would be a lie
    expect(Math.max(...list.map((s) => s.start))).toBeLessThan(now)
    // newest first
    expect(list.map((s) => s.start)).toEqual([...list.map((s) => s.start)].sort((a, b) => b - a))
    // each one a believable length, and dated far enough back to matter to the fitness model
    expect(list.every((s) => s.seconds >= 480 && s.seconds <= 3600)).toBe(true)
    expect(Math.max(...list.map((s) => s.monthsAgo))).toBeGreaterThan(1)
    // no two at the same moment
    expect(new Set(list.map((s) => s.start)).size).toBe(list.length)
  })
})

describe('the wheel speed a trainer would report', () => {
  it('rises with the power, and is nothing at nothing', () => {
    expect(speedFor(0)).toBe(0)
    expect(speedFor(-20)).toBe(0)
    expect(speedFor(200)).toBeGreaterThan(speedFor(100))
  })

  it('is a believable road speed for a believable effort', () => {
    // 150 W on the flat is somewhere around 25 km/h for a rider and bike of ordinary size
    const kmh = speedFor(150) * 3.6
    expect(kmh).toBeGreaterThan(18)
    expect(kmh).toBeLessThan(34)
    // and 300 W is faster, but not twice as fast: drag goes as the cube
    expect(speedFor(300)).toBeLessThan(speedFor(150) * 2)
  })
})
