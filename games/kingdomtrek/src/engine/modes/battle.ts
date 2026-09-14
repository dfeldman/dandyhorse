import type { EnemyDef, ItemDef } from '../../content/types.ts'
import { CONFIG } from '../../config.ts'
import { STYLE_TEXT, createBattle } from '../battle.ts'
import type { Battle, BattleHero } from '../battle.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import type { Encounter } from '../save.ts'

export type BattlePhase = 'intro' | 'fight' | 'over'

const BATTLE_POTIONS = new Set(['heal', 'damage', 'might', 'shield', 'haste'])
export const usableInBattle = (item: ItemDef): boolean => !!item.potion && BATTLE_POTIONS.has(item.potion.effect)

/**
 * A fight. It starts by itself, the player pedals to strike, and may drink potions or switch weapons.
 * The results screen continues by itself after a few seconds.
 */
export class BattleMode implements Mode {
  readonly kind = 'battle' as const
  readonly spendsEffort = true
  readonly enemy: EnemyDef
  readonly encounter: Encounter | null
  readonly battle: Battle
  phase: BattlePhase = 'intro'
  /** Seconds in the current phase. */
  t = 0
  menu: 'main' | 'weapons' = 'main'
  result: { gold: number; items: string[]; lines: string[] } | null = null
  /** The latest thing that happened, shown under the fight. */
  message: string
  private engine: Engine

  constructor(engine: Engine, enemy: EnemyDef, encounter: Encounter | null) {
    this.engine = engine
    this.enemy = enemy
    this.encounter = encounter
    const s = engine.save
    const w = engine.world
    const hp = R.maxHp(s, w)
    const hero: BattleHero = {
      hp, maxHp: hp, strength: s.stats.strength, luck: s.stats.luck, potency: R.potency(s, w),
      weapon: s.weapon ? w.item(s.weapon) : null, gear: R.gear(s, w),
    }
    this.battle = createBattle(
      enemy, s.level, hero, engine.rng, (event) => engine.emit({ type: 'battle', event }),
      enemy.boss ? R.bossWeapon(w) : undefined,
    )
    this.message = enemy.taunt
  }

  step(dt: number, effort: number): void {
    this.t += dt
    if (this.phase === 'intro') {
      if (this.t >= CONFIG.battle.introSeconds) this.begin()
    } else if (this.phase === 'fight') {
      this.battle.step(dt, effort)
      if (this.battle.outcome) this.settle()
    } else if (this.t >= CONFIG.battle.resultSeconds) {
      this.engine.endBattle(this)
    }
  }

  private begin(): void {
    this.phase = 'fight'
    this.t = 0
    this.message = STYLE_TEXT[this.battle.style].go
  }

  private settle(): void {
    this.result = this.engine.settleBattle(this)
    this.phase = 'over'
    this.t = 0
    this.message = this.result.lines[0]
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const s = e.save
    const w = e.world
    if (this.phase === 'intro') return { title: this.enemy.name, options: [{ id: 'fight', label: '⚔️ Fight!' }] }
    if (this.phase === 'over') {
      const o = this.battle.outcome
      return {
        title: o === 'won' ? 'Victory!' : o === 'lost' ? 'Defeated' : 'Escaped',
        options: [{ id: 'continue', label: 'Continue ▶' }],
        backId: 'continue',
        countdown: Math.max(0, CONFIG.battle.resultSeconds - this.t),
      }
    }
    if (this.menu === 'weapons') {
      const opts: ChoiceOption[] = R.weaponsOwned(s, w).map((i) => ({
        id: `wield:${i.id}`, label: `${i.emoji} ${i.name}${i.id === s.weapon ? ' ✓' : ''}`, itemId: i.id,
      }))
      opts.push({ id: 'back', label: '↩ Back' })
      return { title: 'Switch weapon', options: opts, backId: 'back' }
    }
    const opts: ChoiceOption[] = [{ id: 'pedal', label: '🚴 Keep pedaling!', hint: STYLE_TEXT[this.battle.style].pedal }]
    for (const { item, qty } of R.owned(s, w)) {
      if (usableInBattle(item)) opts.push({ id: `potion:${item.id}`, label: `${item.emoji} ${item.name} ×${qty}`, itemId: item.id })
    }
    const weapons = R.weaponsOwned(s, w)
    if (weapons.length > 1) {
      const cur = s.weapon ? w.item(s.weapon).name : 'bare hands'
      opts.push({ id: 'weapons', label: `🗡️ Weapon: ${cur} ▶`, hint: 'Switch to another weapon' })
    }
    if (!this.enemy.boss) opts.push({ id: 'flee', label: '🏃 Flee', hint: 'No reward: you drop a little gold and lose some ground' })
    return { title: `Battle: ${this.enemy.name}`, options: opts }
  }

  choose(id: string): void {
    const e = this.engine
    const s = e.save
    const w = e.world
    if (this.phase === 'intro') {
      if (id === 'fight') this.begin()
      return
    }
    if (this.phase === 'over') {
      if (id === 'continue') e.endBattle(this)
      return
    }
    if (id === 'weapons') this.menu = 'weapons'
    else if (id === 'back') this.menu = 'main'
    else if (id.startsWith('wield:')) {
      const item = w.item(id.slice(6))
      s.weapon = item.id
      this.battle.switchWeapon(item)
      this.menu = 'main'
      this.message = `You ready the ${item.name}.`
    } else if (id.startsWith('potion:')) {
      const item = w.item(id.slice(7))
      if (R.count(s, item.id) > 0) {
        const text = this.battle.usePotion(item)
        if (text) {
          e.take(item.id)
          this.message = text
        }
      }
      if (this.battle.outcome) this.settle()
    } else if (id === 'flee') {
      if (this.battle.flee()) this.settle()
    }
  }
}
