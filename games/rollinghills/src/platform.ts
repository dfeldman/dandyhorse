/**
 * The platform side of the game: owns the SessionClient and implements the RhPlatform contract the
 * classic scripts read every frame. One instance per page.
 */
import {
  DEFAULT_STEADY_WATTS, EffortMeter, SessionClient, putSave, rivalHud, units,
  type EndInfo, type GameState, type Rival, type StartPayload, type TickBody,
} from '@dandyhorse/gamekit'
import { activeSeconds, guardTreadmill, machineEffort, measured, prefsWithDefaults, targets } from './drive.ts'
import type { EndedInfo, Measured, RhHandle, RhPlatform, RhStart } from './globals.d.ts'

export const GAME_ID = 'rollinghills'

export class Platform implements RhPlatform {
  readonly fmt: RhPlatform['fmt']
  readonly bests: Record<string, number>
  readonly startInfo: RhStart
  private readonly client: SessionClient
  private readonly meter: EffortMeter
  private handle: RhHandle | null = null
  private latest: GameState | null = null
  private receivedAt = 0
  private endedInfo: EndedInfo | null = null
  private finishing = false
  private readonly earned = new Set<string>()
  private readonly queue: string[] = []
  private sent: string[] = []
  // Somebody to ride against, and the voice that calls out milestones (PLAN.md §18.3). Null until the
  // platform answers, and a ride with no rival simply never gets one.
  private rival: Rival | null = null
  private lastTick: { distance: number; laps: number } = { distance: 0, laps: 0 }
  private onSegment: string | null = null
  private segments = 0

  constructor(readonly start: StartPayload, private readonly log: (line: string) => void, private readonly onEndedUi: (e: EndInfo) => void) {
    const sys = start.unitSystem
    this.fmt = {
      speed: (ms) => { const q = units.speed(ms, sys, 0); return { value: q.value === null ? '–' : q.value.toFixed(0), unit: q.unit } },
      distance: (m) => { const q = units.distance(m, sys, 2); return { value: q.value === null ? '–' : q.value.toFixed(2), unit: q.unit } },
    }
    const save = (start.saveState ?? {}) as { bests?: Record<string, number> }
    this.bests = { ...(save.bests ?? {}) }
    const prefs = prefsWithDefaults(start.options, start.preferences?.game)
    const weight = start.bodyData?.weight
    this.startInfo = {
      seed: start.seed,
      route: prefs.route,
      timeOfDay: prefs.timeOfDay,
      shadows: prefs.shadows,
      deviceType: start.deviceType,
      duration: start.requestedDuration ?? 1800,
      weightKg: typeof weight === 'number' && weight > 0 ? weight : null,
      referenceWatts: DEFAULT_STEADY_WATTS,
      debug: start.debug,
    }
    // The ride is pedalled by effort, not raw watts, so it fits the rider (docs/GAME_AUTHORING.md "Effort").
    // No smoothing of our own on the bike: the trainer smooths, and the bike's own mass and drag are all the
    // lag this ride wants — a rider whose steady pace is the default then rides exactly as they did before.
    this.meter = new EffortMeter({
      deviceType: start.deviceType,
      bodyData: start.bodyData,
      preferences: { global: start.preferences.global, device: start.preferences.device },
      smoothing: { power: 0 },
    })
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s; this.receivedAt = Date.now(); this.meter.update(s, Date.now() / 1000) },
      onPause: (p) => this.log(`paused: ${p.reason} — ${p.message}`),
      onResume: (secs) => this.log(`resumed after ${secs.toFixed(0)} s`),
      onEnded: (e) => { this.endedInfo = { status: e.status, reason: e.reason }; this.log(`ended: ${e.status} (${e.reason ?? 'no reason'})`); this.onEndedUi(e) },
      onError: (ctx, err) => this.log(`${ctx}: ${err instanceof Error ? err.message : String(err)}`),
      onTick: (ok) => { if (!ok) { this.queue.unshift(...this.sent) } this.sent = [] },
      sessionImage: () => this.handle?.sessionImage() ?? null,
    })
  }

  /** Called once the world exists; starts the tick and poll loops. */
  attach(handle: RhHandle): void {
    this.handle = handle
    this.client.start()
    // Debug rides are not recorded, so they are not raced either; nothing else waits on this.
    if (!this.start.debug) {
      void rivalHud(this.start.sessionId, {
        imperial: this.start.unitSystem === 'us',
        plannedSeconds: this.startInfo.duration,
        words: { laps: 'lap' },
        corner: 'left',
        log: this.log,
      }).then((r) => { this.rival = r })
    }
  }

  // --- RhPlatform (read by the game every frame) ---------------------------------------------
  measured(): Measured {
    const readout = this.meter.readout(Date.now() / 1000)
    return measured(this.latest, this.start.deviceType, machineEffort(readout, this.start.deviceType))
  }
  paused(): boolean { return this.client.paused }
  pauseMessage(): string | null { return this.latest?.pause?.message ?? null }
  activeSeconds(): number { return activeSeconds(this.latest, this.receivedAt, Date.now()) }
  ended(): EndedInfo | null { return this.endedInfo }

  saveBest = (key: string, seconds: number): void => {
    this.bests[key] = seconds
    void putSave(GAME_ID, this.start.variant, { bests: this.bests }).catch((e) => this.log(`putsave: ${String(e)}`))
  }

  achievement = (id: string): void => {
    if (this.earned.has(id)) return
    this.earned.add(id)
    this.queue.push(id)
  }

  finish = (): void => {
    if (this.finishing) return
    this.finishing = true
    // let the finish banner show, flush the last tick (score, the full-ride achievement), then end
    setTimeout(() => void this.client.requestTick().then(() => {
      const { distance, laps } = this.lastTick
      this.rival?.remove()
      return this.client.end('complete', undefined, { message: this.message(distance, laps) })
    }), 2000)
  }

  /** The line this ride leaves on the player's timeline (PLAN.md §18.2). */
  private message(distance: number, laps: number): string {
    const sys = this.start.unitSystem
    const theirs = this.rival?.theirs()
    const who = this.rival?.player?.firstName || this.rival?.player?.username
    if (who && theirs) {
      const gap = distance - theirs.distance
      const d = units.distance(Math.abs(gap), sys, 1)
      const mine = units.distance(distance, sys, 1)
      // "over 0 laps" is not a thing anybody says; a short ride is just a ride round the loop.
      const over = laps >= 1 ? `over ${laps} lap${laps === 1 ? '' : 's'}` : 'round the loop'
      return gap > 0
        ? `${mine.value ?? 0} ${mine.unit} ${over} — ${d.value ?? 0} ${d.unit} further than ${who}.`
        : `${mine.value ?? 0} ${mine.unit} ${over}, ${d.value ?? 0} ${d.unit} behind ${who}. Next time.`
    }
    const d = units.distance(distance, sys, 1)
    const where = { flat: 'the flat loop', rolling: 'the rolling loop', hilly: 'the hilly loop' }[this.startInfo.route]
      ?? 'the loop'
    const timed = this.segments > 0
      ? ` ${this.segments} timed segment${this.segments === 1 ? '' : 's'} on the way.` : ''
    if (laps >= 1) {
      return `${laps} lap${laps === 1 ? '' : 's'} of ${where}, ${d.value ?? 0} ${d.unit}.${timed}`
    }
    return `${d.value ?? 0} ${d.unit} around ${where}.${timed}`
  }

  /** The player gave up (or closed the page): end without counting it. */
  discard(reason = 'user'): Promise<void> { return this.client.end('discarded', reason) }

  // --- setstate --------------------------------------------------------------------------------
  private buildTick(): TickBody | null {
    if (!this.handle) return null
    const t = this.handle.tick()
    const body: TickBody = {
      ...targets(this.start.deviceType, t.request, t.v),
      x: t.pos.x, y: t.pos.y, z: t.pos.z,
      score: Math.round(t.dist),
      route: this.startInfo.route,
      custom: { lap: t.laps + 1, area: t.area, weather: t.weather, segment: t.segment, started: t.started, finished: t.finished, gradePercent: Math.round(t.grade * 1000) / 10 },
    }
    if (this.queue.length) { this.sent = this.queue.splice(0); body.achievements = this.sent }
    // What this ride counted, and the rival box (PLAN.md §18.2-18.3). Both ride on the 1 Hz tick: a HUD
    // box of somebody else's past ride does not need a frame-rate update.
    const laps = t.laps
    const distance = this.latest?.distance ?? t.dist
    this.lastTick = { distance, laps }
    // A timed segment counts once it is behind the rider: `segment` is its name while they are on it.
    if (this.onSegment !== null && t.segment === null) this.segments += 1
    this.onSegment = t.segment
    this.client.countStats({ laps, segments: this.segments })
    body.custom = { ...body.custom, laps }
    this.rival?.update(this.client.latest?.activeSeconds ?? 0, { distance, progress: { laps } })
    return guardTreadmill(this.start.deviceType, body)
  }
}
