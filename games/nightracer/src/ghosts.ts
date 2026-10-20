/**
 * Racing real people instead of invented ones.
 *
 * Owner, 2026-10-20: *"In games where it makes sense, like racer and trailtrainer, we should be able to
 * show the position of your competitors at the same time since start as NPCs (basically ghosts)."*
 *
 * Trail Trainer can do that literally — a fixed real route, so a recorded ride can be replayed metre for
 * metre beside you. Night Racer cannot, and its own code already says why: *"Night Racer builds its route
 * name from the session's seed, and a seed is fresh every launch."* Every night is a different set of
 * tracks, so there is no road to put somebody's recorded line back on. Dropping extra cars that do not
 * take part in the race would be the worst of both: the owner's objection to ghosts in Cycle Dash —
 * *"that would be too confusing"* — applies twice over in an actual race with places and overtakes.
 *
 * So here the ghosts ARE the field. The three rivals keep their behaviour, their drafting and their oil,
 * and take the names, colours and pace of real players who have raced before. You are still in a race of
 * four; it is just that the other three are people, and beating Goldie becomes beating Priya.
 *
 * Their pace comes from measured fitness, theirs against yours, because that is the one thing comparable
 * across two different nights on two different tracks. It is clamped hard: a rival far out of reach is
 * not a race, and one far behind is not either.
 */
import { loadGhosts, type Ghost } from '@dandyhorse/gamekit'
import { Config } from './config.ts'

/** How far a real player's pace may move a rival from its designed one. */
const PACE_RANGE = [0.86, 1.14] as const

/** A rival keeps its slot and behaviour; only who it is — and how hard they ride — changes. */
export interface GhostRival {
  id: string
  name: string
  pace: number
  dodge: number
  color: string
  ghost: true
  /** Their recorded speed at a moment of their own workout, m/s, or null once their ride ended. */
  speedAt: (sessionElapsed: number) => number | null
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * Who is in the race tonight.
 *
 * `Config` is frozen (`as const`) and should stay that way, so the field lives here instead: set once at
 * boot by `useRealRivals`, read by everything that needs the list. Before that, and off the platform, it
 * is simply the invented three.
 */
let field: typeof Config.RIVALS = Config.RIVALS

/** The rivals racing tonight — real people where there were any, the designed three otherwise. */
export const rivals = (): typeof Config.RIVALS => field

/** Set the field for this session. Safe to call with nothing to change. */
export async function useRealRivals(sessionId: string, myFitness: number): Promise<void> {
  field = await realRivals(sessionId, myFitness)
}

/**
 * Turn the rivals into real players, where enough of them have raced.
 *
 * Returns the invented three unchanged when the platform has nobody to offer — a quiet game still has a
 * race in it. Never throws: `loadGhosts` already swallows its own failures.
 */
export async function realRivals(sessionId: string, myFitness: number): Promise<typeof Config.RIVALS> {
  const ghosts: Ghost[] = await loadGhosts(sessionId, Config.RIVALS.length)
  if (!ghosts.length) return Config.RIVALS
  return Config.RIVALS.map((rival, i) => {
    const g = ghosts[i]
    if (!g) return rival
    const theirs = g.player.fitness
    // Their strength against mine, kept inside the band the race was designed around.
    const pace = myFitness > 0 && theirs > 0
      ? clamp(rival.pace * (theirs / myFitness), PACE_RANGE[0], PACE_RANGE[1])
      : rival.pace
    return {
      ...rival,
      name: g.name,
      pace,
      ghost: true as const,
      // What they were actually doing at that second of their own ride. Null once it ended, and the
      // rival falls back to its designed pace rather than stopping dead.
      speedAt: (t: number) => (g.done(t) ? null : g.at(t).speed),
    }
  })
}
