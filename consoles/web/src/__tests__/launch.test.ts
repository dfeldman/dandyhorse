import { describe, expect, test } from 'vitest'
import { defaultDeviceType } from '../launch'
import type { DeviceType } from '../types'

const none = { connected: [], owned: [], saved: [] }
const both: DeviceType[] = ['bike', 'treadmill']

describe('defaultDeviceType', () => {
  test('nothing known: the variant first', () => {
    expect(defaultDeviceType(both, none)).toBe('bike')
    expect(defaultDeviceType([], none)).toBe('treadmill')
  })
  test('a machine connected right now wins over owned and saved', () => {
    expect(defaultDeviceType(both, { connected: ['treadmill'], owned: ['bike'], saved: [{ type: 'bike', lastSeenAt: '2026-09-13T10:00:00Z' }] })).toBe('treadmill')
  })
  test('a connected machine the variant cannot use is skipped', () => {
    expect(defaultDeviceType(['treadmill'], { ...none, connected: ['bike'] })).toBe('treadmill')
    expect(defaultDeviceType(both, { ...none, connected: ['hrm'], owned: ['treadmill'] })).toBe('treadmill')
  })
  test('then the first owned type the variant supports, in the user order', () => {
    expect(defaultDeviceType(both, { ...none, owned: ['treadmill', 'bike'] })).toBe('treadmill')
    expect(defaultDeviceType(['bike'], { ...none, owned: ['treadmill', 'bike'] })).toBe('bike')
  })
  test('then the most recently seen saved device the variant supports', () => {
    const saved = [
      { type: 'bike', lastSeenAt: '2026-09-11T10:00:00Z' },
      { type: 'hrm', lastSeenAt: '2026-09-13T10:00:00Z' },
      { type: 'treadmill', lastSeenAt: '2026-09-12T10:00:00Z' },
    ]
    expect(defaultDeviceType(both, { ...none, saved })).toBe('treadmill')
    expect(defaultDeviceType(both, { ...none, saved: [{ type: 'treadmill', lastSeenAt: null }, { type: 'bike', lastSeenAt: '2026-09-01T00:00:00Z' }] })).toBe('bike')
    expect(defaultDeviceType(['treadmill', 'bike'], { ...none, saved: [{ type: 'hrm', lastSeenAt: '2026-09-13T10:00:00Z' }] })).toBe('treadmill')
  })
})
