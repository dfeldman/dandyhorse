/**
 * The platform side of the game: owns the SessionClient and implements the RhPlatform contract the
 * classic scripts read every frame. One instance per page.
 */
import { SessionClient, putSave, units, type EndInfo, type GameState, type StartPayload, type TickBody } from '@dandyhorse/gamekit'
import { activeSeconds, guardTreadmill, measured, prefsWithDefaults, targets } from './drive.ts'
import type { EndedInfo, Measured, RhHandle, RhPlatform, RhStart } from './globals.d.ts'

export const GAME_ID = 'rollinghills'

export class Platform implements RhPlatform {
  readonly fmt: RhPlatform['fmt']
  readonly bests: Record<string, number>
  readonly startInfo: RhStart
  private readonly client: SessionClient
  private handle: RhHandle | null = null
  private latest: GameState | null = null
  private receivedAt = 0
  private endedInfo: EndedInfo | null = null
  private finishing = false
  private readonly earned = new Set<string>()
  private readonly queue: string[] = []
  private sent: string[] = []

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
      debug: start.debug,
    }
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s; this.receivedAt = Date.now() },
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
  }

  // --- RhPlatform (read by the game every frame) ---------------------------------------------
  measured(): Measured { return measured(this.latest, this.start.deviceType) }
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
    setTimeout(() => void this.client.requestTick().then(() => this.client.end('complete')), 2000)
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
    return guardTreadmill(this.start.deviceType, body)
  }
}
