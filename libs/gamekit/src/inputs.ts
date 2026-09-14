/**
 * Prompts and the d-pad (PLAN.md §6.3, §9.7). Pure helpers; the SessionClient uses them to deliver every
 * answer exactly once, in order, even when taps arrive faster than the game polls.
 */
import type { GameState, InputAnswer, Prompt, RemoteButton } from './types.ts'
import { REMOTE_BUTTONS } from './types.ts'

/**
 * Answers in `state` that are newer than what the game has handled. Prefers the `inputs` ring (rising `n`),
 * falling back to the single `input` compared by time on older servers. Returns the answers and the new
 * cursor to remember. On the very first call pass `{ n: null, t: null }` and `first: true` so answers that
 * predate this page load (a reload mid-session) are skipped, not replayed.
 */
export interface InputCursor { n: number | null; t: number | null }

export function newInputs(state: GameState, cursor: InputCursor, first = false): { answers: InputAnswer[]; cursor: InputCursor } {
  const ring = state.inputs
  if (Array.isArray(ring)) {
    const lastN = ring.length ? ring[ring.length - 1]!.n ?? null : null
    if (first || cursor.n === null) return { answers: [], cursor: { n: lastN ?? -1, t: state.input?.t ?? null } }
    const fresh = ring.filter((a) => (a.n ?? -1) > (cursor.n ?? -1))
    return { answers: fresh, cursor: { n: lastN ?? cursor.n, t: state.input?.t ?? cursor.t } }
  }
  const one = state.input
  if (first) return { answers: [], cursor: { n: null, t: one?.t ?? null } }
  if (one && one.t !== cursor.t) return { answers: [one], cursor: { n: null, t: one.t } }
  return { answers: [], cursor }
}

/** Build a d-pad prompt: the bridge draws a cross with just these buttons; every tap is delivered. */
export function dpadPrompt(promptId: string, title: string, buttons: RemoteButton[] = ['up', 'down', 'left', 'right', 'select', 'back']): Prompt {
  return { promptId, prompt: title, choices: buttons.filter((b) => (REMOTE_BUTTONS as readonly string[]).includes(b)), persistent: true, layout: 'dpad' }
}

/** A one-shot choice ("Left" / "Right" / "Use turbo"): the first answer wins and the prompt closes. */
export function choicePrompt(promptId: string, title: string, choices: string[], timeoutSeconds?: number): Prompt {
  return { promptId, prompt: title, choices, persistent: false, ...(timeoutSeconds ? { timeout: timeoutSeconds } : {}) }
}

/** Persistent buttons ("Downshift" / "Upshift"): stay on screen, every tap is delivered. */
export function persistentPrompt(promptId: string, title: string, choices: string[]): Prompt {
  return { promptId, prompt: title, choices, persistent: true }
}

export const isRemoteButton = (s: string): s is RemoteButton => (REMOTE_BUTTONS as readonly string[]).includes(s)
