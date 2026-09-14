// The bridge's device adapter over devicelib, against devicelib's simulated machines (no hardware, no browser).
import { describe, expect, it } from 'vitest'
import { MockAdapter, MockPeripheral, SimulatedBike, SimulatedTreadmill, UUID } from '@bikebike/devicelib'
import { DevicelibDevice } from '../devices/DevicelibDevice'
import { DEFAULT_LIMITS, emptyCommanded, type Commanded } from '../types'
import { process, speedAllowed } from '../pipeline'

const KMH = 3.6
const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const cmd = (over: Partial<Commanded>): Commanded => ({ ...emptyCommanded(), ...over })
const cp = (p: MockPeripheral) => p.writesTo(UUID.FTMS_CONTROL_POINT)

async function treadmill(horizon: boolean) {
  const sim = new SimulatedTreadmill({ horizonVendorService: horizon })
  const dev = new DevicelibDevice('fitness', { adapter: new MockAdapter([sim.peripheral]) })
  await dev.connectTo(sim.peripheral)
  return { sim, dev }
}

describe('DevicelibDevice: treadmills', () => {
  it('recognises a Horizon 7.0AT, keeps FTMS, and keeps the address its saved preferences use', async () => {
    const { sim, dev } = await treadmill(true)
    expect(dev.info.entryId).toBe('horizon_7_series')
    expect(dev.info.protocolName).toBe('Bluetooth FTMS')
    expect(dev.info.quirkFlags).toContain('speed_sent_in_tenth_kmh')
    expect(dev.address).toBe(`ble:${sim.peripheral.id}`)
    expect(dev.protocol).toBe('ftms')
    expect(dev.type).toBe('treadmill')
    expect(dev.status).toBe('connected')
    expect(dev.ranges().speed!.max * KMH).toBeCloseTo(19.3) // registry limits, not the mph numbers the firmware reports
    expect(cp(sim.peripheral)).toEqual(['00']) // connecting only asks for control; nothing moves until the bridge commands
    await dev.disconnect()
  })

  it('sends Horizon speed targets in tenths of a km/h, including 2 km/h after the pipeline rounds m/s', async () => {
    const { sim, dev } = await treadmill(true)
    await dev.setTargets(cmd({ speed: 1 / KMH }))
    expect(cp(sim.peripheral).at(-1)).toBe('02 0a 00')
    expect(sim.targetSpeedKmh).toBe(1)
    await dev.setTargets(cmd({ speed: 0.5556 })) // what the pipeline makes of 2 km/h
    expect(cp(sim.peripheral).at(-1)).toBe('02 14 00')
    expect(sim.targetSpeedKmh).toBe(2)
    expect(Array.from(dev.speedFrame(1))).toEqual([0x02, 0x0a, 0x00]) // the console previews and sends the same frame
    await dev.disconnect()
  })

  it('sends standard FTMS units to other treadmills, and incline as asked', async () => {
    const { sim, dev } = await treadmill(false)
    expect(dev.info.entryId).toBeNull()
    expect(dev.info.quirkFlags).toEqual([])
    await dev.setTargets(cmd({ speed: 1 / KMH, incline: 2 }))
    expect(cp(sim.peripheral)).toContain('02 64 00')
    expect(cp(sim.peripheral).at(-1)).toBe('03 14 00')
    expect(sim.targetSpeedKmh).toBe(1)
    // unchanged targets are not re-sent
    const n = cp(sim.peripheral).length
    await dev.setTargets(cmd({ speed: 1 / KMH, incline: 2 }))
    expect(cp(sim.peripheral).length).toBe(n)
    await dev.disconnect()
  })

  it('E-STOP takes control, sets target speed 0, then stops', async () => {
    const { sim, dev } = await treadmill(true)
    await dev.setTargets(cmd({ speed: 5 / KMH }))
    expect(sim.running).toBe(true)
    const n = cp(sim.peripheral).length
    await dev.stop()
    expect(cp(sim.peripheral).slice(n)).toEqual(['00', '02 00 00', '00', '08 01'])
    expect(sim.running).toBe(false)
    await dev.disconnect()
  })

  it('a stop on the machine latches: no Start or targets until the user resumes', async () => {
    const { sim, dev } = await treadmill(false)
    await dev.setTargets(cmd({ speed: 5 / KMH, incline: 2 }))
    sim.peripheral.notify(UUID.FTMS_STATUS, Uint8Array.of(0x02, 0x01)) // stopped by the user
    await flush()
    expect(dev.userStopped).toBe(true)
    const n = cp(sim.peripheral).length
    await dev.setTargets(cmd({ speed: 6 / KMH, incline: 3 }))
    expect(cp(sim.peripheral).length).toBe(n)
    dev.resumeAfterUserStop()
    await dev.setTargets(cmd({ speed: 6 / KMH, incline: 3 }))
    expect(cp(sim.peripheral).slice(n)).toContain('02 58 02')
    // the machine's own start button clears the latch too
    sim.peripheral.notify(UUID.FTMS_STATUS, Uint8Array.of(0x03)) // safety key
    await flush()
    expect(dev.userStopped).toBe(true)
    sim.peripheral.notify(UUID.FTMS_STATUS, Uint8Array.of(0x04))
    await flush()
    expect(dev.userStopped).toBe(false)
    await dev.disconnect()
  })

  it('writes nothing unless the bridge commands, even after a reconnect', async () => {
    const { sim, dev } = await treadmill(false)
    await dev.setTargets(cmd({ speed: 5 / KMH }))
    const n = cp(sim.peripheral).length
    sim.peripheral.simulateDisconnect()
    await flush()
    expect(dev.status).toBe('disconnected')
    await waitFor(() => dev.status === 'connected')
    expect(cp(sim.peripheral).slice(n)).toEqual(['00']) // the handshake only; the old speed is not replayed
    await dev.disconnect()
  })

  it('a machine that refuses control is read-only until it grants control', async () => {
    const sim = new SimulatedTreadmill()
    sim.refuse.add(0x00)
    const dev = new DevicelibDevice('fitness', { adapter: new MockAdapter([sim.peripheral]) })
    await dev.connectTo(sim.peripheral)
    expect(dev.info.controlRefused).toBe(true)
    expect(dev.status).toBe('readonly')
    const n = cp(sim.peripheral).length
    await dev.setTargets(cmd({ speed: 5 / KMH }))
    expect(cp(sim.peripheral).length).toBe(n)
    sim.refuse.delete(0x00)
    expect((await dev.rawControl(Uint8Array.of(0x00))).result).toBe('success')
    expect(dev.status).toBe('connected')
    await dev.disconnect()
  })

  it('readings go null after 4 s without data', async () => {
    const { sim, dev } = await treadmill(false)
    sim.speedKmh = 3.6
    sim.step(0)
    await flush()
    expect(dev.actual.speed).toBeCloseTo(1)
    dev.checkQuiet(performance.now() + 2000)
    expect(dev.actual.speed).toBeCloseTo(1)
    dev.checkQuiet(performance.now() + 4500)
    expect(dev.actual.speed).toBeNull()
    await dev.disconnect()
  })
})

describe('DevicelibDevice: bikes and straps', () => {
  it('sends grade as FTMS simulation with the bridge defaults, and power as ERG', async () => {
    const sim = new SimulatedBike()
    const dev = new DevicelibDevice('fitness', { adapter: new MockAdapter([sim.peripheral]) })
    await dev.connectTo(sim.peripheral)
    expect(dev.type).toBe('bike')
    await dev.setTargets(cmd({ grade: 3 }))
    expect(cp(sim.peripheral).at(-1)).toBe('11 00 00 2c 01 28 33') // wind 0, 3 %, crr 0.004, cw 0.51
    await dev.setTargets(cmd({ power: 200 }))
    expect(cp(sim.peripheral).at(-1)).toBe('05 c8 00')
    await dev.disconnect()
  })

  it('reads a heart-rate strap, with 0 bpm as no reading', async () => {
    const strap = new MockPeripheral({
      name: 'HRM-Pro', advertisedServices: [UUID.HEART_RATE],
      services: [{ uuid: UUID.HEART_RATE, characteristics: [{ uuid: UUID.HEART_RATE_MEASUREMENT, properties: { notify: true } }] }],
    })
    const dev = new DevicelibDevice('hrm', { adapter: new MockAdapter([strap]) })
    await dev.connect() // through the adapter's chooser
    expect(dev.status).toBe('connected')
    expect(dev.protocol).toBe('hrs')
    expect(dev.info.protocolName).toBe('Bluetooth Heart Rate')
    strap.notify(UUID.HEART_RATE_MEASUREMENT, Uint8Array.of(0x00, 72))
    await flush()
    expect(dev.actual.heartRate).toBe(72)
    strap.notify(UUID.HEART_RATE_MEASUREMENT, Uint8Array.of(0x00, 0))
    await flush()
    expect(dev.actual.heartRate).toBeNull()
    // a strap gets 5 s of silence (off the chest, out of range) before its reading goes null, not the machines' 4 s
    strap.notify(UUID.HEART_RATE_MEASUREMENT, Uint8Array.of(0x01, 0x8c, 0x00)) // 16-bit form, 140 bpm
    await flush()
    expect(dev.actual.heartRate).toBe(140)
    dev.checkQuiet(performance.now() + 4500)
    expect(dev.actual.heartRate).toBe(140)
    dev.checkQuiet(performance.now() + 5500)
    expect(dev.actual.heartRate).toBeNull()
    await dev.disconnect()
  })
})

describe('Rolling Hills on a Horizon 7.0AT (simulated with the measured firmware)', () => {
  it('incline-only commands write only Request Control and incline; the belt is read, never set or started', async () => {
    const clock = {
      t: Date.now(),
      now() { return this.t },
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      setInterval: (f: () => void, ms: number) => setInterval(f, ms),
      clearInterval: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
    }
    const sim = new SimulatedTreadmill({ horizonVendorService: true, horizonFirmware: true })
    const dev = new DevicelibDevice('fitness', { simulator: sim, clock })
    await dev.connectTo(sim.peripheral)
    expect(dev.status).toBe('simulated')
    expect(dev.info.quirkFlags).toContain('speed_sent_in_tenth_kmh')
    // the bridge pipeline as it runs for a real Horizon (speed control off); Rolling Hills asks for incline only
    const allowSpeed = speedAllowed(dev.protocol, {})
    expect(allowSpeed).toBe(false)
    let prev = emptyCommanded()
    for (const incline of [0, 1, 2.5, 4, 4, 3, 1, 0, 0, 0]) {
      for (let i = 0; i < 4; i++) { // one second of 250 ms control ticks per requested value
        prev = process('treadmill', { incline }, DEFAULT_LIMITS, prev, 0.25, { ranges: dev.ranges(), allowSpeed })
        await dev.setTargets(prev)
      }
    }
    const writes = cp(sim.peripheral)
    expect(writes.filter((w) => w !== '00' && !w.startsWith('03 '))).toEqual([]) // never 02 (speed) or 07 (start)
    expect(writes.filter((w) => w.startsWith('03 ')).length).toBeGreaterThan(4)
    expect(sim.targetInclinePct).toBe(0) // the hill went up to 4 % and back down to flat
    expect(sim.running).toBe(false)
    // the person starts the belt on the console and walks at 5 km/h: the game reads it; there is no incline to read
    sim.userStart()
    sim.userSpeed(4.2)
    clock.t += 6000 // past the 5 s after connecting when devicelib ignores this firmware's speed
    sim.step(0)
    await flush()
    expect(dev.actual.speed! * KMH).toBeCloseTo(5)
    expect(dev.actual.incline).toBeNull()
    expect(dev.actual.heartRate).toBeNull() // the Horizon's heart rate field reads 0
    await dev.disconnect()
  })
})
