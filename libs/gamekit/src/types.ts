/**
 * Types for the Dandyhorse game API (PLAN.md §6). Field names mirror the server exactly
 * (servers/api-flask/dandyhorse/api/gameapi.py). Missing values are `null`, never -1 or 0.
 * Units are SI everywhere: m, s, m/s, W, J, kg; incline and grade in percent.
 */

/** The nine metrics the server tracks (config.METRIC_NAMES), in server order. */
export const METRIC_NAMES = ['speed', 'incline', 'cadence', 'power', 'grade', 'wind', 'crr', 'cw', 'heartRate'] as const
export type MetricName = (typeof METRIC_NAMES)[number]

/** requested = what the game asked, commanded = what the bridge sent, actual = measured. */
export interface Metric {
  requested: number | null
  commanded: number | null
  actual: number | null
}

/**
 * Session lifecycle: pending → active ⇄ paused → complete | discarded (and, from the console only,
 * deleted). `paused` is NOT an end state: the server pauses a running session when no exercise-device
 * data has arrived for ~5 s (and resumes it by itself once data flows again), or when the user presses
 * Pause on a bridge (resumes when they press Play there).
 */
export type SessionStatus = 'pending' | 'active' | 'paused' | 'complete' | 'discarded' | 'deleted'

/** The only statuses after which the game stops for good. Use `isEnded()`, never `!== 'active'`. */
export const ENDED_STATUSES: readonly SessionStatus[] = ['complete', 'discarded', 'deleted']
export const isEnded = (status: SessionStatus): boolean => ENDED_STATUSES.includes(status)

export type PauseReason = 'bridge_silent' | 'device_unavailable' | 'no_data' | 'no_device' | 'user'

export interface PauseInfo {
  reason: PauseReason
  /** Written for end users: show it as-is. It can change during a pause as the situation changes. */
  message: string
  /** Server time (epoch seconds) the pause began. */
  since: number | null
  /** Seconds paused so far, as of `serverTime`. */
  seconds: number
  bridgeId: string | null
  bridgeLabel: string | null
  deviceName: string | null
  deviceStatus: string | null
}

export type DeviceType = 'treadmill' | 'bike'
/** The user's unit preference as the server stores it: `metric` (km, km/h, kg) or `us` (mi, mph, lb). */
export type UnitSystem = 'metric' | 'us'

/** D-pad buttons (PLAN.md §9.7); a d-pad prompt lists the ones it wants in `choices`. */
export const REMOTE_BUTTONS = ['up', 'down', 'left', 'right', 'select', 'back'] as const
export type RemoteButton = (typeof REMOTE_BUTTONS)[number]

/** A prompt the game asks the user to answer (setstate.requestedInput). */
export interface Prompt {
  promptId: string
  prompt: string
  choices: string[]
  /** Seconds; advisory, the server does not enforce it. */
  timeout?: number
  /** Persistent prompts stay open and every tap is delivered as a new `input`. */
  persistent?: boolean
  /** `dpad`: the bridge draws a cross for the RemoteButton names in `choices`. */
  layout?: 'buttons' | 'dpad'
}

/** An answered prompt (getstate.input / getstate.inputs). `source` is "game" or "bridge:<id>". */
export interface InputAnswer {
  promptId: string
  choice: string
  t: number
  source: string
  /** Rising per answer (getstate.inputs only): handle entries with n greater than the last one you did. */
  n?: number
}

export interface BridgeDevice {
  role: string | null
  type: string | null
  name: string
  address: string
  protocol: string | null
  status: string | null
  features?: unknown
}

export interface Bridge {
  bridgeId: string
  label: string | null
  lastSeen: number | null
  devices: BridgeDevice[]
}

export interface BodyData {
  height?: number | null
  weight?: number | null
  sex?: string | null
  age?: number | null
}

export type Json = Record<string, unknown>

// --- startsession ---------------------------------------------------------------------------

/** Launched-by-console form: the bridge put `session=` in the game URL. */
export interface StartSessionBySession {
  sessionId: string
  route?: string
}

/** Ad-hoc form (PLAN.md §5.2): a developer opened the game directly. */
export interface StartSessionAdHoc {
  gameId: string
  variant: string
  deviceType?: DeviceType
  duration?: number
  seed?: number
  debug?: boolean
  route?: string
  /** Game options (metadata.json `options`), e.g. {route: "hilly"}; missing keys get their defaults. */
  options?: Json
}

export interface StartPayload {
  sessionId: string
  gameId: string
  variant: string
  gameVersion: string
  seed: number
  requestedDuration: number | null
  username: string
  uid: number
  debug: boolean
  deviceType: DeviceType
  unitSystem: UnitSystem
  timeZone: string
  bodyData: BodyData
  achievements: Record<string, { t: string; sessionId: string }>
  /** The game options chosen at launch (PLAN.md §7.1), defaults filled in by the server. */
  options: Json
  preferences: { global: Json; device: Json; game: Json }
  saveState: Json | null
  serverTime: number
}

// --- getstate -------------------------------------------------------------------------------

export type GameState = {
  sessionId: string
  sessionStatus: SessionStatus
  endReason: string | null
  seq: number
  serverTime: number
  /** null once the session has ended. */
  elapsed: number | null
  requestedDuration: number | null
  /** Non-null only while paused. */
  pause: PauseInfo | null
  /** Total seconds paused so far. */
  pausedSeconds: number | null
  /** Wall-clock elapsed minus pauses: drive countdowns from this. */
  activeSeconds?: number
  position: { x: number; y: number; z: number } | null
  distance: number | null
  energy: number | null
  /** Joules of mechanical work; null for treadmills. */
  work: number | null
  input: InputAnswer | null
  /** The last 32 answers with a rising `n` (see InputAnswer). */
  inputs?: InputAnswer[]
  requestedInput: Prompt | null
  bridges: Bridge[]
  owner: { fitness: string | null; hrm: string | null }
  devicePreferences: Json
  custom: Json | null
} & Record<MetricName, Metric>

// --- setstate -------------------------------------------------------------------------------

export interface SetStateBody {
  sessionId: string
  timestamp: number
  speed?: number | null
  incline?: number | null
  cadence?: number | null
  power?: number | null
  grade?: number | null
  wind?: number | null
  crr?: number | null
  cw?: number | null
  heartRate?: number | null
  x?: number
  y?: number
  z?: number
  /** Game-scoped ids; the server stores `<gameId>:<id>` and ignores them in debug sessions. */
  achievements?: string[]
  /** Level-triggered: send the open prompt every tick, stop sending it to close it. */
  requestedInput?: Prompt | null
  route?: string
  score?: number
  custom?: Json
  urgent?: boolean
}

/** What a game supplies per tick; the client adds sessionId and timestamp. */
export type TickBody = Omit<SetStateBody, 'sessionId' | 'timestamp'>

export interface SetStateResponse {
  seq: number
  sessionStatus: SessionStatus
}

// --- summaries ------------------------------------------------------------------------------

export interface SessionSummary {
  sessionId: string
  uid: number
  gameId: string
  variant: string
  gameVersion: string
  deviceType: DeviceType
  seed: number
  debug: boolean
  status: SessionStatus
  endReason: string | null
  route: string | null
  score: number | null
  requestedDuration: number | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  duration: number | null
  distance: number | null
  energy: number | null
  work: number | null
  avgPower: number | null
  maxPower: number | null
  avgSpeed: number | null
  maxSpeed: number | null
  avgHr: number | null
  maxHr: number | null
  avgCadence: number | null
  elevationGain: number | null
  energySource: string | null
  sampleCount: number | null
  pausedSeconds: number | null
  hasImage?: boolean
  bodyData: BodyData
  options: Json
  hasLog: boolean
  username?: string
}

export interface TimelineRow extends Json {
  t: number
}
