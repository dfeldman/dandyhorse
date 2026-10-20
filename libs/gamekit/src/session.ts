/**
 * SessionClient: the whole conversation with the server for one session, so a game only has to
 * (1) build what it wants to send each tick and (2) react to callbacks.
 *
 *   const client = new SessionClient({ sessionId, buildTick: () => ({ incline: 3, x, y, z, score }), onState, onInput, ... })
 *   client.start()
 *
 * What it does for you (PLAN.md §5–6):
 * - long-polls getstate (`since`/`wait=1`) and calls onState with every merged state;
 * - pushes setstate once a second (and immediately after requestTick()), never two at once;
 * - tracks pauses: onPause/onResume fire exactly when the server's status changes, `paused` is readable;
 * - delivers every prompt answer once and in order (inputs ring with `n`), skipping answers older than
 *   this page load;
 * - keeps prompts level-triggered: set `prompt`, and it is sent every tick until you clear it (or its
 *   timeout passes); `answer()` for your own on-screen buttons;
 * - ends: onEnded fires once on complete/discarded/deleted from any side; end() uploads the session
 *   image (sessionImage callback) before endsession on a completed session.
 */
import * as api from './api.ts'
import { newInputs, type InputCursor } from './inputs.ts'
import { isEnded, type GameState, type InputAnswer, type PauseInfo, type Prompt, type SessionStats, type SessionSummary, type SessionStatus, type TickBody } from './types.ts'

export interface EndInfo {
  status: SessionStatus | 'discarded'
  reason: string | null
  summary: SessionSummary | null
}

export interface SessionClientOptions {
  sessionId: string
  /** What to send this tick (metrics, position, score, custom, achievements). Return null to skip a tick. */
  buildTick: () => TickBody | null
  /** Every getstate response (about 1 Hz, sooner on changes). */
  onState?: (state: GameState) => void
  /** Each new prompt answer, from the game's own buttons or any bridge, once and in order. */
  onInput?: (input: InputAnswer) => void
  onPause?: (pause: PauseInfo, state: GameState) => void
  /** `pausedSeconds` is the length of the pause that just ended. */
  onResume?: (pausedSeconds: number, state: GameState) => void
  onEnded?: (info: EndInfo) => void
  /** Transport or API errors that the client handled (it keeps running). */
  onError?: (context: string, error: unknown) => void
  /** After every setstate attempt: ok=false means that tick's body (achievements!) did not reach the server. */
  onTick?: (ok: boolean) => void
  /** A PNG/JPEG data URL for History (PLAN.md §6.7), asked for once when end('complete') is called. */
  sessionImage?: () => string | null
  /** Tick period in ms (default 1000, the server expects about 1 Hz). */
  tickMs?: number
  /** Long-poll wait in seconds, 0..2 (default 1). */
  wait?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class SessionClient {
  readonly sessionId: string
  /** The last merged state from the server (null before the first getstate). */
  latest: GameState | null = null
  /** True while the server says `paused`. */
  paused = false
  /** The open prompt; sent with every tick while set. */
  prompt: Prompt | null = null
  private promptOpenedAt = 0
  private seq = -1
  private running = false
  private ended = false
  private interval: ReturnType<typeof setInterval> | null = null
  private poll: AbortController | null = null
  private ticking = false
  private tickWanted = false
  private cursor: InputCursor = { n: null, t: null }
  private firstState = true
  private pausedSince: number | null = null
  private stats: SessionStats = {}
  private readonly opts: SessionClientOptions

  constructor(opts: SessionClientOptions) {
    this.opts = opts
    this.sessionId = opts.sessionId
  }

  get isRunning(): boolean { return this.running }
  get isEnded(): boolean { return this.ended }

  // --- what the game counted (PLAN.md §18.2) --------------------------------------------------

  /**
   * Record what the game has counted so far: `countStats({ deliveries: 7, crashes: 6 })`. Merged into what
   * is already there, sent with every tick (so a session the reaper ends keeps its numbers) and again with
   * endsession. The keys are the ones the game declares in `metadata.json.stats`.
   */
  countStats(stats: SessionStats): void {
    this.stats = { ...this.stats, ...stats }
  }

  /** What would be sent now. */
  get countedStats(): SessionStats { return { ...this.stats } }

  start(): void {
    if (this.running || this.ended) return
    this.running = true
    this.interval = setInterval(() => void this.requestTick(), this.opts.tickMs ?? 1000)
    void this.requestTick()
    void this.pollLoop()
  }

  /** Stop the loops without ending the session on the server (page unload, handing over). */
  stop(): void {
    this.running = false
    if (this.interval !== null) clearInterval(this.interval)
    this.interval = null
    this.poll?.abort()
    this.poll = null
  }

  // --- prompts --------------------------------------------------------------------------------

  /** Open a prompt (sent from the next tick on, right away). Replaces any open one. */
  openPrompt(p: Prompt): void {
    this.prompt = p
    this.promptOpenedAt = Date.now()
    void this.requestTick()
  }

  closePrompt(): void {
    if (!this.prompt) return
    this.prompt = null
    void this.requestTick()
  }

  /** The game's own on-screen button. The answer comes back through onInput like any bridge answer. */
  async answer(choice: string, rev?: number): Promise<boolean> {
    const p = this.prompt
    if (!p) return false
    try {
      return (await api.answerInput(this.sessionId, p.promptId, choice, rev ?? p.rev)).accepted
    } catch (e) {
      this.opts.onError?.('answerinput', e)
      return false
    }
  }

  // --- the game's own pause -------------------------------------------------------------------

  /**
   * Pause (true) or resume (false) the session from the game, as a bridge's ⏸ / ▶ would. The change comes back
   * through onPause / onResume like any other; resolves false if the server refused or could not be reached.
   */
  async setPaused(paused: boolean): Promise<boolean> {
    if (this.ended) return false
    try {
      await api.pauseSession(this.sessionId, paused)
      void this.requestTick()
      return true
    } catch (e) {
      this.opts.onError?.('pause', e)
      return false
    }
  }

  // --- ending ---------------------------------------------------------------------------------

  /**
   * End the session. Uploads the session image first on `complete`. Safe to call twice.
   *
   * `message` is the game's own line for the player's timeline (PLAN.md §18.2) — "Seven parcels delivered —
   * and six cars found the hard way." Compose it from the session; without one the server writes a plain
   * line. `stats` defaults to whatever countStats() has gathered.
   */
  async end(status: 'complete' | 'discarded', reason?: string,
            extra?: { stats?: SessionStats; message?: string }): Promise<void> {
    if (this.ended) return
    this.stop()
    if (extra?.stats) this.countStats(extra.stats)
    if (status === 'complete') await this.sendImage()
    const stats = Object.keys(this.stats).length > 0 ? this.stats : undefined
    try {
      const summary = await api.endSession(this.sessionId, status, reason, stats, extra?.message)
      this.finish(summary.status, summary.endReason, summary)
    } catch (e) {
      this.opts.onError?.('endsession', e)
      this.finish(status, e instanceof api.ApiError ? e.code : String(e), null)
    }
  }

  // --- the end screen (PLAN.md §6.4.1) --------------------------------------------------------

  /**
   * For a game with `capabilities.endScreen`: once the session has ended `complete`, show your summary and call this.
   * It watches the platform's end screen (about once a second) and calls `onClosed` once, when it closes: Done pressed
   * on a bridge, the player dismissing it in your game (`close()`), or the platform's timeout. Hide your summary then;
   * the bridge takes the screen back. `stop()` stops watching without closing it.
   */
  watchEndScreen(onClosed: () => void, everyMs = 1000): { close: () => Promise<void>; stop: () => void } {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      onClosed()
    }
    const poll = async (): Promise<void> => {
      if (done) return
      try {
        const s = await api.endScreenState(this.sessionId)
        if (!s.open) { finish(); return }
      } catch (e) {
        // a platform without end screens (an older server): nothing is holding the screen, so it is closed
        if (e instanceof api.ApiError && e.status === 404) { finish(); return }
        this.opts.onError?.('endscreen', e)
      }
      if (!done) timer = setTimeout(() => void poll(), everyMs)
    }
    timer = setTimeout(() => void poll(), everyMs)
    return {
      close: async () => {
        if (done) return
        try { await api.closeEndScreen(this.sessionId) } catch (e) { this.opts.onError?.('endscreen', e) }
        finish()
      },
      stop: () => { done = true; if (timer !== null) clearTimeout(timer) },
    }
  }

  private imageSent = false

  private finish(status: SessionStatus, reason: string | null, summary: SessionSummary | null): void {
    if (this.ended) return
    this.ended = true
    this.stop()
    this.paused = false
    // Completed from elsewhere (a bridge's End button, the console): the server still accepts the session
    // image for a while, so History gets its picture either way.
    if (status === 'complete' && !this.imageSent) void this.sendImage()
    this.opts.onEnded?.({ status, reason, summary })
  }

  private async sendImage(): Promise<void> {
    if (this.imageSent || !this.opts.sessionImage) return
    this.imageSent = true
    try {
      const img = this.opts.sessionImage()
      if (img) await api.putSessionImage(this.sessionId, img)
    } catch (e) {
      this.opts.onError?.('sessionimage', e)
    }
  }

  /** The server may have ended the session behind our back (console, timeout, supersede): look. */
  private async checkEnded(): Promise<void> {
    try {
      const s = await api.getState(this.sessionId)
      if (isEnded(s.sessionStatus)) this.finish(s.sessionStatus, s.endReason, null)
    } catch (e) {
      if (e instanceof api.ApiError && (e.status === 410 || e.status === 404)) this.finish('discarded', e.code, null)
    }
  }

  // --- getstate -------------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const ctl = new AbortController()
      this.poll = ctl
      const t0 = Date.now()
      try {
        const before = this.seq
        const state = await api.getState(this.sessionId, this.seq, this.opts.wait ?? 1, ctl.signal)
        this.handleState(state)
        // A server that answers instantly with nothing new (no long-poll support, proxies) must not spin us.
        if (state.seq === before && Date.now() - t0 < 200) await sleep(250)
      } catch (e) {
        if (ctl.signal.aborted) break
        if (e instanceof api.ApiError && (e.status === 410 || e.status === 404)) {
          this.finish('discarded', e.code, null)
          break
        }
        this.opts.onError?.('getstate', e)
        await sleep(1000)
      }
    }
  }

  /** Exposed for tests and for games that poll on their own. */
  handleState(state: GameState): void {
    this.latest = state
    this.seq = state.seq
    const { answers, cursor } = newInputs(state, this.cursor, this.firstState)
    this.firstState = false
    this.cursor = cursor
    this.followPause(state)
    this.opts.onState?.(state)
    for (const a of answers) this.opts.onInput?.(a)
    if (isEnded(state.sessionStatus)) this.finish(state.sessionStatus, state.endReason, null)
  }

  private followPause(state: GameState): void {
    const paused = state.sessionStatus === 'paused'
    if (paused === this.paused) return
    this.paused = paused
    if (paused && state.pause) {
      this.pausedSince = state.pause.since ?? state.serverTime - (state.pause.seconds ?? 0)
      this.opts.onPause?.(state.pause, state)
    } else if (!paused) {
      const secs = this.pausedSince == null ? 0 : Math.max(0, state.serverTime - this.pausedSince)
      this.pausedSince = null
      this.opts.onResume?.(secs, state)
    }
    void this.requestTick() // tell the server our new request right away
  }

  // --- setstate -------------------------------------------------------------------------------

  /** Run a tick now, or right after the one in flight; never two at once. */
  async requestTick(): Promise<void> {
    if (!this.running) return
    if (this.ticking) { this.tickWanted = true; return }
    this.ticking = true
    try {
      do {
        this.tickWanted = false
        await this.tick()
      } while (this.tickWanted && this.running)
    } finally {
      this.ticking = false
    }
  }

  private async tick(): Promise<void> {
    const p = this.prompt
    if (p && !p.persistent && p.timeout && Date.now() - this.promptOpenedAt > p.timeout * 1000) this.prompt = null
    const partial = this.opts.buildTick()
    if (!partial) return
    const body = { ...partial, sessionId: this.sessionId, timestamp: Date.now() / 1000, requestedInput: this.prompt }
    // Stats the game set with countStats(), unless this tick's body named its own.
    if (partial.stats === undefined && Object.keys(this.stats).length > 0) body.stats = this.stats
    try {
      const res = await api.setState(body)
      this.opts.onTick?.(true)
      if (isEnded(res.sessionStatus)) await this.checkEnded()
    } catch (e) {
      this.opts.onTick?.(false)
      this.opts.onError?.('setstate', e)
      if (e instanceof api.ApiError && (e.status === 409 || e.status === 410)) await this.checkEnded()
    }
  }
}
