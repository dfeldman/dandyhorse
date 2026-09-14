import { describe, expect, it } from 'vitest'
import { THREATS } from '../src/content/types.ts'
import { validateGame } from '../src/content/validate.ts'
import * as R from '../src/engine/rules.ts'
import { generateGame } from '../src/gen/generate.ts'
import { solve } from '../src/sim/solver.ts'
import { catalog, engineFor } from './helpers.ts'

/**
 * The generator makes a valid game for every threat, and the solver bot wins it from the file alone. (Whether a
 * game's length is in range is for tools/generate.ts, which tries seeds until one is.)
 */
describe('generator', () => {
  it('is deterministic: the same seed makes the same game', () => {
    const a = generateGame({ id: 'game-9000', seed: 5, catalog })
    const b = generateGame({ id: 'game-9000', seed: 5, catalog })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('one of the three is always made at the workshop, and what it is made from is never lost or sold', () => {
    THREATS.forEach((threat, n) => {
      const game = generateGame({ id: 'game-9100', seed: 300 + n, catalog, threat })
      const made = game.challenge.sources.filter((s) => s.how === 'craft')
      expect(made.length, threat).toBe(1)
      const recipe = game.recipes!.find((r) => r.item === made[0].item)!
      const e = engineFor(game, 1)
      for (const need of recipe.needs ?? []) {
        const item = e.world.item(need.item)
        expect(R.isNeeded(item, e.world), `${threat}: ${need.item}`).toBe(true)
        expect(R.canSell(item, e.save, e.world), `${threat}: ${need.item}`).toBe(false)
      }
      expect(game.recipes!.some((r) => r.item === 'healing_draught' && !r.needs), threat).toBe(true)
    })
  })

  THREATS.forEach((threat, n) => {
    it(`${threat}: a valid game the solver bot wins`, () => {
      const game = generateGame({ id: `game-9${String(n + 1).padStart(3, '0')}`, seed: 100 + n, catalog, threat })
      expect(validateGame(game, catalog)).toEqual([])
      for (const t of game.towns) {
        expect(t.workshop?.name, t.id).toBeTruthy()
        for (const p of [t.mayor, t.shop.keeper, t.workshop!.keeper, ...t.npcs]) expect(p.avatar.length, `${t.id}/${p.id}`).toBeGreaterThan(10)
        for (const n of t.npcs) expect(n.lines.length, `${t.id}/${n.id}`).toBeGreaterThan(0)
        expect(t.shop.stock.length, t.id).toBeGreaterThan(3)
      }
      const r = solve(engineFor(game, 11), { cls: 'knight' })
      console.log(`${threat}: "${game.title}" · ${r.ok ? '' : `FAILED: ${r.reason} · `}${r.minutes.toFixed(0)} min · ${r.battlesWon} fights won, ${r.battlesLost} lost`)
      expect(r.ok, r.reason).toBe(true)
    })
  })
})
