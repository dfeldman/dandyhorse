import { describe, expect, it } from 'vitest'
import { Config, laneCenter } from '../src/config.ts'
import { pedalFor, speedFor, type ButtonId } from '../src/sim/car.ts'
import { Race, type RaceEvent } from '../src/sim/race.ts'
import { Series } from '../src/sim/series.ts'

const DT = 1 / 30
const GRID = ['blue', 'gold', 'player', 'green']

function newRace(seed = 9, laps = 1): Race {
  return new Race({ seed, laps, difficulty: 1, grid: GRID })
}

/** Step until a condition (or a time limit), collecting events. */
function run(race: Race, seconds: number, pedal: number | null = 50, until?: (r: Race) => boolean, presses: () => ButtonId[] = () => []): RaceEvent[] {
  const events: RaceEvent[] = []
  for (let t = 0; t < seconds; t += DT) {
    race.step(DT, { pedal, presses: presses() })
    events.push(...race.takeEvents())
    if (until?.(race)) break
  }
  return events
}

const toGreenLight = (race: Race): RaceEvent[] => run(race, 20, 50, (r) => r.phase === 'racing')

describe('speed from the pedal', () => {
  it('cruises at pedal 50 and is monotonic', () => {
    expect(speedFor(50)).toBeCloseTo(Config.CRUISE_SPEED)
    expect(speedFor(0)).toBe(0)
    let last = -1
    for (let p = 0; p <= 100; p += 5) {
      expect(speedFor(p)).toBeGreaterThan(last)
      last = speedFor(p)
    }
    expect(speedFor(150)).toBe(speedFor(100))
  })
  it('pedalFor inverts speedFor', () => {
    for (const p of [10, 35, 50, 72, 100]) expect(pedalFor(speedFor(p))).toBeCloseTo(p, 6)
  })
})

describe('a race', () => {
  it('runs intro → countdown → racing → finished, with four places and points', () => {
    const race = newRace()
    const events = run(race, 400, 50, (r) => r.phase === 'finished')
    expect(race.phase).toBe('finished')
    const types = events.map((e) => e.type)
    expect(types).toContain('go')
    expect(types.filter((t) => t === 'countdown')).toHaveLength(3)
    expect(types).toContain('finish')
    const results = race.results!
    expect(results.map((r) => r.place)).toEqual([1, 2, 3, 4])
    expect(new Set(results.map((r) => r.id)).size).toBe(4)
    expect(results.map((r) => r.points)).toEqual(Config.POINTS)
    expect(results.find((r) => r.id === 'player')!.time).toBeGreaterThan(40)
  })

  it('holds the cars still until GO', () => {
    const race = newRace()
    const start = race.cars.map((c) => c.dist)
    run(race, Config.INTRO_TIME + Config.COUNTDOWN_TIME - 0.2, 80)
    expect(race.phase).toBe('countdown')
    expect(race.cars.map((c) => c.dist)).toEqual(start)
  })

  it('keeps the last pedal when the reading is unknown', () => {
    const race = newRace()
    toGreenLight(race)
    run(race, 10, 70)
    const v = race.player.speed
    run(race, 5, null)
    expect(race.pedal).toBe(70)
    expect(race.player.speed).toBeGreaterThan(v * 0.7)
  })

  it('moves faster the harder you pedal', () => {
    const slow = newRace(), fast = newRace()
    run(slow, 200, 35, (r) => r.phase === 'finished')
    run(fast, 200, 80, (r) => r.phase === 'finished')
    const t = (r: Race): number => r.results!.find((x) => x.id === 'player')!.time!
    expect(t(fast)).toBeLessThan(t(slow) * 0.85)
  })

  it('never lets cars sit inside each other', () => {
    const race = newRace(21, 2)
    let deep = 0
    for (let t = 0; t < 400 && race.phase !== 'finished'; t += DT) {
      race.step(DT, { pedal: 50 + 20 * Math.sin(t / 7), presses: t % 9 < DT ? ['turbo'] : [] })
      const cs = race.cars
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const g = Math.abs(race.track.gap(cs[i]!.dist, cs[j]!.dist))
        if (g < Config.CAR_LENGTH * 0.5 && Math.abs(cs[i]!.x - cs[j]!.x) < Config.CAR_WIDTH * 0.7) deep++
      }
    }
    expect(race.phase).toBe('finished')
    expect(deep).toBeLessThan(10)
  })

  it('keeps every car on the road', () => {
    const race = newRace(4, 1)
    for (let t = 0; t < 300 && race.phase !== 'finished'; t += DT) {
      race.step(DT, { pedal: 60, presses: [] })
      for (const c of race.cars) expect(Math.abs(c.x)).toBeLessThan(laneCenter(Config.LANES - 1) + 1.5)
    }
  })

  it('is deterministic for the same seed and inputs', () => {
    const a = newRace(33), b = newRace(33)
    run(a, 400, 55, (r) => r.phase === 'finished')
    run(b, 400, 55, (r) => r.phase === 'finished')
    expect(a.results).toEqual(b.results)
  })
})

describe('turbo', () => {
  it('gives a rocket start for a tap in the window, and says so for an early one', () => {
    const early = newRace()
    run(early, 20, 50, (r) => r.phase === 'countdown')
    const events = run(early, 0.5, 50, undefined, () => ['turbo'])
    expect(events.some((e) => e.type === 'tooEarly')).toBe(true)
    expect(early.rocketArmed).toBe(false)

    const good = newRace()
    run(good, 20, 50, (r) => r.phase === 'countdown' && r.countdown < 1)
    let pressed = false
    const ev = run(good, 3, 50, (r) => r.phase === 'racing', () => (pressed ? [] : ((pressed = true), ['turbo'])))
    expect(ev.some((e) => e.type === 'rocket' && e.car === 'player')).toBe(true)
    expect(good.player.boost).toBeGreaterThan(0)
  })

  it('spends one segment per tap, stacks, and refuses when empty', () => {
    const race = newRace()
    toGreenLight(race)
    run(race, 4, 50)
    const p = race.player
    p.turbo = 200
    p.boost = 0
    race.step(DT, { pedal: 50, presses: ['turbo', 'turbo'] })
    expect(p.turbo).toBeLessThan(10.5)
    expect(p.boost).toBeGreaterThan(Config.TURBO_TIME * 1.9)
    p.turbo = 0
    race.step(DT, { pedal: 50, presses: ['turbo'] })
    expect(race.takeEvents().some((e) => e.type === 'turboNotReady')).toBe(true)
  })

  it('makes the car faster', () => {
    const a = newRace(), b = newRace()
    for (const r of [a, b]) { toGreenLight(r); run(r, 8, 50) }
    a.player.turbo = 100
    b.player.turbo = 100
    a.step(DT, { pedal: 50, presses: ['turbo'] })
    b.step(DT, { pedal: 50, presses: [] })
    run(a, 3, 50)
    run(b, 3, 50)
    expect(a.player.dist).toBeGreaterThan(b.player.dist + 20)
  })

  it('fills faster when you pedal harder', () => {
    const easy = newRace(), hard = newRace()
    for (const [r, pedal] of [[easy, 30], [hard, 80]] as const) {
      toGreenLight(r)
      r.player.turbo = 0
      run(r, 4, pedal)
    }
    expect(hard.player.turbo).toBeGreaterThan(easy.player.turbo * 2)
  })
})

describe('oil', () => {
  /** A race with `victim` tailgating the player in the same lane. */
  function tailgate(gap: number): Race {
    const race = newRace()
    toGreenLight(race)
    run(race, 3, 50)
    const p = race.player
    const v = race.car('gold')!
    for (const c of race.cars) if (c !== p && c !== v) c.dist = p.dist + 300
    v.dist = p.dist - gap
    v.x = p.x
    v.lane = p.lane
    v.homeLane = p.lane
    v.laneHold = 5
    v.speed = p.speed
    v.dodge = 1
    return race
  }

  it('spins a close tailgater, who has no time to dodge', () => {
    const race = tailgate(9)
    expect(race.oilTarget()?.id).toBe('gold')
    race.step(DT, { pedal: 50, presses: ['oil'] })
    const events = run(race, 3, 50, (r) => r.car('gold')!.spin > 0)
    expect(events.some((e) => e.type === 'spin' && e.car === 'gold' && e.by === 'player')).toBe(true)
    expect(race.player.stats.oilHits).toBe(1)
  })

  it('costs the victim ground', () => {
    const hit = tailgate(9), miss = tailgate(9)
    hit.step(DT, { pedal: 50, presses: ['oil'] })
    miss.step(DT, { pedal: 50, presses: [] })
    run(hit, 6, 50)
    run(miss, 6, 50)
    expect(miss.car('gold')!.dist - hit.car('gold')!.dist).toBeGreaterThan(50)
  })

  it('is limited by charges and recharges over time', () => {
    const race = tailgate(9)
    race.player.oil = 1
    race.step(DT, { pedal: 50, presses: ['oil', 'oil'] })
    expect(race.takeEvents().some((e) => e.type === 'noOil')).toBe(true)
    expect(race.player.oil).toBe(0)
    const events = run(race, Config.OIL_RECHARGE + 1, 50)
    expect(events.some((e) => e.type === 'oilCharged')).toBe(true)
    expect(race.player.oil).toBe(1)
  })

  it('has no target when nobody is behind on your line', () => {
    const race = tailgate(9)
    race.car('gold')!.dist = race.player.dist - 200
    expect(race.oilTarget()).toBeNull()
  })
})

describe('the series', () => {
  it('fits races into the workout and ends when time is up', () => {
    const series = new Series({ seed: 5, duration: 8 * 60, difficulty: 1 })
    expect(series.race.laps).toBeGreaterThanOrEqual(1)
    const laps: number[] = [series.race.laps]
    let lastRace = 1
    for (let t = 0; t < 30 * 60 && series.phase !== 'over'; t += DT) {
      series.step(DT, { pedal: 55, presses: [] })
      if (series.raceNumber !== lastRace) { lastRace = series.raceNumber; laps.push(series.race.laps) }
    }
    expect(series.phase).toBe('over')
    expect(series.history.length).toBe(series.raceNumber)
    expect(series.elapsed).toBeLessThan(8 * 60 + 150)
    expect(series.elapsed).toBeGreaterThan(8 * 60 - 120)
    const total = series.table().reduce((a, s) => a + s.points, 0)
    expect(total).toBe(series.history.length * Config.POINTS.reduce((a, b) => a + b, 0))
    expect(laps.every((l) => l >= 1 && l <= Config.MAX_LAPS)).toBe(true)
  })

  it('starts the championship leader at the back', () => {
    const series = new Series({ seed: 8, duration: 30 * 60, difficulty: 1, laps: 1 })
    for (let t = 0; t < 600 && series.raceNumber === 1; t += DT) series.step(DT, { pedal: 50, presses: [] })
    expect(series.raceNumber).toBe(2)
    const leader = series.table()[0]!.id
    expect(series.race.cars[series.race.cars.length - 1]!.id).toBe(leader)
  })
})
