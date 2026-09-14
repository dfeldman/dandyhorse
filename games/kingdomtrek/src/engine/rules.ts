/**
 * Pure rules over the save and the world: inventory, gear, prices, travel cost, stat growth, quest checks.
 * No events, no randomness: the engine wraps these and tells the player what happened.
 */
import type { Element, GameIndex, ItemDef, Npc, Quest, Recipe, Route, Stat } from '../content/types.ts'
import { ITEM_TYPES } from '../content/types.ts'
import { CONFIG } from '../config.ts'
import type { SaveState, TravelWhere } from './save.ts'
import type { World } from './world.ts'

// --- inventory -----------------------------------------------------------------------------

export const count = (s: SaveState, id: string): number => s.inventory[id] ?? 0

export function give(s: SaveState, id: string, n = 1): void {
  s.inventory[id] = count(s, id) + n
}

export function take(s: SaveState, id: string, n = 1): boolean {
  const c = count(s, id)
  if (c < n) return false
  if (c === n) delete s.inventory[id]
  else s.inventory[id] = c - n
  return true
}

export interface Owned { item: ItemDef; qty: number }

/** Everything carried, grouped by type (weapons, clothing, potions, keys, items), then by name. */
export function owned(s: SaveState, w: World): Owned[] {
  return Object.entries(s.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: w.item(id), qty }))
    .sort((a, b) => ITEM_TYPES.indexOf(a.item.type) - ITEM_TYPES.indexOf(b.item.type) || a.item.name.localeCompare(b.item.name))
}

export function weight(s: SaveState, w: World): number {
  return owned(s, w).reduce((sum, o) => sum + o.item.weight * o.qty, 0)
}

export function capacity(s: SaveState): number {
  return CONFIG.strength.capacityBase + CONFIG.strength.capacityPer * s.stats.strength
}

export const overloaded = (s: SaveState, w: World): boolean => weight(s, w) > capacity(s)

// --- gear and derived battle numbers --------------------------------------------------------

export interface Gear {
  armor: number
  hp: number
  resist: Set<Element>
  travel: number
  gold: number
  damage: number
  potency: number
}

/** All clothing carried is worn; each distinct item counts once. */
export function gear(s: SaveState, w: World): Gear {
  const g: Gear = { armor: 0, hp: 0, resist: new Set(), travel: 0, gold: 0, damage: 0, potency: 0 }
  for (const { item } of owned(s, w)) {
    const c = item.clothing
    if (!c) continue
    g.armor += c.armor ?? 0
    g.hp += c.hp ?? 0
    for (const e of c.resist ?? []) g.resist.add(e)
    g.travel += c.travel ?? 0
    g.gold += c.gold ?? 0
    g.damage += c.damage ?? 0
    g.potency += c.potency ?? 0
  }
  return g
}

export function maxHp(s: SaveState, w: World): number {
  return Math.round((CONFIG.vigor.hpBase + CONFIG.vigor.hpPer * s.stats.vigor) * (1 + gear(s, w).hp))
}

export function potency(s: SaveState, w: World): number {
  return 1 + CONFIG.magic.potency * s.stats.magic + gear(s, w).potency
}

export function weaponsOwned(s: SaveState, w: World): ItemDef[] {
  return owned(s, w).filter((o) => o.item.weapon).map((o) => o.item)
}

export function bestWeapon(s: SaveState, w: World): ItemDef | null {
  return weaponsOwned(s, w).reduce<ItemDef | null>((best, i) => (!best || i.weapon!.power > best.weapon!.power ? i : best), null)
}

/** Keep the equipped weapon valid after selling or losing it. */
export function ensureWeapon(s: SaveState, w: World): void {
  if (s.weapon && count(s, s.weapon) > 0) return
  s.weapon = bestWeapon(s, w)?.id ?? null
}

/** The royal armory's blade for this level (CONFIG.armory), if it beats every weapon the hero carries. */
export function armoryGift(s: SaveState, w: World): ItemDef | null {
  const entry = CONFIG.armory.filter((a) => a.level <= s.level).pop()
  if (!entry) return null
  const blade = w.item(entry.item)
  const best = bestWeapon(s, w)
  return !best || blade.weapon!.power > best.weapon!.power ? blade : null
}

// --- travel --------------------------------------------------------------------------------

/** Trips left before a piece of gear wears out, or null if it never does. */
export function tripsLeft(s: SaveState, item: ItemDef): number | null {
  return item.lasts ? item.lasts - (s.wear[item.id] ?? 0) : null
}

/** For an item card: how many the hero has, and how many trips are left in gear that wears out. */
export function haveLines(s: SaveState, item: ItemDef): string[] {
  const left = tripsLeft(s, item)
  return [`You have ${count(s, item.id)}`, ...(left !== null ? [`${left} trip${left === 1 ? '' : 's'} left`] : [])]
}

export function travelSaving(s: SaveState, w: World): number {
  return Math.min(CONFIG.travelSavingCap, gear(s, w).travel)
}

/** Energy for a whole road, as of now. */
export function tripCost(s: SaveState, w: World, route: Route): number {
  const load = overloaded(s, w) ? CONFIG.overloadMult : 1
  return Math.round(route.distance * CONFIG.energyPerUnit * (1 - travelSaving(s, w)) * load)
}

/** Fraction of the trip still ahead. */
export function tripLeft(t: TravelWhere): number {
  return t.dir > 0 ? 1 - t.pos : t.pos
}

/**
 * Seconds to walk `remaining` Energy with `bank` banked, pedaling at `effort`: pedaling plus the bank's
 * boost while the bank lasts, then pedaling alone.
 */
export function etaSeconds(remaining: number, bank: number, effort: number): number {
  const income = Math.max(0.05, effort * CONFIG.energyPerSecond)
  const fast = income + CONFIG.boostExtra
  const boostTime = bank / CONFIG.boostExtra
  if (fast * boostTime >= remaining) return remaining / fast
  return boostTime + (remaining - fast * boostTime) / income
}

// --- money ---------------------------------------------------------------------------------

export const goldScale = (level: number): number => 1 + CONFIG.goldPerLevel * (level - 1)

export function sellPrice(item: ItemDef, s: SaveState): number {
  return Math.max(1, Math.floor(item.value * CONFIG.sellFraction * (1 + CONFIG.sellLuck * s.stats.luck)))
}

/** Plot items, keys, anything a quest still needs, and the makings of a royal item not yet made are never sold. */
export function canSell(item: ItemDef, s: SaveState, w: World): boolean {
  if (item.noSell || item.value <= 0) return false
  const requires = w.game.challenge.requires
  if (requires.includes(item.id)) return false
  for (const [id, st] of Object.entries(s.quests)) {
    if (st === 'active' && w.quests.get(id)?.quest.item === item.id) return false
  }
  return !recipes(w).some((r) => requires.includes(r.item) && count(s, r.item) === 0 && !!r.needs?.some((n) => n.item === item.id))
}

/**
 * Something the game still needs: a key, one of the challenge's items, a quest's parcel or wanted thing, what
 * someone will trade for, or what any of those is made from. A lost fight never takes these, so losing can't
 * make the game unwinnable.
 */
export function isNeeded(item: ItemDef, w: World, seen = new Set<string>()): boolean {
  if (item.type === 'key' || w.game.challenge.requires.includes(item.id)) return true
  for (const { quest } of w.quests.values()) if (quest.item === item.id) return true
  if (w.game.towns.some((t) => t.npcs.some((n) => n.trade?.wants === item.id) || t.spots.some((s) => s.requiresKey === item.id))) return true
  seen.add(item.id)
  return recipes(w).some((r) => !seen.has(r.item) && !!r.needs?.some((n) => n.item === item.id) && isNeeded(w.item(r.item), w, seen))
}

/** Remaining stock of a limited shop entry, or null for unlimited. */
export function stockLeft(s: SaveState, townId: string, entry: { item: string; qty?: number }): number | null {
  if (entry.qty == null) return null
  return entry.qty - (s.bought[`${townId}:${entry.item}`] ?? 0)
}

export function trainPrice(npc: Npc, s: SaveState): number {
  const t = npc.trains!
  return Math.round(t.price * (1 + CONFIG.trainGrowth * (s.trained[t.stat] ?? 0)))
}

// --- stats ---------------------------------------------------------------------------------

export const xpToNext = (s: SaveState, stat: Stat): number => CONFIG.statXpBase + s.stats[stat]

/** Add stat xp; returns how many points the stat gained. */
export function addXp(s: SaveState, stat: Stat, n: number): number {
  s.statXp[stat] += n
  let gained = 0
  while (s.statXp[stat] >= xpToNext(s, stat)) {
    s.statXp[stat] -= xpToNext(s, stat)
    s.stats[stat] += 1
    gained++
  }
  return gained
}

// --- crafting ------------------------------------------------------------------------------

export const recipes = (w: World): Recipe[] => w.game.recipes ?? []

export const recipeFor = (w: World, item: string): Recipe | undefined => recipes(w).find((r) => r.item === item)

/** Carrying the ingredients for one more. */
export function canCraft(s: SaveState, r: Recipe): boolean {
  return (r.needs ?? []).every((n) => count(s, n.item) >= n.qty)
}

// --- quests and the challenge --------------------------------------------------------------

/** Fetch: carrying the item. Slay: the foe is beaten. Deliveries finish at the recipient instead. */
export function questReady(s: SaveState, q: Quest): boolean {
  if (s.quests[q.id] !== 'active') return false
  if (q.type === 'fetch') return count(s, q.item!) > 0
  if (q.type === 'slay') return s.defeated.includes(q.foe!)
  return false
}

/** An active delivery whose recipient is this mayor (npcId undefined) or this npc, with the parcel in the bag. */
export function deliveryFor(s: SaveState, w: World, townId: string, npcId?: string): Quest | null {
  for (const { quest } of w.quests.values()) {
    if (quest.type !== 'deliver' || s.quests[quest.id] !== 'active' || !quest.to) continue
    if (quest.to.town === townId && quest.to.npc === npcId && count(s, quest.item!) > 0) return quest
  }
  return null
}

export function missing(s: SaveState, w: World): string[] {
  return w.game.challenge.requires.filter((id) => count(s, id) === 0)
}

/** One line for the HUD: what to do next. */
export function objective(s: SaveState, w: World): string {
  const c = w.game.challenge
  const miss = missing(s, w)
  if (!miss.length) return `Face ${w.enemy(c.boss).name} at ${w.town(c.crisisTown).name}!`
  const have = c.requires.length - miss.length
  return `Royal quest ${have}/${c.requires.length} · ${recipeFor(w, miss[0]) ? 'make' : 'seek'} the ${w.item(miss[0]).name}`
}

/** The required weapon the boss's HP is balanced around (DESIGN.md §7). */
export function bossWeapon(w: World): ItemDef | undefined {
  return w.game.challenge.requires.map((id) => w.item(id)).find((i) => i.weapon)
}

/** Where the hero is, in a few words (title screen). */
export function whereText(s: SaveState, w: World): string {
  const where = s.where
  if (where.kind === 'town') return `In ${w.towns.get(where.town)?.name ?? where.town}`
  if (where.kind === 'travel') return `On the road to ${w.towns.get(where.to)?.name ?? where.to}`
  return 'In the throne room'
}

/** The first game not yet completed; when all are done, cycle through them again. */
export function nextGameId(s: SaveState, index: GameIndex): string {
  const fresh = index.games.find((g) => !s.completedGames.includes(g.id))
  if (fresh) return fresh.id
  return index.games[s.completedGames.length % index.games.length].id
}
