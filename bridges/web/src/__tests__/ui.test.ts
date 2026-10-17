import { describe, expect, test } from 'vitest'
import { controlsWords, decideScreen, endReasonWords, estopRelevant, liveReadout, menuPadButtons, percentWords, pickBanner, scrollToShow, type BannerInput, type ScreenInput } from '../ui'

const base: ScreenInput = {
  needLogin: false, hosting: false, expanded: false, hasSession: true, hasEnded: false,
  localExercise: true, fitnessOwner: 'me', wizardOpen: false, deviceOptional: false,
}

describe('decideScreen', () => {
  test('login first', () => {
    expect(decideScreen({ ...base, needLogin: true, hosting: true })).toBe('login')
  })
  test('game while hosting and collapsed', () => {
    expect(decideScreen({ ...base, hosting: true, expanded: false })).toBe('game')
    expect(decideScreen({ ...base, hosting: true, expanded: true })).toBe('ready')
  })
  test('ended summary only without a session', () => {
    expect(decideScreen({ ...base, hasSession: false, hasEnded: true })).toBe('ended')
    expect(decideScreen({ ...base, hasSession: true, hasEnded: true })).toBe('ready')
  })
  test('no session: idle, or wizard on request', () => {
    expect(decideScreen({ ...base, hasSession: false, localExercise: false })).toBe('idle')
    expect(decideScreen({ ...base, hasSession: false, localExercise: false, wizardOpen: true })).toBe('wizard')
  })
  test('session, no local device: wizard unless another bridge owns it', () => {
    expect(decideScreen({ ...base, localExercise: false, fitnessOwner: null })).toBe('wizard')
    expect(decideScreen({ ...base, localExercise: false, fitnessOwner: 'phone' })).toBe('remote')
    expect(decideScreen({ ...base, localExercise: false, fitnessOwner: 'phone', wizardOpen: true })).toBe('wizard')
  })
  test('ready with a local device', () => {
    expect(decideScreen(base)).toBe('ready')
  })
  test('a game that needs no machine: ready without a device, the wizard only on request', () => {
    const none = { ...base, localExercise: false, fitnessOwner: null, deviceOptional: true }
    expect(decideScreen(none)).toBe('ready')
    expect(decideScreen({ ...none, wizardOpen: true })).toBe('wizard')
    expect(decideScreen({ ...none, fitnessOwner: 'phone' })).toBe('remote')
    expect(decideScreen({ ...none, localExercise: true })).toBe('ready')
    expect(decideScreen({ ...none, hasSession: false })).toBe('idle')
    expect(decideScreen({ ...none, hosting: true })).toBe('game')
  })
})

describe('menu prompts', () => {
  test('the small d-pad never shows a second Back', () => {
    const all = ['up', 'down', 'left', 'right', 'select', 'back']
    expect(menuPadButtons(all, true)).toEqual(['up', 'down', 'left', 'right', 'select'])
    expect(menuPadButtons(all, false)).toEqual(all)
    expect(menuPadButtons(['select', 'back', 'place:shop'], false)).toEqual(['select', 'back'])
    expect(menuPadButtons([], true)).toEqual([])
  })
  test('scrolling to the highlighted item moves the list only as far as needed', () => {
    // a 300 px view over 72 px rows
    expect(scrollToShow(0, 300, 72, 64)).toBe(0)            // already visible
    expect(scrollToShow(0, 300, 400, 64)).toBe(172)         // below: its bottom 8 px above the view's bottom
    expect(scrollToShow(500, 300, 360, 64)).toBe(352)       // above: its top 8 px below the view's top
    expect(scrollToShow(100, 300, 4, 64)).toBe(0)           // never above the start
    expect(scrollToShow(0, 300, 400, 500)).toBe(392)        // taller than the view: show its top
  })
})

const quiet: BannerInput = {
  estop: false, needLogin: false, hosting: false, expanded: false, sessionStatus: 'active', pause: null, conflict: null,
  claiming: false, userStoppedName: null, unreachable: false, lastError: null, ramping: false, gameSilentS: 1,
  deviceType: 'treadmill', ignoredReason: null, localDeviceName: 'Sim', muteReports: false, wizardShown: false, driving: true, beltCommanded: true,
}
const userPause = { reason: 'user', message: 'Paused from Phone. Press Play to continue.', since: 0, seconds: 1, bridgeId: null, bridgeLabel: null, deviceName: null, deviceStatus: null } as const
const devPause = { ...userPause, reason: 'bridge_silent', message: 'Phone stopped reporting.' } as const
const conflict = { ownerLabel: 'Phone', sameBrowser: false, deviceName: 'NordicTrack' }

describe('pickBanner priority', () => {
  test('nothing when quiet', () => {
    expect(pickBanner(quiet)).toBeNull()
  })
  test('estop beats everything', () => {
    const b = pickBanner({ ...quiet, estop: true, sessionStatus: 'paused', pause: userPause, conflict, unreachable: true })
    expect(b?.kind).toBe('estop')
    expect(b?.action?.id).toBe('clearEstop')
  })
  test('user pause (with Play) beats device pause and standby', () => {
    const b = pickBanner({ ...quiet, sessionStatus: 'paused', pause: userPause, conflict })
    expect(b?.kind).toBe('userPause')
    expect(b?.action?.id).toBe('play')
  })
  test('device pause beats standby', () => {
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: devPause, conflict })?.kind).toBe('devicePause')
  })
  test('no_device pause is hidden while the wizard is on screen', () => {
    const p = { ...devPause, reason: 'no_device' as const, message: 'No treadmill is connected.' }
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: p, wizardShown: true })).toBeNull()
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: p, wizardShown: false })?.kind).toBe('devicePause')
  })
  test('another bridge driving the machine is a quiet note, last, and never over the game (#305)', () => {
    expect(pickBanner({ ...quiet, conflict, userStoppedName: 'Sim' })?.kind).toBe('userStopped')
    expect(pickBanner({ ...quiet, conflict, unreachable: true })?.kind).toBe('unreachable')
    expect(pickBanner({ ...quiet, conflict, gameSilentS: 30 })?.kind).toBe('silentGame')
    const b = pickBanner({ ...quiet, conflict })
    expect(b?.kind).toBe('standby')
    expect(b?.level).toBe('info')
    expect(b?.text).toContain('Phone')
    expect(b?.action?.id).toBe('claim')
    expect(pickBanner({ ...quiet, conflict, hosting: true, expanded: false })).toBeNull()
    expect(pickBanner({ ...quiet, conflict, hosting: true, expanded: true })?.kind).toBe('standby')
  })
  test('machine stopped > unreachable > silent game > ignored > muted', () => {
    expect(pickBanner({ ...quiet, userStoppedName: 'Sim', unreachable: true, gameSilentS: 30, ignoredReason: 'wrong_device_type', muteReports: true })?.kind).toBe('userStopped')
    expect(pickBanner({ ...quiet, unreachable: true, gameSilentS: 30, ignoredReason: 'wrong_device_type', muteReports: true })?.kind).toBe('unreachable')
    expect(pickBanner({ ...quiet, gameSilentS: 30, ignoredReason: 'wrong_device_type', muteReports: true })?.kind).toBe('silentGame')
    expect(pickBanner({ ...quiet, ignoredReason: 'simulator_not_allowed', muteReports: true })?.kind).toBe('ignored')
    expect(pickBanner({ ...quiet, muteReports: true })?.kind).toBe('muted')
  })
  test('silent game only counts while the session runs', () => {
    expect(pickBanner({ ...quiet, sessionStatus: 'pending', gameSilentS: 30 })).toBeNull()
    expect(pickBanner({ ...quiet, sessionStatus: null, gameSilentS: 30 })).toBeNull()
  })
  test('silent game: calm when nothing here moves a machine, safety wording only when driving a belt', () => {
    const idle = pickBanner({ ...quiet, gameSilentS: 42, driving: false })
    expect(idle?.level).toBe('warn')
    expect(idle?.text).toMatch(/not running.*42 s.*Show game here/)
    expect(pickBanner({ ...quiet, gameSilentS: 42, driving: false, hosting: true })?.text).toMatch(/reload/)
    expect(pickBanner({ ...quiet, gameSilentS: 12 })?.text).toBe('The game has not responded for 12 s. Holding speed; the belt stops in 18 s.')
    expect(pickBanner({ ...quiet, gameSilentS: 42, ramping: true })?.text).toMatch(/Slowing the treadmill/)
    expect(pickBanner({ ...quiet, gameSilentS: 42, deviceType: 'bike' })?.text).toMatch(/resistance/)
    expect(pickBanner({ ...quiet, gameSilentS: 9, driving: false })).toBeNull()
    const incline = pickBanner({ ...quiet, gameSilentS: 42, beltCommanded: false })
    expect(incline?.level).toBe('warn')
    expect(incline?.text).toMatch(/Holding the incline; your speed is unchanged/)
  })
  test('the wizard replaces any device-pause banner, never a user pause', () => {
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: devPause, wizardShown: true })).toBeNull()
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: userPause, wizardShown: true })?.kind).toBe('userPause')
    expect(pickBanner({ ...quiet, sessionStatus: 'paused', pause: devPause })?.kind).toBe('devicePause')
  })
  test('no jargon in banner text', () => {
    const all = [
      pickBanner({ ...quiet, estop: true }), pickBanner({ ...quiet, sessionStatus: 'paused', pause: devPause }),
      pickBanner({ ...quiet, conflict }), pickBanner({ ...quiet, unreachable: true }), pickBanner({ ...quiet, gameSilentS: 30 }),
      pickBanner({ ...quiet, ignoredReason: 'wrong_device_type', deviceType: 'bike' }),
    ]
    for (const b of all) expect(b?.text ?? '').not.toMatch(/standby|owner|putstate|commanded|bridgeId|FTMS|HRM\b/)
  })
})

describe('words', () => {
  test('end reasons', () => {
    expect(endReasonWords('completed')).toBe('Finished')
    expect(endReasonWords('bridge:abc', 'complete', 'abc')).toBe('Ended here')
    expect(endReasonWords('bridge:abc', 'complete', 'xyz')).toBe('Ended from another bridge')
    expect(endReasonWords('bridge:abc', 'discarded', 'abc')).toBe('Discarded here')
    expect(endReasonWords('superseded')).toBe('Replaced by a new game')
    expect(endReasonWords('some_custom_reason')).toBe('Some custom reason')
    expect(endReasonWords(null, 'complete')).toBe('Finished')
  })
  test('estop only when a treadmill is involved', () => {
    expect(estopRelevant({ localType: 'treadmill', localLive: true, sessionType: null, fitnessRole: null })).toBe(true)
    expect(estopRelevant({ localType: 'bike', localLive: true, sessionType: 'bike', fitnessRole: 'owner' })).toBe(false)
    expect(estopRelevant({ localType: null, localLive: false, sessionType: 'treadmill', fitnessRole: 'owner' })).toBe(true)
    expect(estopRelevant({ localType: null, localLive: false, sessionType: 'treadmill', fitnessRole: 'standby' })).toBe(false)
    expect(estopRelevant({ localType: 'treadmill', localLive: false, sessionType: null, fitnessRole: null })).toBe(false)
  })
})

describe('controlsWords', () => {
  test('a speed game on a treadmill with speed control off says the speed is the user\'s', () => {
    expect(controlsWords('speed+incline', 'treadmill', false)).toBe('Speed is yours: speed control is off for this treadmill')
    expect(controlsWords('speed+incline', 'treadmill', true)).toBeNull()
    expect(controlsWords('incline', 'treadmill', false)).toBe('Speed is yours; the game sets the incline')
    expect(controlsWords('speed+incline', 'bike', false)).toBeNull()
  })
})

describe('live readout (#305, #306)', () => {
  const merged = { power: { requested: null, commanded: null, actual: 240 }, cadence: { requested: null, commanded: null, actual: 88 } }
  test('a bridge that does not own the machine shows the owner\'s numbers', () => {
    const r = liveReadout({ local: null, owner: false, merged, requested: { grade: 3.24 }, commanded: null })
    expect(r).toMatchObject({ power: 240, cadence: 88, source: 'remote', target: { kind: 'grade', value: 3.24 }, applied: null })
    // its own device standing by does not stand in for the session's
    expect(liveReadout({ local: { power: 150 }, owner: false, merged, requested: {}, commanded: null }).power).toBe(240)
  })
  test('the owner shows its own machine, and what it set it to', () => {
    const r = liveReadout({ local: { power: 199, cadence: 80 }, owner: true, merged, requested: { grade: 4 }, commanded: { grade: 3.5 } })
    expect(r).toMatchObject({ power: 199, source: 'here', applied: 3.5 })
    expect(liveReadout({ local: null, owner: false, merged: null, requested: { incline: 2 }, commanded: null }).target).toEqual({ kind: 'incline', value: 2 })
    expect(liveReadout({ local: null, owner: false, merged: null, requested: {}, commanded: null })).toMatchObject({ power: null, source: null, target: null })
  })
  test('percent words', () => {
    expect(percentWords(3.24)).toBe('+3.2 %')
    expect(percentWords(-10.86)).toBe('−10.9 %')
    expect(percentWords(0.01)).toBe('0.0 %')
  })
})
