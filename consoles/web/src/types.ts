// Shapes returned by the console API (servers/api-flask/dandyhorse/api/consoleapi.py).
// Missing values are always null.

export type UnitSystem = 'metric' | 'us'
export type DeviceType = 'treadmill' | 'bike'
export type SessionStatus = 'pending' | 'active' | 'paused' | 'complete' | 'discarded'

/** Set while a live session is paused because no exercise-device data arrived for 5 s. */
export interface PauseInfo { reason: string; message: string; since: number; seconds: number }

export interface Achievement {
  t: string
  sessionId: string
}

export interface BodyData {
  height?: number | null // m
  weight?: number | null // kg
  sex?: 'm' | 'f' | 'x' | null
  age?: number | null
}

/** A treadmill pace: belt speed and incline. */
export interface SteadyPace {
  speed: number // m/s
  incline: number // percent
}

export interface GlobalPreferences {
  defaultDuration?: number | null // seconds
  ownedDeviceTypes?: DeviceType[]
  ftp?: number | null
  maxHr?: number | null
  efficiency?: number | null
  allowSimulatorInRealSessions?: boolean
  // The Fitness panel: the player's steady pace, which effort-paced games divide the workout by (fitness.ts).
  /** W the player can hold comfortably for an hour while still able to talk in sentences */
  steadyWatts?: number | null
  /** a treadmill steady pace; on a treadmill it is used before steadyWatts */
  steadyPace?: SteadyPace | null
  restingHr?: number | null // bpm; the game assumes 60 when unset
  steadyHr?: number | null // bpm; derived from hrZones or resting and max HR when unset
  [key: string]: unknown
}

export interface Me {
  uid: number
  username: string
  displayName: string | null
  profile: Record<string, unknown>
  public: boolean
  achievements: Record<string, Achievement>
  bodyData: BodyData
  unitSystem: UnitSystem
  timeZone: string
  preferences: GlobalPreferences
  isAdmin: boolean
  /** a first Google sign-in made this account: ask for a username before anything else */
  needsHandle?: boolean
}

export interface Variant {
  id: string
  name: string
  description: string | null
  deviceTypes: DeviceType[]
  defaultDuration: number | null
  controls?: Record<string, string>
  screenshotUrl: string | null
}

export interface JsonSchemaProperty {
  type?: string
  enum?: unknown[]
  title?: string
  description?: string
  default?: unknown
  minimum?: number
  maximum?: number
}

export interface PreferencesSchema {
  properties?: Record<string, JsonSchemaProperty>
}

export interface Game {
  id: string
  name: string
  version: string
  author: string | null
  description: string | null
  capabilities: Record<string, unknown>
  screenshotUrl: string | null
  entryUrl: string
  preferencesSchema: PreferencesSchema | null
  /** Options chosen at launch (PLAN.md §7.1): one row of choices each in the launch dialog. */
  options: Record<string, GameOption>
  variants: Variant[]
  /** Names of the ids the game sends as achievements (metadata.json), for the Achievements page. */
  achievements?: Record<string, { name: string; description?: string }>
}

export interface GameOption {
  label?: string
  enum: string[]
  labels?: string[]
  default?: string
  description?: string
}

export interface GamesResponse {
  games: Game[]
  invalid?: Record<string, unknown>
}

export interface SessionSummary {
  sessionId: string
  /** seconds the session spent paused waiting for the exercise device */
  pausedSeconds?: number | null
  pause?: PauseInfo | null
  uid: number
  gameId: string
  variant: string
  gameVersion: string | null
  deviceType: DeviceType | null
  seed: number | null
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
  bodyData: BodyData
  options: Record<string, unknown>
  hasLog: boolean
  elapsed?: number
  /** catalog names (ids when the game is gone) */
  gameName?: string
  variantName?: string
  /** picture for the History gallery (the variant screenshot for now); null when there is none */
  imageUrl?: string | null
}

export interface SessionDetail extends SessionSummary {
  achievements: string[]
  gameName: string
  variantName: string
  imageUrl: string | null
}

export interface SessionsResponse {
  sessions: SessionSummary[]
  nextBefore: string | null
}

export interface BridgeDevice {
  role: string
  type: string
  name: string | null
  address: string | null
  status: string | null
  protocol?: string | null
}

export type RoleStanding = 'owner' | 'standby' | 'ignored' | null

export interface Bridge {
  bridgeId: string
  browserId?: string | null
  label: string | null
  lastSeen: number | null // epoch seconds
  fresh?: boolean
  devices: BridgeDevice[]
  roles?: { fitness: RoleStanding; hrm: RoleStanding }
  ignoredReasons?: Partial<Record<'fitness' | 'hrm', string>>
}

export interface SessionBrief {
  sessionId: string
  pause?: PauseInfo | null
  pausedSeconds?: number
  status: SessionStatus
  endReason: string | null
  gameId: string
  variant: string
  deviceType: DeviceType | null
  seed: number | null
  debug: boolean
  seq: number
  elapsed: number
  /** seconds since the game last reported; null until it starts */
  gameAge?: number | null
  requestedDuration: number | null
  route: string | null
  gameEntryUrl: string
  bridgeUrl: string
  joinUrl: string
  gameName: string
  variantName: string
}

export interface CurrentResponse {
  session: SessionBrief | null
  bridges: Bridge[]
}

export interface LaunchResponse {
  sessionId: string
  bridgeUrl: string
  joinUrl: string
  session: SessionBrief
}

export interface Metric {
  requested: number | null
  commanded: number | null
  actual: number | null
}

export interface TimelineRow {
  t: number
  elapsed: number
  position: { x: number; y: number; z: number } | null
  speed: Metric
  incline: Metric
  cadence: Metric
  power: Metric
  grade: Metric
  wind: Metric
  crr: Metric
  cw: Metric
  heartRate: Metric
  distance: number | null
  energy: number | null
  work: number | null
}

export interface TimelineResponse {
  sessionId: string
  timeline: TimelineRow[]
}

export interface DevicePreferences {
  maxSpeed?: number | null
  minSpeed?: number | null
  maxIncline?: number | null
  minIncline?: number | null
  maxSpeedChangePerSecond?: number | null
  maxInclineChangePerSecond?: number | null
  speedScale?: number | null
  inclineScale?: number | null
  gradeCap?: number | null
  difficulty?: number | null
  powerOffset?: number | null
  /** Treadmills: may games set the belt speed? Off unless switched on here (PLAN.md §9.4). */
  speedControl?: boolean
  /** Treadmills and bikes: this machine's steady watts, over the Fitness setting (e.g. a runner who rarely cycles). */
  steadyWatts?: number | null
  /** Treadmills: this machine's steady pace, used before steadyWatts. */
  steadyPace?: SteadyPace | null
  [key: string]: unknown
}

export interface Device {
  deviceId: number
  type: 'treadmill' | 'bike' | 'hrm'
  address: string | null
  name: string | null
  protocol: string | null
  preferences: DevicePreferences
  lastSeenAt: string | null
  createdAt: string
}

export interface LeaderboardRow {
  rank: number | null
  uid: number
  username: string
  sessionId: string
  gameId: string
  variant: string
  route: string | null
  value: number
  me: boolean
}

export interface LeaderboardsResponse {
  metric: string
  rows: LeaderboardRow[]
}
