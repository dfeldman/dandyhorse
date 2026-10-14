/**
 * Where you got to.
 *
 * Every other game on the platform starts at the beginning and runs for half an hour. A real route does not
 * work that way: the Katy Trail is 386 km and nobody rides it in a sitting, so the thing that has to survive
 * between sessions is not a score but a position. Progress is a metre marker per route, plus the time spent
 * getting there, and a session is a slice out of the middle of it.
 *
 * Standalone that lives in localStorage. On Dandyhorse it is the session's `saveState`, which is the same
 * object under a different roof — see INTEGRATION.md.
 */

export interface RouteProgress {
  /** metres along the route */
  s: number
  /** seconds of riding spent on this route, across every session */
  elapsed: number
  /** sessions started on it */
  sessions: number
  /** ISO date of the last ride */
  updated: string
  /** the route has been ridden end to end at least once */
  completed: boolean
}

export interface ProgressStore {
  all(): Record<string, RouteProgress>
  get(routeId: string): RouteProgress | null
  put(routeId: string, progress: RouteProgress): void
  clear(routeId: string): void
}

const KEY = 'trailtrainer.progress.v1'

export const emptyProgress = (): RouteProgress => ({ s: 0, elapsed: 0, sessions: 0, updated: new Date().toISOString(), completed: false })

/** The browser's own store. Anything unreadable is treated as no progress rather than as an error. */
export class LocalProgress implements ProgressStore {
  private cache: Record<string, RouteProgress> | null = null

  all(): Record<string, RouteProgress> {
    if (this.cache) return this.cache
    try {
      const raw = localStorage.getItem(KEY)
      this.cache = raw ? (JSON.parse(raw) as Record<string, RouteProgress>) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  get(routeId: string): RouteProgress | null {
    return this.all()[routeId] ?? null
  }

  put(routeId: string, progress: RouteProgress): void {
    const all = this.all()
    all[routeId] = progress
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // a full or blocked store loses the resume point, which is a shame but not a reason to stop riding
    }
  }

  clear(routeId: string): void {
    const all = this.all()
    delete all[routeId]
    try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* as above */ }
  }
}

/**
 * Tracks the ride and writes it down every few seconds. `finishedAt` is the length of the route: crossing it
 * marks the route complete and parks the marker back at the start, so the next session begins a fresh lap
 * rather than sitting on the finish line with nowhere to go.
 */
export class ProgressTracker {
  private lastWrite = 0
  private readonly start: RouteProgress

  private readonly store: ProgressStore
  private readonly routeId: string
  private readonly routeLength: number

  constructor(store: ProgressStore, routeId: string, routeLength: number) {
    this.store = store
    this.routeId = routeId
    this.routeLength = routeLength
    this.start = store.get(routeId) ?? emptyProgress()
    this.start.sessions += 1
    store.put(routeId, { ...this.start, updated: new Date().toISOString() })
  }

  /** What was written down before this session started — what the resume question is asked about. */
  get previous(): RouteProgress { return this.start }

  /** Called every frame; writes at most once every `every` seconds. */
  update(s: number, sessionSeconds: number, now: number, every: number): void {
    if (now - this.lastWrite < every * 1000) return
    this.lastWrite = now
    this.save(s, sessionSeconds)
  }

  /** Write it down now — at the end of a session, or when the page is going away. */
  save(s: number, sessionSeconds: number): void {
    const done = s >= this.routeLength - 1
    this.store.put(this.routeId, {
      s: done ? this.routeLength : s,
      elapsed: this.start.elapsed + sessionSeconds,
      sessions: this.start.sessions,
      updated: new Date().toISOString(),
      completed: this.start.completed || done,
    })
  }
}
