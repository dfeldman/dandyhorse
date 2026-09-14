import { describe, expect, it } from 'vitest'
import * as R from '../src/engine/rules.ts'
import { Bot } from '../src/sim/bot.ts'
import { solve } from '../src/sim/solver.ts'
import { index, newEngine } from './helpers.ts'

/**
 * The solver bot plays game-0000 through the real engine, choosing only from the choice list and pedaling at a
 * steady pace, with no walkthrough: proof the game can be won, and a measure of how long a level takes.
 */
describe('playthrough', () => {
  const usual = index.games.find((g) => g.id === 'game-0000')?.minutes ?? 0

  it('the game index says a level takes one to two and a half hours', () => {
    expect(usual).toBeGreaterThanOrEqual(60)
    expect(usual).toBeLessThanOrEqual(150)
  })

  for (const [seed, cls] of [[11, 'knight'], [22, 'mage'], [33, 'ranger']] as const) {
    it(`a steady ${cls} saves the kingdom in about the time the index says (seed ${seed})`, () => {
      const e = newEngine(seed)
      const r = solve(e, { cls })
      console.log(`game-0000 (${cls}): ${r.ok ? '' : `FAILED: ${r.reason} · `}${r.minutes.toFixed(1)} min (index says ${usual}) · ${r.battlesWon} fights won, ${r.battlesLost} lost · ${r.steps.length} steps`)
      expect(r.ok, r.reason).toBe(true)
      expect(r.minutes).toBeGreaterThan(usual * 0.75)
      expect(r.minutes).toBeLessThan(usual * 1.35)
      expect(e.save.level).toBe(2)
      // The relics went to the royal armory, so a replay (or another dragon) starts from scratch.
      for (const id of e.world.game.challenge.requires) expect(R.count(e.save, id), id).toBe(0)
      const bot = new Bot(e)
      bot.settle()
      bot.pick('next')
      expect(e.top.kind).toBe('intro')
    })
  }
})
