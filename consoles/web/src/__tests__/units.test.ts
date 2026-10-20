import { describe, expect, test } from 'vitest'
import * as u from '../units'

describe('distance', () => {
  test('metric km', () => {
    expect(u.distance(1500, 'metric').value).toBe(1.5)
    expect(u.distance(1500, 'metric').unit).toBe('km')
  })
  test('us miles', () => {
    expect(u.distance(1609.344, 'us').value).toBe(1)
    expect(u.distance(1609.344, 'us').unit).toBe('mi')
  })
  test('null', () => {
    expect(u.distance(null, 'metric').text).toBe('—')
    expect(u.distance(null, 'metric').value).toBeNull()
  })
})

describe('speed', () => {
  test('m/s to km/h', () => expect(u.speed(10, 'metric').value).toBe(36))
  test('m/s to mph', () => expect(u.speed(10, 'us').value).toBe(22.4))
  test('round trip', () => {
    expect(u.speedToSI(36, 'metric')).toBeCloseTo(10, 9)
    expect(u.speedToSI(u.speed(4.5, 'us', 6).value, 'us')).toBeCloseTo(4.5, 4)
    expect(u.speedToSI(null, 'us')).toBeNull()
  })
})

describe('mass and height', () => {
  test('kg to lb', () => expect(u.mass(70, 'us').value).toBe(154.3))
  test('kg metric unchanged', () => expect(u.mass(70, 'metric').value).toBe(70))
  test('lb to kg', () => expect(u.massToSI(154.32, 'us')).toBeCloseTo(70, 2))
  test('height cm/in', () => {
    expect(u.height(1.8, 'metric').value).toBe(180)
    expect(u.height(1.8, 'us').value).toBe(71)
    expect(u.heightToSI(180, 'metric')).toBeCloseTo(1.8, 9)
    expect(u.heightToSI(71, 'us')).toBeCloseTo(1.8034, 3)
  })
})

describe('length and energy', () => {
  test('m to ft', () => expect(u.length(100, 'us').value).toBe(328))
  test('m metric', () => expect(u.length(100, 'metric').value).toBe(100))
  test('lengthToSI', () => expect(u.lengthToSI(328.084, 'us')).toBeCloseTo(100, 3))
  test('joules to kcal in both systems', () => {
    expect(u.energy(41840, 'metric').value).toBe(10)
    expect(u.energy(41840, 'us').value).toBe(10)
    expect(u.energy(41840).unit).toBe('kcal')
  })
  test('accel', () => {
    expect(u.accel(0.5, 'metric').value).toBe(1.8)
    expect(u.accel(0.5, 'us').value).toBe(1.12)
  })
})

describe('duration', () => {
  test('mm:ss', () => expect(u.duration(754)).toBe('12:34'))
  test('h:mm:ss', () => expect(u.duration(3661)).toBe('1:01:01'))
  test('zero and null', () => {
    expect(u.duration(0)).toBe('00:00')
    expect(u.duration(null)).toBe('—')
  })
  test('rounds fractional seconds', () => expect(u.duration(13.34)).toBe('00:13'))
})

describe('dateTime', () => {
  test('formats in the given zone', () => {
    const s = u.dateTime('2026-09-11T04:00:47.716Z', 'UTC', { timeStyle: 'short', dateStyle: undefined, hour12: false })
    expect(s).toMatch(/04:00/)
  })
  test('invalid time zone falls back instead of throwing', () => {
    expect(() => u.dateTime('2026-09-11T04:00:47.716Z', 'Not/AZone')).not.toThrow()
  })
  test('epoch seconds and null', () => {
    expect(u.dateTime(1789099269, 'UTC')).not.toBe('—')
    expect(u.dateTime(null, 'UTC')).toBe('—')
  })
})

describe('ago', () => {
  const now = Date.UTC(2026, 8, 11, 4, 0, 0)
  test('seconds', () => expect(u.ago(now / 1000 - 5, now)).toBe('5 s ago'))
  test('minutes from iso', () => expect(u.ago('2026-09-11T03:50:00Z', now)).toBe('10 min ago'))
  test('null', () => expect(u.ago(null, now)).toBe('—'))
})

describe('dateTime', () => {
  test('a caller that names the parts gets only those (Intl refuses them beside dateStyle)', () => {
    const d = '2026-10-03T07:30:00Z'
    // (the order is the runner's own locale; what matters is that it formats at all, and has no time in it)
    const named = u.dateTime(d, 'UTC', { day: 'numeric', month: 'short', year: 'numeric' })
    expect(named).toMatch(/3/)
    expect(named).toMatch(/2026/)
    expect(named).not.toMatch(/:/)
    // the default is still a date and a time
    expect(u.dateTime(d, 'UTC')).toMatch(/2026/)
    expect(u.dateTime(null, 'UTC')).toBe('—')
    expect(u.dateTime('not a date', 'UTC')).toBe('—')
    // an unknown zone falls back to local rather than throwing
    expect(u.dateTime(d, 'Mars/Olympus', { year: 'numeric' })).toBe('2026')
  })
})

describe('boardValue', () => {
  test('per metric', () => {
    expect(u.boardValue('distance', 1000, 'metric')).toBe('1 km')
    expect(u.boardValue('distance', 640, 'metric')).toBe('640 m')
    expect(u.boardValue('energy', 4184, 'metric')).toBe('1 kcal')
    expect(u.boardValue('duration', 90, 'metric')).toBe('01:30')
    expect(u.boardValue('power', 185.4, 'metric')).toBe('185 W')
    expect(u.boardValue('elevation', 1234, 'metric')).toBe('1,234 m')
    expect(u.boardValue('count', 12, 'metric')).toBe('12')
    expect(u.boardValue('weeks', 1, 'metric')).toBe('1 week')
    expect(u.boardValue('weeks', 6, 'metric')).toBe('6 weeks')
    expect(u.boardValue('number', 120.44, 'metric')).toBe('120.4')
    expect(u.boardValue('number', null, 'metric')).toBe('—')
  })
})

describe('unitLabel', () => {
  test('labels', () => {
    expect(u.unitLabel('speed', 'metric')).toBe('km/h')
    expect(u.unitLabel('speed', 'us')).toBe('mph')
    expect(u.unitLabel('mass', 'us')).toBe('lb')
  })
})

describe('ago (history subtitles)', () => {
  const now = Date.UTC(2026, 8, 11, 4, 0, 0)
  test('hours and days', () => {
    expect(u.ago(now / 1000 - 3 * 3600, now)).toBe('3 h ago')
    expect(u.ago(now / 1000 - 47 * 3600, now)).toBe('47 h ago')
    expect(u.ago(now / 1000 - 3 * 86400, now)).toBe('3 d ago')
  })
  test('future timestamps clamp to now', () => expect(u.ago(now / 1000 + 60, now)).toBe('0 s ago'))
  test('invalid strings', () => expect(u.ago('nope', now)).toBe('—'))
})
