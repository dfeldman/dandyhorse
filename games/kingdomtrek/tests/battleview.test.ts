import { describe, expect, it } from 'vitest'
import { typical } from '../src/config.ts'
import { createBattle } from '../src/engine/battle.ts'
import type { BattleHero } from '../src/engine/battle.ts'
import { Rng } from '../src/engine/rng.ts'
import * as R from '../src/engine/rules.ts'
import { knotShare } from '../src/render/battle.ts'
import { newEngine } from './helpers.ts'

/** A tug of war against a wolf, pedaled at `effort` until someone wins. */
function tug(effort: number) {
  const e = newEngine(1)
  const weapon = { ...e.world.item('iron_sword'), weapon: { power: typical.power(1) } }
  const hero: BattleHero = { hp: 60, maxHp: 60, strength: typical.strength(1), luck: 0, potency: 1, weapon, gear: R.gear(e.save, e.world) }
  const b = createBattle({ ...e.world.enemy('wolf'), battle: 'tug' }, 1, hero, new Rng(1), () => {})
  for (let t = 0; !b.outcome && t < 600; t += 0.1) b.step(0.1, effort)
  return b
}

describe('the tug of war on screen', () => {
  it('shows a won fight with the knot on the hero side and a lost one on the enemy side', () => {
    const won = tug(1.5)
    expect(won.outcome).toBe('won')
    expect(knotShare(won.view().rope)).toBe(0)
    const lost = tug(0)
    expect(lost.outcome).toBe('lost')
    expect(knotShare(lost.view().rope)).toBe(1)
  })

  it('the knot goes to the side that is winning: the hero pulls from the left', () => {
    expect(knotShare(1)).toBe(0) // the hero won: the knot at the hero's end, under "◀ You win here"
    expect(knotShare(-1)).toBe(1) // the enemy won: the knot at the enemy's end
    expect(knotShare(0)).toBe(0.5)
    expect(knotShare(0.5)).toBeLessThan(0.5)
    expect(knotShare(undefined)).toBe(0.5)
  })
})
