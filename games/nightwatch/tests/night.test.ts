import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { Lamp } from '../src/sim/lamp.ts'
import { Night, type NightEvent } from '../src/sim/night.ts'
import { driftLine } from '../src/sim/ship.ts'

const DT = 0.1

/** Step a night until `until` (night time), pedalling whatever `pedal(night)` says. Returns the events. */
function run(night: Night, until: number, pedal: (n: Night) => number | null, presses: (n: Night) => 'horn'[] = () => []): NightEvent[] {
  const events: NightEvent[] = []
  while (night.time < until - 1e-9 && night.phase !== 'done') {
    night.step(DT, { pedal: pedal(night), presses: presses(night) })
    events.push(...night.takeEvents())
  }
  return events
}

/** A keeper who reads the board: the neediest ship's need (a little early), else an easy walk. */
const keeper = (margin = 1) => (n: Night): number => {
  let want = 34
  for (const s of n.ships) {
    const p = s.plan
    if (n.time >= p.watchStart - 6 && n.time < p.watchEnd) want = Math.max(want, p.need + margin)
  }
  return want
}

describe('the lamp', () => {
  it('spins up toward the pedal and coasts down more slowly', () => {
    const lamp = new Lamp()
    for (let i = 0; i < 10; i++) lamp.step(0.1, 50, 25)
    const up = lamp.power
    expect(up).toBeGreaterThan(30)
    expect(up).toBeLessThan(50)
    for (let i = 0; i < 100; i++) lamp.step(0.1, 50, 25)
    expect(lamp.power).toBeCloseTo(50, 1)
    for (let i = 0; i < 10; i++) lamp.step(0.1, 0, 25)
    expect(50 - lamp.power).toBeLessThan(up)
  })

  it('holds the last pedal when there is no reading', () => {
    const lamp = new Lamp()
    for (let i = 0; i < 100; i++) lamp.step(0.1, 60, 25)
    for (let i = 0; i < 100; i++) lamp.step(0.1, null, 25)
    expect(lamp.power).toBeCloseTo(60, 1)
  })

  it('is full at the target and dims below it', () => {
    const lamp = new Lamp()
    for (let i = 0; i < 200; i++) lamp.step(0.1, 50, 50)
    expect(lamp.brightness).toBeGreaterThan(0.99)
    expect(lamp.brightnessFor(45)).toBe(1)
    expect(lamp.brightnessFor(55)).toBeLessThan(0.95)
    expect(lamp.brightnessFor(55)).toBeGreaterThan(lamp.brightnessFor(60))
    expect(lamp.brightnessFor(50 + Config.LAMP_FADE)).toBe(0)
  })

  it('builds steam only above the target and the floor, up to the cap', () => {
    const lamp = new Lamp()
    const start = lamp.steam
    for (let i = 0; i < 600; i++) lamp.step(0.1, Config.STEAM_FLOOR - 2, 25)
    expect(lamp.steam).toBe(start)
    for (let i = 0; i < 600; i++) lamp.step(0.1, 60, 62)
    expect(lamp.steam).toBe(start)
    let gained = 0
    for (let i = 0; i < 3000; i++) gained += lamp.step(0.1, 70, 50)
    expect(lamp.steam).toBe(Config.STEAM_MAX)
    expect(gained).toBe(Config.STEAM_MAX - Config.STEAM_START)
    expect(lamp.spend()).toBe(true)
    expect(lamp.charges).toBe(Config.STEAM_MAX - 1)
  })
})

describe('drift', () => {
  it('settles further off the line the dimmer the lamp', () => {
    expect(driftLine(-5)).toBe(0)
    expect(driftLine(0)).toBe(0)
    expect(driftLine(3)).toBeLessThan(Config.STAR3_DRIFT)
    expect(driftLine(7)).toBeLessThan(1)
    expect(driftLine(10)).toBeGreaterThan(1)
    expect(driftLine(50)).toBe(Config.DRIFT_CAP)
  })
})

describe('a night', () => {
  it('brings every ship home with three stars for a keeper who follows the board', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const night = new Night({ seed, duration: 1200 })
      run(night, 99999, keeper(1))
      expect(night.phase).toBe('done')
      expect(night.ships.every((s) => s.stars === 3)).toBe(true)
      expect(night.starsEarned).toBe(night.starsMax)
      expect(night.bestStreak).toBe(night.ships.length)
    }
  })

  it('forgives a two-second stop in the middle of the channel', () => {
    const night = new Night({ seed: 11, duration: 1200 })
    const ship = night.ships.find((s) => s.plan.level >= 2)!
    const mid = (ship.plan.approachEnd + ship.plan.watchEnd) / 2
    run(night, ship.plan.watchEnd + 1, (n) => (n.time >= mid && n.time < mid + 2 ? 0 : keeper(1)(n)))
    expect(ship.maxDrift).toBeLessThan(Config.STAR3_DRIFT)
    expect(ship.stars).toBe(3)
  })

  it('runs a ship aground in the dark, then tows it in', () => {
    const night = new Night({ seed: 5, duration: 900 })
    const ship = night.ships[0]!
    const events: NightEvent[] = []
    while (ship.state !== 'aground' && night.time < ship.plan.watchEnd) events.push(...run(night, night.time + DT, () => 0))
    expect(ship.state).toBe('aground')
    expect(ship.stars).toBe(0)
    expect(events.some((e) => e.type === 'scrape' && e.ship === ship)).toBe(true)
    expect(events.some((e) => e.type === 'aground' && e.ship === ship)).toBe(true)
    const later = run(night, ship.groundedAt + Config.TOW_DELAY + Config.TOW_TIME + 1, () => 0)
    expect(later.some((e) => e.type === 'tow' && e.ship === ship)).toBe(true)
    expect(ship.state).toBe('moored')
    expect(ship.mooring).toBeGreaterThanOrEqual(0)
  })

  it('scores a ship that wandered with two stars, and one that scraped with one', () => {
    const night = new Night({ seed: 21, duration: 1800 })
    const a = night.ships[1]!
    const b = night.ships[2]!
    run(night, a.plan.watchEnd + 1, (n) => (n.time >= a.plan.watchStart ? a.plan.need - 6 : keeper(1)(n)))
    expect(a.stars).toBe(2)
    run(night, b.plan.watchStart, keeper(1))
    // dark until it touches the rocks, then back to the need
    let touched = false
    run(night, b.plan.watchEnd + 1, (n) => {
      if (b.onRocks) touched = true
      return touched ? b.plan.need + 4 : 0
    })
    expect(touched).toBe(true)
    expect(b.stars).toBe(1)
  })

  it('tells the story of a ship in order', () => {
    const night = new Night({ seed: 2, duration: 900 })
    const ship = night.ships[0]!
    const events = run(night, ship.plan.watchEnd + Config.HARBOR_TIME + 1, keeper(1))
      .filter((e) => 'ship' in e && e.ship === ship && !e.type.startsWith('hail'))
      .map((e) => e.type)
    expect(events).toEqual(['sighted', 'watch', 'channel', 'safe', 'docked'])
  })

  it('sets the target from the ship on watch, climbing at the start, and shows a ghost before it', () => {
    const night = new Night({ seed: 4, duration: 1200 })
    const ship = night.ships[1]!
    run(night, ship.plan.watchStart - Config.GHOST_TIME - 1, keeper(1))
    expect(night.ghost()).toBeNull()
    expect(night.target).toBe(Config.REST_TARGET)
    run(night, ship.plan.watchStart - 2, keeper(1))
    expect(night.ghost()?.need).toBe(ship.plan.need)
    run(night, ship.plan.watchStart + Config.TARGET_RAMP / 2, keeper(1))
    expect(night.target).toBeGreaterThan(Config.REST_TARGET)
    expect(night.target).toBeLessThan(ship.plan.need)
    run(night, ship.plan.watchStart + Config.TARGET_RAMP + 1, keeper(1))
    expect(night.target).toBeCloseTo(ship.plan.need, 6)
    expect(night.upcoming(1)[0]).not.toBe(ship)
  })

  it('blows the horn only when a ship needs it, answers hails for free, and waits between blasts', () => {
    const night = new Night({ seed: 9, duration: 1800 })
    const ship = night.ships.find((s, i) => i > 0 && s.plan.hailAt === null)!
    run(night, ship.plan.approachEnd + 5, keeper(1))
    const before = night.lamp.steam
    night.step(DT, { pedal: 50, presses: ['horn'] })
    expect(night.takeEvents().some((e) => e.type === 'toot' && e.reason === 'nobody')).toBe(true)
    expect(night.lamp.steam).toBeGreaterThanOrEqual(before)

    // let it wander, then blow
    run(night, night.time + 1.5, () => 50)
    run(night, night.time + 30, () => 0)
    expect(ship.drift).toBeGreaterThan(Config.HORN_MIN_DRIFT)
    night.lamp.steam = 2
    const drift = ship.drift
    night.step(DT, { pedal: 0, presses: ['horn'] })
    const ev = night.takeEvents()
    expect(ev.some((e) => e.type === 'horn')).toBe(true)
    expect(night.lamp.charges).toBe(1)
    expect(ship.drift).toBeLessThan(drift - Config.HORN_KICK + 0.05)
    night.step(DT, { pedal: 0, presses: ['horn'] })
    expect(night.takeEvents().some((e) => e.type === 'toot' && e.reason === 'busy')).toBe(true)
    expect(night.lamp.charges).toBe(1)
    // held steady for a moment even in the dark
    const held = ship.drift
    run(night, night.time + Config.HORN_CALM - 0.5, () => 0)
    expect(ship.drift).toBeLessThanOrEqual(held + 0.02)
  })

  it('answers a hail with the horn, and a missed hail costs nothing', () => {
    const night = new Night({ seed: 3, duration: 1800 })
    const hailers = night.ships.filter((s) => s.plan.hailAt !== null)
    expect(hailers.length).toBeGreaterThan(1)
    const [a, b] = hailers
    run(night, a!.plan.hailAt! + 1, keeper(1))
    expect(a!.hail).not.toBeNull()
    const steam = night.lamp.steam
    const points = night.points
    night.step(DT, { pedal: keeper(1)(night), presses: ['horn'] })
    const ev = night.takeEvents()
    expect(ev.some((e) => e.type === 'hailAnswered' && e.ship === a)).toBe(true)
    expect(night.points).toBe(points + Config.HAIL_POINTS)
    expect(night.lamp.steam).toBeGreaterThanOrEqual(steam)
    const missed = run(night, b!.plan.hailAt! + Config.HAIL_WINDOW + 1, keeper(1))
    expect(missed.some((e) => e.type === 'hailMissed' && e.ship === b)).toBe(true)
    run(night, 99999, keeper(1))
    expect(b!.stars).toBe(3)
    expect(night.hailsAnswered).toBe(1)
  })

  it('keeps the harbour to its moorings: the longest-moored ship sails out to make room', () => {
    const night = new Night({ seed: 6, duration: 3600 })
    expect(night.ships.length).toBeGreaterThan(Config.MOORINGS)
    const events = run(night, 99999, keeper(1))
    const leaves = events.filter((e) => e.type === 'leave')
    expect(leaves.length).toBeGreaterThan(0)
    expect((leaves[0] as { ship: { id: number } }).ship.id).toBe(night.ships[0]!.id)
    const held = night.moorings.filter(Boolean)
    expect(held.length).toBe(Config.MOORINGS)
    expect(new Set(held.map((s) => s!.id)).size).toBe(Config.MOORINGS)
  })

  it('runs the clock from dusk to dawn and then stops', () => {
    const night = new Night({ seed: 1, duration: 600 })
    expect(night.clock()).toBe('20:00')
    const events = run(night, 300, () => 30)
    expect(events.some((e) => e.type === 'lit')).toBe(true)
    expect(night.clock()).toBe('01:00')
    const rest = run(night, 99999, () => 30)
    expect(rest.some((e) => e.type === 'dawn')).toBe(true)
    expect(rest.at(-1)!.type).toBe('done')
    expect(night.clock()).toBe('06:00')
    const t = night.time
    night.step(1, { pedal: 30, presses: ['horn'] })
    expect(night.time).toBe(t)
    expect(night.takeEvents()).toEqual([])
  })

  it('ends the night on demand, keeping the stars earned so far', () => {
    const night = new Night({ seed: 1, duration: 1800 })
    run(night, 300, keeper())
    const before = night.starsEarned
    night.finishNow()
    const events = night.takeEvents()
    expect(night.phase).toBe('done')
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(night.starsEarned).toBe(before)
    // a night that is already over stays over, and says so only once
    night.finishNow()
    expect(night.takeEvents()).toEqual([])
  })

  it('reports what the platform needs', () => {
    const night = new Night({ seed: 1, duration: 600 })
    run(night, 60, () => 45)
    const s = night.snapshot()
    expect(s).toMatchObject({ phase: 'night', time: 60, remaining: 540 })
    expect(s.power).toBeGreaterThan(40)
    expect(s.watching.length).toBe(1)
    expect(typeof s.target).toBe('number')
  })
})
