import { describe, expect, it } from 'vitest'
import type { GameFile } from '../src/content/types.ts'
import { Engine } from '../src/engine/engine.ts'
import { newSave } from '../src/engine/save.ts'
import { solve } from '../src/sim/solver.ts'
import { catalog, games, index, newEngine } from './helpers.ts'

describe('solver', () => {
  it('works out the chains on its own: honey for a key, the key for a shrine', () => {
    const r = solve(newEngine(5))
    expect(r.ok, r.reason).toBe(true)
    const at = (text: string): number => r.steps.findIndex((s) => s.includes(text))
    expect(at('bought the Jar of Honey')).toBeGreaterThanOrEqual(0)
    expect(at('traded with Old Salt')).toBeGreaterThan(at('bought the Jar of Honey'))
    expect(at('searched sunken shrine')).toBeGreaterThan(at('traded with Old Salt'))
    expect(r.steps[r.steps.length - 1]).toMatch(/^beat Cindermaw/)
  })

  it('says so when a required item cannot be had', () => {
    const game: GameFile = structuredClone(games.get('game-0000')!)
    for (const t of game.towns) t.shop.stock = t.shop.stock.filter((s) => s.item !== 'dragonscale_shield')
    const e = new Engine({ catalog, index, game: (id) => (id === game.id ? game : games.get(id)) }, newSave(game.id, 7), { seedSource: () => 7 })
    const r = solve(e)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Dragonscale Shield/)
  })
})
