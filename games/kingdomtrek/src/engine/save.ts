/**
 * The player's whole state: one JSON blob (docs/DESIGN.md §10). Only the base mode (a town or the road) is
 * saved; shops, dialogs and battles are transient, so loading puts the hero back in town or on the road.
 */
import { STATS } from '../content/types.ts'
import type { Stat } from '../content/types.ts'
import { CONFIG } from '../config.ts'
import { Rng } from './rng.ts'

export const SAVE_VERSION = 1

export interface Encounter {
  /** Position along the route, 0 at `route.a`, 1 at `route.b`. */
  at: number
  enemy: string
  /** FixedFoe id for named foes. */
  fixed?: string
  done?: boolean
}

export interface TravelWhere {
  kind: 'travel'
  route: string
  from: string
  to: string
  /** Position along the route, 0 at `route.a`, 1 at `route.b`. */
  pos: number
  /** +1 walking from a to b, −1 from b to a. */
  dir: 1 | -1
  /** Energy for the whole road, fixed when the trip starts (a Traveler's Tonic lowers it). */
  cost: number
  plan: Encounter[]
}

export type Where = { kind: 'intro' } | { kind: 'town'; town: string } | TravelWhere

export type HeroClass = keyof typeof CONFIG.classes
export const HERO_CLASSES = Object.keys(CONFIG.classes) as HeroClass[]
export const BODIES = ['sturdy', 'slim', 'tall'] as const
/** The five emoji skin tones, lightest first. */
export const SKINS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const
export const OUTFITS = ['blue', 'red', 'green', 'purple', 'gold', 'black'] as const
export const HAIRS = ['brown', 'blond', 'red', 'black', 'white', 'none'] as const
/** How long the hair is (skipped in the creator when there is none). */
export const HAIR_LENGTHS = ['short', 'shoulder', 'long'] as const
/** How the hero looks, picked in the character creator (and changed later by a wizard, for gold). */
export interface HeroLook {
  body: (typeof BODIES)[number]
  skin: (typeof SKINS)[number]
  outfit: (typeof OUTFITS)[number]
  hair: (typeof HAIRS)[number]
  hairLength: (typeof HAIR_LENGTHS)[number]
}

export interface Totals {
  playSeconds: number
  energyEarned: number
  /** Map units walked. */
  distance: number
  battlesWon: number
  battlesLost: number
  kingdomsSaved: number
  /** Things made at the workshop. */
  itemsCrafted: number
}

export interface SaveState {
  version: typeof SAVE_VERSION
  gameId: string
  level: number
  heroName: string
  /** Null until the character creator has run (and for heroes from before it existed). */
  heroClass: HeroClass | null
  look: HeroLook
  energy: number
  gold: number
  stats: Record<Stat, number>
  statXp: Record<Stat, number>
  trained: Record<Stat, number>
  inventory: Record<string, number>
  weapon: string | null
  where: Where
  quests: Record<string, 'active' | 'done'>
  /** Ids of one-time things already taken: spots, road finds, gifts ("gift:town:npc"), trades, met mayors. */
  taken: string[]
  /** FixedFoe ids beaten. */
  defeated: string[]
  hints: string[]
  visited: string[]
  /** "town:item" → how many bought, for limited stock. */
  bought: Record<string, number>
  /** Trips walked in each piece of gear that wears out (ItemDef.lasts). */
  wear: Record<string, number>
  completedGames: string[]
  /** RNG state, so a reload continues the same random sequence. */
  rng: number
  totals: Totals
  /** Play time in the current adventure (the journal compares it with the game's usual length). */
  adventureSeconds: number
  savedAt: string
}

const zeroStats = (): Record<Stat, number> => ({ strength: 0, magic: 0, vigor: 0, luck: 0 })

/** Each stat 3–7, total 18–22. */
export function rollStats(rng: Rng): Record<Stat, number> {
  const { min, max, totalMin, totalMax } = CONFIG.statStart
  for (;;) {
    const s = zeroStats()
    for (const k of STATS) s[k] = rng.int(min, max)
    const total = STATS.reduce((a, k) => a + s[k], 0)
    if (total >= totalMin && total <= totalMax) return s
  }
}

export function newSave(gameId: string, seed: number): SaveState {
  const rng = new Rng(seed)
  return {
    version: SAVE_VERSION,
    gameId,
    level: 1,
    heroName: 'Hero',
    heroClass: null,
    look: { body: 'sturdy', skin: 'medium-light', outfit: 'blue', hair: 'brown', hairLength: 'short' },
    energy: CONFIG.startEnergy,
    gold: CONFIG.startGold,
    stats: rollStats(rng),
    statXp: zeroStats(),
    trained: zeroStats(),
    inventory: { [CONFIG.starterWeapon]: 1 },
    weapon: CONFIG.starterWeapon,
    where: { kind: 'intro' },
    quests: {},
    taken: [],
    defeated: [],
    hints: [],
    visited: [],
    bought: {},
    wear: {},
    completedGames: [],
    rng: rng.state,
    totals: { playSeconds: 0, energyEarned: 0, distance: 0, battlesWon: 0, battlesLost: 0, kingdomsSaved: 0, itemsCrafted: 0 },
    adventureSeconds: 0,
    savedAt: '',
  }
}

/** Clear everything tied to one game file and stand in the throne room of the next. */
export function resetAdventure(save: SaveState, gameId: string): void {
  save.gameId = gameId
  save.where = { kind: 'intro' }
  save.quests = {}
  save.taken = []
  save.defeated = []
  save.hints = []
  save.visited = []
  save.bought = {}
  save.adventureSeconds = 0
}

/** Accept a stored blob, filling anything missing from a new save. Throws on something that is not a save. */
export function parseSave(raw: unknown): SaveState {
  const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<SaveState> | null
  if (!o || typeof o !== 'object' || typeof o.gameId !== 'string' || typeof o.level !== 'number') {
    throw new Error('Not a Kingdom Trek save')
  }
  if (o.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${String(o.version)}`)
  const base = newSave(o.gameId, 1)
  return {
    ...base,
    ...o,
    stats: { ...base.stats, ...o.stats },
    statXp: { ...base.statXp, ...o.statXp },
    trained: { ...base.trained, ...o.trained },
    totals: { ...base.totals, ...o.totals },
    look: { ...base.look, ...o.look },
  } as SaveState
}
