// Bridge store: identity, polling loop, control tick, devices, game hosting. One instance per page.
import { markRaw, reactive } from 'vue'
import { ApiError, api, isAbort } from './api'
import { bluetoothUnavailableReason } from './devices/bluetooth'
import type { FitnessDevice } from './devices/FitnessDevice'
import { DevicelibDevice } from './devices/DevicelibDevice'
import { SimulatorDevice, SimulatorHrm } from './devices/SimulatorDevice'
import { speedAllowed, commandedEqual, process, rampDown, staleAction } from './pipeline'
import {
  DEFAULT_LIMITS, emptyCommanded, emptyMetrics, emptyRoles, type Commanded, type Conflict, type DeviceRole, type DeviceRow,
  type DevicePrefs, type DeviceType, type GetState, type IgnoreReason, type Limits, type Metrics, type PutState, type PutStateResponse,
  type RemoteButton, type ReportedDevice, type Roles, type SessionBrief, type SessionSummary, type Standing, type UnitSystem,
} from './types'

export type Tab = 'session' | 'devices' | 'debug' | 'ftms'
export type Theme = 'system' | 'light' | 'dark'
export type WizardStep = 'connect' | 'connecting' | 'result' | 'hrm' | 'hrmConnecting'

export interface RoundTrip {
  t: number
  kind: 'getstate' | 'putstate' | 'sendinput' | 'devices' | 'me' | 'session'
  ms: number
  ok: boolean
  status: number
  note: string
}

// bridgeId is per PAGE and lives only in memory: two tabs of one browser share cookies and localStorage,
// so anything persisted would make them look like one bridge to the server (their reports would
// overwrite each other). browserId is persisted and only used to say "another tab in this browser".
const LS_BROWSER = 'dh.browserId'
const LS_OLD_ID = 'dh.bridgeId' // pre-2026-09-11 builds stored a shared bridgeId here; reused as browserId
const LS_LABEL = 'dh.bridgeLabel'
// UI preferences (presentation only)
const LS_THEME = 'dh.theme'
const LS_DEVTOOLS = 'dh.devTools'
const LS_TECH = 'dh.techDetails'
// Simulators survive a reload of THIS tab (the console navigates the tab to the bridge) but must not
// start in every other tab of the browser: sessionStorage, not localStorage.
const SS_SIM = 'dh.sim'
const SS_SIM_HRM = 'dh.simHrm'
const TICK_MS = 250
const PUT_MS = 1000
const PUT_MIN_MS = 250
const UNREACHABLE_MS = 10_000
const GETSTATE_TIMEOUT_MS = 8000

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function defaultLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  return `${browser} on ${os}`
}

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function lsSet(k: string, v: string): void {
  try { localStorage.setItem(k, v) } catch { /* private mode */ }
}
function ssGet(k: string): string | null {
  try { return sessionStorage.getItem(k) } catch { return null }
}
function ssSet(k: string, v: string): void {
  try { sessionStorage.setItem(k, v) } catch { /* private mode */ }
}

function browserIdentity(): string {
  const id = lsGet(LS_BROWSER) ?? lsGet(LS_OLD_ID) ?? uuid()
  lsSet(LS_BROWSER, id)
  return id
}

export const store = reactive({
  bridgeId: uuid(),
  browserId: browserIdentity(),
  label: lsGet(LS_LABEL) ?? defaultLabel(),
  unitSystem: 'metric' as UnitSystem,
  tab: 'session' as Tab,

  // UI preferences and transient UI state (presentation only; nothing here affects the control loop)
  theme: (['light', 'dark'].includes(lsGet(LS_THEME) ?? '') ? lsGet(LS_THEME) : 'system') as Theme,
  devTools: lsGet(LS_DEVTOOLS) === '1',
  techDetails: lsGet(LS_TECH) === '1',
  /** the user asked for the setup wizard explicitly (from "Set up a device" / "Connect a device here instead") */
  wizardOpen: false,
  wizardStep: 'connect' as WizardStep,

  // server connectivity
  needLogin: false,
  loginUid: '1',
  lastGetOk: 0, // performance.now() of the last successful getstate; 0 = never
  everOk: false,
  unreachable: false,
  lastError: null as string | null,

  // server state
  state: null as GetState | null,
  lastSeq: 0,
  session: null as SessionBrief | null,
  endedSession: null as SessionSummary | null,
  requested: emptyMetrics() as Metrics,
  limits: { ...DEFAULT_LIMITS } as Limits,
  /** Saved preferences per device address (from getstate); `speedControl` gates belt-speed commands. */
  devicePreferences: {} as Record<string, DevicePrefs>,
  ignoredFitness: false,
  /** seconds the game has been silent (server-reported age + time since that getstate), null if unknown */
  gameSilentS: null as number | null,
  /** our standing per role as last confirmed by the server; null = not confirmed yet (never command then) */
  roles: emptyRoles() as Roles,
  ignoredReasons: {} as Partial<Record<DeviceRole, IgnoreReason>>,
  conflicts: [] as Conflict[],
  claiming: false,
  /** debug: stop sending putstate, as if this tab were asleep */
  muteReports: false,

  // control
  commanded: emptyCommanded() as Commanded,
  actual: emptyMetrics() as Metrics,
  estop: false,
  ramping: false,

  // devices
  fitness: null as FitnessDevice | null,
  hrm: null as FitnessDevice | null,
  registered: [] as DeviceRow[],
  bluetoothReason: bluetoothUnavailableReason(),

  // game hosting
  hosting: false,
  expanded: false,
  gameUrl: null as string | null,

  // debug
  lastGetState: null as unknown,
  lastPutRequest: null as unknown,
  lastPutResponse: null as unknown,
  log: [] as RoundTrip[],
})

/** Short id shown next to the label so two tabs can be told apart. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 4) : '????'
}

export function setLabel(label: string): void {
  store.label = label.trim().slice(0, 60) || defaultLabel()
  lsSet(LS_LABEL, store.label)
}

// ---------------------------------------------------------------------------
// UI preferences

export function setTheme(theme: Theme): void {
  store.theme = theme
  lsSet(LS_THEME, theme)
  applyTheme()
}
/** data-theme="light|dark" on <html>; unset for 'system' so the CSS falls back to prefers-color-scheme. */
export function applyTheme(): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (store.theme === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', store.theme)
}
export function setDevTools(on: boolean): void {
  store.devTools = on
  lsSet(LS_DEVTOOLS, on ? '1' : '0')
  if (!on && (store.tab === 'debug' || store.tab === 'ftms')) store.tab = 'session'
}
export function setTechDetails(on: boolean): void {
  store.techDetails = on
  lsSet(LS_TECH, on ? '1' : '0')
}
export function openWizard(): void {
  store.wizardOpen = true
  store.wizardStep = 'connect'
  store.tab = 'session'
}
export function closeWizard(): void {
  store.wizardOpen = false
  store.wizardStep = 'connect'
}

// ---------------------------------------------------------------------------
// logging

function logRT(kind: RoundTrip['kind'], t0: number, ok: boolean, status: number, note = ''): void {
  store.log.push({ t: Date.now(), kind, ms: Math.round(performance.now() - t0), ok, status, note })
  if (store.log.length > 50) store.log.splice(0, store.log.length - 50)
}

function noteError(e: unknown, kind: RoundTrip['kind'], t0: number): void {
  if (e instanceof ApiError) {
    if (e.status === 401) store.needLogin = true
    store.lastError = `${kind}: ${e.status} ${e.code}`
    logRT(kind, t0, false, e.status, e.message)
  } else if (isAbort(e)) {
    store.lastError = `${kind}: timeout`
    logRT(kind, t0, false, 0, 'timeout')
  } else {
    store.lastError = `${kind}: ${(e as Error)?.message ?? String(e)}`
    logRT(kind, t0, false, 0, store.lastError)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// lifecycle

let running = false
let tickTimer: ReturnType<typeof setInterval> | null = null
let startedAt = 0

export function start(): void {
  if (running) return
  running = true
  startedAt = performance.now()
  applyTheme()
  startWakeLock()
  void fetchMe()
  void refreshDevices()
  void pollLoop()
  restoreSimulators()
  lastTick = performance.now()
  tickTimer = setInterval(tick, TICK_MS)
  window.addEventListener('pagehide', sendLeave)
}

/** Tell the server this page is going away so another bridge can take control at once (not after 5 s). */
function sendLeave(): void {
  try {
    const blob = new Blob([JSON.stringify({ bridgeId: store.bridgeId })], { type: 'text/plain' })
    navigator.sendBeacon('/bridgeapi/leave', blob)
  } catch { /* best effort */ }
}

export function stop(): void {
  running = false
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
}

export async function fetchMe(): Promise<void> {
  const t0 = performance.now()
  try {
    const me = await api<{ unitSystem: UnitSystem }>('/api/me')
    store.unitSystem = me.unitSystem === 'us' ? 'us' : 'metric'
    store.needLogin = false
    logRT('me', t0, true, 200)
  } catch (e) {
    noteError(e, 'me', t0)
  }
}

export function loginUrl(mode: 'stub' | 'oidc' = 'stub'): string {
  const next = encodeURIComponent(location.pathname + location.hash)
  if (mode === 'oidc') return `/login?next=${next}`
  return `/login?uid=${encodeURIComponent(store.loginUid || '1')}&next=${next}`
}

// ---------------------------------------------------------------------------
// getstate long-poll

// Bumped whenever this bridge's device set changes, so a response computed for the old devices
// (e.g. a long-poll that started before "Connect") cannot mark the new device as owner.
let deviceEpoch = 0

function applyStanding(st: Partial<Standing> | null | undefined, epoch: number): void {
  if (!st || epoch !== deviceEpoch || !st.roles) return
  store.roles = { ...emptyRoles(), ...st.roles }
  store.ignoredReasons = st.ignoredReasons ?? {}
  store.conflicts = st.conflicts ?? []
  store.ignoredFitness = store.roles.fitness === 'ignored'
}

async function pollLoop(): Promise<void> {
  while (running) {
    if (store.needLogin) { await sleep(1000); continue }
    const epoch = deviceEpoch
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), GETSTATE_TIMEOUT_MS)
    const t0 = performance.now()
    try {
      const q = `bridgeId=${encodeURIComponent(store.bridgeId)}&since=${store.lastSeq}&wait=1`
      const gs = await api<GetState>(`/bridgeapi/getstate?${q}`, { signal: ctrl.signal })
      applyGetState(gs)
      applyStanding(gs, epoch)
      markGetOk()
      logRT('getstate', t0, true, 200, `seq ${gs.session?.seq ?? 0}`)
    } catch (e) {
      noteError(e, 'getstate', t0)
      await sleep(1000)
    } finally {
      clearTimeout(timer)
    }
  }
}

function markGetOk(): void {
  store.lastGetOk = performance.now()
  store.everOk = true
  store.unreachable = false
  store.needLogin = false
  store.lastError = null
}

function applyGetState(gs: GetState): void {
  store.state = gs
  store.lastGetState = gs
  const s = gs.session
  if (s) {
    if (!store.session || store.session.sessionId !== s.sessionId) {
      // new session: seq restarts at 1; a game iframe from an earlier session (kept mounted after its end so it
      // could upload its picture) must not be mistaken for this one
      store.lastSeq = s.seq
      store.endedSession = null
      if (store.hosting && (store.session || !store.gameUrl?.includes(s.sessionId))) stopHosting()
    } else {
      store.lastSeq = Math.max(store.lastSeq, s.seq)
    }
    store.session = s
    gameAgeAt = { age: s.gameAge ?? null, at: performance.now() }
    dropMismatchedSimulator(s.deviceType)
  } else {
    gameAgeAt = { age: null, at: 0 }
    if (store.session) {
      const ended = store.session
      store.session = null
      store.expanded = true // the game is over; bring the bridge UI back
      void fetchEnded(ended.sessionId)
    }
    store.lastSeq = 0
  }
  store.requested = gs.requested
  store.limits = { ...DEFAULT_LIMITS, ...gs.limits }
  store.devicePreferences = gs.devicePreferences ?? {}
  syncWakeLock()
}

/** Load the summary of a session that is no longer live (route id on a launching bridge, or the one that just ended). */
export async function fetchEnded(sessionId: string): Promise<void> {
  const t0 = performance.now()
  try {
    store.endedSession = await api<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    logRT('session', t0, true, 200, sessionId)
  } catch (e) {
    noteError(e, 'session', t0)
  }
}

// ---------------------------------------------------------------------------
// control tick

let lastTick = 0
let gameAgeAt: { age: number | null; at: number } = { age: null, at: 0 }
let lastPutAt = -Infinity
let lastSentCommanded: Commanded | null = null
let putInFlight = false

function activeDeviceType(): DeviceType | null {
  const f = store.fitness
  if (f && (f.status === 'connected' || f.status === 'simulated' || f.status === 'readonly') && f.type !== 'hrm') return f.type
  return null
}

function tick(): void {
  const now = performance.now()
  const dt = Math.min(2, Math.max(0, (now - lastTick) / 1000))
  lastTick = now

  // time since the last good getstate; before the first success, count from page start
  const sinceGet = store.lastGetOk ? now - store.lastGetOk : now - startedAt
  store.unreachable = !store.needLogin && sinceGet > UNREACHABLE_MS
  const gameSilent = gameAgeAt.age == null ? null : gameAgeAt.age + (now - gameAgeAt.at) / 1000
  store.gameSilentS = gameSilent

  const dev = store.fitness
  const type = activeDeviceType()
  const prev = store.commanded
  // Only the bridge the server confirmed as owner drives its machine. A standby bridge (another tab or
  // phone already controls the session) or an ignored device (wrong type, simulator in a real session)
  // must never move, not even for the second before the server's answer arrives.
  const inControl = store.roles.fitness === 'owner'
  let next: Commanded
  let ramping = false
  if (!dev || !type || !inControl) {
    next = emptyCommanded()
  } else if (dev.userStopped) {
    next = emptyCommanded() // the user stopped the machine on its own panel: hands off until they resume
  } else if (dev.status === 'readonly') {
    next = emptyCommanded() // the user drives the machine; we only observe
  } else if (store.estop) {
    next = emptyCommanded()
    next.speed = 0
  } else if (staleAction(type, sinceGet, gameSilent) === 'ramp') {
    next = rampDown(prev, store.limits, dt)
    ramping = next.speed != null && next.speed > 0 // a belt the game never commanded is left alone (§7.3)
  } else if (staleAction(type, sinceGet, gameSilent) === 'hold') {
    next = { ...prev } // hold the last target; do not chase a request nobody is updating
  } else {
    // (Re)gaining control of a belt that may already be moving: slew from where it is, not from 0.
    const base = type === 'treadmill' && prev.speed == null
      ? { ...prev, speed: dev.actual.speed ?? null, incline: prev.incline ?? dev.actual.incline ?? null }
      : prev
    next = process(type, store.requested, store.limits, base, dt, { ranges: dev.ranges(), allowSpeed: speedAllowed(dev.protocol, store.devicePreferences[dev.address]) })
  }
  store.ramping = ramping
  if (!commandedEqual(next, prev)) store.commanded = next

  // while E-stop is latched the driver's stop() has already handled the machine; never write targets
  if (dev && type && inControl && !dev.userStopped && dev.status !== 'readonly' && !store.estop) {
    dev.setTargets(store.commanded).catch(() => { /* logged by the driver */ })
  }

  // gather actuals
  const act = emptyMetrics()
  if (dev && type) Object.assign(act, dev.actual)
  const hr = store.hrm?.actual.heartRate
  if (hr != null) act.heartRate = hr
  if (!dev || !type) act.heartRate = hr ?? null
  store.actual = act

  // putstate schedule: 1 Hz, sooner (max 4 Hz) when commanded changed
  const changed = !commandedEqual(store.commanded, lastSentCommanded)
  const since = now - lastPutAt
  if (!putInFlight && !store.needLogin && !store.muteReports && ((changed && since >= PUT_MIN_MS) || since >= PUT_MS)) {
    void putstate(changed)
  }
}

function reportedDevices(): ReportedDevice[] {
  const out: ReportedDevice[] = []
  if (store.fitness) out.push(store.fitness.toReport())
  if (store.hrm) out.push(store.hrm.toReport())
  return out
}

export function buildPutState(urgent: boolean): PutState {
  const type = activeDeviceType()
  return {
    bridgeId: store.bridgeId,
    browserId: store.browserId,
    label: store.label,
    timestamp: Date.now() / 1000,
    devices: reportedDevices(),
    commanded: type ? { ...store.commanded } : null,
    actual: type ? { ...store.actual } : { heartRate: store.actual.heartRate },
    urgent,
  }
}

async function putstate(urgent: boolean): Promise<void> {
  putInFlight = true
  lastPutAt = performance.now()
  const epoch = deviceEpoch
  const body = buildPutState(urgent)
  lastSentCommanded = body.commanded ? { ...body.commanded } : null
  try {
    applyStanding(await sendPutState(body), epoch)
  } finally {
    putInFlight = false
  }
}

/** POST a putstate body (also used by the debug "fake putstate" form). */
export async function sendPutState(body: PutState | Record<string, unknown>): Promise<PutStateResponse | null> {
  const t0 = performance.now()
  store.lastPutRequest = body
  try {
    const res = await api<PutStateResponse>('/bridgeapi/putstate', { method: 'POST', body })
    store.lastPutResponse = res
    store.needLogin = false
    if (res.session && store.session && res.session.sessionId === store.session.sessionId) {
      store.lastSeq = Math.max(store.lastSeq, res.seq)
    }
    const standby = Object.entries(res.roles ?? {}).filter(([, v]) => v && v !== 'owner').map(([k, v]) => `${k} ${v}`)
    logRT('putstate', t0, true, 200, `seq ${res.seq}${standby.length ? ' · ' + standby.join(', ') : ''}`)
    return res
  } catch (e) {
    store.lastPutResponse = { error: (e as Error).message }
    noteError(e, 'putstate', t0)
    return null
  }
}

// ---------------------------------------------------------------------------
// prompts

/** Answer the open prompt. `rev`: the menu version the phone was showing, so the game can drop a tap aimed at an old list. */
export async function answerPrompt(promptId: string, choice: string, rev?: number): Promise<boolean> {
  const t0 = performance.now()
  try {
    const r = await api<{ accepted: boolean; reason?: string }>('/bridgeapi/sendinput', {
      method: 'POST', body: { bridgeId: store.bridgeId, promptId, choice, ...(rev != null ? { rev } : {}) },
    })
    logRT('sendinput', t0, true, 200, `${choice}${rev != null ? ' @' + rev : ''} -> ${r.accepted ? 'accepted' : 'rejected ' + (r.reason ?? '')}`)
    return r.accepted
  } catch (e) {
    noteError(e, 'sendinput', t0)
    return false
  }
}

/** The D-pad. While a running session shows a d-pad or menu prompt that offers this button, it is that prompt's
 *  answer (a menu's carries its rev); otherwise it drives Dandyhorse itself (console navigation) through
 *  /bridgeapi/remote. Fire and forget. */
export async function sendRemote(button: RemoteButton): Promise<void> {
  const p = store.state?.requestedInput
  const s = store.session
  if (p && (p.layout === 'dpad' || p.layout === 'menu') && p.choices.includes(button) && s && (s.status === 'active' || s.status === 'paused')) {
    await answerPrompt(p.promptId, button, p.layout === 'menu' ? p.rev : undefined)
    return
  }
  const t0 = performance.now()
  try {
    await api('/bridgeapi/remote', { method: 'POST', body: { bridgeId: store.bridgeId, button } })
    logRT('sendinput', t0, true, 200, `remote ${button}`)
  } catch (e) {
    noteError(e, 'sendinput', t0)
  }
}

// ---------------------------------------------------------------------------
// screen wake lock: the bridge usually runs on an old phone mounted on the machine; keep it awake while a
// session runs. Failures are ignored (unsupported browser, hidden tab, low battery).

let wakeLock: { release(): Promise<void>; addEventListener?: unknown } | null = null
let wakeWanted = false

async function requestWakeLock(): Promise<void> {
  if (wakeLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  try {
    const nav = navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> } }
    const lock = await nav.wakeLock.request('screen')
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null })
    wakeLock = lock
  } catch { /* ignored */ }
}
function releaseWakeLock(): void {
  const l = wakeLock
  wakeLock = null
  if (l) l.release().catch(() => { /* ignored */ })
}
function syncWakeLock(): void {
  const s = store.session
  wakeWanted = !!s && (s.status === 'active' || s.status === 'paused' || s.status === 'pending')
  if (wakeWanted) void requestWakeLock()
  else releaseWakeLock()
}
function startWakeLock(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', () => { if (wakeWanted && document.visibilityState === 'visible') void requestWakeLock() })
}

// ---------------------------------------------------------------------------
// safety

export async function emergencyStop(): Promise<void> {
  store.estop = true
  store.commanded = { ...emptyCommanded(), speed: 0 }
  const dev = store.fitness
  if (dev) {
    try { await dev.stop() } catch { /* driver logs */ }
  }
  await putstate(true)
}

export function clearEmergencyStop(): void {
  store.estop = false
}

/** User convenience: pause the game from this bridge; Play resumes (if the device is sending data). */
export async function pauseSession(): Promise<void> {
  const t0 = performance.now()
  try {
    await api('/bridgeapi/pause', { method: 'POST', body: { bridgeId: store.bridgeId, label: store.label } })
    logRT('session', t0, true, 200, 'pause')
  } catch (e) {
    noteError(e, 'session', t0)
  }
}
/**
 * End the session for the user from this bridge (PLAN.md §9.2 /bridgeapi/end). `complete` keeps the ride in
 * History (the game still gets to attach its picture); `discarded` drops it. The tail sees the end on its next
 * poll and shows the ended card; a hosted game is closed once the server confirms.
 */
/**
 * Play the same game again with the same variant, duration and options (from the ended session's summary).
 * The launch goes through the console API; the tail then follows the new session like any other.
 */
export async function playAgain(summary: SessionSummary): Promise<boolean> {
  const t0 = performance.now()
  const opts = (summary.options ?? {}) as { duration?: number; debug?: boolean; game?: Record<string, unknown> }
  try {
    await api('/api/sessions/launch', {
      method: 'POST',
      body: {
        gameId: summary.gameId, variant: summary.variant, deviceType: summary.deviceType,
        duration: opts.duration ?? summary.requestedDuration ?? undefined, debug: !!summary.debug, options: opts.game ?? {},
      },
    })
    logRT('session', t0, true, 200, 'play again')
    store.endedSession = null
    return true
  } catch (e) {
    noteError(e, 'session', t0)
    return false
  }
}

export async function endSession(status: 'complete' | 'discarded'): Promise<boolean> {
  const t0 = performance.now()
  try {
    await api('/bridgeapi/end', { method: 'POST', body: { bridgeId: store.bridgeId, status } })
    logRT('session', t0, true, 200, `end:${status}`)
    return true
  } catch (e) {
    noteError(e, 'session', t0)
    return false
  }
}
export async function resumeSession(): Promise<void> {
  const t0 = performance.now()
  try {
    await api('/bridgeapi/resume', { method: 'POST', body: { bridgeId: store.bridgeId } })
    logRT('session', t0, true, 200, 'resume')
  } catch (e) {
    noteError(e, 'session', t0)
  }
}
/** What the Pause/Play control should offer right now. */
export function pausePlay(): 'pause' | 'play' | null {
  const s = store.session
  if (s?.status === 'active') return 'pause'
  if (s?.status === 'paused' && s.pause?.reason === 'user') return 'play'
  return null // not running, or paused for the device (Play would not help)
}

/** Hand control back after the user stopped the machine on its own panel. */
export function resumeAfterUserStop(): void {
  store.fitness?.resumeAfterUserStop()
}

/** Take a role (normally the fitness device) away from the bridge that currently owns it. */
export async function claimRole(role: DeviceRole): Promise<boolean> {
  const t0 = performance.now()
  store.claiming = true
  const epoch = deviceEpoch
  try {
    const r = await api<GetState & { ok: boolean; reason: string | null }>('/bridgeapi/claim', {
      method: 'POST', body: { bridgeId: store.bridgeId, role },
    })
    applyStanding(r, epoch)
    logRT('putstate', t0, true, 200, `claim ${role}: ${r.ok ? 'ok' : r.reason}`)
    if (!r.ok) store.lastError = `claim ${role}: ${r.reason}`
    return r.ok
  } catch (e) {
    noteError(e, 'putstate', t0)
    return false
  } finally {
    store.claiming = false
  }
}

// ---------------------------------------------------------------------------
// devices

export async function refreshDevices(): Promise<void> {
  const t0 = performance.now()
  try {
    const r = await api<{ devices: DeviceRow[] }>('/bridgeapi/devices')
    store.registered = r.devices
    logRT('devices', t0, true, 200, `${r.devices.length} devices`)
  } catch (e) {
    noteError(e, 'devices', t0)
  }
}

export async function registerDevice(dev: FitnessDevice): Promise<void> {
  if (!dev.address) return
  const t0 = performance.now()
  try {
    await api<DeviceRow>('/bridgeapi/devices', {
      method: 'POST', body: { type: dev.type, address: dev.address, name: dev.name, protocol: dev.protocol },
    })
    logRT('devices', t0, true, 200, `registered ${dev.address}`)
  } catch (e) {
    noteError(e, 'devices', t0)
  }
  await refreshDevices()
}

export async function savePreferences(deviceId: number, preferences: Record<string, unknown>): Promise<DeviceRow | null> {
  const t0 = performance.now()
  try {
    const row = await api<DeviceRow>(`/bridgeapi/devices/${deviceId}/preferences`, { method: 'PUT', body: { preferences } })
    logRT('devices', t0, true, 200, `saved prefs for ${deviceId}`)
    await refreshDevices()
    return row
  } catch (e) {
    noteError(e, 'devices', t0)
    return null
  }
}

/** Rename a saved device (console endpoint; same cookie). */
export async function renameDevice(deviceId: number, name: string): Promise<boolean> {
  const t0 = performance.now()
  try {
    await api<DeviceRow>(`/api/devices/${deviceId}`, { method: 'PUT', body: { name } })
    logRT('devices', t0, true, 200, `renamed ${deviceId}`)
    await refreshDevices()
    return true
  } catch (e) {
    noteError(e, 'devices', t0)
    return false
  }
}
/** Forget a saved device (console endpoint). */
export async function forgetDevice(deviceId: number): Promise<boolean> {
  const t0 = performance.now()
  try {
    await api(`/api/devices/${deviceId}`, { method: 'DELETE' })
    logRT('devices', t0, true, 200, `forgot ${deviceId}`)
    await refreshDevices()
    return true
  } catch (e) {
    noteError(e, 'devices', t0)
    return false
  }
}

async function replaceFitness(dev: FitnessDevice | null): Promise<void> {
  const old = store.fitness
  if (old && old !== dev) {
    try { await old.disconnect() } catch { /* ignore */ }
  }
  store.fitness = dev ? markRaw(dev) : null
  store.commanded = emptyCommanded()
  lastSentCommanded = null
  deviceEpoch++
  store.roles = { ...store.roles, fitness: null } // unconfirmed until the server answers
}

async function replaceHrm(dev: FitnessDevice | null): Promise<void> {
  const old = store.hrm
  if (old && old !== dev) {
    try { await old.disconnect() } catch { /* ignore */ }
  }
  store.hrm = dev ? markRaw(dev) : null
  deviceEpoch++
  store.roles = { ...store.roles, hrm: null }
}

/**
 * A simulator is not a machine the user has to unplug: one restored from a previous session (or left from
 * another variant) that does not match the session's device type is simply dropped, so the wizard can offer
 * the right one instead of warning about the wrong one. Real devices keep the "not being used" banner.
 */
function dropMismatchedSimulator(sessionType: DeviceType | null | undefined): void {
  const sim = simulator()
  if (!sim || !sessionType || sim.deviceType === sessionType) return
  logRT('session', performance.now(), true, 0, `dropped the simulated ${sim.deviceType}: this session needs a ${sessionType}`)
  ssSet(SS_SIM, '')
  void replaceFitness(null).then(() => putstate(true))
}

export function simulator(): SimulatorDevice | null {
  return store.fitness instanceof SimulatorDevice ? store.fitness : null
}
export function simulatorHrm(): SimulatorHrm | null {
  return store.hrm instanceof SimulatorHrm ? store.hrm : null
}
export function ftms(): DevicelibDevice | null {
  return store.fitness instanceof DevicelibDevice ? store.fitness : null
}

export async function toggleSimulator(type: DeviceType): Promise<void> {
  const cur = simulator()
  if (cur && cur.deviceType === type) {
    await replaceFitness(null)
    ssSet(SS_SIM, '')
    void putstate(true)
    return
  }
  const dev = new SimulatorDevice(type)
  await replaceFitness(dev)
  await dev.connect()
  ssSet(SS_SIM, type)
  void putstate(true) // simulators are never saved as the user's devices
}

export async function toggleSimulatorHrm(): Promise<void> {
  if (simulatorHrm()) {
    await replaceHrm(null)
    ssSet(SS_SIM_HRM, '')
    return
  }
  const dev = new SimulatorHrm()
  await replaceHrm(dev)
  await dev.connect()
  ssSet(SS_SIM_HRM, '1')
}

/** Simulators survive a reload of this tab (the console navigates the tab to the bridge URL), never other tabs. */
function restoreSimulators(): void {
  const sim = ssGet(SS_SIM)
  if (sim === 'treadmill' || sim === 'bike') void toggleSimulator(sim)
  if (ssGet(SS_SIM_HRM) === '1') void toggleSimulatorHrm()
}

/** Needs a user gesture (Web Bluetooth chooser). Returns the device even if it ends up read-only. */
export async function connectFtms(): Promise<DevicelibDevice> {
  const dev = new DevicelibDevice('fitness')
  ssSet(SS_SIM, '')
  await replaceFitness(dev)
  try {
    await dev.connect()
  } catch (e) {
    await replaceFitness(null)
    throw e
  }
  await registerDevice(dev)
  void putstate(true)
  return dev
}

/** Attach a device connected on the Exercise device console as the session's fitness device. */
export async function adoptFtms(dev: DevicelibDevice): Promise<void> {
  ssSet(SS_SIM, '')
  await replaceFitness(dev)
  if (!dev.simulator) await registerDevice(dev) // devicelib's simulated machines are never saved as the user's devices
  void putstate(true)
}

export async function connectHrm(): Promise<DevicelibDevice> {
  const dev = new DevicelibDevice('hrm')
  ssSet(SS_SIM_HRM, '')
  await replaceHrm(dev)
  try {
    await dev.connect()
  } catch (e) {
    await replaceHrm(null)
    throw e
  }
  await registerDevice(dev)
  return dev
}

export async function disconnectFitness(): Promise<void> {
  ssSet(SS_SIM, '')
  await replaceFitness(null)
  void putstate(true)
}
export async function disconnectHrm(): Promise<void> {
  ssSet(SS_SIM_HRM, '')
  await replaceHrm(null)
}

// ---------------------------------------------------------------------------
// game hosting

export function startGame(): void {
  const s = store.session
  if (!s) return
  store.gameUrl = s.gameEntryUrl
  store.hosting = true
  store.expanded = false
  document.title = `${s.gameId} · Dandyhorse`
}
export function expandBridge(): void { store.expanded = true }
export function collapseBridge(): void { if (store.hosting) store.expanded = false }
/**
 * Hand the keyboard and gamepad at the big screen to the hosted game (games/kingdomtrek/INTEGRATION.md §4.3): called
 * when it loads, when the bridge UI collapses back to it and when the strip's sheet closes. Never while the bridge UI
 * is expanded: it would take the focus from the controls the user is looking at.
 */
export function focusGame(): void {
  if (!store.hosting || store.expanded || typeof document === 'undefined') return
  const frame = document.querySelector<HTMLIFrameElement>('iframe.game-frame')
  if (!frame) return
  try { frame.focus({ preventScroll: true }) } catch { /* ignored */ }
  try { frame.contentWindow?.focus() } catch { /* ignored: not loaded yet */ }
}
export function stopHosting(): void {
  store.hosting = false
  store.expanded = false
  store.gameUrl = null
  document.title = 'Dandyhorse Web Bridge'
}
