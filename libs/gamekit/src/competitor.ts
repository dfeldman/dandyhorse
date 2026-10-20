/**
 * Riding against somebody (PLAN.md §18.3).
 *
 * The platform hands a game a real past session by another player a little stronger than this one. This is
 * the common half every game shares: fetch one, ask where they were at any moment, and draw a small box on
 * the HUD saying so.
 *
 *   const rival = await loadCompetitor({ session: sessionId })
 *   const box = rival ? competitorBox(document.body, rival) : null
 *   // each frame, with your own figures:
 *   box?.update(elapsedSeconds, { distance: myDistance, progress: { deliveries: myDeliveries } })
 *
 * Nobody is guaranteed: `loadCompetitor` resolves null when no suitable session exists (a new game, a new
 * route, the first player on the platform), and every game must play fine without one.
 */
import * as api from './api.ts'
import { countryName, flagOrCode } from './flags.ts'
import type { CompetitorPayload, CompetitorPlayer, CompetitorRow } from './types.ts'

/** A competitor with a timeline, which is the only kind worth tracking. */
export interface Competitor {
  player: CompetitorPlayer
  sessionId: string
  startedAt: string | null
  duration: number | null
  distance: number | null
  route: string | null
  stats: Record<string, number | string | boolean | null>
  progressKeys: string[]
  timeline: CompetitorRow[]
}

/** Where the competitor was at some moment: interpolated between the two rows either side. */
export interface CompetitorSample {
  elapsed: number
  distance: number
  speed: number
  power: number
  energy: number
  elevationGain: number
  progress: Record<string, number>
  /** True once their session had ended by this moment: they finished, and you are still going. */
  finished: boolean
}

/** Your own figures, for the comparison. Everything is optional; only what you pass is compared. */
export interface MyProgress {
  distance?: number
  speed?: number
  progress?: Record<string, number>
}

/**
 * Fetch a competitor. `session` is the usual argument — the platform then matches the game, variant and
 * route by itself. Returns null when there is nobody, or when the request fails: a missing rival must never
 * stop a game from starting.
 */
export async function loadCompetitor(
  params: { session?: string; game?: string; variant?: string; route?: string; anyRoute?: 1 },
  onError?: (e: unknown) => void,
): Promise<Competitor | null> {
  let payload: CompetitorPayload
  try {
    payload = await api.getCompetitor(params)
  } catch (e) {
    onError?.(e)
    return null
  }
  return fromPayload(payload)
}

export function fromPayload(payload: CompetitorPayload): Competitor | null {
  if (!payload.competitor || !payload.timeline?.length || !payload.sessionId) return null
  return {
    player: payload.competitor,
    sessionId: payload.sessionId,
    startedAt: payload.startedAt ?? null,
    duration: payload.duration ?? null,
    distance: payload.distance ?? null,
    route: payload.route ?? null,
    stats: payload.stats ?? {},
    progressKeys: payload.progressKeys ?? [],
    timeline: payload.timeline,
  }
}

/** The name to show: their first name if they gave one, else their username. */
export function competitorName(p: CompetitorPlayer): string {
  return (p.firstName || '').trim() || (p.displayName || '').trim() || p.username
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f

/**
 * Answers "where were they at elapsed t". Keeps its place in the timeline, so asking every frame costs
 * nothing: rows only ever move forward.
 */
export class CompetitorTracker {
  readonly competitor: Competitor
  private i = 0

  constructor(competitor: Competitor) {
    this.competitor = competitor
  }

  get player(): CompetitorPlayer { return this.competitor.player }
  get progressKeys(): string[] { return this.competitor.progressKeys }

  /** Their last row's elapsed time: how long their session lasted. */
  get finishElapsed(): number {
    const rows = this.competitor.timeline
    return rows.length ? rows[rows.length - 1].elapsed : 0
  }

  at(elapsed: number): CompetitorSample {
    const rows = this.competitor.timeline
    const t = Math.max(0, elapsed)
    // Asking for an earlier moment than last time (a restart, a rewind) is rare but must work.
    if (this.i > 0 && rows[this.i].elapsed > t) this.i = 0
    while (this.i < rows.length - 1 && rows[this.i + 1].elapsed <= t) this.i++
    const a = rows[this.i]
    const b = rows[Math.min(this.i + 1, rows.length - 1)]
    const span = b.elapsed - a.elapsed
    const f = span > 0 ? Math.min(1, Math.max(0, (t - a.elapsed) / span)) : 0
    const num = (key: keyof CompetitorRow): number => {
      const x = a[key]
      const y = b[key]
      if (typeof x !== 'number') return typeof y === 'number' ? y : 0
      return typeof y === 'number' ? lerp(x, y, f) : x
    }
    const progress: Record<string, number> = {}
    for (const key of this.competitor.progressKeys) {
      // A counter steps, it does not slide: show what they had actually reached, never 3.4 deliveries.
      const v = (a.progress ?? {})[key]
      progress[key] = typeof v === 'number' ? v : 0
    }
    return {
      elapsed: t,
      distance: num('distance'),
      speed: num('speed'),
      power: num('power'),
      energy: num('energy'),
      elevationGain: num('elevationGain'),
      progress,
      finished: t >= this.finishElapsed && rows.length > 1,
    }
  }

  /** Ahead, behind or level on distance (a metre of slack, so a dead heat does not flicker). */
  standing(elapsed: number, mine: MyProgress): 'ahead' | 'behind' | 'level' {
    if (mine.distance == null) return 'level'
    const theirs = this.at(elapsed).distance
    const gap = mine.distance - theirs
    return gap > 1 ? 'ahead' : gap < -1 ? 'behind' : 'level'
  }

  /** How far in front you are, in metres (negative when they are). */
  gap(elapsed: number, mine: MyProgress): number {
    return mine.distance == null ? 0 : mine.distance - this.at(elapsed).distance
  }
}

// --- the HUD box -------------------------------------------------------------------------------

export interface CompetitorBoxOptions {
  /** Labels for the progress counters, when the game wants nicer ones than the keys. */
  labels?: Record<string, string>
  /** Miles and mph instead of kilometres (the player's `unitSystem` is `us`). */
  imperial?: boolean
  /** Where to sit: a corner, or `none` to let the game's own CSS place it. */
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'none'
  /** Shown while nothing has happened yet. */
  title?: string
}

export interface CompetitorBox {
  readonly element: HTMLElement
  update: (elapsed: number, mine: MyProgress) => void
  remove: () => void
}

const CSS = `
.dh-rival { position: absolute; z-index: 40; min-width: 168px; padding: 8px 10px; border-radius: 10px;
  font: 500 13px/1.3 var(--dh-rival-font, system-ui, sans-serif); color: var(--dh-rival-fg, #eef2ff);
  background: var(--dh-rival-bg, rgba(13, 16, 24, .72)); border: 1px solid var(--dh-rival-border, rgba(255,255,255,.14));
  backdrop-filter: blur(4px); pointer-events: none; user-select: none }
.dh-rival-top-left { left: 12px; top: 12px } .dh-rival-top-right { right: 12px; top: 12px }
.dh-rival-bottom-left { left: 12px; bottom: 12px } .dh-rival-bottom-right { right: 12px; bottom: 12px }
.dh-rival-head { display: flex; align-items: center; gap: 7px; margin-bottom: 5px }
.dh-rival-head img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
  background: var(--dh-rival-border, rgba(255,255,255,.14)) }
.dh-rival-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 112px }
.dh-rival-flag { font-size: 1.05em; line-height: 1; flex: none }
.dh-rival-row { display: flex; justify-content: space-between; gap: 10px; opacity: .92 }
.dh-rival-row b { font-weight: 700; font-variant-numeric: tabular-nums }
.dh-rival-gap { margin-top: 5px; font-weight: 800; letter-spacing: .01em }
.dh-rival-ahead { color: var(--dh-rival-ahead, #6ee7a8) } .dh-rival-behind { color: var(--dh-rival-behind, #ff9d8a) }
.dh-rival-level { color: var(--dh-rival-level, #ffd479) }
`

let cssAdded = false

function addCss(doc: Document): void {
  if (cssAdded || doc.getElementById('dh-rival-css')) { cssAdded = true; return }
  const style = doc.createElement('style')
  style.id = 'dh-rival-css'
  style.textContent = CSS
  doc.head.appendChild(style)
  cssAdded = true
}

/** `1.4 km` / `0.9 mi`, and `24.1 km/h` / `15.0 mph`. */
export function fmtDistance(metres: number, imperial = false): string {
  return imperial ? `${(metres / 1609.344).toFixed(1)} mi` : `${(metres / 1000).toFixed(1)} km`
}

export function fmtSpeed(ms: number, imperial = false): string {
  return imperial ? `${(ms * 2.236936).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`
}

/**
 * A small box on the HUD: who you are riding against, where they were at this point in their session, and
 * whether you are in front. The game calls `update()` each frame with its own figures. Styling comes from
 * CSS custom properties (`--dh-rival-bg`, `--dh-rival-fg`, `--dh-rival-ahead`, ...) so each game can keep
 * its own look without reimplementing the thing.
 */
export function competitorBox(parent: HTMLElement, source: Competitor | CompetitorTracker,
                              opts: CompetitorBoxOptions = {}): CompetitorBox {
  const tracker = source instanceof CompetitorTracker ? source : new CompetitorTracker(source)
  const doc = parent.ownerDocument
  addCss(doc)
  const el = doc.createElement('div')
  el.className = `dh-rival dh-rival-${opts.corner ?? 'top-right'}`
  if (opts.corner === 'none') el.className = 'dh-rival'

  // Everything that comes from another player's profile — their name, their thumbnail's URL, the game's own
  // labels — is set as text or as a DOM property, never built into an HTML string.
  const head = doc.createElement('div')
  head.className = 'dh-rival-head'
  const thumb = tracker.player.thumbnailUrl
  if (thumb) {
    const img = doc.createElement('img')
    img.alt = ''
    img.src = thumb
    head.appendChild(img)
  }
  const nameEl = doc.createElement('span')
  nameEl.className = 'dh-rival-name'
  nameEl.textContent = competitorName(tracker.player)
  head.appendChild(nameEl)
  // Where they are from, beside who they are: a ride against somebody in another country is a better
  // story than a ride against a name, and it is two characters.
  const flag = flagOrCode(tracker.player.country)
  if (flag) {
    const f = doc.createElement('span')
    f.className = 'dh-rival-flag'
    f.textContent = flag
    f.title = countryName(tracker.player.country)
    head.appendChild(f)
  }
  el.appendChild(head)

  const addRow = (label: string, key: string): void => {
    const row = doc.createElement('div')
    row.className = 'dh-rival-row'
    const l = doc.createElement('span')
    l.textContent = label
    const v = doc.createElement('b')
    v.dataset.dh = key
    v.textContent = '—'
    row.append(l, v)
    el.appendChild(row)
  }
  addRow(opts.title ?? 'Their distance', 'distance')
  addRow('Speed', 'speed')
  for (const k of tracker.progressKeys) addRow(opts.labels?.[k] ?? k, `p-${k}`)
  const gapRow = doc.createElement('div')
  gapRow.className = 'dh-rival-gap'
  el.appendChild(gapRow)
  parent.appendChild(el)

  const field = (key: string): HTMLElement | null => el.querySelector(`[data-dh="${key}"]`)
  const gapEl = gapRow

  return {
    element: el,
    update(elapsed: number, mine: MyProgress) {
      const them = tracker.at(elapsed)
      const d = field('distance')
      if (d) d.textContent = fmtDistance(them.distance, opts.imperial)
      const sp = field('speed')
      if (sp) sp.textContent = them.finished ? 'finished' : fmtSpeed(them.speed, opts.imperial)
      for (const k of tracker.progressKeys) {
        const f = field(`p-${k}`)
        if (!f) continue
        const theirs = them.progress[k] ?? 0
        const ours = mine.progress?.[k]
        f.textContent = ours == null ? String(theirs) : `${ours} v ${theirs}`
      }
      const standing = tracker.standing(elapsed, mine)
      const gap = Math.abs(tracker.gap(elapsed, mine))
      gapEl.className = `dh-rival-gap dh-rival-${standing}`
      gapEl.textContent = mine.distance == null ? ''
        : standing === 'level' ? 'Level'
        : `${fmtDistance(gap, opts.imperial)} ${standing === 'ahead' ? 'ahead' : 'behind'}`
    },
    remove() { el.remove() },
  }
}

// --- the whole thing in one call ---------------------------------------------------------------

export interface RivalOptions extends CompetitorBoxOptions {
  /** The session's planned length, for the halfway and home-straight lines. */
  plannedSeconds?: number | null
  /** Match on this route only (a named trail, a seeded series). The platform uses the session's own by default. */
  route?: string
  /** Look beyond this session's route. */
  anyRoute?: boolean
  /** Singular words for the progress counters, for the encouragement: `{ deliveries: 'delivery' }`. */
  words?: Record<string, string>
  /** Where to put the box and the banner. Defaults to the document body. */
  parent?: HTMLElement
  /** Somewhere to note what happened. */
  log?: (line: string) => void
  /** Skip the HUD box and keep only the voice: for a game with no room for one. */
  voiceOnly?: boolean
}

export interface Rival {
  /** Who is being raced, or null when nobody was found. */
  readonly player: CompetitorPlayer | null
  readonly tracker: CompetitorTracker | null
  /** About once a second, with where this session has got to. */
  update: (elapsed: number, mine: MyProgress) => void
  /** Where the rival finished, for a game composing its own end-of-session line. */
  theirs: () => CompetitorSample | null
  remove: () => void
}

/**
 * Everything a game needs to ride against somebody: fetch a competitor, put the box on the HUD, and let the
 * voice call out the milestones. One call, and a game that gets nobody still gets the voice.
 *
 *   const rival = await rivalHud(sessionId, { imperial, plannedSeconds, labels: { laps: 'Laps' } })
 *   // each second:
 *   rival.update(elapsed, { distance, progress: { laps } })
 *
 * Nothing here throws: a platform that cannot answer leaves the game riding alone, which is how every game
 * worked before there was anybody to race.
 */
export async function rivalHud(sessionId: string, opts: RivalOptions = {}): Promise<Rival> {
  // No document, no HUD: a game under test, or driving a worker, still calls this and must not be broken
  // by it. The ride carries on exactly as it would with nobody to race.
  const parent = opts.parent ?? (typeof document === 'undefined' ? null : document.body)
  if (!parent) {
    return { player: null, tracker: null, update: () => {}, theirs: () => null, remove: () => {} }
  }
  const { Encouragement, banner } = await import('./encouragement.ts')
  const say = banner(parent)
  const rival = await loadCompetitor(
    { session: sessionId, route: opts.route, ...(opts.anyRoute ? { anyRoute: 1 as const } : {}) },
    (e) => opts.log?.(`competitor: ${String(e)}`),
  )
  const name = rival ? competitorName(rival.player) : undefined
  const voice = new Encouragement({
    imperial: opts.imperial, rivalName: name, plannedSeconds: opts.plannedSeconds,
    progressWords: opts.words,
  })
  let tracker: CompetitorTracker | null = null
  let box: CompetitorBox | null = null
  if (rival) {
    tracker = new CompetitorTracker(rival)
    opts.log?.(`riding against ${name} at ${Math.round(rival.player.fitness)} W`)
    if (!opts.voiceOnly) box = competitorBox(parent, tracker, opts)
  } else {
    opts.log?.('nobody to ride against yet')
  }

  return {
    player: rival?.player ?? null,
    tracker,
    update(elapsed, mine) {
      box?.update(elapsed, mine)
      const line = voice.update({
        elapsed, distance: mine.distance, progress: mine.progress,
        rival: tracker ? tracker.at(elapsed) : null,
      })
      if (line) say(line)
    },
    theirs: () => (tracker ? tracker.at(tracker.finishElapsed) : null),
    remove: () => box?.remove(),
  }
}
