/**
 * Battle styles (docs/DESIGN.md §7). The engine only uses the `Battle` interface, so a new style is a new class
 * plus a case in `createBattle`, chosen by the enemy's `battle` setting. Bosses always fight for hit points.
 */
import type { BattleStyle, Element, EnemyDef, ItemDef } from '../content/types.ts'
import { CONFIG, typical } from '../config.ts'
import type { Gear } from './rules.ts'
import type { Rng } from './rng.ts'

export interface BattleHero {
  hp: number
  maxHp: number
  strength: number
  luck: number
  potency: number
  weapon: ItemDef | null
  gear: Gear
}

export type BattleEvent =
  | { type: 'strike'; damage: number; crit: boolean; effective: 'strong' | 'weak' | null }
  | { type: 'hurt'; damage: number; resisted: boolean }
  | { type: 'potion'; item: ItemDef; text: string }
  /** A contest enemy heaves or sprints. */
  | { type: 'surge'; text: string }

export type Outcome = 'won' | 'lost' | 'fled'

export interface Buff { kind: 'might' | 'shield' | 'haste'; value: number; left: number }

/**
 * What the renderer needs. Every style fills the HP fields (a contest reports each side's share of the
 * contest as "HP", so bots and summaries work unchanged); contests add their own.
 */
export interface BattleView {
  style: BattleStyle
  heroHp: number
  heroMaxHp: number
  enemyHp: number
  enemyMaxHp: number
  /** 0–1: the hero's next strike. */
  strike: number
  /** 0–1: the enemy's next attack (a contest: 1 while it surges). */
  enemyCharge: number
  buffs: Buff[]
  /** Tug of war: the rope, −1 (the enemy wins) to +1 (the hero wins). */
  rope?: number
  /** Race: how far each runner has got, 0–1. */
  heroPos?: number
  enemyPos?: number
  /** Contests: each side's pull or speed right now (1 = a typical hero at a steady pace). */
  heroForce?: number
  enemyForce?: number
  surging?: boolean
}

export interface Battle {
  readonly style: BattleStyle
  readonly enemy: EnemyDef
  readonly hero: BattleHero
  outcome: Outcome | null
  potionsUsed: number
  /** Lowest HP fraction reached (Vigor grows from close fights). */
  lowest: number
  step(dt: number, effort: number): void
  /** Returns what happened, or null if this potion does nothing in battle. */
  usePotion(item: ItemDef): string | null
  switchWeapon(item: ItemDef | null): void
  flee(): boolean
  view(): BattleView
}

/** Words for each style: the intro banner, the prompt once it starts, and the hint on "keep pedaling". */
export const STYLE_TEXT: Record<BattleStyle, { intro: (name: string) => string; go: string; pedal: string }> = {
  hp: { intro: (n) => `${n} blocks the road!`, go: 'Pedal to strike!', pedal: 'Every pedal stroke powers your next strike' },
  tug: { intro: (n) => `${n} wants a tug of war!`, go: 'Pedal to pull!', pedal: 'Pull harder when it heaves!' },
  race: { intro: (n) => `${n} races you to the flag!`, go: 'Pedal to run!', pedal: 'Sprint when it sprints!' },
}

export function createBattle(
  enemy: EnemyDef, level: number, hero: BattleHero, rng: Rng, emit: (e: BattleEvent) => void, bossWeapon?: ItemDef,
): Battle {
  const style = enemy.boss ? 'hp' : enemy.battle ?? 'hp'
  switch (style) {
    case 'hp': return new HpBattle(enemy, level, hero, rng, emit, bossWeapon)
    case 'tug':
    case 'race': return new ContestBattle(style, enemy, level, hero, rng, emit)
  }
}

// --- shared math ---------------------------------------------------------------------------

/** Element and bane multiplier of a weapon against an enemy. */
export function weaponMult(weapon: ItemDef | null, enemy: EnemyDef): number {
  const w = weapon?.weapon
  if (!w) return 1
  return elementMult(w.element, enemy) * (w.bane?.includes(enemy.family) ? CONFIG.battle.baneMult : 1)
}

export function elementMult(el: Element | undefined, enemy: EnemyDef): number {
  if (!el) return 1
  if (el === enemy.weakness) return CONFIG.battle.weakMult
  if (el === enemy.resist) return CONFIG.battle.resistMult
  return 1
}

/**
 * Enemy numbers for a hero of `level`, calibrated to the typical hero so fights keep their length at any
 * level. A boss's HP assumes the required weapon (`bossWeapon`) at typical Strength.
 */
export function enemyStats(enemy: EnemyDef, level: number, bossWeapon?: ItemDef): { maxHp: number; dps: number } {
  const b = CONFIG.battle
  const secs = b.tierSeconds[enemy.tier]
  let maxHp = secs * typical.dps(level)
  if (enemy.boss && bossWeapon?.weapon) {
    maxHp = secs * b.strikeRate * bossWeapon.weapon.power
      * (1 + CONFIG.strength.damage * typical.strength(level)) * weaponMult(bossWeapon, enemy)
  }
  const dps = enemy.boss
    ? (typical.hp(level) / (secs * b.bossSafety)) * b.bossUnresisted
    : typical.hp(level) / (secs * b.safety)
  return { maxHp: Math.round(maxHp), dps }
}

const FISTS = 3

/** Buff potions work the same in every style. */
function buffPotion(buffs: Buff[], item: ItemDef, potency: number, words: Record<Buff['kind'], string>): { buffs: Buff[]; text: string } | null {
  const p = item.potion
  if (!p || (p.effect !== 'might' && p.effect !== 'shield' && p.effect !== 'haste')) return null
  const secs = Math.round((p.seconds ?? 15) * potency)
  const kind = p.effect
  return { buffs: [...buffs.filter((b) => b.kind !== kind), { kind, value: p.power, left: secs }], text: `${item.name}: ${words[kind]} for ${secs}s` }
}

// --- hp: strike meter vs attack timer -------------------------------------------------------

class HpBattle implements Battle {
  readonly style = 'hp' as const
  readonly enemy: EnemyDef
  readonly hero: BattleHero
  outcome: Outcome | null = null
  potionsUsed = 0
  lowest = 1
  private level: number
  private rng: Rng
  private emit: (e: BattleEvent) => void
  private enemyHp: number
  private enemyMaxHp: number
  private enemyDps: number
  private strike = 0
  private interval: number
  private timer: number
  private buffs: Buff[] = []

  constructor(enemy: EnemyDef, level: number, hero: BattleHero, rng: Rng, emit: (e: BattleEvent) => void, bossWeapon?: ItemDef) {
    this.enemy = enemy
    this.hero = hero
    this.level = level
    this.rng = rng
    this.emit = emit
    const st = enemyStats(enemy, level, bossWeapon)
    this.enemyHp = this.enemyMaxHp = st.maxHp
    this.enemyDps = st.dps
    this.interval = this.nextInterval()
    this.timer = this.interval
  }

  private nextInterval(): number {
    return CONFIG.battle.enemyInterval * this.rng.range(0.8, 1.2)
  }

  private buff(kind: Buff['kind']): number | null {
    return this.buffs.find((b) => b.kind === kind)?.value ?? null
  }

  step(dt: number, effort: number): void {
    if (this.outcome) return
    for (const b of this.buffs) b.left -= dt
    this.buffs = this.buffs.filter((b) => b.left > 0)

    this.strike += CONFIG.battle.strikeRate * Math.max(0, effort) * (this.buff('haste') ?? 1) * dt
    while (this.strike >= 1 && this.enemyHp > 0) {
      this.strike -= 1
      this.hit()
    }
    if (this.enemyHp <= 0) {
      this.outcome = 'won'
      return
    }
    this.timer -= dt
    if (this.timer <= 0) {
      this.attack()
      this.interval = this.nextInterval()
      this.timer += this.interval
    }
    if (this.hero.hp <= 0) this.outcome = 'lost'
  }

  private hit(): void {
    const b = CONFIG.battle
    const w = this.hero.weapon
    const mult = weaponMult(w, this.enemy)
    let dmg = (w?.weapon?.power ?? FISTS)
      * (1 + CONFIG.strength.damage * this.hero.strength + this.hero.gear.damage)
      * mult * (this.buff('might') ?? 1) * this.rng.range(b.randomLo, b.randomHi)
    const crit = this.rng.chance(b.critBase + CONFIG.luck.crit * this.hero.luck)
    if (crit) dmg *= b.critMult
    dmg = Math.max(1, Math.round(dmg))
    this.enemyHp = Math.max(0, this.enemyHp - dmg)
    this.emit({ type: 'strike', damage: dmg, crit, effective: mult > 1 ? 'strong' : mult < 1 ? 'weak' : null })
  }

  private attack(): void {
    const armor = Math.min(CONFIG.battle.armorCap, this.hero.gear.armor + (this.buff('shield') ?? 0))
    const resisted = !!this.enemy.attack && this.hero.gear.resist.has(this.enemy.attack)
    const dmg = Math.max(1, Math.round(
      this.enemyDps * this.interval * (1 - armor) * (resisted ? CONFIG.battle.resistMult : 1) * this.rng.range(0.8, 1.2),
    ))
    this.hero.hp = Math.max(0, this.hero.hp - dmg)
    this.lowest = Math.min(this.lowest, this.hero.hp / this.hero.maxHp)
    this.emit({ type: 'hurt', damage: dmg, resisted })
  }

  usePotion(item: ItemDef): string | null {
    const p = item.potion
    if (!p || this.outcome) return null
    const pot = this.hero.potency
    let text: string
    switch (p.effect) {
      case 'heal': {
        const before = this.hero.hp
        this.hero.hp = Math.min(this.hero.maxHp, Math.round(this.hero.hp + p.power * this.hero.maxHp * pot))
        text = `${item.name}: +${this.hero.hp - before} HP`
        break
      }
      case 'damage': {
        const dmg = Math.round(p.power * typical.dps(this.level) * pot * elementMult(p.element, this.enemy))
        this.enemyHp = Math.max(0, this.enemyHp - dmg)
        text = `${item.name}: ${dmg} damage!`
        if (this.enemyHp <= 0) this.outcome = 'won'
        break
      }
      default: {
        const b = buffPotion(this.buffs, item, pot, { might: 'mighty blows', shield: 'tough as bark', haste: 'lightning quick' })
        if (!b) return null
        this.buffs = b.buffs
        text = b.text
      }
    }
    this.potionsUsed++
    this.emit({ type: 'potion', item, text })
    return text
  }

  switchWeapon(item: ItemDef | null): void {
    this.hero.weapon = item
  }

  flee(): boolean {
    if (this.enemy.boss || this.outcome) return false
    this.outcome = 'fled'
    return true
  }

  view(): BattleView {
    return {
      style: 'hp',
      heroHp: this.hero.hp,
      heroMaxHp: this.hero.maxHp,
      enemyHp: this.enemyHp,
      enemyMaxHp: this.enemyMaxHp,
      strike: Math.min(1, this.strike),
      enemyCharge: Math.min(1, Math.max(0, 1 - this.timer / this.interval)),
      buffs: this.buffs.map((b) => ({ ...b })),
    }
  }
}

// --- contests: tug of war and races -------------------------------------------------------------

/** Seconds a surge lasts, and the gap between surges (so surges are about a quarter of the time). */
const SURGE_SECONDS = 3
const SURGE_GAP: [number, number] = [7, 11]
/**
 * How hard the enemy pulls or runs while surging, as a multiple of its average; between surges it eases off so
 * the average stays 1. A racer sprints faster than a steady hero, then all but stops to get its breath back.
 */
const SURGE: Record<'tug' | 'race', number> = { tug: 3, race: 3.5 }
const SURGE_SHARE = SURGE_SECONDS / (SURGE_SECONDS + (SURGE_GAP[0] + SURGE_GAP[1]) / 2)
/**
 * Tug of war: how far the enemy's heaves and pauses swing the rope. It leaves the average alone (the enemy's
 * average pull still sets how fast a hero who stops pedaling loses), but at a steady pace a heave drags the rope
 * back and a pause lets the hero win it back, so the rope goes back and forth.
 */
const TUG_SWING = 1.5
/** Race: the enemy starts this far down the track, so the hero has to catch it. */
const RACE_HEAD_START = 0.3

/**
 * No hit points: the hero's pull (or speed) is their battle strength (weapon, Strength, element, crits) times
 * live effort, and the enemy's comes in surges. Calibrated like a fight: a typical hero at a steady pace wins
 * in the tier's time, and doing nothing loses in `safety` times that. In a tug of war a surge drags the rope
 * back unless the hero pedals harder.
 */
class ContestBattle implements Battle {
  readonly style: 'tug' | 'race'
  readonly enemy: EnemyDef
  readonly hero: BattleHero
  outcome: Outcome | null = null
  potionsUsed = 0
  lowest = 1
  private level: number
  private rng: Rng
  private emit: (e: BattleEvent) => void
  private secs: number
  private strength: number
  private rope = 0
  private heroPos = 0
  private enemyPos = 0
  private surgeIn: number
  private surgeLeft = 0
  private heroForce = 0
  private enemyForce = 0
  private buffs: Buff[] = []

  constructor(style: 'tug' | 'race', enemy: EnemyDef, level: number, hero: BattleHero, rng: Rng, emit: (e: BattleEvent) => void) {
    this.style = style
    this.enemy = enemy
    this.hero = hero
    this.level = level
    this.rng = rng
    this.emit = emit
    this.secs = CONFIG.battle.tierSeconds[enemy.tier]
    this.strength = this.measure()
    this.surgeIn = rng.range(4, 8)
    if (style === 'race') this.enemyPos = RACE_HEAD_START
  }

  /** The hero's battle strength relative to a typical hero of this level (1 = typical). */
  private measure(): number {
    const b = CONFIG.battle
    const w = this.hero.weapon
    const dps = b.strikeRate * (w?.weapon?.power ?? FISTS)
      * (1 + CONFIG.strength.damage * this.hero.strength + this.hero.gear.damage) * weaponMult(w, this.enemy)
    const crits = 1 + (b.critBase + CONFIG.luck.crit * this.hero.luck) * (b.critMult - 1)
    return (dps * crits) / typical.dps(this.level)
  }

  private buff(kind: Buff['kind']): number | null {
    return this.buffs.find((b) => b.kind === kind)?.value ?? null
  }

  /** The hero's share of the contest, 0–1 (reported as "HP"). In a race, each runner's share of their own course. */
  private share(): number {
    if (this.style === 'tug') return (1 + this.rope) / 2
    const foe = (this.enemyPos - RACE_HEAD_START) / (1 - RACE_HEAD_START)
    return Math.max(0, Math.min(1, 0.5 + this.heroPos - foe))
  }

  step(dt: number, effort: number): void {
    if (this.outcome) return
    const b = CONFIG.battle
    for (const x of this.buffs) x.left -= dt
    this.buffs = this.buffs.filter((x) => x.left > 0)

    if (this.surgeLeft > 0) {
      this.surgeLeft -= dt
      if (this.surgeLeft <= 0) this.surgeIn = this.rng.range(SURGE_GAP[0], SURGE_GAP[1])
    } else if ((this.surgeIn -= dt) <= 0) {
      this.surgeLeft = SURGE_SECONDS
      this.emit({ type: 'surge', text: this.style === 'tug' ? 'HEAVE!' : 'SPRINT!' })
    }
    const surge = SURGE[this.style]
    const pull = this.surgeLeft > 0 ? surge : (1 - SURGE_SHARE * surge) / (1 - SURGE_SHARE)
    const armor = Math.min(b.armorCap, this.hero.gear.armor + (this.buff('shield') ?? 0))
    const resisted = !!this.enemy.attack && this.hero.gear.resist.has(this.enemy.attack)
    /** The enemy's average pull or pace, after the hero's armor and resistance. */
    const avg = (1 - armor) * (resisted ? b.resistMult : 1)
    this.heroForce = Math.max(0, effort) * (this.buff('haste') ?? 1) * this.strength * (this.buff('might') ?? 1)
    this.enemyForce = pull * avg

    if (this.style === 'tug') {
      const swing = TUG_SWING * (this.enemyForce - avg)
      this.rope += ((this.heroForce * (1 + 1 / b.safety) - avg / b.safety - swing) / this.secs) * dt
      this.rope = Math.max(-1, Math.min(1, this.rope))
    } else {
      this.heroPos += (this.heroForce / this.secs) * dt
      this.enemyPos += ((this.enemyForce * (1 - RACE_HEAD_START)) / (b.safety * this.secs)) * dt
    }
    this.lowest = Math.min(this.lowest, this.share())
    if (this.rope >= 1 || this.heroPos >= 1) this.outcome = 'won'
    else if (this.rope <= -1 || this.enemyPos >= 1) this.outcome = 'lost'
  }

  usePotion(item: ItemDef): string | null {
    const p = item.potion
    if (!p || this.outcome) return null
    const pot = this.hero.potency
    const tug = this.style === 'tug'
    let text: string
    switch (p.effect) {
      case 'heal': {
        const gain = p.power * pot * 0.8
        if (tug) this.rope = Math.min(1, this.rope + gain)
        else this.heroPos = Math.min(1, this.heroPos + gain * 0.35)
        text = `${item.name}: second wind!`
        break
      }
      case 'damage': {
        const gain = (p.power / this.secs) * pot * elementMult(p.element, this.enemy)
        if (tug) this.rope = Math.min(1, this.rope + gain)
        else this.enemyPos = Math.max(0, this.enemyPos - gain * 0.5)
        text = `${item.name}: ${this.enemy.name} ${tug ? 'loses its grip' : 'stumbles'}!`
        break
      }
      default: {
        const b = buffPotion(this.buffs, item, pot, tug
          ? { might: 'mighty pulls', shield: 'sure-footed', haste: 'lightning quick' }
          : { might: 'mighty strides', shield: 'hard to pass', haste: 'lightning quick' })
        if (!b) return null
        this.buffs = b.buffs
        text = b.text
      }
    }
    if (this.rope >= 1 || this.heroPos >= 1) this.outcome = 'won'
    this.potionsUsed++
    this.emit({ type: 'potion', item, text })
    return text
  }

  switchWeapon(item: ItemDef | null): void {
    this.hero.weapon = item
    this.strength = this.measure()
  }

  flee(): boolean {
    if (this.enemy.boss || this.outcome) return false
    this.outcome = 'fled'
    return true
  }

  view(): BattleView {
    const share = this.share()
    return {
      style: this.style,
      heroHp: share * 100,
      heroMaxHp: 100,
      enemyHp: (1 - share) * 100,
      enemyMaxHp: 100,
      strike: 0,
      enemyCharge: this.surgeLeft > 0 ? 1 : 0,
      buffs: this.buffs.map((b) => ({ ...b })),
      rope: this.rope,
      heroPos: this.heroPos,
      enemyPos: this.enemyPos,
      heroForce: this.heroForce,
      enemyForce: this.enemyForce,
      surging: this.surgeLeft > 0,
    }
  }
}
