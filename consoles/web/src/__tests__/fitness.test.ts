import { describe, expect, test } from 'vitest'
import { FITNESS_LEVELS, globalSteadyWatts, levelHint, numberOrNull, paceFromForm, paceOf, paceText, steadyHeartRate, steadyText } from '../fitness'
import type { GlobalPreferences } from '../types'

const prefs = (o: Record<string, unknown>) => o as GlobalPreferences

describe('steadyText (what the game will use)', () => {
  test('nothing set: Regular, the default', () => {
    expect(steadyText({}, 'metric')).toBe('130 W (Regular, the default: pick yours)')
  })
  test('from FTP when only FTP is set', () => {
    expect(steadyText({ ftp: 250 }, 'metric')).toBe('0.65 × your FTP = 163 W')
    expect(globalSteadyWatts({ ftp: 250 })).toEqual({ watts: 162.5, source: 'ftp' })
  })
  test('steadyWatts wins over FTP; a level is named', () => {
    expect(steadyText({ steadyWatts: 145, ftp: 250 }, 'metric')).toBe('145 W')
    expect(steadyText({ steadyWatts: 160 }, 'metric')).toBe('160 W (Fit)')
  })
  test('blank, zero and junk values are skipped, as the game skips them', () => {
    expect(steadyText(prefs({ steadyWatts: '', ftp: 0 }), 'metric')).toBe('130 W (Regular, the default: pick yours)')
    expect(steadyText(prefs({ steadyWatts: -5, ftp: 200 }), 'metric')).toBe('0.65 × your FTP = 130 W')
  })
  test('a treadmill pace is shown as a pace, in the player units', () => {
    const steadyPace = { speed: 6 / 3.6, incline: 3 }
    expect(steadyText({ steadyWatts: 145, steadyPace }, 'metric')).toBe('145 W; on a treadmill, 6.0 km/h at 3%')
    expect(steadyText({ steadyPace }, 'us')).toBe('130 W (Regular, the default: pick yours); on a treadmill, 3.7 mph at 3%')
    expect(steadyText({ steadyPace: { speed: 0, incline: 3 } }, 'metric')).toBe('130 W (Regular, the default: pick yours)')
  })
})

describe('levels', () => {
  test('the four levels', () => expect(FITNESS_LEVELS.map((l) => l.watts)).toEqual([100, 130, 160, 200]))
  test('treadmill equivalents in the player units', () => {
    expect(FITNESS_LEVELS.map((l) => levelHint(l, 'metric'))).toEqual(['a 5 km/h walk up 5%', 'a 6 km/h walk up 6%', 'jogging at 8 km/h', 'running at 10 km/h'])
    expect(FITNESS_LEVELS.map((l) => levelHint(l, 'us'))).toEqual(['a 3.1 mph walk up 5%', 'a 3.7 mph walk up 6%', 'jogging at 5 mph', 'running at 6.2 mph'])
  })
})

describe('pace', () => {
  test('from the form: speed in the player units to m/s, a blank incline is 0', () => {
    const p = paceFromForm(6, 3, 'metric')!
    expect(p.speed).toBeCloseTo(1.6667, 4)
    expect(p.incline).toBe(3)
    expect(paceFromForm(3.7, '', 'us')!.speed).toBeCloseTo(1.654, 3)
    expect(paceFromForm(3.7, '', 'us')!.incline).toBe(0)
  })
  test('a blank or zero speed is no pace', () => {
    expect(paceFromForm('', 3, 'metric')).toBeNull()
    expect(paceFromForm(0, 3, 'metric')).toBeNull()
    expect(paceFromForm(null, null, 'metric')).toBeNull()
  })
  test('stored paces read as the game reads them', () => {
    expect(paceOf({ speed: 2, incline: -2 })).toEqual({ speed: 2, incline: 0 })
    expect(paceOf({ speed: 2 })).toEqual({ speed: 2, incline: 0 })
    expect(paceOf({ speed: 0 })).toBeNull()
    expect(paceOf(null)).toBeNull()
    expect(paceText({ speed: 2.5, incline: 2.5 }, 'metric')).toBe('9.0 km/h at 2.5%')
  })
  test('numberOrNull: a cleared number input gives an empty string', () => {
    expect(numberOrNull('')).toBeNull()
    expect(numberOrNull(NaN)).toBeNull()
    expect(numberOrNull(0)).toBe(0)
  })
})

describe('steadyHeartRate (the steady HR placeholder)', () => {
  test('as the game works it out: set, zones, max, age, default', () => {
    expect(steadyHeartRate({ maxHr: 180 })).toMatchObject({ resting: 60, steady: 132, source: 'max' })
    expect(steadyHeartRate({ restingHr: 50, steadyHr: 140 })).toMatchObject({ resting: 50, steady: 140, source: 'set' })
    expect(steadyHeartRate({ hrZones: [120, 138, 155] }).steady).toBe(138)
    expect(steadyHeartRate({ hrZones: [{ max: 120 }, { max: 141 }] }).steady).toBe(141)
    expect(steadyHeartRate({}, 40)).toMatchObject({ steady: 132, source: 'age' })
    expect(steadyHeartRate({})).toMatchObject({ steady: 132, source: 'default' })
  })
  test('resting outside 30–110 is 60; a steady HR too close to resting is worked out instead', () => {
    expect(steadyHeartRate({ restingHr: 20, maxHr: 180 }).resting).toBe(60)
    expect(steadyHeartRate({ restingHr: 50, maxHr: 190 }).steady).toBe(134)
    expect(steadyHeartRate({ restingHr: 60, steadyHr: 63, maxHr: 180 })).toMatchObject({ steady: 132, source: 'max' })
  })
})
