/** Names, icons and short descriptions shared by the engine's choice labels and the UI. */
import type { Biome, Element, ItemDef, ItemType, Stat } from '../content/types.ts'

export const STAT_INFO: Record<Stat, { name: string; icon: string; blurb: string }> = {
  strength: { name: 'Strength', icon: '💪', blurb: 'weapon damage and how much you can carry' },
  magic: { name: 'Magic', icon: '✨', blurb: 'how strong and long-lasting potions are' },
  vigor: { name: 'Vigor', icon: '❤️', blurb: 'HP in battle' },
  luck: { name: 'Luck', icon: '🍀', blurb: 'battle gold, critical hits, and drops' },
}

export const TYPE_INFO: Record<ItemType, { name: string; plural: string }> = {
  weapon: { name: 'Weapon', plural: 'Weapons' },
  clothing: { name: 'Clothing', plural: 'Clothing' },
  potion: { name: 'Potion', plural: 'Potions' },
  key: { name: 'Key', plural: 'Keys' },
  general: { name: 'Item', plural: 'Items' },
}

export const ELEMENT_ICON: Record<Element, string> = { fire: '🔥', ice: '❄️', storm: '🌩️', holy: '🌟', poison: '☠️' }

export const TERRAIN_NAME: Record<Biome, string> = {
  plains: 'farmland',
  forest: 'deep forest',
  hills: 'rolling hills',
  coast: 'sea cliffs',
  mountain: 'mountain pass',
  swamp: 'bogland',
  snow: 'snowfields',
  volcano: 'ash plains',
  desert: 'desert',
}

export function dangerWord(danger: number): string {
  return danger < 0.75 ? 'quiet road' : danger < 1.05 ? 'some danger' : 'dangerous road'
}

export function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  return `~${m} min`
}

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Where a thing is made: potions in the cauldron, weapons and metal on the anvil, the rest at the workbench. */
export type Station = 'brew' | 'forge' | 'make'

export function station(item: ItemDef): Station {
  if (item.type === 'potion') return 'brew'
  if (item.type === 'weapon' || item.type === 'key' || /shield|helm|mail|gauntlet|ring|amulet|belt|mirror/i.test(item.name)) return 'forge'
  return 'make'
}

export const STATION_VERB: Record<Station, string> = { brew: 'Brewing', forge: 'Forging', make: 'Making' }

/** 45 → "45 s", 60 → "1 min", 90 → "1 min 30 s". */
export function craftTime(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`
}

/** One line summarising what an item does. */
export function effectText(item: ItemDef): string {
  const parts: string[] = []
  if (item.weapon) {
    parts.push(`Power ${item.weapon.power}`)
    if (item.weapon.element) parts.push(`${ELEMENT_ICON[item.weapon.element]} ${item.weapon.element}`)
    if (item.weapon.bane?.length) parts.push(`deadly to ${item.weapon.bane.join(', ')}`)
  }
  const c = item.clothing
  if (c) {
    if (c.armor) parts.push(`Armor ${Math.round(c.armor * 100)}%`)
    if (c.hp) parts.push(`HP +${Math.round(c.hp * 100)}%`)
    if (c.resist?.length) parts.push(`resists ${c.resist.map((e) => `${ELEMENT_ICON[e]} ${e}`).join(', ')}`)
    if (c.travel) parts.push(`travel −${Math.round(c.travel * 100)}% Energy`)
    if (c.gold) parts.push(`battle gold +${Math.round(c.gold * 100)}%`)
    if (c.damage) parts.push(`damage +${Math.round(c.damage * 100)}%`)
    if (c.potency) parts.push(`potions +${Math.round(c.potency * 100)}%`)
  }
  const p = item.potion
  if (p) {
    switch (p.effect) {
      case 'heal': parts.push(`Heals ${Math.round(p.power * 100)}% HP`); break
      case 'damage': parts.push(`${p.element ? ELEMENT_ICON[p.element] + ' ' : ''}damage`); break
      case 'might': parts.push(`damage ×${p.power} for ${p.seconds}s`); break
      case 'shield': parts.push(`armor +${Math.round(p.power * 100)}% for ${p.seconds}s`); break
      case 'haste': parts.push(`strikes ×${p.power} for ${p.seconds}s`); break
      case 'travel': parts.push(`rest of a trip −${Math.round(p.power * 100)}% Energy`); break
      case 'stat': parts.push(`${p.stat ? STAT_INFO[p.stat].name : 'stat'} +${p.power}`); break
    }
  }
  if (item.lasts) parts.push(`lasts ${item.lasts} trips`)
  if (item.type === 'key') parts.push('opens something')
  if (item.tags?.includes('treasure')) parts.push('treasure: sell it')
  return parts.join(' · ')
}
