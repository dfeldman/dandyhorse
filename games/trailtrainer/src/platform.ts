/**
 * Trail Trainer on Dandyhorse (INTEGRATION.md): the platform side of `Controls` and `ProgressStore`.
 *
 *   machine ─► bridge ─► server ─► getstate (1 Hz) ─► measured()   = power / belt speed, as measured
 *   game ─► setstate (1 Hz): grade (bike) or incline (treadmill), score, route, custom, position, achievements
 *   game ─► putsave: { routes: { <id>: RouteProgress } }   — where you got to on each route
 *
 * Nothing here touches Babylon or the DOM, so the tests can build it in node: the session picture is handed in
 * by main.ts as an already-encoded data URL (`setImage`), because SessionClient asks for it synchronously.
 *
 * A bike also sends the speed the ride model computes, so the server can integrate distance (GAME_AUTHORING.md,
 * "Bike games also send speed"); a trainer cannot be told a speed, so this is a report, not a command. A treadmill
 * NEVER gets a speed: the runner keeps the belt and the game only tilts it.
 */
import {
  SessionClient, putSave, rivalHud,
  type EndInfo, type GameState, type Json, type Rival, type StartPayload, type TickBody,
} from '@dandyhorse/gamekit'
import { NO_READING, type Controls, type Measured } from './controls.ts'
import type { ProgressStore, RouteProgress } from './sim/progress.ts'

export const GAME_ID = 'trailtrainer'

export type DeviceType = 'bike' | 'treadmill'

/** The `others` launch option (metadata.json), as a number of people on the road. */
export const OTHERS: Record<string, number> = { none: 0, few: 3, busy: 6 }

/** A launch option, checked against what is allowed: the server fills defaults in, but never trust a stray value. */
export function option<T extends string>(options: Json | null | undefined, key: string, allowed: readonly T[], fallback: T): T {
  const v = (options as Record<string, unknown> | null | undefined)?.[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

// --- save state -------------------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** `{ routes: { <id>: RouteProgress } }` out of whatever the platform stored. Anything unreadable is no progress. */
export function parseSaveState(v: Json | null | undefined): Record<string, RouteProgress> {
  const routes = (v as { routes?: unknown } | null | undefined)?.routes
  const out: Record<string, RouteProgress> = {}
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return out
  for (const [id, raw] of Object.entries(routes as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.s !== 'number' || !Number.isFinite(r.s)) continue
    out[id] = {
      s: Math.max(0, r.s),
      elapsed: Math.max(0, num(r.elapsed)),
      sessions: Math.max(0, Math.round(num(r.sessions))),
      updated: typeof r.updated === 'string' ? r.updated : new Date(0).toISOString(),
      completed: r.completed === true,
    }
  }
  return out
}

/**
 * Progress kept in the session's save state rather than in this browser. `write` is called with the whole save
 * state on every change (ProgressTracker writes every `Config.saveEvery` seconds and when the page goes away);
 * pass null for a debug session, which keeps the progress in memory and never writes it, as Night Watch does.
 */
export class PlatformProgress implements ProgressStore {
  private readonly routes: Record<string, RouteProgress>
  private readonly write: ((state: Json) => void) | null

  constructor(saveState: Json | null | undefined, write: ((state: Json) => void) | null) {
    this.routes = parseSaveState(saveState)
    this.write = write
  }

  /** The save state as it would be written now. */
  state(): Json { return { routes: { ...this.routes } } }

  all(): Record<string, RouteProgress> { return this.routes }
  get(routeId: string): RouteProgress | null { return this.routes[routeId] ?? null }

  put(routeId: string, progress: RouteProgress): void {
    this.routes[routeId] = { ...progress }
    this.flush()
  }

  clear(routeId: string): void {
    delete this.routes[routeId]
    this.flush()
  }

  private flush(): void {
    try { this.write?.(this.state()) } catch { /* a lost write loses a resume point, not the ride */ }
  }
}

/** The usual writer: putsave for this game and variant, errors logged rather than thrown. */
export const putSaveWriter = (variant: string, log: (line: string) => void) => (state: Json): void => {
  void putSave(GAME_ID, variant, state).catch((e: unknown) => log(`putsave: ${e instanceof Error ? e.message : String(e)}`))
}

// --- setstate ---------------------------------------------------------------------------------------

/**
 * The metric part of a tick, per machine (metadata.json `controls`): a bike's grade plus its virtual speed (for the
 * server's distance), a treadmill's incline and never a speed.
 */
export function targets(deviceType: DeviceType, requestPercent: number, virtualSpeed: number | null = null): TickBody {
  const r = Math.round(requestPercent * 10) / 10
  if (deviceType === 'treadmill') return { incline: r }
  return virtualSpeed === null ? { grade: r } : { grade: r, speed: Math.max(0, Math.round(virtualSpeed * 100) / 100) }
}

export interface RideReport {
  /** metres along the route */
  s: number
  /** the trail's own grade here, rise over run */
  grade: number
  /** the rider's speed along the route, m/s (the ride model's own on a bike) */
  speed: number
  /** metres above sea level */
  elevation: number
  /** route-frame metres (x east, z north, y up) */
  x: number
  y: number
  z: number
  finished: boolean
}

export interface TickInput {
  deviceType: DeviceType
  routeId: string
  request: number
  report: RideReport | null
  routeLength: number
}

/** One setstate body. Pure, so the tests can pin "grade for a bike, incline for a treadmill, never speed". */
export function tickBody(i: TickInput): TickBody {
  const r = i.report
  const body: TickBody = { ...targets(i.deviceType, i.request, r ? r.speed : null), route: i.routeId }
  if (r) {
    body.score = Math.round(r.s)
    body.custom = {
      s: Math.round(r.s),
      km: Math.round(r.s / 10) / 100,
      toGo: Math.max(0, Math.round(i.routeLength - r.s)),
      grade: Math.round(r.grade * 1000) / 10,
      elevation: Math.round(r.elevation),
      finished: r.finished,
    }
    body.x = Math.round(r.x * 10) / 10
    body.y = Math.round(r.y * 10) / 10
    body.z = Math.round(r.z * 10) / 10
  }
  return body
}

// --- the session ------------------------------------------------------------------------------------

export interface PlatformOptions {
  routeId: string
  routeLength: number
  /** where this session started on the route, metres (for the "resumed" achievement) */
  startAt: number
  log?: (line: string) => void
  /** for tests: replaces the real SessionClient */
  client?: (opts: ConstructorParameters<typeof SessionClient>[0]) => SessionClient
}

export class PlatformControls implements Controls {
  readonly start: StartPayload
  readonly deviceType: DeviceType
  /** seconds the session is meant to last, or null when the platform did not say */
  readonly duration: number | null
  readonly routeId: string
  readonly client: SessionClient

  /** Called once when the session ends, from any side (main.ts saves and says so). */
  onEnded: ((info: EndInfo) => void) | null = null

  private readonly routeLength: number
  private readonly startAt: number
  private readonly log: (line: string) => void
  private latest: GameState | null = null
  private grade = 0
  private report_: RideReport | null = null
  private localActive = 0
  private endInfo: EndInfo | null = null
  private image: string | null = null
  private completing = false
  /** Somebody who rode this same route before, and the voice for the climb (PLAN.md §18.3). */
  private rival: Rival | null = null

  // achievements, sent once each and re-queued if the tick carrying them failed
  private readonly earned = new Set<string>()
  private readonly pending: string[] = []
  private sent: string[] = []

  constructor(start: StartPayload, opts: PlatformOptions) {
    this.start = start
    this.deviceType = start.deviceType === 'treadmill' ? 'treadmill' : 'bike'
    this.duration = typeof start.requestedDuration === 'number' && start.requestedDuration > 0 ? start.requestedDuration : null
    this.routeId = opts.routeId
    this.routeLength = opts.routeLength
    this.startAt = opts.startAt
    this.log = opts.log ?? ((line) => console.log('trailtrainer:', line))
    // the server stores them as "<gameId>:<id>"
    const mine = `${GAME_ID}:`
    for (const id of Object.keys(start.achievements ?? {})) if (id.startsWith(mine)) this.earned.add(id.slice(mine.length))

    const clientOpts: ConstructorParameters<typeof SessionClient>[0] = {
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s },
      onPause: (p) => this.log(`paused: ${p.reason} — ${p.message}`),
      onResume: (secs) => this.log(`resumed after ${secs.toFixed(0)} s`),
      onEnded: (e) => {
        if (this.endInfo) return
        this.endInfo = e
        this.log(`ended: ${e.status} (${e.reason ?? 'no reason'})`)
        this.onEnded?.(e)
      },
      onError: (ctx, err) => this.log(`${ctx}: ${err instanceof Error ? err.message : String(err)}`),
      onTick: (ok) => { if (!ok) this.pending.unshift(...this.sent); this.sent = [] },
      sessionImage: () => this.image,
    }
    this.client = opts.client ? opts.client(clientOpts) : new SessionClient(clientOpts)
  }

  /** Starts the tick and poll loops, once the world is built and the ride is about to start. */
  attach(): void {
    if (this.startAt > 50) this.achievement('resumed')
    this.client.start()
    // A rider who has been up this same road before (PLAN.md §18.3). The route is the match, so Alpe d'Huez
    // is never compared with the Katy Trail. A debug ride is not recorded, so it is not raced either.
    if (!this.start.debug) {
      void rivalHud(this.start.sessionId, {
        imperial: this.start.unitSystem === 'us',
        plannedSeconds: this.duration,
        route: this.routeId,
        words: { routeMetres: 'metre', climbed: 'metre climbed' },
        corner: 'left',
        log: this.log,
      }).then((r) => { this.rival = r })
    }
  }

  // --- Controls ---------------------------------------------------------------------------------------

  /** What the machine measured, straight from getstate: null where there is no reading, never a zero for one. */
  measured(): Measured {
    const s = this.latest
    if (!s) return NO_READING
    const actual = (k: 'power' | 'speed' | 'cadence' | 'heartRate'): number | null => {
      const v = s[k]?.actual
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    }
    return { power: actual('power'), speed: actual('speed'), cadence: actual('cadence'), heartRate: actual('heartRate') }
  }

  paused(): boolean { return this.client.paused }

  /** The server's own words for why the session is paused, or null. */
  pauseMessage(): string | null { return this.client.paused ? (this.latest?.pause?.message ?? null) : null }

  /** The server's active seconds (pauses excluded) once it has said, the local active clock before that. */
  elapsedSeconds(): number {
    const a = this.latest?.activeSeconds
    return typeof a === 'number' && Number.isFinite(a) ? a : this.localActive
  }

  request(gradePercent: number): void {
    if (Number.isFinite(gradePercent)) this.grade = gradePercent
  }

  /** what the machine was last asked for */
  requested(): number { return this.grade }

  ended(): boolean { return this.endInfo !== null }

  endedInfo(): EndInfo | null { return this.endInfo }

  // --- the page tells us what happened ----------------------------------------------------------------

  /** Every frame: where the rider is, and whether the ride clock ran. */
  report(r: RideReport, dt: number, active: boolean): void {
    this.report_ = r
    if (active) this.localActive += dt
    if (r.s - this.startAt > 100 || (r.finished && r.s > this.startAt)) this.achievement('first-session')
    if (r.s >= 10_000) this.achievement('ten-k')
    if (r.s >= 100_000) this.achievement('hundred-k')
    if (r.finished) {
      this.achievement('end-to-end')
      if (this.routeId === 'alpe-dhuez') this.achievement('summit')
    }
  }

  /** The session's time is up: `requestedDuration` ends the session, not the route (INTEGRATION.md §5). */
  timeUp(): boolean {
    return this.duration !== null && !this.ended() && this.elapsedSeconds() >= this.duration
  }

  /** The picture History shows, already encoded; refreshed by main.ts every few seconds and at the end. */
  setImage(dataUrl: string | null): void {
    if (dataUrl) this.image = dataUrl
  }

  /** End the session `complete`: flush one last tick (score, achievements), then endsession with the image. */
  async complete(reason?: string): Promise<void> {
    if (this.completing || this.ended()) return
    this.completing = true
    await this.client.requestTick()
    const message = this.message()
    this.rival?.remove()
    await this.client.end('complete', reason, { message })
  }

  // --- achievements -----------------------------------------------------------------------------------

  private achievement(id: string): void {
    if (this.earned.has(id)) return
    this.earned.add(id)
    this.pending.push(id)
  }

  // --- setstate ---------------------------------------------------------------------------------------

  /** Exposed for tests. */
  buildTick(): TickBody | null {
    const body = tickBody({
      deviceType: this.deviceType,
      routeId: this.routeId,
      request: this.grade,
      report: this.report_,
      routeLength: this.routeLength,
    })
    // How far up the road, and how much of it was upwards (PLAN.md §18.2). The platform counts the climbing
    // itself, but a rider wants it beside the distance as the ride goes on, so it is a progress counter too.
    const r = this.report_
    if (r) {
      const along = Math.round(r.s)
      const climbed = Math.round(this.latest?.elevationGain ?? 0)
      this.client.countStats({ routeMetres: along, climbed, finished: r.finished })
      body.custom = { ...body.custom, routeMetres: along, climbed }
      this.rival?.update(this.latest?.activeSeconds ?? 0,
                         { distance: along, progress: { routeMetres: along, climbed } })
    }
    if (this.pending.length) { this.sent = this.pending.splice(0); body.achievements = this.sent }
    return body
  }

  /** The line this ride leaves on the player's timeline (PLAN.md §18.2). */
  private message(): string {
    const r = this.report_
    const imperial = this.start.unitSystem === 'us'
    const far = (m: number): string => imperial ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`
    const along = Math.round(r?.s ?? 0)
    const climbed = Math.round(this.latest?.elevationGain ?? 0)
    const hill = climbed > 20 ? `, ${climbed} m of it upwards` : ''
    const theirs = this.rival?.theirs()
    const who = this.rival?.player?.firstName || this.rival?.player?.username
    if (r?.finished) return `Finished ${this.routeId}${hill}.`
    if (who && theirs && typeof theirs.progress.routeMetres === 'number') {
      const gap = along - theirs.progress.routeMetres
      return gap >= 0
        ? `${far(along)} up ${this.routeId}${hill} — ${far(gap)} further than ${who}.`
        : `${far(along)} up ${this.routeId}${hill}; ${who} got ${far(-gap)} further.`
    }
    return `${far(along)} up ${this.routeId}${hill}.`
  }
}
