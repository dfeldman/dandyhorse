import { describe, expect, it } from 'vitest'
import type { GameState } from '@dandyhorse/gamekit'
import { activeSeconds, guardTreadmill, measured, prefsWithDefaults, targets } from './drive.ts'

const metric = (actual: number | null) => ({ requested: null, commanded: null, actual })
function state(over: Partial<GameState> = {}): GameState {
  return {
    sessionId: 's', sessionStatus: 'active', endReason: null, seq: 1, serverTime: 0, elapsed: 100, requestedDuration: 1800,
    pause: null, pausedSeconds: 10, activeSeconds: 90, position: null, distance: null, energy: null, work: null, input: null,
    requestedInput: null, bridges: [], owner: { fitness: null, hrm: null }, devicePreferences: {}, custom: null,
    speed: metric(2.5), incline: metric(3), cadence: metric(null), power: metric(180), grade: metric(4), wind: metric(null),
    crr: metric(null), cw: metric(null), heartRate: metric(140),
    ...over,
  }
}

describe('targets', () => {
  it('treadmill asks for incline and never for speed', () => {
    const t = targets('treadmill', 4.5, 7)
    expect(t).toEqual({ incline: 4.5 })
    expect('speed' in t).toBe(false)
  })
  it('bike asks for grade and reports the virtual speed', () => {
    expect(targets('bike', -2, 8.2)).toEqual({ grade: -2, speed: 8.2 })
    expect(targets('bike', Number.NaN, -1)).toEqual({ grade: 0, speed: 0 })
  })
  it('guardTreadmill strips a speed that slipped in', () => {
    expect(guardTreadmill('treadmill', { incline: 1, speed: 3, x: 1 })).toEqual({ incline: 1, x: 1 })
    expect(guardTreadmill('bike', { grade: 1, speed: 3 })).toEqual({ grade: 1, speed: 3 })
  })
})

describe('measured', () => {
  it('reads actual values and keeps null as null', () => {
    expect(measured(null, 'bike')).toEqual({ power: null, speed: null, heartRate: null, machineGrade: null })
    expect(measured(state(), 'bike')).toEqual({ power: 180, speed: 2.5, heartRate: 140, machineGrade: 4 })
    expect(measured(state(), 'treadmill').machineGrade).toBe(3)
    expect(measured(state({ power: metric(null) }), 'bike').power).toBeNull()
  })
})

describe('activeSeconds', () => {
  it('interpolates while active and freezes while paused', () => {
    expect(activeSeconds(state(), 1000, 3500)).toBeCloseTo(92.5)
    expect(activeSeconds(state({ sessionStatus: 'paused' }), 1000, 3500)).toBe(90)
    expect(activeSeconds(state({ activeSeconds: undefined }), 1000, 1000)).toBe(90)
    expect(activeSeconds(null, 0, 0)).toBe(0)
  })
})

describe('prefsWithDefaults', () => {
  it('applies the schema defaults and rejects junk', () => {
    expect(prefsWithDefaults(null, null)).toEqual({ route: 'rolling', timeOfDay: 'day', shadows: true })
    expect(prefsWithDefaults({ route: 'hilly', timeOfDay: 'night' }, { shadows: false })).toEqual({ route: 'hilly', timeOfDay: 'night', shadows: false })
    expect(prefsWithDefaults({ route: 'moon' }, { shadows: 'yes', route: 'hilly' })).toEqual({ route: 'rolling', timeOfDay: 'day', shadows: true })
  })
})
