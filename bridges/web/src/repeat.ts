// Hold-to-repeat for the d-pad arrows (games/kingdomtrek/INTEGRATION.md §4.3): a pointer press fires at once, then
// after 400 ms again every 130 ms until released (the game's own gamepad timings). Every repeat is still a discrete
// tap. It also decides which clicks count: the click that follows a pointer press is part of that press; a click with
// no pointer press before it (Enter / Space on a focused key, or el.click() from the remote) is one press.
// Timers are injectable; see __tests__/repeat.test.ts.

export const REPEAT_DELAY_MS = 400
export const REPEAT_EVERY_MS = 130

export interface Timers {
  setTimeout(f: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

// resolved at call time, so fake timers installed after this module loaded are the ones used
const globalTimers: Timers = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface Repeater<K> {
  /** pointerdown: fire now, then repeat while held; a press on another key takes over */
  down(key: K): void
  /** pointerup / pointercancel / pointerleave / unmount: stop repeating (with `key`, only if that key is the one held) */
  up(key?: K): void
  /** click; `fromPointer` is e.detail > 0. The click after a pointer press is swallowed; a keyboard click fires once. */
  click(key: K, fromPointer: boolean): void
  /** the key being held, or null */
  held(): K | null
}

export function holdToRepeat<K>(fire: (key: K) => void, opts: { delay?: number; every?: number; timers?: Timers } = {}): Repeater<K> {
  const delay = opts.delay ?? REPEAT_DELAY_MS
  const every = opts.every ?? REPEAT_EVERY_MS
  const timers = opts.timers ?? globalTimers
  let held: K | null = null
  let timer: unknown = null
  // The key of the last pointer press: its trailing click is not a second tap. Only pointer clicks look at it, and
  // every pointer click has its own pointerdown first, so a finger that slid off the key cannot eat a keyboard press.
  let pointerKey: K | null = null

  function up(key?: K): void {
    if (key !== undefined && key !== held) return
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    held = null
  }
  function down(key: K): void {
    up()
    held = key
    pointerKey = key
    fire(key)
    const again = (): void => {
      timer = timers.setTimeout(again, every) // scheduled first, so a fire() that releases the key cancels it
      fire(key)
    }
    timer = timers.setTimeout(again, delay)
  }
  function click(key: K, fromPointer: boolean): void {
    if (fromPointer && pointerKey === key) {
      pointerKey = null
      return
    }
    fire(key)
  }
  return { down, up, click, held: () => held }
}
