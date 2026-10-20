import { describe, expect, it } from 'vitest'
import { Encouragement } from '../encouragement.ts'
import { countryName, flag, flagOrCode } from '../flags.ts'
import type { CompetitorSample } from '../competitor.ts'

const rival = (distance: number, extra: Partial<CompetitorSample> = {}): CompetitorSample => ({
  elapsed: 0, distance, speed: 8, power: 180, energy: 0, elevationGain: 0, progress: {}, finished: false, ...extra,
})

/** No cooldown and no idle chatter, so a test sees exactly the event it set up. */
const voice = (o = {}) => new Encouragement({ cooldown: 0, idleEvery: 0, random: () => 0, ...o })

describe('flags', () => {
  it('turns a country code into a flag', () => {
    expect(flag('es')).toBe('🇪🇸')
    expect(flag('US')).toBe('🇺🇸')
    expect(flag('')).toBe('')
    expect(flag('USA')).toBe('')
    expect(flag(null)).toBe('')
    expect(flagOrCode('gb')).toBe('🇬🇧')
    expect(flagOrCode('xx')).not.toBe('')  // a valid shape is shown even if no country owns it
    expect(flagOrCode('nope')).toBe('')
    expect(countryName('ES')).toBe('Spain')
    expect(countryName('')).toBe('')
  })
})

describe('Encouragement', () => {
  it('says nothing when nothing has happened', () => {
    const v = voice()
    expect(v.update({ elapsed: 1, distance: 0 })).toBeNull()
    expect(v.update({ elapsed: 2, distance: 400 })).toBeNull()
  })

  it('marks every kilometre at first, then every fifth', () => {
    const v = voice()
    expect(v.update({ elapsed: 10, distance: 1001 })?.text).toBe('1 km down.')
    expect(v.update({ elapsed: 20, distance: 2001 })?.text).toBe('2 km down.')
    for (let km = 3; km <= 9; km++) v.update({ elapsed: 20 + km, distance: km * 1000 + 1 })
    // past ten, only the fives
    expect(v.update({ elapsed: 40, distance: 10_001 })?.text).toBe('10 km down.')
    expect(v.update({ elapsed: 50, distance: 11_001 })).toBeNull()
    expect(v.update({ elapsed: 60, distance: 15_001 })?.text).toBe('15 km down.')
  })

  it('counts in miles when asked', () => {
    const v = voice({ imperial: true })
    expect(v.update({ elapsed: 10, distance: 1001 })).toBeNull()
    expect(v.update({ elapsed: 20, distance: 1700 })?.text).toBe('1 mi down.')
  })

  it('calls out passing the rival, and being passed back', () => {
    const v = voice({ rivalName: 'Ana' })
    // the first look only establishes where things stand
    expect(v.update({ elapsed: 1, distance: 0, rival: rival(0) })).toBeNull()
    expect(v.update({ elapsed: 2, distance: 50, rival: rival(10) })?.text).toBe('You have passed Ana!')
    expect(v.update({ elapsed: 3, distance: 60, rival: rival(20) })).toBeNull()  // still ahead: said already
    expect(v.update({ elapsed: 4, distance: 60, rival: rival(200) })?.text)
      .toBe('Ana is back in front — dig in.')
  })

  it('interrupts its own cooldown for the rival, but not for a kilometre post', () => {
    const v = new Encouragement({ cooldown: 30, idleEvery: 0, rivalName: 'Ana', random: () => 0 })
    expect(v.update({ elapsed: 1, distance: 1001, rival: rival(1001) })?.id).toBe('distance')
    // inside the cooldown
    expect(v.update({ elapsed: 5, distance: 2001, rival: rival(2001) })).toBeNull()
    expect(v.update({ elapsed: 6, distance: 2600, rival: rival(2001) })?.id).toBe('passed')
  })

  it('celebrates the game own counters, and says when you are ahead on them', () => {
    const v = voice({ rivalName: 'Ana', progressWords: { deliveries: 'delivery' } })
    expect(v.update({ elapsed: 1, progress: { deliveries: 0 } })).toBeNull()
    expect(v.update({ elapsed: 2, progress: { deliveries: 1 } })?.text).toBe('Delivery 1. Good.')
    const ahead = v.update({ elapsed: 3, distance: 0, progress: { deliveries: 2 },
                             rival: rival(0, { progress: { deliveries: 1 } }) })
    expect(ahead?.text).toBe('2 — that is 1 more than Ana.')
    expect(ahead?.tone).toBe('good')
  })

  it('notices the rival finishing, and whether you beat them', () => {
    const v = voice({ rivalName: 'Ana' })
    v.update({ elapsed: 1, distance: 0, rival: rival(0) })
    const won = v.update({ elapsed: 2, distance: 500, rival: rival(400, { finished: true }) })
    expect(won?.id === 'passed' || won?.id === 'beat-rival').toBe(true)
    const v2 = voice({ rivalName: 'Ana' })
    v2.update({ elapsed: 1, distance: 0, rival: rival(0) })
    expect(v2.update({ elapsed: 2, distance: 100, rival: rival(900, { finished: true }) })?.id)
      .toBe('overtaken')
  })

  it('marks halfway and the last stretch of a planned session', () => {
    const v = voice({ plannedSeconds: 600 })
    expect(v.update({ elapsed: 299 })).toBeNull()
    expect(v.update({ elapsed: 300 })?.id).toBe('halfway')
    expect(v.update({ elapsed: 400 })).toBeNull()
    expect(v.update({ elapsed: 540 })?.id).toBe('home-straight')
    expect(v.update({ elapsed: 560 })).toBeNull()
  })

  it('marks calories and climbing', () => {
    const v = voice()
    expect(v.update({ elapsed: 10, energy: 200 * 4184 + 1 })?.text).toBe('200 calories burned.')
    expect(v.update({ elapsed: 20, elevationGain: 251 })?.text).toBe('250 m of climbing. That is real hill.')
  })

  it('says something now and then when nothing is happening', () => {
    const v = new Encouragement({ cooldown: 0, idleEvery: 60, random: () => 0 })
    expect(v.update({ elapsed: 10, distance: 0 })).toBeNull()
    const line = v.update({ elapsed: 61, distance: 0 })
    expect(line?.tone).toBe('neutral')
    // and then holds off again
    expect(v.update({ elapsed: 70, distance: 0 })).toBeNull()
  })
})
