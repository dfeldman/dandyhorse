import { describe, expect, test } from 'vitest'
import { gradeFromResistance, pedalFromEffort } from './drive.ts'
import { CHOSEN, CHAINS, FLIGHTS, RIDERS, evaluate, learn } from '../tools/playability.ts'

describe('pedal', () => {
  test('steady power holds level flight; nothing is 0; twice steady is full', () => {
    expect(pedalFromEffort(1)).toBe(50)
    expect(pedalFromEffort(0)).toBe(0)
    expect(pedalFromEffort(1.3)).toBeCloseTo(65)
    expect(pedalFromEffort(2)).toBe(100)
    expect(pedalFromEffort(3)).toBe(100)
  })
})

describe('grade', () => {
  test('a gentle grade while cruising, less with each Tailwind, flat on the runway', () => {
    expect(gradeFromResistance(45)).toBe(1)
    expect(gradeFromResistance(45 * 0.9)).toBe(0.8)
    expect(gradeFromResistance(45 * 0.81)).toBe(0.6)
    expect(gradeFromResistance(25)).toBe(0)
    expect(gradeFromResistance(0)).toBe(0)
    expect(gradeFromResistance(100)).toBe(3.8)
  })
})

describe('playability (PLAYABILITY.md)', () => {
  test('a first ride through the lag hits most rings on the course as built', () => {
    const first = RIDERS.first
    const gains = learn(CHAINS.quick, first, FLIGHTS.pitch, CHOSEN)
    expect(evaluate(CHAINS.quick, first, FLIGHTS.pitch, CHOSEN, gains).hit).toBeGreaterThan(0.95)
    // following the arrows, judged 3 s ahead, with the boosts at their cap
    const arrows = { kp: 0, kd: 0, cue: { lead: 3, push: 0.3, deadband: CHOSEN.tolerance / 2 } }
    expect(evaluate(CHAINS.quick, first, FLIGHTS.pitch, { ...CHOSEN, speedMult: 1.25 }, arrows).hit).toBeGreaterThan(0.88)
  })
})
