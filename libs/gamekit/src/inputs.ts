/**
 * Prompts and the d-pad (PLAN.md §6.3, §9.7). Pure helpers; the SessionClient uses them to deliver every
 * answer exactly once, in order, even when taps arrive faster than the game polls.
 */
import type { GameState, InputAnswer, MenuItem, Prompt, RemoteButton } from './types.ts'
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

// --- menu prompts (PLAN.md §6.3) ----------------------------------------------------------------

export const MENU_ITEMS_MAX = 100
export const MENU_LABEL_MAX = 40
const ESCAPE = 'item:'

/**
 * An item id as it travels in a menu prompt. An answer is either an item id or a d-pad button name, so an item whose
 * id is a button name ("back" is a common one) travels as `item:back`; readMenuAnswer() undoes it.
 */
export const menuItemId = (id: string): string => (isRemoteButton(id) || id.startsWith(ESCAPE) ? ESCAPE + id : id)

export interface MenuSpec {
  title: string
  items: MenuItem[]
  highlight?: string | null
  /** The item Back picks. */
  back?: string | null
  countdown?: number | null
  /** The d-pad buttons to show beside the list (all six by default). */
  buttons?: RemoteButton[]
}

/** At most `max` characters, counted the way the server counts them (code points, so an emoji is never cut in half). */
const clip = (s: string, max: number): string => {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…'
}

/**
 * A menu prompt: the game's whole choice list, so a phone can mirror it. Persistent; bump `rev` whenever the list
 * itself changes (ids, disabled flags, the title), not when only the highlight moves or a label's number ticks.
 */
export function menuPrompt(promptId: string, rev: number, spec: MenuSpec): Prompt {
  const items = spec.items.slice(0, MENU_ITEMS_MAX).map((it) => {
    const out: MenuItem = { id: menuItemId(it.id), label: clip(it.label, MENU_LABEL_MAX) }
    if (it.hint) out.hint = it.hint
    if (it.disabled) out.disabled = true
    return out
  })
  const buttons = (spec.buttons ?? [...REMOTE_BUTTONS]).filter(isRemoteButton)
  return {
    promptId, prompt: spec.title, choices: buttons, persistent: true, layout: 'menu', items, rev,
    highlight: spec.highlight ? menuItemId(spec.highlight) : null,
    back: spec.back ? menuItemId(spec.back) : null,
    countdown: spec.countdown ?? null,
  }
}

export type MenuAnswer =
  | { kind: 'button'; button: RemoteButton; rev: number | null }
  | { kind: 'item'; id: string; rev: number | null }

/** What a menu answer means: a d-pad button, or a tap on an item (its id as the game gave it). */
export function readMenuAnswer(a: InputAnswer): MenuAnswer {
  const rev = typeof a.rev === 'number' ? a.rev : null
  if (isRemoteButton(a.choice)) return { kind: 'button', button: a.choice, rev }
  return { kind: 'item', id: a.choice.startsWith(ESCAPE) ? a.choice.slice(ESCAPE.length) : a.choice, rev }
}

/**
 * Was this tap aimed at an older list? Item taps, Select and Back are (and should be dropped) when their `rev` is not
 * the current one; directions always pass, and so does a tap that carries no rev (an older bridge).
 */
export function isStaleAnswer(a: MenuAnswer, currentRev: number): boolean {
  if (a.rev === null) return false
  if (a.kind === 'button' && a.button !== 'select' && a.button !== 'back') return false
  return a.rev !== currentRev
}
