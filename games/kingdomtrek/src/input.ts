/**
 * Six buttons from a keyboard or a gamepad, as one stream of presses (docs/DESIGN.md §2).
 * Arrows / d-pad / left stick move; Enter, Space or A selects; Esc, Backspace or B goes back.
 */
import type { Press } from './engine/choice.ts'

const KEYS: Record<string, Press> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  NumpadEnter: 'select',
  ' ': 'select',
  Escape: 'back',
  Backspace: 'back',
}

/** Standard gamepad mapping: button index → press. */
const PAD: [number, Press][] = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'], [0, 'select'], [1, 'back']]
const REPEAT_DELAY = 0.38
const REPEAT_EVERY = 0.13

export class Input {
  private listeners: ((p: Press) => void)[] = []
  private held = new Map<Press, number>()

  constructor() {
    window.addEventListener('keydown', (ev) => {
      const p = KEYS[ev.key]
      if (!p || ev.metaKey || ev.ctrlKey || ev.altKey) return
      ev.preventDefault()
      this.fire(p)
    })
  }

  onPress(fn: (p: Press) => void): void {
    this.listeners.push(fn)
  }

  private fire(p: Press): void {
    for (const fn of this.listeners) fn(p)
  }

  /** Poll gamepads once per frame: edge-triggered buttons, auto-repeat for held directions. */
  poll(dt: number): void {
    const pads = navigator.getGamepads?.() ?? []
    const down = new Set<Press>()
    for (const pad of pads) {
      if (!pad) continue
      for (const [i, p] of PAD) if (pad.buttons[i]?.pressed) down.add(p)
      const [x = 0, y = 0] = pad.axes
      if (y < -0.55) down.add('up')
      if (y > 0.55) down.add('down')
      if (x < -0.55) down.add('left')
      if (x > 0.55) down.add('right')
    }
    for (const p of [...this.held.keys()]) if (!down.has(p)) this.held.delete(p)
    for (const p of down) {
      const t = this.held.get(p)
      if (t === undefined) {
        this.held.set(p, 0)
        this.fire(p)
        continue
      }
      const next = t + dt
      this.held.set(p, next)
      const repeats = p !== 'select' && p !== 'back'
      if (repeats && next >= REPEAT_DELAY && Math.floor((next - REPEAT_DELAY) / REPEAT_EVERY) > Math.floor((t - REPEAT_DELAY) / REPEAT_EVERY)) {
        this.fire(p)
      }
    }
  }
}
