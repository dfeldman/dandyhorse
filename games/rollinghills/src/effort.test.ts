/**
 * The ride has to fit the rider: everyone pedalling at their own steady pace should hold the same speed up
 * the same hill, and the rider whose steady pace is the platform default should ride exactly as they always
 * did. These pin both, plus the source gate that keeps a heart-rate strap from pedalling for you.
 */
import { DEFAULT_STEADY_WATTS, EffortMeter, FITNESS_LEVELS, type EffortReadout } from '@dandyhorse/gamekit'
import { beforeAll, describe, expect, it } from 'vitest'
import { machineEffort, virtualWatts } from './drive.ts'

// game/config.js reads the page's URL as it loads (it is a browser module), so the test gives it one
// before importing, the same way src/physics.test.ts does.
let cruiseSpeed: (power: number, mass: number) => number
beforeAll(async () => {
  const g = globalThis as unknown as { location?: unknown; window?: unknown }
  g.location ??= { search: '' }
  g.window ??= {}
  ;({ cruiseSpeed } = await import('./game/physics.js'))
})

const MASS = 85
/** The speed a rider holds on the flat, given the steady watts their fitness sets and what they are doing. */
function flatSpeed(steadyWatts: number, reading: { power?: number; speed?: number; incline?: number }, deviceType: 'bike' | 'treadmill' = 'bike'): number {
  const meter = new EffortMeter({
    deviceType,
    weightKg: 75,
    preferences: { global: { steadyWatts }, device: {} },
    smoothing: { power: 0 },
  })
  meter.read(reading, 0)
  const effort = machineEffort(meter.readout(0), deviceType)
  return cruiseSpeed(virtualWatts(effort, DEFAULT_STEADY_WATTS), MASS)
}

describe('the ride fits the rider', () => {
  it('gives every fitness level the same speed at their own steady pace', () => {
    const speeds = FITNESS_LEVELS.map((l) => flatSpeed(l.watts, { power: l.watts }))
    for (const v of speeds) expect(v).toBeCloseTo(speeds[0]!, 2)
    // and it is a real bike speed for all of them, not a crawl: ~24 km/h for the default 130 W
    expect(speeds[0]).toBeGreaterThan(5)
    expect(speeds[0]).toBeLessThan(12)
  })

  it('leaves a rider on the platform default riding exactly as before', () => {
    expect(flatSpeed(DEFAULT_STEADY_WATTS, { power: DEFAULT_STEADY_WATTS }))
      .toBeCloseTo(cruiseSpeed(DEFAULT_STEADY_WATTS, MASS), 6)
  })

  it('still rewards working harder, by the same factor for everyone', () => {
    for (const level of FITNESS_LEVELS) {
      const steady = flatSpeed(level.watts, { power: level.watts })
      const pushing = flatSpeed(level.watts, { power: level.watts * 1.3 })
      expect(pushing).toBeGreaterThan(steady)
      expect(pushing / steady).toBeCloseTo(flatSpeed(100, { power: 130 }) / flatSpeed(100, { power: 100 }), 2)
    }
  })

  it('reads a treadmill at its rider\'s steady pace as the same ride', () => {
    const meter = new EffortMeter({
      deviceType: 'treadmill',
      weightKg: 75,
      preferences: { global: { steadyPace: { speed: 1.4, incline: 0 } }, device: {} },
    })
    meter.read({ speed: 1.4, incline: 0 }, 0)
    const effort = machineEffort(meter.readout(0), 'treadmill')
    expect(effort).toBeCloseTo(1, 2)
    expect(virtualWatts(effort, DEFAULT_STEADY_WATTS)).toBeCloseTo(DEFAULT_STEADY_WATTS, 2)
  })

  it('counts a treadmill climb as more effort, which is what carries the bike up the hill', () => {
    const flat = flatSpeed(0, { speed: 1.4, incline: 0 }, 'treadmill')
    const climb = flatSpeed(0, { speed: 1.4, incline: 6 }, 'treadmill')
    expect(climb).toBeGreaterThan(flat)
  })
})

describe('only the machine pedals', () => {
  const readout = (source: EffortReadout['source'], effort: number): EffortReadout =>
    ({ source, effort } as EffortReadout)

  it('takes the machine\'s own reading', () => {
    expect(machineEffort(readout('power', 1.2), 'bike')).toBeCloseTo(1.2)
    expect(machineEffort(readout('treadmill', 0.8), 'treadmill')).toBeCloseTo(0.8)
  })

  it('refuses heart rate and cadence, so the bike never rolls on your pulse', () => {
    // a strap reads high for a minute after you stop, and cadence cannot see the resistance
    expect(machineEffort(readout('heartRate', 1.1), 'bike')).toBeNull()
    expect(machineEffort(readout('cadence', 1.1), 'bike')).toBeNull()
    expect(machineEffort(readout('none', 0), 'bike')).toBeNull()
    // the wrong machine's reading is not this machine's
    expect(machineEffort(readout('power', 1.1), 'treadmill')).toBeNull()
    expect(machineEffort(readout('treadmill', 1.1), 'bike')).toBeNull()
  })

  it('treats nothing reading as nobody pedalling', () => {
    expect(virtualWatts(null, DEFAULT_STEADY_WATTS)).toBe(0)
  })
})
