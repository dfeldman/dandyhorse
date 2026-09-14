import { describe, expect, test } from 'vitest'
import { connection, deviceTypeName, freshBridges, hueIndex, initialOf, standing } from '../status'
import type { Bridge, BridgeDevice } from '../types'

const dev = (o: Partial<BridgeDevice>): BridgeDevice => ({ role: 'fitness', type: 'treadmill', name: 'T', address: 'aa', status: 'connected', ...o })
const bridge = (o: Partial<Bridge>): Bridge => ({ bridgeId: 'b1', label: 'Phone', lastSeen: 1, devices: [], ...o })

describe('connection', () => {
  test('no bridges', () => {
    expect(connection([])).toMatchObject({ connected: false, label: 'Devices', hrm: false })
  })
  test('connected treadmill', () => {
    const c = connection([bridge({ devices: [dev({})] })])
    expect(c.connected).toBe(true)
    expect(c.label).toBe('Connected treadmill')
  })
  test('bike trainer wording, simulated and readonly count', () => {
    expect(connection([bridge({ devices: [dev({ type: 'bike', status: 'simulated' })] })]).label).toBe('Connected bike trainer')
    expect(connection([bridge({ devices: [dev({ status: 'readonly' })] })]).connected).toBe(true)
  })
  test('disconnected or connecting devices do not count', () => {
    expect(connection([bridge({ devices: [dev({ status: 'disconnected' })] })]).connected).toBe(false)
    expect(connection([bridge({ devices: [dev({ status: 'connecting' })] })]).connected).toBe(false)
  })
  test('stale bridges are ignored', () => {
    expect(connection([bridge({ fresh: false, devices: [dev({})] })]).connected).toBe(false)
    expect(freshBridges([bridge({ fresh: false }), bridge({ bridgeId: 'b2' })]).map((b) => b.bridgeId)).toEqual(['b2'])
  })
  test('heart rate monitor flag is independent', () => {
    const c = connection([bridge({ devices: [dev({ role: 'hrm', type: 'hrm' })] })])
    expect(c.connected).toBe(false)
    expect(c.hrm).toBe(true)
  })
  test('the owner bridge wins over a standby with a different device', () => {
    const c = connection([
      bridge({ bridgeId: 's', roles: { fitness: 'standby', hrm: null }, devices: [dev({ type: 'bike' })] }),
      bridge({ bridgeId: 'o', roles: { fitness: 'owner', hrm: null }, devices: [dev({ type: 'treadmill' })] }),
    ])
    expect(c.label).toBe('Connected treadmill')
  })
})

describe('words', () => {
  test('deviceTypeName', () => {
    expect(deviceTypeName('bike')).toBe('bike trainer')
    expect(deviceTypeName('hrm')).toBe('heart rate monitor')
    expect(deviceTypeName(null)).toBe('device')
  })
  test('standing', () => {
    expect(standing(bridge({ roles: { fitness: 'owner', hrm: null } }))).toBe('in control')
    expect(standing(bridge({ roles: { fitness: 'ignored', hrm: null }, ignoredReasons: { fitness: 'wrong type' } }))).toBe('wrong type')
    expect(standing(bridge({}))).toBe('')
  })
  test('initialOf and hueIndex', () => {
    expect(initialOf('mock game')).toBe('M')
    expect(initialOf('  ')).toBe('?')
    expect(initialOf(null)).toBe('?')
    expect(hueIndex('abc', 4)).toBe(hueIndex('abc', 4))
    expect(hueIndex('abc', 4)).toBeLessThan(4)
    expect(hueIndex('abc', 0)).toBe(0)
  })
})
