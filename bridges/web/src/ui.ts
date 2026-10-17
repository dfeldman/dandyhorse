// Presentation logic for the bridge UI: which screen to show, which single banner to show, plain-word
// terminology, live-value freshness. Pure functions take a snapshot so they can be unit-tested; the
// thin wrappers at the bottom read the store.
import { ref, watch } from 'vue'
import { store } from './bridge'
import type { FitnessDevice } from './devices/FitnessDevice'
import { REMOTE_BUTTONS, type Commanded, type DeviceStatus, type DeviceType, type MergedMetric, type MetricName, type Metrics, type OtherBridge, type PauseInfo, type RemoteButton, type RoleStanding } from './types'

// ---------------------------------------------------------------------------
// screen state

export type Screen = 'login' | 'game' | 'ended' | 'idle' | 'wizard' | 'remote' | 'ready'

export interface ScreenInput {
  needLogin: boolean
  hosting: boolean
  expanded: boolean
  hasSession: boolean
  hasEnded: boolean
  /** a local treadmill / bike trainer / simulator (any status but disconnected) */
  localExercise: boolean
  /** bridgeId of the bridge the server says controls the exercise device, or null */
  fitnessOwner: string | null
  /** the user asked for the wizard explicitly */
  wizardOpen: boolean
  /** the session's game plays without a machine (session.autoPause false): never force the wizard */
  deviceOptional: boolean
}

/** Exactly one screen, decided in this order (PLAN §15 Phase 3.5; brief "Screen state model"). */
export function decideScreen(i: ScreenInput): Screen {
  if (i.needLogin) return 'login'                       // 1
  if (i.hosting && !i.expanded) return 'game'           // 2 game iframe + strip
  if (!i.hasSession && i.hasEnded) return 'ended'       // 3 summary
  if (!i.hasSession) return i.wizardOpen ? 'wizard' : 'idle' // 4 waiting for a game (wizard on request)
  if (i.wizardOpen) return 'wizard'                     // "Connect a device here instead"
  if (!i.localExercise) return i.fitnessOwner ? 'remote' : i.deviceOptional ? 'ready' : 'wizard' // 6 / 7 with no machine / 5
  return 'ready'                                        // 7
}

// ---------------------------------------------------------------------------
// banners: one at a time, most urgent first

export type BannerKind = 'estop' | 'login' | 'userPause' | 'devicePause' | 'standby' | 'userStopped'
  | 'unreachable' | 'silentGame' | 'ignored' | 'muted'
export interface Banner {
  kind: BannerKind
  level: 'bad' | 'warn' | 'info'
  text: string
  action?: { label: string; id: 'clearEstop' | 'login' | 'play' | 'claim' | 'resumeControl' }
}

export interface BannerInput {
  estop: boolean
  needLogin: boolean
  hosting: boolean
  expanded: boolean
  sessionStatus: string | null
  pause: PauseInfo | null | undefined
  /** owner label + device when another bridge controls the fitness role */
  conflict: { ownerLabel: string | null; sameBrowser: boolean; deviceName: string | null } | null
  claiming: boolean
  userStoppedName: string | null
  unreachable: boolean
  lastError: string | null
  ramping: boolean
  gameSilentS: number | null
  /** this bridge is the confirmed owner of a live local exercise device (its commands move a machine) */
  driving: boolean
  /** the game has commanded belt speed (most treadmill games only set the incline, §7.3) */
  beltCommanded: boolean
  deviceType: DeviceType | null
  ignoredReason: 'wrong_device_type' | 'simulator_not_allowed' | null
  localDeviceName: string | null
  muteReports: boolean
  /** the wizard is on screen (so a "no device" pause message would be redundant) */
  wizardShown: boolean
}

export function pickBanner(i: BannerInput): Banner | null {
  const machine = i.deviceType === 'bike' ? 'bike trainer' : 'treadmill'
  if (i.estop) {
    return { kind: 'estop', level: 'bad', text: 'Emergency stop: the treadmill was told to stop.', action: { label: 'Clear E-stop', id: 'clearEstop' } }
  }
  if (i.needLogin && i.hosting && !i.expanded) {
    return { kind: 'login', level: 'bad', text: 'You are logged out. Devices keep running but nothing reaches the game.', action: { label: 'Log in', id: 'login' } }
  }
  if (i.sessionStatus === 'paused' && i.pause?.reason === 'user') {
    return { kind: 'userPause', level: 'warn', text: i.pause.message || 'Paused.', action: { label: '▶ Play', id: 'play' } }
  }
  // while the wizard is on screen it already says "connect a device"; a device pause would repeat it
  if (i.sessionStatus === 'paused' && !(i.wizardShown && i.pause?.reason !== 'user')) {
    return { kind: 'devicePause', level: 'warn', text: `Paused: ${i.pause?.message ?? `waiting for the ${machine}.`} The game continues by itself once data flows again.` }
  }
  if (i.userStoppedName) {
    return { kind: 'userStopped', level: 'bad', text: `${i.userStoppedName} was stopped on the machine. The game will not restart it.`, action: { label: 'Resume control', id: 'resumeControl' } }
  }
  if (i.unreachable) {
    const tail = i.ramping ? ' Slowing the treadmill to a stop.' : ' Holding the current settings.'
    return { kind: 'unreachable', level: 'bad', text: `Cannot reach the Dandyhorse server.${tail}` }
  }
  if ((i.sessionStatus === 'active' || i.sessionStatus === 'paused') && i.gameSilentS != null && i.gameSilentS > 10) {
    const secs = Math.round(i.gameSilentS)
    if (!i.driving) {
      // Nothing here moves a machine: the game page is simply gone (closed, or this tab was navigated away).
      const how = i.hosting ? 'It may have crashed; reload it.' : 'Open it with "Show game here", or start it on your other screen.'
      return { kind: 'silentGame', level: 'warn', text: `The game is not running (no response for ${secs} s). ${how}` }
    }
    const tail = i.ramping
      ? ' Slowing the treadmill to a stop.'
      : i.deviceType !== 'treadmill' ? ' Holding the current resistance.'
        : i.beltCommanded ? ` Holding speed; the belt stops in ${Math.max(0, 30 - secs)} s.` : ' Holding the incline; your speed is unchanged.'
    return { kind: 'silentGame', level: i.beltCommanded || i.ramping ? 'bad' : 'warn', text: `The game has not responded for ${secs} s.${tail}` }
  }
  if (i.ignoredReason === 'wrong_device_type') {
    return { kind: 'ignored', level: 'warn', text: `${i.localDeviceName ?? 'Your device'} is not being used: this game needs a ${machine}.` }
  }
  if (i.ignoredReason === 'simulator_not_allowed') {
    return { kind: 'ignored', level: 'warn', text: 'The simulator is not being used: this game is not in debug mode.' }
  }
  if (i.muteReports) {
    return { kind: 'muted', level: 'warn', text: 'Developer: this bridge is not reporting to the server.' }
  }
  /*
   * Another bridge drives the session with its own machine while this one has a device too (#305, 2026-10-17). That is
   * a normal set-up (a phone on the bike with the trainer, a laptop showing the game), not an error: the owner (PLAN.md
   * §16 Q6, "the user can figure that one out"). So: nothing at all over the game — the strip says where the machine
   * is — and a quiet note on the bridge's own screens, with the switch for whoever wants it. It was a red banner over
   * the game that nothing could dismiss.
   */
  if (i.conflict && !(i.hosting && !i.expanded)) {
    const who = i.conflict.ownerLabel ?? 'another device'
    const same = i.conflict.sameBrowser ? ' (another tab in this browser)' : ''
    return { kind: 'standby', level: 'info', text: `Your ${machine} is driven from ${who}${same}; this one is standing by.`, action: { label: 'Use this one instead', id: 'claim' } }
  }
  return null
}

// ---------------------------------------------------------------------------
// the session's live numbers, wherever the machine is (#305, #306)

export interface LiveInput {
  /** this bridge's own exercise device's readings, if it has one */
  local: Partial<Metrics> | null
  /** this bridge owns the session's machine */
  owner: boolean
  /** the server's merged view (getstate `merged`): the owning bridge's machine, whichever bridge that is */
  merged: Partial<Record<MetricName, MergedMetric>> | null | undefined
  /** what the game asks of the machine (getstate `requested`) */
  requested: Partial<Metrics> | null | undefined
  /** what this bridge is commanding its machine right now (after limits and difficulty) */
  commanded: Partial<Commanded> | null
}

export interface LiveReadout {
  power: number | null
  speed: number | null
  cadence: number | null
  /** where the numbers come from: this bridge's machine, another bridge's, or nowhere yet */
  source: 'here' | 'remote' | null
  /** the game's request: grade on a bike, incline on a treadmill (percent), null when it asks for neither */
  target: { kind: 'grade' | 'incline'; value: number } | null
  /** what this bridge set its machine to for that request, when it is the one driving it */
  applied: number | null
}

/**
 * The numbers to show for the session. The machine's readings are the OWNER's: a bridge that does not own the machine
 * (a phone used as the remote, a big screen while the phone has the trainer) shows the session's merged readings, so
 * every bridge shows the same watts. It showed its own device's (or nothing) before (#305).
 */
export function liveReadout(i: LiveInput): LiveReadout {
  const m = i.merged ?? null
  const fromMerged = !i.owner && !!m && (m.power?.actual != null || m.speed?.actual != null || m.cadence?.actual != null)
  const pick = (k: 'power' | 'speed' | 'cadence'): number | null => (i.owner || !fromMerged ? i.local?.[k] ?? null : m?.[k]?.actual ?? null)
  const g = i.requested?.grade
  const inc = i.requested?.incline
  const target = g != null ? { kind: 'grade' as const, value: g } : inc != null ? { kind: 'incline' as const, value: inc } : null
  const applied = !i.owner || !target ? null : (target.kind === 'grade' ? i.commanded?.grade : i.commanded?.incline) ?? null
  return {
    power: pick('power'), speed: pick('speed'), cadence: pick('cadence'),
    source: i.owner && i.local ? 'here' : fromMerged ? 'remote' : i.local ? 'here' : null,
    target, applied,
  }
}

/** "+3.2 %", "−1.0 %": a grade or an incline, signed. */
export function percentWords(v: number): string {
  const r = Math.round(v * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)} %`
}

// ---------------------------------------------------------------------------
// terminology

export function deviceWord(type: DeviceType | 'hrm' | string | null | undefined, capital = false): string {
  const w = type === 'treadmill' ? 'treadmill' : type === 'bike' ? 'bike trainer' : type === 'hrm' ? 'heart rate monitor' : 'exercise device'
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w
}

export function statusWord(status: DeviceStatus | string): string {
  switch (status) {
    case 'connected': return 'Connected'
    case 'simulated': return 'Simulator'
    case 'readonly': return 'Read-only: use the machine’s own buttons'
    case 'connecting': return 'Connecting…'
    default: return 'Disconnected'
  }
}

/** One status line for a device card: connection, then who is in control. */
export function controlLine(role: RoleStanding, ownerLabel: string | null): string | null {
  if (role === 'owner') return 'In control'
  if (role === 'standby') return `Another device is controlling: ${ownerLabel ?? 'unknown'}`
  return null
}

/**
 * What the game does with the machine, for the treadmill card's status line. `speedAllowed` is false when this
 * treadmill's speed control is off (the default for real machines, PLAN.md §9.4): a speed game then only sets incline.
 */
export function controlsWords(controls: string | null | undefined, type: string | null | undefined, speedAllowed = true): string | null {
  if (type !== 'treadmill' || !controls) return null
  if (controls === 'incline') return 'Speed is yours; the game sets the incline'
  if (controls === 'none') return 'This game only reads your treadmill'
  if (controls.includes('speed') && !speedAllowed) return 'Speed is yours: speed control is off for this treadmill'
  return null
}

const END_REASONS: Record<string, string> = {
  completed: 'Finished',
  discarded_by_game: 'Ended by the game',
  superseded: 'Replaced by a new game',
  timeout: 'The game stopped responding',
  server_restart: 'The server restarted',
  pending_timeout: 'The game never started',
}
export function endReasonWords(reason: string | null | undefined, status?: string | null, myBridgeId?: string | null): string {
  if (!reason) return status === 'complete' ? 'Finished' : 'Ended'
  if (reason.startsWith('bridge:')) {
    // ended by a person pressing End / Discard on a bridge; never show the bridge id
    const here = !!myBridgeId && reason.slice(7) === myBridgeId
    return status === 'complete' ? (here ? 'Ended here' : 'Ended from another bridge') : here ? 'Discarded here' : 'Discarded from another bridge'
  }
  return END_REASONS[reason] ?? reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Is a device "on" for UI purposes (anything but disconnected)? */
export function deviceLive(dev: FitnessDevice | null | undefined): boolean {
  return !!dev && dev.status !== 'disconnected'
}

/** E-STOP only matters when a treadmill is involved (owner decision). */
export function estopRelevant(i: { localType: string | null; localLive: boolean; sessionType: DeviceType | null; fitnessRole: RoleStanding }): boolean {
  if (i.localLive && i.localType === 'treadmill') return true
  return i.sessionType === 'treadmill' && i.fitnessRole === 'owner'
}

// ---------------------------------------------------------------------------
// menu prompts (games/kingdomtrek/INTEGRATION.md §4.2)

/** The buttons of the small d-pad beside a menu: the ones it names, without 'back' while a Back item button is shown
 *  (never two Backs). */
export function menuPadButtons(choices: string[], backItemShown: boolean): RemoteButton[] {
  return REMOTE_BUTTONS.filter((b) => choices.includes(b) && !(b === 'back' && backItemShown))
}

/**
 * The scrollTop that shows an item of a scrolling list in full, `margin` px clear of the edges; the current one when
 * it already is. `top` and `height` are the item's box in the list's content coordinates. An item taller than the
 * view shows its top. Only the list scrolls, never the page (a highlight moved at the big screen must not yank it).
 */
export function scrollToShow(scrollTop: number, viewHeight: number, top: number, height: number, margin = 8): number {
  if (top - margin < scrollTop) return Math.max(0, top - margin)
  if (top + height + margin > scrollTop + viewHeight) return Math.max(0, Math.min(top - margin, top + height + margin - viewHeight))
  return scrollTop
}

// ---------------------------------------------------------------------------
// store-backed wrappers

export function localExerciseDevice(): FitnessDevice | null {
  const f = store.fitness
  return f && deviceLive(f) && f.type !== 'hrm' ? f : null
}

/** The session's game plays without a machine (session.autoPause false; absent means true): effort may come from a
 *  heart rate monitor or nothing, so the device wizard is offered, never forced. */
export function deviceOptional(): boolean {
  return store.session?.autoPause === false
}

export function currentScreen(): Screen {
  return decideScreen({
    needLogin: store.needLogin,
    hosting: store.hosting,
    expanded: store.expanded,
    hasSession: !!store.session,
    hasEnded: !!store.endedSession,
    localExercise: !!localExerciseDevice(),
    fitnessOwner: store.state?.owner?.fitness ?? null,
    wizardOpen: store.wizardOpen,
    deviceOptional: deviceOptional(),
  })
}

export function ownerBridge(role: 'fitness' | 'hrm' = 'fitness'): OtherBridge | null {
  const id = store.state?.owner?.[role]
  if (!id || id === store.bridgeId) return null
  return store.state?.otherBridges.find((b) => b.bridgeId === id) ?? null
}

export function currentBanner(): Banner | null {
  const c = store.conflicts.find((x) => x.role === 'fitness') ?? store.conflicts[0] ?? null
  return pickBanner({
    estop: store.estop,
    needLogin: store.needLogin,
    hosting: store.hosting,
    expanded: store.expanded,
    sessionStatus: store.session?.status ?? null,
    pause: store.session?.pause,
    conflict: c ? { ownerLabel: c.ownerLabel, sameBrowser: !!c.ownerBrowserId && c.ownerBrowserId === store.browserId, deviceName: c.ownerDevice?.name ?? null } : null,
    claiming: store.claiming,
    userStoppedName: store.fitness?.userStopped ? store.fitness.name : null,
    unreachable: store.unreachable,
    lastError: store.lastError,
    ramping: store.ramping,
    gameSilentS: store.gameSilentS,
    driving: store.roles.fitness === 'owner' && !!localExerciseDevice(),
    beltCommanded: store.commanded.speed != null,
    deviceType: store.session?.deviceType ?? (localExerciseDevice()?.type as DeviceType | undefined) ?? null,
    ignoredReason: store.ignoredReasons.fitness ?? null,
    localDeviceName: store.fitness?.name ?? null,
    muteReports: store.muteReports,
    wizardShown: currentScreen() === 'wizard',
  })
}

export function currentReadout(): LiveReadout {
  const dev = localExerciseDevice()
  return liveReadout({
    local: dev ? dev.actual : null,
    owner: store.roles.fitness === 'owner' && !!dev,
    merged: store.state?.merged,
    requested: store.state?.requested ?? store.requested,
    commanded: store.commanded,
  })
}

export function showEstop(): boolean {
  const f = store.fitness
  return estopRelevant({
    localType: f?.type ?? null,
    localLive: deviceLive(f),
    sessionType: store.session?.deviceType ?? null,
    fitnessRole: store.roles.fitness,
  })
}

// ---------------------------------------------------------------------------
// freshness: when did a device's readings last CHANGE? (drivers null their readings after a 4–5 s stall,
// so a non-null value means "recent"; the pulse means "changing right now")

const FRESH_MS = 2000
export const fitnessChangedAt = ref(0)
export const hrmChangedAt = ref(0)
export const clock = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

export function startFreshness(): void {
  if (clockTimer) return
  clockTimer = setInterval(() => { clock.value = Date.now() }, 500)
  watch(() => (store.fitness ? Object.values(store.fitness.actual) : null), () => { fitnessChangedAt.value = Date.now() }, { deep: true })
  watch(() => store.hrm?.actual.heartRate ?? null, () => { hrmChangedAt.value = Date.now() })
}
export function fitnessFresh(): boolean { return clock.value - fitnessChangedAt.value < FRESH_MS }
export function hrmFresh(): boolean { return clock.value - hrmChangedAt.value < FRESH_MS }
