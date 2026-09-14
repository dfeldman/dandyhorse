/**
 * Kingdom Trek on Dandyhorse (INTEGRATION.md). Owns gamekit's SessionClient and talks to the game only through the
 * engine (step, choices, snapshot and its events) and the choice panel (press, pick, highlight):
 *
 * - effort from getstate: the machine or heart rate against the player's steady pace (gamekit's EffortMeter);
 * - the choice list mirrored to the phone as a menu prompt, and the phone's taps back as presses and picks;
 * - the hero: from the start payload, written with putsave on every checkpoint, every 30 s and at the end;
 * - pauses both ways: the game's ⏸ pauses the session, a bridge's ⏸ opens the game's pause menu, Play closes it;
 * - the end: Save and exit ends the session; an end from anywhere else saves and shows the farewell card;
 * - each tick: the hero's place on the map, the adventure's title, kingdoms saved, achievements, Hills targets.
 */
import { EffortMeter, SessionClient, putSave, startSession } from '@dandyhorse/gamekit'
import type { EndInfo, GameState, InputAnswer, Json, PauseInfo, StartPayload, TickBody, UnitSystem } from '@dandyhorse/gamekit'
import type { GameIndex } from './content/types.ts'
import type { EffortSource } from './effort.ts'
import { clock } from './effort.ts'
import type { Press } from './engine/choice.ts'
import type { Engine, GameEvent } from './engine/engine.ts'
import * as R from './engine/rules.ts'
import { newSave, parseSave, resetAdventure } from './engine/save.ts'
import type { SaveState } from './engine/save.ts'
import { MenuMirror, phoneAction } from './mirror.ts'
import { mapPosition, roadGrade } from './road.ts'

export const GAME_ID = 'kingdomtrek'
/** Between checkpoints, write the hero at least this often (seconds). */
const SAVE_EVERY_S = 30
/** A list or highlight change reaches the phone this soon (ms), so bursts stay under the platform's 10 Hz. */
const PUSH_AFTER_MS = 100
/** A pause or resume the server hasn't confirmed after this long (ms) is asked again. */
const PAUSE_RETRY_MS = 3000
/** A Play that follows our own resume this soon (ms) is ours, not a bridge's: it must not close a menu. */
const OWN_RESUME_MS = 5000
/** Where a save the game could not read is kept (this browser only) before a new hero replaces it. */
const UNREADABLE_KEY = 'kingdomtrek.save.unreadable'
/** Where a session that used developer tools checkpoints instead of the player's hero. */
const DEV_SAVE_KEY = 'kingdomtrek.save.debug'

/** What the platform needs from the page. */
export interface PlatformHooks {
  engine: Engine
  effort: EffortSource
  /** A button press, exactly as a key would do it (Left/Right scroll a journal page). */
  press(p: Press): void
  /** Highlight this option, then select it (a phone tapped it). */
  pick(id: string): void
  /** The option the big screen has highlighted. */
  highlighted(): string | null
  toast(text: string): void
  /** The session is over, from here or from anywhere else: show the farewell card and stop taking input. */
  ended(info: EndInfo): void
  /** The session's picture for History: a 640×360 PNG or JPEG data URL. */
  sessionImage(): string | null
  log(line: string): void
}

/** What the HUD shows for the session. */
export interface WorkoutStatus {
  /** "⏱ 32:10 left", "⏱ Time's up", or the time so far when no duration was chosen. */
  clock: string
  /** Where effort is coming from: 🚴, 🏃 or ❤️. */
  icon: string
  /** One line for the player when something needs saying: a pause from a bridge, a missing reading. */
  notice: string | null
}

/**
 * The hero from the start payload, or a new one seeded with the session's seed. A hero whose adventure is no longer
 * in the index keeps everything but starts the next one; a save the game can't read is kept in this browser before a
 * new hero replaces it.
 */
export function saveFromStart(start: StartPayload, index: GameIndex): { save: SaveState; fresh: boolean } {
  if (start.saveState) {
    try {
      const save = parseSave(start.saveState)
      if (!index.games.some((g) => g.id === save.gameId)) resetAdventure(save, R.nextGameId(save, index))
      return { save, fresh: false }
    } catch {
      try {
        localStorage.setItem(UNREADABLE_KEY, JSON.stringify(start.saveState))
      } catch {
        // private mode: nothing more we can do
      }
    }
  }
  return { save: newSave(index.games[0].id, start.seed >>> 0), fresh: true }
}

export class Platform {
  readonly start: StartPayload
  /** Launch options (metadata.json): what turns the workout into effort, and whether the game sets the hills. */
  readonly prefer: 'machine' | 'heartRate'
  readonly hills: boolean
  /** A developer tool changed the game (effort, time, the save): from then on the player's hero is not written. */
  tainted = false
  private readonly client: SessionClient
  // Seconds since 1970: a tap the phone aimed at the list before a reload can't match a rev after it.
  private readonly mirror = new MenuMirror(Math.floor(Date.now() / 1000))
  private hooks: PlatformHooks | null = null
  private latest: GameState | null = null
  private receivedAt = 0
  private endedInfo: EndInfo | null = null
  private finishing = false
  private pushed = ''
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private pauseSent: { paused: boolean; at: number } | null = null
  private resumeAskedAt = -Infinity
  private sinceSave = 0
  private saving: Promise<void> | null = null
  private dirty = false
  private timeUp: 'no' | 'waiting' | 'shown' = 'no'
  private readonly earned = new Set<string>()
  private readonly queue: string[] = []
  private sent: string[] = []

  /** startsession with the id the bridge put in the URL; after a reload it rejoins the same session. */
  static async open(sessionId: string): Promise<Platform> {
    return new Platform(await startSession({ sessionId }))
  }

  constructor(start: StartPayload) {
    this.start = start
    this.prefer = start.options?.effortFrom === 'heartRate' ? 'heartRate' : 'machine'
    this.hills = start.options?.hills === 'on'
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => {
        this.latest = s
        this.receivedAt = performance.now()
        this.hooks?.effort.update(s)
      },
      onInput: (a) => this.onInput(a),
      onPause: (p) => this.onPause(p),
      onResume: () => this.onResume(),
      onEnded: (e) => this.onEnded(e),
      onError: (ctx, err) => this.hooks?.log(`${ctx}: ${err instanceof Error ? err.message : String(err)}`),
      onTick: (ok) => {
        if (!ok) this.queue.unshift(...this.sent)
        this.sent = []
      },
      sessionImage: () => this.hooks?.sessionImage() ?? null,
    })
  }

  get debug(): boolean {
    return this.start.debug
  }

  get unitSystem(): UnitSystem {
    return this.start.unitSystem
  }

  get isEnded(): boolean {
    return !!this.endedInfo
  }

  /** The game is built: measure the workout and start talking to the server. */
  attach(hooks: PlatformHooks): void {
    this.hooks = hooks
    const s = this.start
    hooks.effort.attach(new EffortMeter({
      deviceType: s.deviceType,
      prefer: this.prefer,
      bodyData: s.bodyData,
      preferences: { global: s.preferences?.global ?? {}, device: s.preferences?.device ?? {} },
    }), s.unitSystem)
    this.client.start()
  }

  /** Game time stops while the session is paused or over: fights hold, the road stops. The menus keep working. */
  frozen(): boolean {
    return this.client.paused || !!this.endedInfo
  }

  /**
   * From the game's own 10 Hz timer, never from animation frames (they stop in a hidden tab, and the bridge's tab is
   * often hidden): the save clock, the phone following the list and the highlight, pauses following both ways, and
   * the planned time.
   */
  update(dt: number): void {
    this.sinceSave += dt
    if (this.sinceSave >= SAVE_EVERY_S) {
      this.sinceSave = 0
      void this.save()
    }
    const h = this.hooks
    if (!h || this.endedInfo) return
    const key = `${this.mirror.sync(h.engine.choices())}|${h.highlighted() ?? ''}`
    if (key !== this.pushed) {
      this.pushed = key
      this.pushSoon()
    }
    this.syncPause()
    this.checkTime()
  }

  /** The engine's events. */
  onEvent(ev: GameEvent): void {
    const e = this.hooks?.engine
    if (!e) return
    if (ev.type === 'checkpoint') void this.save()
    else if (ev.type === 'exit') void this.finish()
    else if (ev.type === 'arrive' && this.timeUp === 'waiting') {
      this.timeUp = 'shown'
      e.openMenu({ timeUp: true })
    } else if (ev.type === 'levelUp') {
      this.achieve('kingdom-saved')
      if ([2, 5, 10].includes(ev.level)) this.achieve(`level-${ev.level}`)
    } else if (ev.type === 'craft') this.achieve('first-craft')
  }

  /** A developer tool was used: stop writing the player's hero (INTEGRATION.md §6). */
  taint(): void {
    if (this.tainted) return
    this.tainted = true
    this.hooks?.toast("🛠 Developer tools used: this session won't save your hero")
  }

  /** Seconds of exercise so far, pauses excluded, carried forward between polls. */
  activeSeconds(): number {
    const s = this.latest
    if (!s) return 0
    const base = s.activeSeconds ?? Math.max(0, (s.elapsed ?? 0) - (s.pausedSeconds ?? 0))
    return base + (s.sessionStatus === 'active' ? (performance.now() - this.receivedAt) / 1000 : 0)
  }

  status(): WorkoutStatus {
    const dur = this.start.requestedDuration
    const so = this.activeSeconds()
    const text = !dur ? `⏱ ${clock(so)}` : so < dur ? `⏱ ${clock(dur - so)} left` : "⏱ Time's up"
    const r = this.hooks?.effort.readout() ?? null
    const icon = r?.source === 'heartRate' ? '❤️' : this.start.deviceType === 'treadmill' ? '🏃' : '🚴'
    const pause = this.client.paused ? this.latest?.pause : null
    // Our own pause shows the game's pause menu; any other pause says why. Otherwise a missing reading, if any.
    const notice = this.endedInfo ? null : pause && (pause.reason !== 'user' || pause.bridgeId) ? pause.message : r?.note ?? null
    return { clock: text, icon, notice }
  }

  // --- saving ------------------------------------------------------------------------------------

  /** Write the hero. One request at a time; a checkpoint that arrives meanwhile is written right after. */
  save(): Promise<void> {
    this.dirty = true
    this.saving ??= this.flush().finally(() => {
      this.saving = null
    })
    return this.saving
  }

  private async flush(): Promise<void> {
    const h = this.hooks
    while (h && this.dirty) {
      this.dirty = false
      const blob = h.engine.snapshot()
      if (this.tainted) {
        try {
          localStorage.setItem(DEV_SAVE_KEY, JSON.stringify(blob))
        } catch {
          // private mode
        }
        continue
      }
      try {
        await putSave(GAME_ID, this.start.variant, blob as unknown as Json)
      } catch (err) {
        h.log(`putsave: ${err instanceof Error ? err.message : String(err)}`)
        return // the next checkpoint, or the 30 s clock, tries again
      }
    }
  }

  /** The page is going away: the last checkpoint rides a beacon (putsave accepts POST). */
  beacon(): void {
    const h = this.hooks
    if (!h || this.tainted) return
    try {
      const body = JSON.stringify({ game: GAME_ID, variant: this.start.variant, saveState: h.engine.snapshot() })
      navigator.sendBeacon('/gameapi/putsave', new Blob([body], { type: 'application/json' }))
    } catch {
      // best effort: checkpoints are frequent
    }
  }

  // --- the end -----------------------------------------------------------------------------------

  /** Save and exit: the hero first, then the last tick (score, achievements), then the end with the picture. */
  private async finish(): Promise<void> {
    if (this.finishing || this.endedInfo) return
    this.finishing = true
    await this.save()
    await this.client.requestTick()
    await this.client.end('complete')
  }

  private onEnded(info: EndInfo): void {
    if (this.endedInfo) return
    this.endedInfo = info
    this.client.prompt = null
    // Wherever the end came from (a bridge's End, the console, a newer game, the reaper), the hero stays where they
    // are. A discarded session keeps its progress too: the exercise was real (INTEGRATION.md §12).
    void this.save()
    this.hooks?.ended(info)
  }

  // --- the phone ---------------------------------------------------------------------------------

  private buildTick(): TickBody | null {
    const h = this.hooks
    if (!h) return null
    const e = h.engine
    const s = e.save
    this.client.prompt = this.endedInfo ? null : this.mirror.prompt(e.choices(), h.highlighted())
    const body: TickBody = {
      route: e.world.game.title,
      score: s.totals.kingdomsSaved,
      custom: {
        gameId: s.gameId, level: s.level, where: R.whereText(s, e.world), mode: e.modes.map((m) => m.kind).join(' > '),
        effort: Math.round(h.effort.value() * 100) / 100, source: h.effort.readout()?.source ?? null, tainted: this.tainted,
      },
    }
    const pos = mapPosition(e)
    if (pos) Object.assign(body, { x: pos.x, y: 0, z: pos.z })
    if (this.hills) {
      // The road's grade; flat in town, in the menus and while paused.
      const g = this.client.paused ? 0 : roadGrade(e)
      if (this.start.deviceType === 'treadmill') body.incline = g
      else body.grade = g
    }
    if (this.queue.length) {
      this.sent = this.queue.splice(0)
      body.achievements = this.sent
    }
    return body
  }

  private pushSoon(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.client.requestTick()
    }, PUSH_AFTER_MS)
  }

  private onInput(a: InputAnswer): void {
    const h = this.hooks
    if (!h || this.endedInfo) return
    const act = phoneAction(a, this.mirror, h.engine.choices())
    if (!act) return
    if ('press' in act) h.press(act.press)
    else h.pick(act.pick)
    this.pushSoon()
  }

  private achieve(id: string): void {
    if (this.earned.has(id)) return
    this.earned.add(id)
    this.queue.push(id)
  }

  // --- pauses ------------------------------------------------------------------------------------

  /** A bridge's ⏸ opens the game's own pause screen. Our own pause needs nothing; a device pause just stops time. */
  private onPause(p: PauseInfo): void {
    const e = this.hooks?.engine
    if (e && p.reason === 'user' && p.bridgeId && e.top.kind !== 'menu' && e.top.kind !== 'farewell') e.openMenu()
    this.pauseSent = null
  }

  /** Play on a bridge: back to the adventure, as if Resume (or Keep playing) had been picked here. */
  private onResume(): void {
    const e = this.hooks?.engine
    if (e && performance.now() - this.resumeAskedAt > OWN_RESUME_MS) {
      for (let i = 0; i < 3 && (e.top.kind === 'menu' || e.top.kind === 'farewell'); i++) e.pop()
    }
    this.pauseSent = null
  }

  /**
   * The game's ⏸ (the pause menu, or the farewell) pauses the session so a break isn't counted as exercise, and
   * leaving it resumes the session. Each side only acts when the other disagrees, so they never ping-pong.
   */
  private syncPause(): void {
    const e = this.hooks!.engine
    const c = this.client
    const gamePaused = e.top.kind === 'menu' || e.top.kind === 'farewell'
    const userPaused = c.paused && this.latest?.pause?.reason === 'user'
    const want = gamePaused && !userPaused ? true : !gamePaused && userPaused ? false : null
    if (want === null) {
      this.pauseSent = null
      return
    }
    const t = performance.now()
    if (this.pauseSent?.paused === want && t - this.pauseSent.at < PAUSE_RETRY_MS) return
    this.pauseSent = { paused: want, at: t }
    if (!want) this.resumeAskedAt = t
    void c.setPaused(want)
  }

  /** The planned time is up: say so once, and offer End session at the next town (never in a fight). */
  private checkTime(): void {
    const dur = this.start.requestedDuration
    if (!dur || this.timeUp !== 'no' || this.activeSeconds() < dur) return
    this.timeUp = 'waiting'
    this.hooks?.toast("⏱ Time's up: end at the next town?")
  }
}
