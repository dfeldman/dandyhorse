/**
 * The minute after the workout: stand still, and watch what the heart rate does. The screen is deliberately
 * quiet — one countdown, two numbers — because the player is meant to be standing still and breathing.
 */
import type { RecoveryTest } from '../recovery.ts'
import * as units from '../units.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

export interface RecoveryOptions {
  onDone(): void
}

export function showRecovery(host: HTMLElement, test: RecoveryTest, opts: RecoveryOptions): void {
  const count = el('b', {}, units.clock(test.remaining))
  const from = el('b', {}, '—')
  const now = el('b', {}, '—')
  const skip = el('button', { type: 'button', class: 'ghost big' }, 'Skip')
  skip.addEventListener('click', () => {
    test.abandon()
    stop()
    opts.onDone()
  })

  host.replaceChildren(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Recovery'),
      el('p', { class: 'muted' }, 'Stand still and breathe. In a minute the console will tell you how quickly your heart settles — one of the better signs of how your fitness is going.'),
      el('div', { class: 'recovery-dial' }, count, el('span', { class: 'u' }, 'seconds left')),
      el(
        'div',
        { class: 'recovery-hr' },
        el('div', {}, el('span', { class: 'label' }, 'At the finish'), from),
        el('div', {}, el('span', { class: 'label' }, 'Now'), now),
      ),
      el('div', { class: 'row end' }, skip),
    ),
  )
  host.hidden = false

  const timer = setInterval(() => {
    count.textContent = String(Math.ceil(test.remaining))
    from.textContent = test.startedAt > 0 ? String(Math.round(test.startedAt)) : '—'
    now.textContent = test.current === null ? '—' : String(Math.round(test.current))
    if (test.done) {
      stop()
      opts.onDone()
    }
  }, 250)

  function stop(): void {
    clearInterval(timer)
    host.hidden = true
  }
}
