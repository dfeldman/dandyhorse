import { describe, expect, test } from 'vitest'
import { defaultDebug, defaultDeviceType, isRealMachine } from '../launch'
import type { DeviceType } from '../types'

const none = { connected: [], owned: [], saved: [] }
const both: DeviceType[] = ['bike', 'treadmill']

describe('defaultDebug', () => {
  const sim = { type: 'bike', address: 'sim:bike', protocol: 'sim' }
  const kickr = { type: 'bike', address: 'AA:BB:CC:DD:EE:FF', protocol: 'ftms' }
  const strap = { type: 'hrm', address: '11:22:33:44:55:66', protocol: 'hrs' }
  test('the simulators and a heart-rate strap are not a machine', () => {
    expect(isRealMachine(sim)).toBe(false)
    expect(isRealMachine({ ...sim, protocol: null })).toBe(false)
    expect(isRealMachine(strap)).toBe(false)
    expect(isRealMachine(kickr)).toBe(true)
  })
  test('on until a real machine is saved, so real rides count', () => {
    expect(defaultDebug([])).toBe(true)
    expect(defaultDebug([sim, strap])).toBe(true)
    expect(defaultDebug([sim, kickr])).toBe(false)
  })
})

describe('defaultDeviceType', () => {
  test('nothing known: the variant first', () => {
    expect(defaultDeviceType(both, none)).toBe('bike')
    expect(defaultDeviceType([], none)).toBe('treadmill')
  })
  test('the one machine the user owns wins, even over one connected right now', () => {
    expect(defaultDeviceType(both, { connected: ['treadmill'], owned: ['bike'], saved: [{ type: 'treadmill', lastSeenAt: '2026-09-13T10:00:00Z' }] })).toBe('bike')
  })
  test('with nothing ticked under "I own", one kind of saved machine counts as owned', () => {
    expect(defaultDeviceType(both, { connected: ['bike'], owned: [], saved: [{ type: 'treadmill', lastSeenAt: null }, { type: 'hrm', lastSeenAt: null }] })).toBe('treadmill')
  })
  test('owning both kinds, or none: a machine connected right now wins', () => {
    expect(defaultDeviceType(both, { connected: ['treadmill'], owned: ['bike', 'treadmill'], saved: [] })).toBe('treadmill')
    expect(defaultDeviceType(both, { ...none, connected: ['treadmill'] })).toBe('treadmill')
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
