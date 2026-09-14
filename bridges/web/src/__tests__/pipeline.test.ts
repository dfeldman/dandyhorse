import { describe, expect, test } from 'vitest'
import { commandedEqual, process, rampDown, slew, speedAllowed, staleAction } from '../pipeline'
import { DEFAULT_LIMITS, type Commanded, type Limits } from '../types'

const L: Limits = { ...DEFAULT_LIMITS }
const SPEED = { allowSpeed: true }

describe('speed control is opt-in per treadmill', () => {
  test('without allowSpeed a treadmill gets no speed command, but incline still flows', () => {
    const lim = { ...L, maxInclineChangePerSecond: 100 }
    const c = process('treadmill', { speed: 3, incline: 4 }, lim, null, 1)
    expect(c.speed).toBeNull()
    expect(c.incline).toBe(4)
    expect(process('treadmill', { speed: 3 }, lim, null, 1, { allowSpeed: false }).speed).toBeNull()
  })
  test('simulators are allowed; real treadmills only when their preferences say so', () => {
    expect(speedAllowed('sim', null)).toBe(true)
    expect(speedAllowed('ftms', null)).toBe(false)
    expect(speedAllowed('ftms', {})).toBe(false)
    expect(speedAllowed('ftms', { speedControl: 'yes' })).toBe(false)
    expect(speedAllowed('ftms', { speedControl: true })).toBe(true)
  })
})

describe('treadmill pipeline', () => {
  test('null requested gives null commanded', () => {
    const c = process('treadmill', { speed: null, incline: null }, L, null, 1)
    expect(c).toEqual({ speed: null, incline: null, power: null, grade: null, wind: null, crr: null, cw: null })
  })

  test('scales speed and incline', () => {
    const lim = { ...L, speedScale: 0.5, inclineScale: 2, maxSpeedChangePerSecond: 100, maxInclineChangePerSecond: 100 }
    const c = process('treadmill', { speed: 2, incline: 3 }, lim, null, 1, SPEED)
    expect(c.speed).toBe(1)
    expect(c.incline).toBe(6)
  })

  test('clamps to min/max', () => {
    const lim = { ...L, maxSpeed: 3, minIncline: 1, maxSpeedChangePerSecond: 100, maxInclineChangePerSecond: 100 }
    const c = process('treadmill', { speed: 10, incline: -5 }, lim, null, 1, SPEED)
    expect(c.speed).toBe(3)
    expect(c.incline).toBe(1)
  })

  test('slews from 0 when no previous commanded', () => {
    const c = process('treadmill', { speed: 3, incline: 10 }, L, null, 0.5, SPEED)
    expect(c.speed).toBe(0.25) // 0.5 m/s^2 * 0.5 s
    expect(c.incline).toBe(0.5) // 1 %/s * 0.5 s
  })

  test('slews relative to the previous commanded value, both directions', () => {
    const prev = { speed: 2, incline: 4, power: null, grade: null, wind: null, crr: null, cw: null }
    const up = process('treadmill', { speed: 3, incline: 10 }, L, prev, 1, SPEED)
    expect(up.speed).toBe(2.5)
    expect(up.incline).toBe(5)
    const down = process('treadmill', { speed: 0, incline: 0 }, L, prev, 1, SPEED)
    expect(down.speed).toBe(1.5)
    expect(down.incline).toBe(3)
  })

  test('reaches the target when within the slew budget', () => {
    const prev = { speed: 2, incline: 4, power: null, grade: null, wind: null, crr: null, cw: null }
    const c = process('treadmill', { speed: 2.1, incline: 4.2 }, L, prev, 1, SPEED)
    expect(c.speed).toBe(2.1)
    expect(c.incline).toBe(4.2)
  })

  test('applies device ranges and resolution', () => {
    const lim = { ...L, maxSpeedChangePerSecond: 100, maxInclineChangePerSecond: 100, maxIncline: 20 }
    const c = process('treadmill', { speed: 2.004, incline: 20 }, lim, null, 1, {
      allowSpeed: true,
      ranges: { speed: { min: 0.5, max: 5, step: 0.1 }, incline: { min: 0, max: 12, step: 0.5 } },
    })
    expect(c.speed).toBe(2)
    expect(c.incline).toBe(12)
  })

  test('ignores bike-only requests on a treadmill', () => {
    const c = process('treadmill', { power: 200, grade: 5 }, L, null, 1)
    expect(c.power).toBeNull()
    expect(c.grade).toBeNull()
  })
})

describe('bike pipeline', () => {
  test('ERG wins when power is requested, sim fields null', () => {
    const c = process('bike', { power: 200, grade: 5, wind: 1 }, { ...L, powerOffset: 10 }, null, 1)
    expect(c.power).toBe(210)
    expect(c.grade).toBeNull()
    expect(c.wind).toBeNull()
    expect(c.crr).toBeNull()
    expect(c.cw).toBeNull()
  })

  test('power offset never goes negative', () => {
    const c = process('bike', { power: 5 }, { ...L, powerOffset: -50 }, null, 1)
    expect(c.power).toBe(0)
  })

  test('sim mode fills defaults when only grade is requested', () => {
    const c = process('bike', { grade: 4.5 }, L, null, 1)
    expect(c).toEqual({ speed: null, incline: null, power: null, grade: 4.5, wind: 0, crr: 0.004, cw: 0.51 })
  })

  test('difficulty scales grade and gradeCap clamps it (both signs)', () => {
    const lim = { ...L, difficulty: 0.5, gradeCap: 3 }
    expect(process('bike', { grade: 4 }, lim, null, 1).grade).toBe(2)
    expect(process('bike', { grade: 40 }, lim, null, 1).grade).toBe(3)
    expect(process('bike', { grade: -40 }, lim, null, 1).grade).toBe(-3)
  })

  test('sim mode with only wind requested defaults grade to 0', () => {
    const c = process('bike', { wind: 2, crr: 0.005, cw: 0.6 }, L, null, 1)
    expect(c.grade).toBe(0)
    expect(c.wind).toBe(2)
    expect(c.crr).toBe(0.005)
    expect(c.cw).toBe(0.6)
  })

  test('no request gives no command; virtual speed is ignored on a bike', () => {
    const c = process('bike', { speed: 8 }, L, null, 1)
    expect(Object.values(c).every((v) => v === null)).toBe(true)
  })

  test('bikes are not slewed', () => {
    const prev = { speed: null, incline: null, power: 100, grade: null, wind: null, crr: null, cw: null }
    expect(process('bike', { power: 400 }, L, prev, 0.01).power).toBe(400)
  })

  test('power range applied', () => {
    const c = process('bike', { power: 3000 }, L, null, 1, { ranges: { power: { min: 0, max: 2000, step: 1 } } })
    expect(c.power).toBe(2000)
  })
})

describe('helpers', () => {
  test('slew with zero dt holds', () => {
    expect(slew(5, 2, 1, 0)).toBe(2)
  })
  test('rampDown lowers speed at the slew rate and keeps incline', () => {
    const prev = { speed: 2, incline: 3, power: null, grade: null, wind: null, crr: null, cw: null }
    const r = rampDown(prev, L, 1)
    expect(r.speed).toBe(1.5)
    expect(r.incline).toBe(3)
    expect(rampDown(r, L, 10).speed).toBe(0)
  })
  test('rampDown leaves a user-controlled belt alone (game never commanded speed)', () => {
    const prev = { speed: null, incline: 3, power: null, grade: null, wind: null, crr: null, cw: null }
    expect(rampDown(prev, L, 1)).toMatchObject({ speed: null, incline: 3 })
    expect(rampDown(null, L, 1).speed).toBeNull()
  })
  test('commandedEqual', () => {
    const a = { speed: 1, incline: null, power: null, grade: null, wind: null, crr: null, cw: null }
    expect(commandedEqual(a, { ...a })).toBe(true)
    expect(commandedEqual(a, { ...a, speed: 2 })).toBe(false)
    expect(commandedEqual(a, null)).toBe(false)
    expect(commandedEqual(null, null)).toBe(true)
  })
})


describe('staleAction', () => {
  test('normal while server and game are live', () => {
    expect(staleAction('treadmill', 500, 0.8)).toBe('normal')
    expect(staleAction('treadmill', 500, null)).toBe('normal') // no active game (pending session)
  })
  test('holds after 10 s of silence from either side', () => {
    expect(staleAction('treadmill', 11_000, 1)).toBe('hold')
    expect(staleAction('treadmill', 500, 12)).toBe('hold')
  })
  test('ramps a treadmill down after 30 s, from a dead server or a frozen game', () => {
    expect(staleAction('treadmill', 31_000, 1)).toBe('ramp')
    expect(staleAction('treadmill', 500, 31)).toBe('ramp')
  })
  test('bikes only ever hold', () => {
    expect(staleAction('bike', 60_000, 60)).toBe('hold')
  })
})

describe('incline on a coarse machine grid (Horizon: 0.5 % steps, 250 ms ticks)', () => {
  const ranges = { incline: { min: 0, max: 15, step: 0.5 } }
  function ride(from: number, to: number, ticks = 60): number[] {
    let prev: Commanded = { ...process('treadmill', {}, L, null, 0.25), incline: from }
    const seen: number[] = []
    for (let i = 0; i < ticks; i++) {
      prev = process('treadmill', { incline: to }, L, prev, 0.25, { ranges })
      seen.push(prev.incline!)
    }
    return seen
  }
  test('reaches a lower target', () => {
    expect(ride(2, 0).at(-1)).toBe(0)
    expect(ride(7.5, 3).at(-1)).toBe(3)
  })
  test('reaches a higher target', () => {
    expect(ride(0, 2).at(-1)).toBe(2)
    expect(ride(3, 7.5).at(-1)).toBe(7.5)
  })
  test('never moves faster than the slew limit allows, averaged over a second', () => {
    const seen = ride(0, 6, 8)
    expect(seen.at(-1)).toBeLessThanOrEqual(2 + 0.5)
  })
})
