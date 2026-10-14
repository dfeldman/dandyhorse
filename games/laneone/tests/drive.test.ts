import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { defaultBase, pausedCommand, targetsFor, type Mode } from '../src/drive.ts'
import type { Segment } from '../src/program.ts'

const seg = (effort: number, grade: number): Segment => ({ t0: 0, t1: 60, kind: 'work', label: 'x', effort, grade })
const treadYou: Mode = { device: 'treadmill', who: 'you' }
const treadMachine: Mode = { device: 'treadmill', who: 'machine' }
const bikeYou: Mode = { device: 'bike', who: 'you' }
const bikeErg: Mode = { device: 'bike', who: 'machine' }

describe('a treadmill the player drives', () => {
  const base = { ...defaultBase('treadmill'), speed: 2, incline: 1 }

  it('never sends a belt speed — that is the rule that keeps people on their feet', () => {
    for (const s of [seg(1, 0), seg(1.35, 3), seg(0.6, 0)]) {
      expect(targetsFor(s, base, treadYou).command.speed).toBeNull()
    }
  })

  it('sends the hill, and shows the pace as something to match by hand', () => {
    const t = targetsFor(seg(1.35, 3), base, treadYou)
    expect(t.command.incline).toBeCloseTo(4, 6) // base 1 % + the segment's 3 %
    expect(t.want.speed).toBeCloseTo(2.7, 6)
    expect(t.manual).toBe('speed')
  })
})

describe('a treadmill that drives itself', () => {
  const base = { ...defaultBase('treadmill'), speed: 2, incline: 1 }

  it('sends both, and asks the player for nothing', () => {
    const t = targetsFor(seg(1.35, 3), base, treadMachine)
    expect(t.command.speed).toBeCloseTo(2.7, 6)
    expect(t.command.incline).toBeCloseTo(4, 6)
    expect(t.manual).toBeNull()
  })

  it('will not ask for a belt faster or a hill steeper than the console allows', () => {
    const fast = targetsFor(seg(9, 40), { ...base, speed: 5 }, treadMachine)
    expect(fast.command.speed).toBe(Config.SPEED_RANGE[1])
    expect(fast.command.incline).toBe(Config.INCLINE_RANGE[1])
    const slow = targetsFor(seg(0, -40), base, treadMachine)
    expect(slow.command.speed).toBe(0)
    expect(slow.command.incline).toBe(0) // a treadmill has no decline
  })
})

describe('a bike in simulation', () => {
  const base = { ...defaultBase('bike'), power: 150, grade: 0 }

  it('sends the hill and asks the rider for the watts', () => {
    const t = targetsFor(seg(1.2, 4), base, bikeYou)
    expect(t.command.grade).toBeCloseTo(4, 6)
    expect(t.command.power).toBeNull()
    expect(t.want.power).toBeCloseTo(180, 6)
    expect(t.manual).toBe('power')
  })
})

describe('a bike in ERG', () => {
  const base = { ...defaultBase('bike'), power: 150, grade: 0 }

  it('sends watts only, because power wins over grade on the wire', () => {
    const t = targetsFor(seg(1.2, 0), base, bikeErg)
    expect(t.command.power).toBeCloseTo(180, 6)
    expect(t.command.grade).toBeNull()
    expect(t.manual).toBeNull()
  })

  it('turns a programmed hill into watts, since ERG has no hill to feel', () => {
    const flat = targetsFor(seg(1, 0), base, bikeErg).command.power!
    const hill = targetsFor(seg(1, 6), base, bikeErg).command.power!
    expect(hill).toBeGreaterThan(flat)
    expect(hill).toBeCloseTo(150 * (1 + 6 * Config.GRADE_TO_POWER), 6)
  })

  it('stays inside the console’s power range', () => {
    expect(targetsFor(seg(20, 20), base, bikeErg).command.power).toBe(Config.POWER_RANGE[1])
    expect(targetsFor(seg(0, 0), base, bikeErg).command.power).toBe(Config.POWER_RANGE[0])
  })
})

describe('paused', () => {
  it('stands a driven belt still but keeps its hill', () => {
    const c = pausedCommand({ ...defaultBase('treadmill'), incline: 6 }, treadMachine)
    expect(c.speed).toBe(0)
    expect(c.incline).toBe(6)
  })

  it('says nothing about a belt it does not drive', () => {
    expect(pausedCommand(defaultBase('treadmill'), treadYou).speed).toBeNull()
  })

  it('flattens a bike, so a device that reconnects starts easy', () => {
    for (const m of [bikeYou, bikeErg]) {
      const c = pausedCommand({ ...defaultBase('bike'), grade: 8 }, m)
      expect(c.grade).toBe(0)
      expect(c.power).toBeNull()
    }
  })
})
