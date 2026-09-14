import { describe, expect, test } from 'vitest'
import {
  EffortMeter, describeEffort, describeSteady, heartRateEffort, steadyHeartRate, steadyWatts, treadmillWatts,
} from '../effort'
import type { GameState, Json } from '../types'

const kmh = (x: number) => x / 3.6
const metric = (actual: number | null = null, commanded: number | null = null) => ({ requested: null, commanded, actual })

function state(o: { speed?: number; incline?: [number | null, number | null]; power?: number; heartRate?: number; devicePreferences?: Json }): GameState {
  return {
    speed: metric(o.speed ?? null), incline: metric(...(o.incline ?? [null, null])), cadence: metric(), power: metric(o.power ?? null),
    grade: metric(), wind: metric(), crr: metric(), cw: metric(), heartRate: metric(o.heartRate ?? null),
    devicePreferences: o.devicePreferences ?? {},
  } as unknown as GameState
}

describe('treadmillWatts', () => {
  test('matches the table in games/kingdomtrek/INTEGRATION.md §3.3 (75 kg)', () => {
    const table: [number, number, number][] = [[5, 0, 52], [5, 5, 99], [5, 10, 146], [6, 3, 101], [8, 0, 167], [10, 0, 208], [10, 3, 236], [0, 0, 0]]
    for (const [speed, incline, watts] of table) expect(Math.round(treadmillWatts(kmh(speed), incline, 75)!)).toBe(watts)
  })

  test('rises with speed and incline and never jumps across the walk/run blend; a decline counts as flat', () => {
    let prev = 0
    for (let v = 0; v <= 4; v += 0.01) {
      const w = treadmillWatts(v, 3, 75)!
      expect(w).toBeGreaterThanOrEqual(prev)
      expect(w - prev).toBeLessThan(3)
      prev = w
    }
    prev = 0
    for (let i = 0; i <= 15; i += 0.5) {
      const w = treadmillWatts(1.4, i, 75)!
      expect(w).toBeGreaterThan(prev - 1e-9)
      prev = w
    }
    expect(treadmillWatts(1.4, -3, 75)).toBe(treadmillWatts(1.4, 0, 75))
    expect(treadmillWatts(null, 3, 75)).toBeNull()
    expect(treadmillWatts(1.4, null, null)).toBeCloseTo(75 * 1.4 * 0.5)
    expect(treadmillWatts(1.4, 0, 100)! / treadmillWatts(1.4, 0, 75)!).toBeCloseTo(100 / 75)
  })
})

describe('smoothing', () => {
  test('a game can turn power smoothing off for the least lag', () => {
    const preferences = { global: { steadyWatts: 100 } }
    const smooth = new EffortMeter({ deviceType: 'bike', preferences })
    const raw = new EffortMeter({ deviceType: 'bike', preferences, smoothing: { power: 0 } })
    for (const m of [smooth, raw]) {
      m.update(state({ power: 100 }), 0)
      m.update(state({ power: 200 }), 1)
    }
    expect(raw.value(1)).toBeCloseTo(2)
    expect(smooth.value(1)).toBeGreaterThan(1.2) // 3 s: a second in, it has gone 28% of the way
    expect(smooth.value(1)).toBeLessThan(1.35)
  })
})

describe('steady pace', () => {
  test('the most specific preference wins', () => {
    const pace = { speed: kmh(6), incline: 3 }
    expect(steadyWatts({ device: { steadyPace: pace, steadyWatts: 150 }, global: { steadyWatts: 120 } }, 'treadmill', 75)).toMatchObject({ source: 'device pace', pace })
    expect(steadyWatts({ device: { steadyPace: pace, steadyWatts: 150 } }, 'bike', 75)).toMatchObject({ watts: 150, source: 'device' })
    expect(steadyWatts({ global: { steadyPace: pace, steadyWatts: 120 } }, 'treadmill', 75).source).toBe('pace')
    expect(steadyWatts({ global: { steadyPace: pace, steadyWatts: 120 } }, 'bike', 75)).toMatchObject({ watts: 120, source: 'watts' })
    expect(steadyWatts({ global: { ftp: 250 } }, 'bike')).toMatchObject({ watts: 162.5, source: 'ftp' })
    expect(steadyWatts({}, 'bike')).toMatchObject({ watts: 130, source: 'default' })
    expect(steadyWatts({ global: { steadyWatts: 'lots', ftp: -1, steadyPace: { speed: 0 } } }, 'treadmill').source).toBe('default')
  })

  test('a treadmill pace makes the weight cancel out', () => {
    const pace = { speed: kmh(6), incline: 3 }
    for (const kg of [55, 75, 110]) {
      const m = new EffortMeter({ deviceType: 'treadmill', weightKg: kg, preferences: { global: { steadyPace: pace } } })
      m.read({ speed: pace.speed, incline: pace.incline }, 0)
      expect(m.value(0)).toBeCloseTo(1)
    }
  })

  test('heart rate: steady from the preferences, and the reserve', () => {
    expect(steadyHeartRate({ maxHr: 180 })).toMatchObject({ resting: 60, steady: 132, source: 'max' })
    expect(steadyHeartRate({ restingHr: 50, steadyHr: 140 })).toMatchObject({ resting: 50, steady: 140, source: 'set' })
    expect(steadyHeartRate({ hrZones: [120, 138, 155] }).steady).toBe(138)
    expect(steadyHeartRate({ hrZones: [{ max: 120 }, { max: 141 }] }).steady).toBe(141)
    expect(steadyHeartRate({}, { age: 40 })).toMatchObject({ steady: 132, source: 'age' })
    expect(steadyHeartRate({})).toMatchObject({ steady: 132, source: 'default' })
    const h = steadyHeartRate({ maxHr: 180 })
    expect(heartRateEffort(60, h)).toBe(0)
    expect(heartRateEffort(50, h)).toBe(0)
    expect(heartRateEffort(132, h)).toBeCloseTo(1)
    expect(heartRateEffort(null, h)).toBeNull()
  })
})

describe('EffortMeter', () => {
  const bike = () => new EffortMeter({ deviceType: 'bike', preferences: { global: { steadyWatts: 130, maxHr: 180 } } })

  test('power over steady, held between readings, 0 after 3 s without data', () => {
    const m = bike()
    m.read({ power: 130 }, 0)
    expect(m.value(0)).toBeCloseTo(1)
    expect(m.value(2.9)).toBeCloseTo(1)
    m.read({ power: null }, 1)
    m.read({ power: null }, 2)
    expect(m.value(2.5)).toBeCloseTo(1)
    expect(m.value(3.1)).toBe(0)
    m.read({ power: null }, 3.5)
    expect(m.value(3.5)).toBe(0)
    expect(m.readout(3.5)).toMatchObject({ source: 'none', note: 'No power reading' })
  })

  test('smoothed over about 3 s, and capped at 3×', () => {
    const m = bike()
    m.read({ power: 130 }, 0)
    m.read({ power: 260 }, 1)
    expect(m.value(1)).toBeGreaterThan(1.2)
    expect(m.value(1)).toBeLessThan(1.5)
    for (let t = 2; t <= 15; t++) m.read({ power: 260 }, t)
    expect(m.value(15)).toBeCloseTo(2, 1)
    for (let t = 16; t <= 40; t++) m.read({ power: 1000 }, t)
    expect(m.value(40)).toBe(3)
  })

  test('any machine but a treadmill counts by measured power (a rower, one day)', () => {
    const m = new EffortMeter({ deviceType: 'rower' as never, preferences: { global: { steadyWatts: 130 } } })
    m.read({ power: 130, cadence: 24 }, 0)
    expect(m.readout(0)).toMatchObject({ source: 'power', note: null })
    expect(m.value(0)).toBeCloseTo(1)
  })

  test('falls back to heart rate, then cadence, and says so', () => {
    const m = bike()
    m.read({ heartRate: 132, cadence: 80 }, 0)
    expect(m.readout(0)).toMatchObject({ source: 'heartRate', note: 'No power reading: using heart rate' })
    expect(m.value(0)).toBeCloseTo(1)
    const c = new EffortMeter({ deviceType: 'bike' })
    c.read({ cadence: 160 }, 0)
    expect(c.readout(0)).toMatchObject({ source: 'cadence', effort: 1.5 })
    expect(c.readout(0).note).toContain('cadence')
    const hr = new EffortMeter({ deviceType: 'treadmill', prefer: 'heartRate' })
    hr.read({ speed: kmh(5) }, 0)
    expect(hr.readout(0)).toMatchObject({ source: 'treadmill', note: 'No heart rate reading: using the machine' })
  })

  test('heart rate earns nothing once the machine says you stopped; alone, it decides', () => {
    const m = new EffortMeter({ deviceType: 'bike', prefer: 'heartRate', preferences: { global: { maxHr: 180 } } })
    m.read({ heartRate: 150, power: 120, cadence: 85 }, 0)
    expect(m.value(0)).toBeCloseTo(1.25)
    m.read({ heartRate: 150, power: 0, cadence: 0 }, 1)
    expect(m.value(1)).toBe(0)
    expect(m.readout(1).moving).toBe(false)
    const t = new EffortMeter({ deviceType: 'treadmill', prefer: 'heartRate' })
    t.read({ heartRate: 150, speed: 0 }, 0)
    expect(t.value(0)).toBe(0)
    const alone = new EffortMeter({ deviceType: 'treadmill', prefer: 'heartRate' })
    alone.read({ heartRate: 150 }, 0)
    expect(alone.value(0)).toBeCloseTo(1.25)
  })

  test('treadmill from getstate: incline falls back to the commanded value; device preferences follow the machine', () => {
    const m = new EffortMeter({ deviceType: 'treadmill', weightKg: 75, preferences: { global: { steadyWatts: 99 } } })
    m.update(state({ speed: kmh(5), incline: [null, 5] }), 0)
    expect(m.value(0)).toBeCloseTo(98.96 / 99, 2)
    m.update(state({ speed: kmh(5), incline: [null, 5], devicePreferences: { steadyWatts: 198 } }), 1)
    expect(m.steady).toMatchObject({ watts: 198, source: 'device' })
  })

  test('words for a HUD', () => {
    const m = bike()
    m.read({ power: 140 }, 0)
    expect(describeEffort(m.readout(0), 'metric')).toBe('140 W · 108%')
    expect(describeSteady(m.readout(0), 'metric')).toBe('130 W')
    const t = new EffortMeter({ deviceType: 'treadmill', weightKg: 75, preferences: { global: { steadyPace: { speed: kmh(6), incline: 3 } } } })
    t.read({ speed: kmh(6), incline: 3 }, 0)
    expect(describeEffort(t.readout(0), 'metric')).toBe('6.0 km/h · 3% · 100%')
    expect(describeSteady(t.readout(0), 'us')).toBe('3.7 mph · 3%')
    const h = new EffortMeter({ deviceType: 'bike', prefer: 'heartRate', preferences: { global: { maxHr: 180 } } })
    h.read({ heartRate: 132 }, 0)
    expect(`${describeEffort(h.readout(0), 'metric')} / ${describeSteady(h.readout(0), 'metric')}`).toBe('132 bpm · 100% / 132 bpm')
    expect(describeEffort(new EffortMeter({ deviceType: 'bike' }).readout(0), 'metric')).toBe('—')
  })
})
