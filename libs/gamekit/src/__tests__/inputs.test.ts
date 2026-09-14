import { describe, expect, test } from 'vitest'
import { choicePrompt, dpadPrompt, newInputs } from '../inputs'
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
