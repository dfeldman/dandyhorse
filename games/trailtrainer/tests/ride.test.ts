/**
 * The rules the riding model must not break, pinned.
 *
 * The first three are the difference between a bike and a pair of legs, and they are the ones worth a test: a
 * bike coasts and a runner does not. Get that wrong and the game is a toy.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { Ride } from '../src/sim/ride.ts'
import { Route } from '../src/route/route.ts'
import type { RouteManifest } from '../src/route/package.ts'

/** A straight route `length` metres long at a constant grade, with no elevation model behind it. */
function straight(grade: number, length = 4000, step = 10): Route {
  const samples = Math.floor(length / step) + 1
  const track = new Float32Array(samples * 3)
  for (let i = 0; i < samples; i++) {
    track[i * 3] = 0
    track[i * 3 + 1] = i * step
    track[i * 3 + 2] = 400 + i * step * grade
  }
  const manifest: RouteManifest = {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    direction: 'a → b',
    region: 'nowhere',
    blurb: '',
    kind: 'road',
    origin: { lat: 45, lon: 6 },
    step,
    length: (samples - 1) * step,
    samples,
    stats: { gain: 0, loss: 0, minElevation: 0, maxElevation: 0, maxGrade: 0, minGrade: 0, averageGrade: 0 },
    biomes: [{ start: 0, value: 'mountain' }],
    surfaces: [{ start: 0, value: 'paved' }],
    landmarks: [],
    dem: { step: 30, tile: 64, minCol: 0, minRow: 0, tiles: [], scale: 2, noData: -32768 },
    attribution: { geometry: '', elevation: '', terrain: '', bakedAt: '', recipe: '' },
  }
  return Route.fromParts(manifest, track.buffer, new Int16Array(0).buffer)
}

/** Several laps of a flat circle of radius `r`, so the cornering cap has a long bend to act on. */
function bend(r: number, laps = 5): Route {
  const step = 10
  const samples = Math.floor((2 * Math.PI * r * laps) / step) + 1
  const track = new Float32Array(samples * 3)
  for (let i = 0; i < samples; i++) {
    const a = (i * step) / r
    track[i * 3] = r * Math.sin(a)
    track[i * 3 + 1] = r * (1 - Math.cos(a))
    track[i * 3 + 2] = 400
  }
  const base = straight(0, (samples - 1) * step, step)
  return Route.fromParts({ ...base.manifest, samples, length: (samples - 1) * step }, track.buffer, new Int16Array(0).buffer)
}

const run = (ride: Ride, m: Parameters<Ride['update']>[0], seconds: number, dt = 0.05) => {
  let last = ride.update(m, dt)
  for (let t = dt; t < seconds; t += dt) last = ride.update(m, dt)
  return last
}

const coasting = { power: 0, speed: null, cadence: 0, heartRate: null }

describe('a bike coasts', () => {
  it('rolls on after the rider stops pedalling, and then stops', () => {
    Config.deviceType = 'bike'
    const ride = new Ride(straight(0), 0)
    run(ride, { power: 220, speed: null, cadence: 85, heartRate: null }, 30)
    const rolling = ride.velocity
    expect(rolling).toBeGreaterThan(6)

    const after2s = run(ride, coasting, 2)
    // two seconds of not pedalling is not a stop: still moving, and further down the road
    expect(after2s.speed).toBeGreaterThan(rolling * 0.75)
    expect(after2s.s).toBeGreaterThan(0)
    expect(after2s.coasting).toBe(true)

    const eventually = run(ride, coasting, 120)
    expect(eventually.speed).toBe(0)
    expect(eventually.s).toBeGreaterThan(after2s.s)
  })

  it('speeds up downhill with no power at all, and covers ground', () => {
    Config.deviceType = 'bike'
    const ride = new Ride(straight(-0.08), 0)
    const t5 = run(ride, coasting, 5)
    const t20 = run(ride, coasting, 15)
    expect(t5.speed).toBeGreaterThan(2)
    expect(t20.speed).toBeGreaterThan(t5.speed)
    expect(t20.s).toBeGreaterThan(100)
    expect(t20.power).toBe(0)
    // and it settles at a terminal speed rather than running away
    const t120 = run(ride, coasting, 100)
    expect(t120.speed).toBeLessThan(20)
    expect(Math.abs(t120.speed - run(ride, coasting, 30).speed)).toBeLessThan(0.5)
  })

  it('does not roll backwards up a hill', () => {
    Config.deviceType = 'bike'
    const ride = new Ride(straight(0.09), 0)
    const state = run(ride, coasting, 20)
    expect(state.speed).toBe(0)
    expect(state.s).toBeGreaterThanOrEqual(0)
  })
})

describe('climbing', () => {
  it('gets up a steep ramp at an ordinary power, slowly, from a standing start', () => {
    Config.deviceType = 'bike'
    // 15.4% is real: it is the ramp above Le Rosai on Alpe d'Huez, and people ride up it at 180 W
    const ride = new Ride(straight(0.154), 0)
    const state = run(ride, { power: 180, speed: null, cadence: 70, heartRate: null }, 90)
    expect(state.speed).toBeGreaterThan(0.9)
    expect(state.speed).toBeLessThan(2.2)
    expect(state.s).toBeGreaterThan(60)
  })

  it('goes faster up the same ramp for more power', () => {
    Config.deviceType = 'bike'
    const slow = run(new Ride(straight(0.154), 0), { power: 180, speed: null, cadence: 70, heartRate: null }, 90)
    const fast = run(new Ride(straight(0.154), 0), { power: 320, speed: null, cadence: 85, heartRate: null }, 90)
    expect(fast.speed).toBeGreaterThan(slow.speed * 1.4)
  })
})

describe('a runner does not', () => {
  it('covers no ground at all when the belt stops, however steep the descent', () => {
    Config.deviceType = 'treadmill'
    const ride = new Ride(straight(-0.12), 0)
    run(ride, { power: null, speed: 3, cadence: null, heartRate: null }, 20)
    const moving = ride.position
    const stopped = run(ride, { power: null, speed: 0, cadence: null, heartRate: null }, 60)
    // the belt takes a moment to wind down for the eye, and then nothing moves at all
    expect(stopped.speed).toBe(0)
    const held = run(ride, { power: null, speed: 0, cadence: null, heartRate: null }, 60)
    expect(held.s).toBeCloseTo(stopped.s, 3)
    expect(stopped.s - moving).toBeLessThan(5)
    expect(stopped.coasting).toBe(false)
  })

  it('moves at the belt speed and not the hill', () => {
    Config.deviceType = 'treadmill'
    const belt = { power: null, speed: 3, cadence: null, heartRate: null }
    const down = run(new Ride(straight(-0.1), 0), belt, 60)
    const up = run(new Ride(straight(0.1), 0), belt, 60)
    expect(down.speed).toBeCloseTo(3, 1)
    expect(up.speed).toBeCloseTo(3, 1)
    // 60 s at 3 m/s is 180 m, whichever way the ground tilts
    expect(down.s).toBeGreaterThan(170)
    expect(Math.abs(down.s - up.s)).toBeLessThan(2)
  })
})

describe('what the machine is asked for', () => {
  it('is the route grade in percent, stepped and smoothed', () => {
    Config.deviceType = 'bike'
    const state = run(new Ride(straight(0.082), 0), { power: 200, speed: null, cadence: 85, heartRate: null }, 20)
    expect(state.request).toBeCloseTo(8, 0)
    expect(state.request % Config.gradeStep).toBeCloseTo(0, 6)
  })
})

describe('bends', () => {
  it('hold a coasting bike down to what the corner will take', () => {
    Config.deviceType = 'bike'
    // a 30 m radius hairpin: sqrt(3.5 / (1/30)) is about 10 m/s
    const ride = new Ride(bend(30), 0)
    const state = run(ride, { power: 400, speed: null, cadence: 90, heartRate: null }, 60)
    expect(state.speed).toBeLessThan(12)
    expect(state.braking).toBe(true)
  })
})

describe('the end of the route', () => {
  it('is the end: s stops there and the ride reports it', () => {
    Config.deviceType = 'bike'
    const route = straight(0, 500)
    const ride = new Ride(route, 400)
    const state = run(ride, { power: 300, speed: null, cadence: 90, heartRate: null }, 120)
    expect(state.finished).toBe(true)
    expect(state.s).toBe(route.length)
  })
})
