import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { build, ends, levelHrr, levelScale, PROGRAM_IDS, PROGRAMS, segmentAt, type ProgramId } from '../src/program.ts'

const LENGTHS = [300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200]

describe('every programme fits any length', () => {
  for (const id of PROGRAM_IDS) {
    for (const duration of LENGTHS) {
      it(`${id} at ${duration / 60} min tiles the clock exactly`, () => {
        const w = build(id, duration)
        expect(w.segments.length).toBeGreaterThan(0)
        expect(w.segments[0]!.t0).toBe(0)
        expect(w.segments[w.segments.length - 1]!.t1).toBe(duration)
        for (let i = 0; i < w.segments.length; i++) {
          const s = w.segments[i]!
          expect(s.t1, `segment ${i} of ${id} has no length`).toBeGreaterThan(s.t0)
          if (i > 0) expect(s.t0, `gap before segment ${i} of ${id}`).toBe(w.segments[i - 1]!.t1)
        }
      })
    }
  }
})

describe('the ends', () => {
  it('gives a 30 minute workout a few minutes each end', () => {
    const { warmup, cooldown } = ends(1800, 'hills')
    expect(warmup).toBe(216)
    expect(cooldown).toBe(180)
  })

  it('squeezes the ends on a short workout so the middle keeps its share', () => {
    const duration = 300
    const { warmup, cooldown } = ends(duration, 'hills')
    expect(warmup + cooldown).toBeLessThanOrEqual(duration * (1 - Config.MIDDLE_MIN_SHARE) + 1)
    expect(warmup).toBeGreaterThan(0)
    expect(cooldown).toBeGreaterThan(0)
  })

  it('gives Manual no warm-up at all: it is the player’s to run', () => {
    expect(ends(1800, 'manual')).toEqual({ warmup: 0, cooldown: 0 })
    const w = build('manual', 1800)
    expect(w.segments).toHaveLength(1)
    expect(w.segments[0]).toMatchObject({ t0: 0, t1: 1800, effort: 1, grade: 0 })
  })
})

describe('level', () => {
  it('swings further at 10 than at 5, and less at 1', () => {
    expect(levelScale(1)).toBeLessThan(levelScale(5))
    expect(levelScale(5)).toBe(1)
    expect(levelScale(10)).toBeGreaterThan(levelScale(5))
  })

  it('scales a programme’s hills and pushes, but never its warm-up', () => {
    const easy = build('intervals', 1800, { level: 1 })
    const hard = build('intervals', 1800, { level: 10 })
    const peak = (id: ProgramId, level: number) => Math.max(...build(id, 1800, { level }).segments.map((s) => s.effort))
    expect(peak('intervals', 10)).toBeGreaterThan(peak('intervals', 5))
    expect(peak('intervals', 1)).toBeLessThan(peak('intervals', 5))
    const warm = (w: typeof easy) => w.segments.find((s) => s.kind === 'warmup')!
    expect(warm(easy).effort).toBe(warm(hard).effort)
  })

  it('reads level as the zone on a heart-rate programme', () => {
    expect(levelHrr(1)).toBeCloseTo(0.4, 5)
    expect(levelHrr(10)).toBeCloseTo(0.8, 5)
    const w = build('heartrate', 1800, { level: 8 })
    const middle = segmentAt(w, 900)
    expect(middle.hrr).toBeCloseTo(levelHrr(8), 5)
    // The ends are gentler than the middle, and every segment carries a target.
    for (const s of w.segments) expect(s.hrr).toBeDefined()
    expect(w.segments[0]!.hrr!).toBeLessThan(middle.hrr!)
  })

  it('leaves an unlevelled programme alone', () => {
    expect(PROGRAMS.steady.levelled).toBe(false)
    const a = build('steady', 1800, { level: 1 })
    const b = build('steady', 1800, { level: 10 })
    expect(a.segments.map((s) => s.effort)).toEqual(b.segments.map((s) => s.effort))
  })
})

describe('shapes', () => {
  it('hills climbs to 6 % at level 5 and comes back to flat', () => {
    const w = build('hills', 1800)
    const grades = w.segments.map((s) => s.grade)
    expect(Math.max(...grades)).toBeCloseTo(6, 5)
    expect(Math.min(...grades)).toBe(0)
    const middle = w.segments.filter((s) => s.kind !== 'warmup' && s.kind !== 'cooldown')
    expect(middle.every((s) => s.effort === 1)).toBe(true) // hills never touch the pace
  })

  it('intervals alternates push and recover', () => {
    const middle = build('intervals', 1800).segments.filter((s) => s.kind === 'work' || s.kind === 'recover')
    expect(middle.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i < middle.length; i++) expect(middle[i]!.kind).not.toBe(middle[i - 1]!.kind)
  })

  it('pyramid goes up and comes down once', () => {
    const middle = build('pyramid', 1800).segments.filter((s) => s.label !== 'Warm up' && s.label !== 'Cool down')
    const efforts = middle.map((s) => s.effort)
    const peak = efforts.indexOf(Math.max(...efforts))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(efforts.length - 1)
    for (let i = 1; i <= peak; i++) expect(efforts[i]!).toBeGreaterThan(efforts[i - 1]!)
    for (let i = peak + 1; i < efforts.length; i++) expect(efforts[i]!).toBeLessThan(efforts[i - 1]!)
  })

  it('random is the same workout for the same seed, and a different one otherwise', () => {
    const a = build('random', 1800, { seed: 7 })
    const b = build('random', 1800, { seed: 7 })
    const c = build('random', 1800, { seed: 8 })
    expect(a.segments).toEqual(b.segments)
    expect(a.segments).not.toEqual(c.segments)
  })

  it('random never leaves a block shorter than 20 s', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const d of LENGTHS) {
        for (const s of build('random', d, { seed }).segments) expect(s.t1 - s.t0).toBeGreaterThanOrEqual(20)
      }
    }
  })
})

describe('segmentAt', () => {
  it('finds the segment on either side of a boundary, and holds the last one past the end', () => {
    const w = build('intervals', 1800)
    const s = w.segments[2]!
    expect(segmentAt(w, s.t0)).toBe(s)
    expect(segmentAt(w, s.t1 - 0.001)).toBe(s)
    expect(segmentAt(w, s.t1)).toBe(w.segments[3])
    expect(segmentAt(w, 99999)).toBe(w.segments[w.segments.length - 1])
  })
})
