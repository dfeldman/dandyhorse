import { describe, expect, it } from 'vitest'
import { CONFIG, typical } from '../src/config.ts'
import { validateCatalog, validateGame } from '../src/content/validate.ts'
import { catalog, games, index } from './helpers.ts'

describe('content', () => {
  it('the item catalog is consistent', () => {
    expect(validateCatalog(catalog)).toEqual([])
  })

  it('every item the rules hand out exists', () => {
    const ids = new Set(catalog.items.map((i) => i.id))
    const given = [CONFIG.starterWeapon, ...CONFIG.queensGift.items, ...CONFIG.armory.map((a) => a.item), ...CONFIG.battle.prizes.map((p) => p.item)]
    for (const id of given) expect(ids.has(id), id).toBe(true)
  })

  it('the royal armory hands out ever better blades that keep up with the level curve', () => {
    let last = 0
    for (const a of CONFIG.armory) {
      const power = catalog.items.find((i) => i.id === a.item)?.weapon?.power ?? 0
      expect(power, a.item).toBeGreaterThan(last)
      expect(power, a.item).toBeGreaterThanOrEqual(Math.floor(typical.power(a.level)))
      last = power
    }
  })

  it('the validator follows recipes, and counts what can be had more than once', () => {
    const game = structuredClone(games.get('game-0000')!)
    const mire = game.towns.find((t) => t.id === 'mirewater')!
    mire.spots = mire.spots.filter((s) => s.item !== 'tidestone')
    game.recipes = [...(game.recipes ?? []), { item: 'tidestone', needs: [{ item: 'golden_idol', qty: 2 }], seconds: 240 }]
    expect(validateGame(game, catalog)).toContain('required item "tidestone" cannot be obtained')
    mire.spots.push({ id: 'idol', name: 'an old idol', emoji: '🗿', item: 'golden_idol', text: 'An idol.' })
    expect(validateGame(game, catalog)).toContain('required item "tidestone" cannot be obtained')
    mire.shop.stock.push({ item: 'golden_idol' })
    expect(validateGame(game, catalog)).toEqual([])
  })

  for (const { id } of index.games) {
    const game = games.get(id)!

    it(`${id} is valid and solvable`, () => {
      expect(validateGame(game, catalog)).toEqual([])
    })

    it(`${id}: roads take 5 to 12 minutes at a steady pace`, () => {
      for (const r of game.routes) {
        const minutes = (r.distance * CONFIG.energyPerUnit) / CONFIG.energyPerSecond / 60
        expect(minutes, r.id).toBeGreaterThanOrEqual(5)
        expect(minutes, r.id).toBeLessThanOrEqual(12)
      }
    })

    it(`${id}: every person has an avatar description`, () => {
      for (const t of game.towns) {
        for (const p of [t.mayor, t.shop.keeper, ...(t.workshop ? [t.workshop.keeper] : []), ...t.npcs]) expect(p.avatar.length, `${t.id}/${p.id}`).toBeGreaterThan(10)
      }
    })
  }
})
