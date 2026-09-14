import { describe, expect, it } from 'vitest'
import { layoutTown, placeUnder } from '../src/render/town.ts'
import { Bot } from './bot.ts'
import { newEngine } from './helpers.ts'

/** Oakvale as a player first sees it, laid out in a 900 × 600 view under a 60 px HUD. */
function oakvale() {
  const e = newEngine(1)
  new Bot(e).start('knight')
  const town = e.world.town((e.save.where as { town: string }).town)
  const V = { x: 0, y: 60, w: 900, h: 600 }
  return { e, town, L: layoutTown(e, town), V, u: Math.min(V.w, V.h) * 0.1 }
}

describe('tapping a place in town', () => {
  it('finds the place under a tap, and nothing on bare ground', () => {
    const { L, V, u } = oakvale()
    for (const p of L.places) expect(placeUnder(L, V, u, [], V.x + p.rx * V.w, V.y + p.ry * V.h)).toBe(p.id)
    expect(placeUnder(L, V, u, [], V.x + 2, V.y + 2)).toBeNull()
  })

  it('every place it finds is a choice in the town list; a spot already searched is not', () => {
    const { e, town, L, V, u } = oakvale()
    const ids = new Set(e.choices().options.map((o) => o.id))
    for (const p of L.places) expect(ids.has(p.id)).toBe(true)
    const spot = L.places.find((p) => p.kind === 'spot')
    if (spot) {
      const searched = [spot.id.slice(5)]
      expect(placeUnder(L, V, u, searched, V.x + spot.rx * V.w, V.y + spot.ry * V.h)).not.toBe(spot.id)
    }
    expect(town.spots.length).toBeGreaterThan(0)
  })
})
