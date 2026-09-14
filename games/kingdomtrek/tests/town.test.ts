import { describe, expect, it } from 'vitest'
import { LOOKS, layoutTown, streetPath } from '../src/render/town.ts'
import type { Place } from '../src/render/town.ts'
import { games, newEngine } from './helpers.ts'

describe('town layouts', () => {
  const e = newEngine(1)
  const game = games.get('game-0000')!
  const door = (p: Place): { x: number; y: number } => ({ x: p.rx, y: p.kind === 'gate' ? p.ry - 0.075 : p.ry + 0.05 * p.h })

  for (const look of LOOKS) {
    it(`${look}: every place can be walked to from the gate, and no two buildings overlap`, () => {
      for (const town of game.towns) {
        const L = layoutTown(e, town, look)
        const at = (i: number): { x: number; y: number } => ({ x: L.nodes[i][0], y: L.nodes[i][1] })
        const gate = L.places.find((p) => p.kind === 'gate')!
        for (const p of L.places) {
          const path = streetPath(L, at, door, door(gate), p.id)
          expect(path.length, `${town.id}/${p.id}`).toBeGreaterThan(0)
          expect(path[path.length - 1], `${town.id}/${p.id}`).toEqual(door(p))
        }
        const all = [...L.places, ...L.houses].filter((p) => p.kind !== 'gate')
        for (const p of all) {
          expect(p.rx, `${town.id}/${p.id}`).toBeGreaterThan(0.05)
          expect(p.rx, `${town.id}/${p.id}`).toBeLessThan(0.95)
        }
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const [a, b] = [all[i], all[j]]
            expect(Math.abs(a.rx - b.rx) > 0.1 || Math.abs(a.ry - b.ry) > 0.08, `${town.id}: ${a.id} and ${b.id}`).toBe(true)
          }
        }
      }
    })
  }
})
