import { beforeAll, describe, expect, it } from 'vitest'

// game/config.js reads the page's URL as it loads (it is a browser module), so the test gives it one
// before importing, which is why this is a dynamic import and not a plain one at the top.
type Accel = (v: number, grade: number, power: number, mass: number, gravityScale?: number) => number
let bikeAccel: Accel
let runSpeed: (base: number, grade: number) => number
let freewheeling: (wasCoasting: boolean, grade: number, v: number, cruise: number) => boolean
let cruiseSpeed: (power: number, mass: number) => number
beforeAll(async () => {
  const g = globalThis as unknown as { location?: unknown; window?: unknown }
  g.location ??= { search: '' }
  g.window ??= {}
  ;({ bikeAccel, runSpeed, freewheeling, cruiseSpeed } = await import('./game/physics.js'))
})

describe('bikeAccel', () => {
  it('holds a steady speed on the flat where the power balances the losses', () => {
    // find the speed a 200 W rider settles at, then check the acceleration there is nil
    let v = 8
    for (let i = 0; i < 20000; i++) v += bikeAccel(v, 0, 200, 80) * 0.01
    expect(v).toBeGreaterThan(5)
    expect(Math.abs(bikeAccel(v, 0, 200, 80))).toBeLessThan(0.01)
  })
  it('costs speed to climb and gives it back going down, at the same power', () => {
    const settle = (grade: number): number => {
      let v = 6
      for (let i = 0; i < 40000; i++) v = Math.max(0.5, v + bikeAccel(v, grade, 200, 80) * 0.01)
      return v
    }
    const flat = settle(0)
    expect(settle(0.04)).toBeLessThan(flat)
    expect(settle(0.09)).toBeLessThan(settle(0.04))
    expect(settle(-0.04)).toBeGreaterThan(flat)
  })
})

describe('runSpeed', () => {
  it('leaves the flat alone', () => {
    expect(runSpeed(3.3, 0)).toBeCloseTo(3.3, 6)
  })
  it('falls away the steeper the climb gets', () => {
    const grades = [0, 0.02, 0.05, 0.08, 0.12, 0.2]
    const speeds = grades.map((g) => runSpeed(3.3, g))
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThan(speeds[i - 1])
    expect(runSpeed(3.3, 0.1)).toBeCloseTo(3.3 / 1.6, 5)   // a 10% wall costs about 40% of the pace
  })
  it('is a little quicker down a gentle slope and slower down a steep one', () => {
    expect(runSpeed(3.3, -0.03)).toBeGreaterThan(3.3)
    expect(runSpeed(3.3, -0.25)).toBeLessThan(3.3 * 0.7)
  })
  it('never runs away downhill or stops dead on a wall', () => {
    for (let g = -0.6; g <= 0.6; g += 0.01) {
      const v = runSpeed(3.3, g)
      expect(v).toBeGreaterThan(0.5)
      expect(v).toBeLessThan(3.3 / 0.9 + 1e-9)
    }
  })
})

describe('freewheeling', () => {
  const cruise = 8
  it('keeps pedalling on the flat and uphill however fast the rider is going', () => {
    expect(freewheeling(false, 0, 20, cruise)).toBe(false)
    expect(freewheeling(true, 0.04, 20, cruise)).toBe(false)
  })
  it('stops pedalling once the descent is carrying them faster than their own flat speed', () => {
    expect(freewheeling(false, -0.06, cruise * 1.1, cruise)).toBe(true)
    expect(freewheeling(false, -0.06, cruise * 0.8, cruise)).toBe(false)   // still slower than the flat: pedal
  })
  it('does not flicker at the threshold', () => {
    const v = cruise           // exactly at the flat speed
    expect(freewheeling(false, -0.06, v, cruise)).toBe(false)   // needs to be clearly faster to stop
    expect(freewheeling(true, -0.06, v, cruise)).toBe(true)     // and clearly slower to start again
  })
  it('has no equivalent on foot: a runner gains only a little on a descent', () => {
    expect(runSpeed(3.3, -0.06) / 3.3).toBeLessThan(1.1)
  })
})

describe('cruiseSpeed', () => {
  it('is the speed where the flat-ground forces balance', () => {
    const v = cruiseSpeed(200, 80)
    expect(Math.abs(bikeAccel(v, 0, 200, 80))).toBeLessThan(0.02)
  })
  it('rises with power', () => {
    expect(cruiseSpeed(300, 80)).toBeGreaterThan(cruiseSpeed(150, 80))
  })
})
