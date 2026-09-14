import { describe, expect, test } from 'vitest'
import * as u from '../units'

describe('units', () => {
  test('speed and distance in both systems', () => {
    expect(u.speed(2.5, 'metric').text).toBe('9.0 km/h')
    expect(u.speed(2.5, 'us').text).toBe('5.6 mph')
    expect(u.distance(1609.344, 'us').text).toBe('1.00 mi')
    expect(u.distance(1500, 'metric', 1).text).toBe('1.5 km')
    expect(u.length(10, 'us').text).toBe('33 ft')
  })
  test('null is a dash, never 0', () => {
    expect(u.speed(null, 'metric')).toEqual({ value: null, unit: 'km/h', text: '—' })
    expect(u.energy(null).text).toBe('—')
  })
  test('pace and clock', () => {
    expect(u.pace(1000 / 330, 'metric').text).toBe('5:30 /km')
    expect(u.pace(0, 'metric').text).toBe('—')
    expect(u.clock(3661)).toBe('1:01:01')
    expect(u.clock(-5)).toBe('-0:05')
  })
  test('round trips', () => {
    expect(u.speedToSI(u.speed(3, 'us').value!, 'us')).toBeCloseTo(3, 1)
    expect(u.energy(4184).text).toBe('1 kcal')
  })
})
