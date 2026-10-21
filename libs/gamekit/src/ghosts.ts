/**
 * Ghosts: several competitors at once, placed on the road where they were at this point in THEIR ride.
 *
 * Owner, 2026-10-20: *"In games where it makes sense, like racer and trailtrainer, we should be able to
 * show the position of your competitors at the same time since start as NPCs (basically ghosts)... Also
 * since many players look alike, they should have some kind of an indication that they're ghosts —
 * probably just showing their name over their heads is fine."*
 *
 * The platform does the choosing; this does the playing back. A ghost is one past session's 1 Hz
 * timeline, and `at(elapsed)` says how far along they were that many seconds in. The game turns that
 * distance into a place on its own road, which is the only part a game has to write itself.
 *
 * Three things worth knowing before using it:
 *
 * - **the count varies, and may be zero.** A quiet game, or a route nobody else has ridden, gives you
 *   none. Every game must be perfectly playable with an empty list.
 * - **a ghost finishes.** Their session was however long it was; past that they stop rather than carry
 *   on for ever at their last speed, because a ghost that rides past the end of its own ride is a lie.
 *   `done` says so, and a game should take them off the road.
 * - **this is not multiplayer.** Nothing is synchronous, nobody is told, and the ride they are playing
 *   back happened days ago.
 *
 * Cycle Dash deliberately does not use this (owner: *"Cycle Dash should not display live competitors
 * though, that would be too confusing"*) — a city with traffic and junctions has enough on the road.
 */
import { request } from './api.ts'
import { CompetitorTracker, competitorName, fromPayload, type CompetitorSample } from './competitor.ts'
import type { CompetitorPayload, CompetitorPlayer } from './types.ts'

/** One ghost: who they are, and where they had got to. */
export interface Ghost {
  readonly player: CompetitorPlayer
  /** What to write over their head. Their first name where they have one, else their handle. */
  readonly name: string
  /**
   * Their own AvatarSpec, so a game that draws a body can draw THEM rather than a stranger.
   *
   * Null where they have never made one — fall back to whatever body you would otherwise have used. Only
   * public players are ever ghosts, and this is the same look their profile already shows anybody.
   */
  readonly avatar: Record<string, unknown> | null
  /** Their whole ride's length in seconds; past this they are `done`. */
  readonly finishElapsed: number
  /** Where they were `elapsed` seconds into their own ride. */
  at(elapsed: number): CompetitorSample
  /** Their ride ended before this moment: take them off the road. */
  done(elapsed: number): boolean
}

class Playback implements Ghost {
  private readonly track: CompetitorTracker
  readonly name: string
  readonly avatar: Record<string, unknown> | null

  constructor(track: CompetitorTracker, avatar: Record<string, unknown> | null) {
    this.track = track
    this.name = competitorName(track.player)
    this.avatar = avatar
  }

  get player(): CompetitorPlayer { return this.track.player }
  get finishElapsed(): number { return this.track.finishElapsed }
  at(elapsed: number): CompetitorSample { return this.track.at(elapsed) }
  done(elapsed: number): boolean { return elapsed > this.track.finishElapsed }
}

/**
 * Load the ghosts for this session.
 *
 * `count` is a request, not a promise. Never throws: a game that cannot reach the platform, or is being
 * played outside it, gets an empty list and carries on.
 */
export async function loadGhosts(sessionId: string, count = 4): Promise<Ghost[]> {
  try {
    const r = await request<{ ghosts: (CompetitorPayload & { avatar?: Record<string, unknown> | null })[] }>(
      'GET', `/gameapi/ghosts?session=${encodeURIComponent(sessionId)}&count=${count}`)
    const out: Ghost[] = []
    for (const p of r.ghosts ?? []) {
      const c = fromPayload(p)
      if (c) out.push(new Playback(new CompetitorTracker(c), p.avatar ?? null))
    }
    return out
  } catch {
    return []
  }
}

/** The styles for `ghostLabel`, added once. */
let styled = false
function style(): void {
  if (styled || typeof document === 'undefined') return
  styled = true
  const el = document.createElement('style')
  el.textContent = `
.dh-ghost-name { position: absolute; transform: translate(-50%, -100%); pointer-events: none;
  font: 700 12px/1.25 -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Roboto, Arial, sans-serif;
  color: #fff; background: rgba(12,16,28,.62); border: 1px solid rgba(255,255,255,.22);
  border-radius: 999px; padding: 2px 9px; white-space: nowrap; backdrop-filter: blur(3px);
  text-shadow: 0 1px 2px rgba(0,0,0,.6); transition: opacity .2s ease; z-index: 30; }
.dh-ghost-name .dh-ghost-flag { margin-left: 5px; }`
  document.head.appendChild(el)
}

/**
 * A name tag to float over a ghost's head.
 *
 * This is the "indication that they're ghosts" the owner asked for, and a name is the right one: many
 * players look alike, and a rider you cannot name is just scenery. The game owns the projection — it
 * knows where the head is on screen — and calls `move(x, y)` each frame, or `hide()` when they are
 * behind something, off screen, or finished.
 */
export interface GhostLabel {
  move(x: number, y: number): void
  hide(): void
  dispose(): void
}

export function ghostLabel(ghost: Ghost, parent: HTMLElement = document.body,
                           flag?: string): GhostLabel {
  style()
  const el = document.createElement('div')
  el.className = 'dh-ghost-name'
  el.textContent = ghost.name
  if (flag) {
    const f = document.createElement('span')
    f.className = 'dh-ghost-flag'
    f.textContent = flag
    el.appendChild(f)
  }
  el.style.opacity = '0'
  parent.appendChild(el)
  return {
    move(x, y) {
      el.style.left = `${Math.round(x)}px`
      el.style.top = `${Math.round(y)}px`
      el.style.opacity = '1'
    },
    hide() { el.style.opacity = '0' },
    dispose() { el.remove() },
  }
}
