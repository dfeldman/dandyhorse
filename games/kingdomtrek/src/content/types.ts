/**
 * Content schemas: the item catalog (items.json) and game files (game-NNNN.json).
 * The single source of truth for both the game and the tools. See docs/DESIGN.md §8–§9.
 */

export const STATS = ['strength', 'magic', 'vigor', 'luck'] as const
export type Stat = (typeof STATS)[number]

export const ELEMENTS = ['fire', 'ice', 'storm', 'holy', 'poison'] as const
export type Element = (typeof ELEMENTS)[number]

export const FAMILIES = [
  'beast', 'bandit', 'goblin', 'pirate', 'undead', 'spirit', 'giant', 'dragon', 'sea', 'witch', 'wizard', 'soldier',
] as const
export type Family = (typeof FAMILIES)[number]

export const ITEM_TYPES = ['weapon', 'clothing', 'potion', 'key', 'general'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const BIOMES = ['plains', 'forest', 'hills', 'coast', 'mountain', 'swamp', 'snow', 'volcano', 'desert'] as const
export type Biome = (typeof BIOMES)[number]

// --- items.json ---------------------------------------------------------------------------

export interface WeaponSpec {
  power: number
  element?: Element
  /** Families this weapon is deadly against (× CONFIG.battle.baneMult). */
  bane?: Family[]
}

export type PotionEffect = 'heal' | 'damage' | 'might' | 'shield' | 'haste' | 'travel' | 'stat'

export interface PotionSpec {
  effect: PotionEffect
  /**
   * heal: fraction of max HP. damage: seconds of a typical hero's strikes. might/haste: multiplier.
   * shield: armor added. travel: next trip's cost multiplier reduction (0.2 = −20%). stat: points.
   */
  power: number
  seconds?: number
  element?: Element
  stat?: Stat
}

export interface ClothingSpec {
  /** Fraction of damage blocked (all clothing adds up, capped). */
  armor?: number
  /** Fraction of max HP added. */
  hp?: number
  /** Attacks of these elements do half damage. */
  resist?: Element[]
  /** Fraction of travel Energy saved. */
  travel?: number
  /** Fraction of extra battle gold. */
  gold?: number
  /** Fraction of extra weapon damage. */
  damage?: number
  /** Fraction of extra potion potency. */
  potency?: number
}

export interface ItemDef {
  id: string
  name: string
  emoji: string
  type: ItemType
  value: number
  weight: number
  description: string
  weapon?: WeaponSpec
  potion?: PotionSpec
  clothing?: ClothingSpec
  /** Shops will not buy it (keys, plot items). */
  noSell?: boolean
  /**
   * Trips it lasts before wearing out. Travel gear must have it: items are kept from one adventure to the next,
   * and nothing may make the roads cheaper forever, or every level would take less pedaling than the last.
   */
  lasts?: number
  tags?: string[]
}

export interface ItemCatalog {
  schemaVersion: 1
  items: ItemDef[]
}

// --- game-NNNN.json -----------------------------------------------------------------------

/** Anyone the hero can meet. `avatar` describes how they look, for art generated later; unused for now. */
export interface Person {
  id: string
  name: string
  emoji: string
  avatar: string
}

export interface Mayor extends Person {
  /** Duke, Duchess, Count, Countess, Baron, ... */
  title: string
  greeting: string[]
  quest?: Quest
  hint?: string
}

export interface StockEntry {
  item: string
  /** Limited stock; unlimited when absent. */
  qty?: number
}

export interface Shop {
  name: string
  keeper: Person
  lines: string[]
  stock: StockEntry[]
}

/** Where anyone may use the cauldron, the anvil and the grindstone to make the game's recipes. Named like a shop. */
export interface Workshop {
  name: string
  keeper: Person
  /** What the keeper says when the hero comes in. */
  lines: string[]
}

export interface Npc extends Person {
  role: string
  lines: string[]
  hint?: string
  /** A present, given once the first time the hero talks to them. */
  gives?: { item: string; line: string }
  /** Swaps one item for another, once. */
  trade?: { wants: string; gives: string; line: string }
  /** Sells a stat point; the price grows each time (CONFIG.trainGrowth). */
  trains?: { stat: Stat; price: number }
  /** A wizard: changes the hero's look (not class or stats) for gold. */
  restyle?: { price: number }
}

/** Somewhere in town to search. Found once. */
export interface Spot {
  id: string
  name: string
  emoji: string
  item?: string
  gold?: number
  requiresKey?: string
  text: string
  lockedText?: string
}

export interface Town {
  id: string
  name: string
  biome: Biome
  x: number
  y: number
  blurb: string
  /**
   * How the town looks, in a word: village, capital, fortress, port, river, hillside or ruins. Anything else
   * is drawn as a village (and the crisis town, if it says nothing, as ruins).
   */
  appearance?: string
  crisis?: boolean
  mayor: Mayor
  shop: Shop
  /** Where the game's recipes are made. A town without one has no Craft choice. */
  workshop?: Workshop
  npcs: Npc[]
  spots: Spot[]
}

/** A named foe on a road. With `quest`, it only appears while that quest is active. Beaten once. */
export interface FixedFoe {
  id: string
  enemy: string
  /** Where on the road (0–1 of the way from `a` to `b`). */
  at: number
  quest?: string
}

export interface RouteFind {
  id: string
  item: string
  at: number
}

export interface Route {
  id: string
  a: string
  b: string
  distance: number
  terrain: Biome
  /** Expected random encounters per trip. */
  danger: number
  enemies: string[]
  fixed?: FixedFoe[]
  finds?: RouteFind[]
}

/** Only `hp` exists today; other styles (tug of war, ...) will plug in behind the same battle interface. */
/** hp: strike until it falls. tug: a tug of war. race: reach the flag first. Bosses always fight for hp. */
export type BattleStyle = 'hp' | 'tug' | 'race'

export interface EnemyDef {
  id: string
  name: string
  emoji: string
  family: Family
  /** 1–4 ordinary to named, 5 boss. Sets fight length; strength scales with the hero's level. */
  tier: 1 | 2 | 3 | 4 | 5
  weakness?: Element
  resist?: Element
  /** Element of its attacks: clothing resisting it halves the damage. */
  attack?: Element
  gold: [number, number]
  drops?: { item: string; chance: number }[]
  taunt: string
  boss?: boolean
  battle?: BattleStyle
  avatar?: string
}

export type QuestType = 'fetch' | 'deliver' | 'slay'

export interface Quest {
  id: string
  type: QuestType
  title: string
  /** What the mayor says when offering it. */
  offer: string[]
  /** What the mayor says while it is still open. */
  reminder: string
  /** Said on completion (by the recipient for a delivery, by the mayor otherwise). */
  done: string[]
  /** fetch: the item to bring back. deliver: the parcel, handed over on accepting. */
  item?: string
  /** deliver: the recipient (an npc id, or the mayor when `npc` is absent). */
  to?: { town: string; npc?: string }
  /** slay: the FixedFoe id. */
  foe?: string
  reward: { gold: number; items?: string[] }
}

export const THREATS = [
  'dragon', 'sea_monster', 'wizard_curse', 'witch_plague', 'pirates', 'enemy_nation', 'giant', 'undead', 'goblin_horde', 'frost_titan',
] as const
export type Threat = (typeof THREATS)[number]

export interface ChallengeSource {
  item: string
  how: 'quest' | 'shop' | 'spot' | 'trade' | 'gift' | 'route' | 'craft'
  town: string
  /** The quest id, spot id, npc id or route id, depending on `how` (for craft, the item: made from its recipe). */
  ref: string
}

export interface Challenge {
  threat: Threat
  title: string
  /** The monarch's words in the throne room. */
  summons: string[]
  crisisTown: string
  lair: { name: string; emoji: string; text: string }
  requires: string[]
  boss: string
  victory: string[]
  /** Where each required item can be had. Never shown to the player; for the validator and the test bot. */
  sources: ChallengeSource[]
}

export interface Hint {
  id: string
  text: string
  /** Item, town or enemy id the hint is about. */
  about?: string
}

/**
 * Something the hero can make at the workshop in any town, by pedaling (DESIGN.md §9). A meter fills at the pace
 * they pedal; each time it fills they get one and it starts on the next, until they stop or run out of ingredients.
 */
export interface Recipe {
  /** What it makes, one at a time. At most one recipe per item. */
  item: string
  /** Used up for each one made. With none, pedaling alone makes it, as many as you like. */
  needs?: { item: string; qty: number }[]
  /** Seconds of pedaling at a steady pace for each one. */
  seconds: number
}

export interface GameFile {
  schemaVersion: 1
  id: string
  title: string
  /** The look and words: "medieval" (the default and, for now, the only one). */
  theme?: string
  region: { name: string; blurb: string; width: number; height: number }
  startTown: string
  towns: Town[]
  routes: Route[]
  enemies: EnemyDef[]
  hints: Hint[]
  /** What can be made at the workshop (the Craft choice in every town). */
  recipes?: Recipe[]
  challenge: Challenge
}

export interface GameIndex {
  /** `minutes`: how long a steady-pace hero usually needs, as measured by the playthrough bot. */
  games: { id: string; title: string; threat: Threat; minutes?: number }[]
}
