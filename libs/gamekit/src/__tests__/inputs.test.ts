import { describe, expect, test } from 'vitest'
import { choicePrompt, dpadPrompt, isStaleAnswer, menuPrompt, newInputs, readMenuAnswer } from '../inputs'
import type { GameState, InputAnswer } from '../types'

const ans = (n: number, choice: string, t = n): InputAnswer => ({ promptId: 'd', choice, t, source: 'bridge:x', n })
const state = (inputs: InputAnswer[] | undefined, input: InputAnswer | null = inputs?.[inputs.length - 1] ?? null) =>
  ({ inputs, input } as unknown as GameState)

describe('newInputs', () => {
  test('first call skips history, later calls deliver every new answer in order', () => {
    let c = newInputs(state([ans(1, 'left'), ans(2, 'left')]), { n: null, t: null }, true)
    expect(c.answers).toEqual([])
    c = newInputs(state([ans(1, 'left'), ans(2, 'left'), ans(3, 'up'), ans(4, 'up')]), c.cursor)
    expect(c.answers.map((a) => a.choice)).toEqual(['up', 'up'])
    c = newInputs(state([ans(3, 'up'), ans(4, 'up')]), c.cursor)
    expect(c.answers).toEqual([])
  })
  test('older servers without the ring fall back to the single input by time', () => {
    let c = newInputs(state(undefined, { promptId: 'p', choice: 'L', t: 10, source: 'game' }), { n: null, t: null }, true)
    expect(c.answers).toEqual([])
    c = newInputs(state(undefined, { promptId: 'p', choice: 'R', t: 11, source: 'game' }), c.cursor)
    expect(c.answers.map((a) => a.choice)).toEqual(['R'])
    c = newInputs(state(undefined, { promptId: 'p', choice: 'R', t: 11, source: 'game' }), c.cursor)
    expect(c.answers).toEqual([])
  })
})

describe('prompt builders', () => {
  test('dpad keeps only real buttons and is persistent', () => {
    expect(dpadPrompt('d', 'Steer', ['up', 'left', 'nope' as never])).toEqual({ promptId: 'd', prompt: 'Steer', choices: ['up', 'left'], persistent: true, layout: 'dpad' })
  })
  test('one-shot choice with timeout', () => {
    expect(choicePrompt('p1', 'Which way?', ['Left', 'Right'], 10)).toMatchObject({ persistent: false, timeout: 10 })
  })
})

describe('menu prompts', () => {
  test('a persistent menu; ids that are button names travel escaped', () => {
    const p = menuPrompt('kt', 3, {
      title: 'Oakvale gate',
      items: [{ id: 'travel:r1', label: 'Millbrook · ⚡200 · 8 min', hint: 'Forest' }, { id: 'back', label: '↩ Back into town' }],
      highlight: 'back', back: 'back',
    })
    expect(p).toMatchObject({ promptId: 'kt', prompt: 'Oakvale gate', layout: 'menu', persistent: true, rev: 3, highlight: 'item:back', back: 'item:back', countdown: null })
    expect(p.items!.map((i) => i.id)).toEqual(['travel:r1', 'item:back'])
    expect(p.items![0]!.hint).toBe('Forest')
    expect(p.choices).toEqual(['up', 'down', 'left', 'right', 'select', 'back'])
  })
  test('labels are clipped by code points, never through an emoji', () => {
    const p = menuPrompt('m', 1, { title: 't', items: [{ id: 'a', label: '🏛️' + 'x'.repeat(60) }] })
    expect(Array.from(p.items![0]!.label).length).toBe(40)
    expect(p.items![0]!.label.startsWith('🏛️')).toBe(true)
  })
  test('answers: buttons, items (unescaped), and stale taps', () => {
    const a = (choice: string, rev?: number) => readMenuAnswer({ promptId: 'kt', choice, t: 1, source: 'bridge:x', ...(rev != null ? { rev } : {}) })
    expect(a('down', 2)).toEqual({ kind: 'button', button: 'down', rev: 2 })
    expect(a('item:back', 2)).toEqual({ kind: 'item', id: 'back', rev: 2 })
    expect(a('item:item:x')).toEqual({ kind: 'item', id: 'item:x', rev: null })
    expect(isStaleAnswer(a('down', 1), 2)).toBe(false)
    expect(isStaleAnswer(a('select', 1), 2)).toBe(true)
    expect(isStaleAnswer(a('back', 1), 2)).toBe(true)
    expect(isStaleAnswer(a('travel:r1', 1), 2)).toBe(true)
    expect(isStaleAnswer(a('travel:r1', 2), 2)).toBe(false)
    expect(isStaleAnswer(a('select'), 2)).toBe(false)
  })
})
