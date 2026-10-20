/**
 * The platform side of Flight Cycle: owns the SessionClient and implements the FcPlatform contract the
 * classic scripts read every frame. One instance per page.
 */
import {
  EffortMeter,
  SessionClient,
  putSave,
  rivalHud,
  units,
  type GameState,
  type Rival,
  type StartPayload,
  type TickBody,
} from '@dandyhorse/gamekit'
import { gradeFromResistance, pedalFromEffort } from './drive.ts'
import type { EndedInfo, FcHandle, FcPlatform, Formatted } from './globals.d.ts'

export const GAME_ID = 'bikeplane'
/** The island (public/js/levels.js): the route leaderboards group by. */
const ROUTE = 'isla-uno'

const seconds = (): number => performance.now() / 1000

export class Platform implements FcPlatform {
  readonly duration: number
  readonly fmt: FcPlatform['fmt']
  private readonly client: SessionClient
  private readonly meter: EffortMeter
  private handle: FcHandle | null = null
  private latest: GameState | null = null
  private receivedAt = 0
  private endedInfo: EndedInfo | null = null
  private finishing = false
  private best: number
  private readonly earned = new Set<string>()
  private readonly queue: string[] = []
  private sent: string[] = []

  constructor(readonly start: StartPayload, private readonly log: (line: string) => void) {
    const sys = start.unitSystem
    const show = (q: { value: number | null; unit: string }, digits: number): Formatted =>
      ({ value: q.value === null ? '–' : q.value.toFixed(digits), unit: q.unit })
    this.fmt = {
      speed: (ms) => show(units.speed(ms, sys, 0), 0),
      length: (m) => show(units.length(m, sys, 0), 0),
      distance: (m) => show(units.distance(m, sys, 2), 2),
    }
    this.duration = start.requestedDuration ?? 1800
    const save = (start.saveState ?? {}) as { best?: unknown }
    this.best = typeof save.best === 'number' ? save.best : 0
    // Effort is the trainer's power over the rider's steady power. No smoothing of our own: the trainer and
    // the game already smooth, and every second of lag costs rings (PLAYABILITY.md §2).
    this.meter = new EffortMeter({
      deviceType: 'bike',
      bodyData: start.bodyData,
      preferences: { global: start.preferences.global, device: start.preferences.device },
      smoothing: { power: 0, cadence: 0 },
    })
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s; this.receivedAt = Date.now(); this.meter.update(s, seconds()) },
      onPause: (p) => this.log(`paused: ${p.reason} — ${p.message}`),
      onResume: (secs) => this.log(`resumed after ${secs.toFixed(0)} s`),
      onEnded: (e) => { this.endedInfo = { status: e.status, reason: e.reason }; this.log(`ended: ${e.status} (${e.reason ?? 'no reason'})`) },
      onError: (ctx, err) => this.log(`${ctx}: ${err instanceof Error ? err.message : String(err)}`),
      onTick: (ok) => { if (!ok) this.queue.unshift(...this.sent); this.sent = [] },
      sessionImage: () => this.handle?.sessionImage() ?? null,
    })
  }

  /** Called once the world exists; starts the tick and poll loops. */
  attach(handle: FcHandle): void {
    this.handle = handle
    this.client.start()
    // Another pilot's flight round the same island (PLAN.md §18.3). Top left, clear of the rings ahead.
    if (!this.start.debug) {
      void rivalHud(this.start.sessionId, {
        imperial: this.start.unitSystem === 'us',
        plannedSeconds: this.start.requestedDuration,
        labels: { ringsHit: 'Rings' }, words: { ringsHit: 'ring' },
        corner: 'top-left',
        log: this.log,
      }).then((r) => { this.rival = r })
    }
  }

  // --- FcPlatform (read by the game every frame) ---------------------------------------------
  pedal = (): number | null => (this.latest ? pedalFromEffort(this.meter.value(seconds())) : null)
  paused = (): boolean => this.client.paused
  pauseMessage = (): string | null => this.latest?.pause?.message ?? null
  ended = (): EndedInfo | null => this.endedInfo

  activeSeconds = (): number => {
    const s = this.latest
    if (!s) return 0
    const base = s.activeSeconds ?? Math.max(0, (s.elapsed ?? 0) - (s.pausedSeconds ?? 0))
    return s.sessionStatus === 'active' ? base + Math.max(0, Date.now() - this.receivedAt) / 1000 : base
  }

  /** Another pilot's flight to chase, and the voice for this one (PLAN.md §18.3). */
  private rival: Rival | null = null
  /** The longest run of rings this flight managed, not the one in progress. */
  private bestStreak = 0

  achievement = (id: string): void => {
    if (this.earned.has(id)) return
    this.earned.add(id)
    this.queue.push(id)
  }

  finish = (): void => {
    if (this.finishing) return
    this.finishing = true
    // let the end screen show, send the last tick (score, achievements), then end with the picture
    setTimeout(() => void this.client.requestTick().then(() => {
      const message = this.message()
      this.rival?.remove()
      return this.client.end('complete', undefined, { message })
    }), 2000)
  }

  /** The line this flight leaves on the player's timeline (PLAN.md §18.2). */
  private message(): string {
    const t = this.handle?.tick()
    const hit = t?.ringsHit ?? 0
    const missed = Math.max(0, (t?.ringsPassed ?? 0) - hit)
    const theirs = this.rival?.theirs()?.progress.ringsHit
    const who = this.rival?.player?.firstName || this.rival?.player?.username
    const rings = `${hit} ring${hit === 1 ? '' : 's'} flown through`
    const clean = missed === 0 && hit > 0 ? ', not one missed' : missed > 0 ? `, ${missed} missed` : ''
    if (who && typeof theirs === 'number') {
      if (hit > theirs) return `${rings}${clean} — ${who} managed ${theirs}.`
      if (hit < theirs) return `${rings}${clean}. ${who} flew through ${theirs}.`
      return `${rings}${clean}, level with ${who}.`
    }
    if (this.bestStreak > 2) return `${rings}${clean}, ${this.bestStreak} of them in a row.`
    return `${rings}${clean}.`
  }

  saveScore = (score: number): { best: number; isNew: boolean } => {
    if (score <= this.best) return { best: this.best, isNew: false }
    this.best = score
    void putSave(GAME_ID, this.start.variant, { best: score }).catch((e) => this.log(`putsave: ${String(e)}`))
    return { best: score, isNew: true }
  }

  // --- setstate --------------------------------------------------------------------------------
  private buildTick(): TickBody | null {
    if (!this.handle) return null
    const t = this.handle.tick()
    const body: TickBody = {
      grade: gradeFromResistance(t.resistance),
      // The plane's own speed: History's distance is the flight, and its profile the plane's height (y).
      speed: t.speed,
      x: t.pos.x, y: t.pos.y, z: t.pos.z,
      score: t.score,
      route: ROUTE,
      custom: { ringsHit: t.ringsHit, ringsPassed: t.ringsPassed, streak: t.streak, lap: t.lap, turbo: t.turbo, race: t.race, flying: t.flying },
    }
    // What the flight has come to (PLAN.md §18.2). The streak is the best one of the flight, not the one
    // running now: a run of six that ended is still what the pilot did.
    this.bestStreak = Math.max(this.bestStreak, t.streak)
    this.client.countStats({
      ringsHit: t.ringsHit, ringsMissed: Math.max(0, t.ringsPassed - t.ringsHit),
      bestStreak: this.bestStreak, laps: t.lap,
    })
    body.custom = { ...body.custom, ringsHit: t.ringsHit }
    this.rival?.update(this.client.latest?.activeSeconds ?? 0,
                       { distance: this.client.latest?.distance ?? 0, progress: { ringsHit: t.ringsHit } })
    if (this.queue.length) { this.sent = this.queue.splice(0); body.achievements = this.sent }
    return body
  }
}
