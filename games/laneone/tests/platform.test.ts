import { describe, expect, it } from 'vitest'
import { commandMetrics, consoleChoices, launchChoice, stepFor } from '../src/platform.ts'

describe('the launch options', () => {
  it('turns the console dialog words into the game\'s own choice', () => {
    const c = launchChoice({ options: { programme: 'hills', level: 'very hard', drive: 'the machine', goal: 'the clock runs out' }, requestedDuration: 1200, unitSystem: 'metric' })
    expect(c).toMatchObject({ program: 'hills', level: 9, who: 'machine', duration: 1200, goal: { kind: 'time', value: 1200 } })
  })
  it('defaults to the safe thing and never throws on a stray value', () => {
    const c = launchChoice({ options: { programme: 'nonsense', drive: 'whoever' }, requestedDuration: null, unitSystem: 'us' })
    expect(c.program).toBe('steady')
    expect(c.who).toBe('you')
    expect(c.level).toBe(5)
  })
  it('gives a distance goal a number without asking (the middle chip of the setup screen: 5 km, or 5 mi)', () => {
    expect(launchChoice({ options: { goal: 'a distance is done' }, requestedDuration: 1800, unitSystem: 'metric' }).goal).toEqual({ kind: 'distance', value: 5000 })
    expect(launchChoice({ options: { goal: 'a distance is done' }, requestedDuration: 1800, unitSystem: 'us' }).goal).toEqual({ kind: 'distance', value: 8046.72 })
  })
})

describe('what goes on the wire', () => {
  it('never sends a field the drive mode left out', () => {
    expect(commandMetrics({ speed: null, incline: 4, power: null, grade: null })).toEqual({ incline: 4 })
  })
  it('sends power and not grade if both were ever set', () => {
    expect(commandMetrics({ speed: null, incline: null, power: 200, grade: 3 })).toEqual({ power: 200 })
  })
})

describe('the phone', () => {
  it('has the same buttons as the screen', () => {
    expect(consoleChoices('treadmill', 'you')).toEqual(['Speed −', 'Speed +', 'Incline −', 'Incline +'])
    expect(consoleChoices('bike', 'machine')).toEqual(['Power −', 'Power +'])
  })
  it('steps in the player\'s display units', () => {
    expect(stepFor('Speed +', 'metric')!.delta).toBeCloseTo(0.1 / 3.6)
    expect(stepFor('Speed −', 'us')!.delta).toBeCloseTo(-0.1 / 2.2369362920544)
    expect(stepFor('Incline +', 'metric')).toEqual({ dial: 'incline', delta: 0.5 })
    expect(stepFor('Power −', 'metric')).toEqual({ dial: 'power', delta: -5 })
    expect(stepFor('Horn', 'metric')).toBeNull()
  })
})
