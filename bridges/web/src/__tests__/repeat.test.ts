import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { holdToRepeat, REPEAT_DELAY_MS, REPEAT_EVERY_MS, type Timers } from '../repeat'

function recorder() {
  const fired: string[] = []
  return { fired, r: holdToRepeat<string>((k) => fired.push(k)) }
}

describe('hold to repeat', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('the game\'s own gamepad timings', () => {
    expect([REPEAT_DELAY_MS, REPEAT_EVERY_MS]).toEqual([400, 130])
  })
  test('a press fires at once, then after 400 ms every 130 ms until released', () => {
    const { fired, r } = recorder()
    r.down('up')
    expect(fired).toEqual(['up'])
    expect(r.held()).toBe('up')
    vi.advanceTimersByTime(399)
    expect(fired).toHaveLength(1)
    vi.advanceTimersByTime(1) // 400 ms
    expect(fired).toHaveLength(2)
    vi.advanceTimersByTime(129)
    expect(fired).toHaveLength(2)
    vi.advanceTimersByTime(1) // 530 ms
    expect(fired).toHaveLength(3)
    vi.advanceTimersByTime(260) // 790 ms
    expect(fired).toEqual(['up', 'up', 'up', 'up', 'up'])
    r.up()
    expect(r.held()).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(fired).toHaveLength(5)
    expect(vi.getTimerCount()).toBe(0)
  })
  test('a quick tap is exactly one press', () => {
    const { fired, r } = recorder()
    r.down('down')
    vi.advanceTimersByTime(150)
    r.up('down')
    vi.advanceTimersByTime(2000)
    expect(fired).toEqual(['down'])
    expect(vi.getTimerCount()).toBe(0)
  })
  test('the click after a pointer press is not a second press; keyboard clicks press once and never repeat', () => {
    const { fired, r } = recorder()
    r.down('left')
    r.up('left')
    r.click('left', true)
    expect(fired).toEqual(['left'])
    r.click('left', false) // Enter / Space
    r.click('left', false)
    vi.advanceTimersByTime(2000)
    expect(fired).toEqual(['left', 'left', 'left'])
    r.click('right', true) // a pointer click with no pointer press before it still counts
    expect(fired).toEqual(['left', 'left', 'left', 'right'])
  })
  test('a finger that slid off the key does not eat the next keyboard press', () => {
    const { fired, r } = recorder()
    r.down('up')
    r.up() // pointerleave; the release lands elsewhere, so no click reaches the key
    r.click('up', false)
    expect(fired).toEqual(['up', 'up'])
  })
  test('releasing another key leaves the held one repeating; a press on another key takes over', () => {
    const { fired, r } = recorder()
    r.down('up')
    r.up('down')
    vi.advanceTimersByTime(400)
    expect(fired).toEqual(['up', 'up'])
    r.down('down')
    expect(r.held()).toBe('down')
    vi.advanceTimersByTime(400)
    expect(fired).toEqual(['up', 'up', 'down', 'down'])
    r.up('down')
    vi.advanceTimersByTime(1000)
    expect(fired).toHaveLength(4)
  })
  test('a fire that releases the key stops the repeat', () => {
    const fired: string[] = []
    const r = holdToRepeat<string>((k) => { fired.push(k); if (fired.length === 3) r.up() })
    r.down('up')
    vi.advanceTimersByTime(2000)
    expect(fired).toEqual(['up', 'up', 'up'])
    expect(vi.getTimerCount()).toBe(0)
  })
  test('timers can be injected', () => {
    type T = { f: () => void; ms: number }
    const pending: T[] = []
    const timers: Timers = {
      setTimeout: (f, ms) => { const t = { f, ms }; pending.push(t); return t },
      clearTimeout: (h) => { const i = pending.indexOf(h as T); if (i >= 0) pending.splice(i, 1) },
    }
    const fired: string[] = []
    const r = holdToRepeat<string>((k) => fired.push(k), { delay: 50, every: 10, timers })
    r.down('up')
    expect(pending.map((t) => t.ms)).toEqual([50])
    pending.shift()!.f()
    expect(pending.map((t) => t.ms)).toEqual([10])
    expect(fired).toEqual(['up', 'up'])
    r.up()
    expect(pending).toHaveLength(0)
  })
})
