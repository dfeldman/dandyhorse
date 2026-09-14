// Shared types mirroring the server contract (PLAN.md §9.2, config.py METRIC_NAMES).

export const METRIC_NAMES = ['speed', 'incline', 'cadence', 'power', 'grade', 'wind', 'crr', 'cw', 'heartRate'] as const
export type MetricName = (typeof METRIC_NAMES)[number]
export const COMMANDABLE = ['speed', 'incline', 'power', 'grade', 'wind', 'crr', 'cw'] as const
export type CommandName = (typeof COMMANDABLE)[number]

export type Metrics = Record<MetricName, number | null>
export type Commanded = Record<CommandName, number | null>

export type DeviceType = 'treadmill' | 'bike'
export type DeviceRole = 'fitness' | 'hrm'
export type DeviceStatus = 'connected' | 'connecting' | 'disconnected' | 'simulated' | 'readonly'

export function emptyMetrics(): Metrics {
  return { speed: null, incline: null, cadence: null, power: null, grade: null, wind: null, crr: null, cw: null, heartRate: null }
}
export function emptyCommanded(): Commanded {
  return { speed: null, incline: null, power: null, grade: null, wind: null, crr: null, cw: null }
}

export interface Limits {
  maxSpeed: number
  minSpeed: number
  maxIncline: number
  minIncline: number
  maxSpeedChangePerSecond: number
  maxInclineChangePerSecond: number
  speedScale: number
  inclineScale: number
  gradeCap: number
  difficulty: number
  powerOffset: number
}
export const LIMIT_KEYS: (keyof Limits)[] = [
  'maxSpeed', 'minSpeed', 'maxIncline', 'minIncline', 'maxSpeedChangePerSecond', 'maxInclineChangePerSecond',
  'speedScale', 'inclineScale', 'gradeCap', 'difficulty', 'powerOffset',
]
export const DEFAULT_LIMITS: Limits = {
  maxSpeed: 4.5, minSpeed: 0, maxIncline: 15, minIncline: 0, maxSpeedChangePerSecond: 0.5, maxInclineChangePerSecond: 1.0,
  speedScale: 1, inclineScale: 1, gradeCap: 20, difficulty: 1, powerOffset: 0,
}

/** Saved per-device preferences as the server sends them: limits, plus whether games may set the belt speed. */
export interface DevicePrefs extends Partial<Limits> {
  speedControl?: boolean
}

/** Device-reported supported ranges (SI). null when the device did not report one. */
export interface Range { min: number; max: number; step: number }
export interface DeviceRanges {
  speed?: Range | null
  incline?: Range | null
  power?: Range | null
}

export interface SessionBrief {
  sessionId: string
  status: 'pending' | 'active' | 'paused' | 'complete' | 'discarded' | 'deleted'
  endReason: string | null
  gameId: string
  variant: string
  deviceType: DeviceType
  seed: number
  debug: boolean
  seq: number
  elapsed: number
  requestedDuration: number | null
  route: string | null
  gameEntryUrl: string
  /** what the game drives on this device type: "incline" | "speed+incline" | "speed" | "grade" | "power" | "none" */
  controls?: string
  /** seconds since the game last sent setstate (null unless active) */
  gameAge?: number | null
  /** set while status is 'paused': the server saw no exercise-device data for 5 s */
  pause?: PauseInfo | null
  pausedSeconds?: number
}

export interface PauseInfo {
  reason: 'user' | 'bridge_silent' | 'device_unavailable' | 'no_data' | 'no_device'
  message: string
  since: number
  seconds: number
  bridgeId: string | null
  bridgeLabel: string | null
  deviceName: string | null
  deviceStatus: string | null
}

export interface RequestedInput {
  promptId: string
  prompt: string
  choices: string[]
  timeout?: number
  persistent: boolean
  /** 'dpad' renders up/down/left/right/ok/back as a cross; default is a list of buttons */
  layout?: 'buttons' | 'dpad'
}

export type RemoteButton = 'up' | 'down' | 'left' | 'right' | 'select' | 'back'
export const REMOTE_BUTTONS: RemoteButton[] = ['up', 'down', 'left', 'right', 'select', 'back']

export interface InputAnswer { promptId: string; choice: string; t: number; source: string }

export interface MergedMetric { requested: number | null; commanded: number | null; actual: number | null }

/** This bridge's standing for a role: owner = its device drives the session; standby = another bridge
 *  already owns the role; ignored = its device is unusable here (see ignoredReasons); null = offers nothing. */
export type RoleStanding = 'owner' | 'standby' | 'ignored' | null
export type Roles = Record<DeviceRole, RoleStanding>
export type IgnoreReason = 'wrong_device_type' | 'simulator_not_allowed'
export interface Conflict {
  role: DeviceRole
  ownerBridgeId: string | null
  ownerLabel: string | null
  ownerBrowserId: string | null
  ownerDevice: { name: string; type: string; status: string } | null
}
export interface Standing {
  roles: Roles
  ignoredReasons: Partial<Record<DeviceRole, IgnoreReason>>
  ignored: DeviceRole[]
  conflicts: Conflict[]
}
export function emptyRoles(): Roles { return { fitness: null, hrm: null } }

export interface OtherBridge {
  bridgeId: string
  browserId: string | null
  label: string | null
  lastSeen: number
  fresh: boolean
  devices: ReportedDevice[]
  roles: Roles
}

export interface GetState {
  serverTime: number
  session: SessionBrief | null
  requested: Metrics
  limits: Limits
  devicePreferences: Record<string, DevicePrefs>
  requestedInput: RequestedInput | null
  input: InputAnswer | null
  merged: Record<MetricName, MergedMetric>
  position: { x: number; y: number; z: number } | null
  distance: number | null
  energy: number | null
  work: number | null
  owner: { fitness: string | null; hrm: string | null }
  otherBridges: OtherBridge[]
}
export interface GetState extends Standing {}

export interface ReportedDevice {
  role: DeviceRole
  type: DeviceType | 'hrm'
  name: string
  address: string
  protocol: string
  status: DeviceStatus
  features?: Record<string, unknown>
  /** the user stopped the machine with its own stop button or safety key; the bridge will not restart it */
  userStopped?: boolean
}

export interface PutState {
  bridgeId: string
  browserId: string
  label: string
  timestamp: number
  devices: ReportedDevice[]
  commanded: Commanded | null
  actual: Partial<Metrics>
  urgent: boolean
}

export interface PutStateResponse extends Standing {
  seq: number
  session: SessionBrief | null
  serverTime: number
  owner: { fitness: string | null; hrm: string | null }
}

export interface DeviceRow {
  deviceId: number
  type: DeviceType | 'hrm'
  address: string
  name: string
  protocol: string
  preferences: Partial<Limits> & Record<string, unknown>
  lastSeenAt: string
  createdAt: string
}

/** Shape of GET /api/sessions/<id> (subset we use). */
export interface SessionSummary {
  sessionId: string
  status: string
  endReason: string | null
  gameId: string
  gameName?: string
  variant: string
  deviceType: DeviceType
  duration: number | null
  distance: number | null
  energy: number | null
  avgPower: number | null
  avgSpeed: number | null
  avgHr: number | null
  maxSpeed: number | null
  requestedDuration?: number | null
  debug?: boolean
  /** Launch options as stored: {duration, seed, debug, game: {...}} (PLAN.md §7.1). */
  options?: Record<string, unknown>
}

export type UnitSystem = 'metric' | 'us'
