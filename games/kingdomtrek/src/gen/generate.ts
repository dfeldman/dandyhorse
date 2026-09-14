/**
 * Makes a complete game file from a seed: a region of eight towns and the roads between them, the people,
 * shops, quests and hints, and a threat with the three things that beat it. A file is only a candidate:
 * tools/generate.ts keeps it only if the validator passes and the solver bot wins it in a sensible time.
 *
 * How each of the three is found varies: a mayor's quest (slay a named foe, fetch a lost thing, or deliver a
 * parcel whose recipient pays with it), a shop that sells it dear, or a locked place whose key someone trades
 * for a local good. One is always made at the workshop, from things bought and found. Side quests, trainers,
 * the wizard, places to search, road finds and recipes fill in around them, and hints in other towns point at
 * every step.
 */
import type {
  Biome, ChallengeSource, Element, EnemyDef, GameFile, Hint, ItemCatalog, ItemDef, Mayor, Npc, Quest, Recipe, Route,
  Shop, Spot, StockEntry, Threat, Workshop,
} from '../content/types.ts'
import { THREATS } from '../content/types.ts'
import { CONFIG, KINGDOM } from '../config.ts'
import { Rng } from '../engine/rng.ts'
import { ENEMIES, NAMED, ROADSIDE } from './bestiary.ts'
import { KIT_RECIPES, KIT_SECONDS, LOCAL_RECIPES } from './crafts.ts'
import { REGION, layRegion } from './map.ts'
import type { Layout } from './map.ts'
import * as M from './medieval.ts'
import type { Gender, RoleDef } from './medieval.ts'
import { PROPER_NAMES, THREAT_DEFS } from './threats.ts'
import type { ThreatDef } from './threats.ts'
import { TONES, cap, fill, sample, shuffle, slug, weighted, withArticle, withTone } from './util.ts'

export interface GenerateOptions {
  id: string
  seed: number
  catalog: ItemCatalog
  /** The threat to face; picked from the seed when absent. */
  threat?: Threat
}

export function generateGame(o: GenerateOptions): GameFile {
  return new Builder(o).build()
}

type Slot = 'weapon' | 'armor' | 'relic'
type Pattern = 'slay' | 'shop' | 'keys' | 'fetch' | 'deliver' | 'craft'
type Teller = 'mayor' | 'npc' | 'any'

/** What a quest pays: gold, items, and whether the first item is one of the three the boss requires. */
interface Reward { gold: number; items: string[]; kit: Slot | null }

/** A town while it is being filled in. */
interface Draft {
  i: number
  id: string
  name: string
  biome: Biome
  look: string
  x: number
  y: number
  crisis: boolean
  /** 0 for the westernmost town, 1 for the easternmost. */
  depth: number
  /** Towns one road away (indexes). */
  near: number[]
  blurb: string
  mayor: Mayor
  quest?: Quest
  shop: Shop
  workshop: Workshop
  /** Stock that quests and sources need, ahead of the shop's own. */
  must: StockEntry[]
  npcs: Npc[]
  spots: Spot[]
  /** Hint ids to be told here, most important first. */
  tell: { hint: string; by: Teller }[]
  /** NPCs with a job (trainer, key holder, wizard): a hint is added to their lines rather than replacing one. */
  busy: Set<string>
}

const SIDE_REWARDS = [
  'boots_of_striding', 'ring_of_vigor', 'lucky_clover', 'wizards_hat', 'gauntlets_of_might', 'travelers_cloak', 'oak_shield',
  'tome_of_might', 'tome_of_vigor', 'tome_of_arcana', 'tome_of_fortune', 'greater_healing', 'quickening_elixir', 'fur_cloak',
]
const TOMES = ['tome_of_might', 'tome_of_vigor', 'tome_of_arcana', 'tome_of_fortune']
const WEAPONS: Record<'low' | 'mid' | 'high', string[]> = {
  low: ['oak_cudgel', 'hunting_bow', 'iron_sword', 'cutlass', 'ember_spear', 'icicle_dagger', 'spark_rapier', 'thornlash', 'morningstar'],
  mid: ['war_axe', 'flame_blade', 'sunlit_mace', 'viper_dagger', 'glacier_pick', 'storm_hammer', 'longbow'],
  high: ['steel_longsword', 'elven_bow', 'scorpion_bow', 'inferno_greatsword', 'winters_edge', 'tempest_spear', 'dawnblade'],
}
const TREASURE: Record<Biome, string[]> = {
  plains: ['wolf_pelt', 'carved_tusk'], forest: ['spider_silk', 'goblin_trinket'], hills: ['eagle_feather', 'carved_tusk'],
  coast: ['pearl', 'sea_glass', 'pirate_doubloon'], mountain: ['silver_ore', 'crystal_shard'], swamp: ['goblin_trinket', 'pearl'],
  snow: ['frost_lily', 'troll_tooth'], volcano: ['ember_crystal'], desert: ['crystal_shard', 'carved_tusk'],
}
const SPOT_POTIONS = ['healing_draught', 'shield_tonic', 'potion_of_might', 'greater_healing', 'quickening_elixir', 'travelers_tonic']
const FLASK: Record<Element, string> = { fire: 'fire_flask', ice: 'frost_flask', storm: 'thunder_vial', holy: 'holy_water', poison: 'venom_vial' }
const LOCAL_POTION: Partial<Record<Biome, string>> = {
  snow: 'frost_flask', coast: 'thunder_vial', swamp: 'holy_water', volcano: 'frost_flask', forest: 'fire_flask', desert: 'venom_vial', mountain: 'thunder_vial',
}
const LOCAL_GEAR: Partial<Record<Biome, string>> = {
  snow: 'fur_cloak', swamp: 'plague_mask', coast: 'storm_charm', volcano: 'salamander_scale', desert: 'salamander_scale', mountain: 'iron_helm',
}
/** Wilder terrain wins when two towns' lands meet on a road. */
const WILD: Biome[] = ['plains', 'hills', 'forest', 'coast', 'desert', 'swamp', 'mountain', 'snow', 'volcano']
const MAX_NPCS = 4

class Builder {
  private readonly rng: Rng
  private readonly id: string
  private readonly items: Map<string, ItemDef>
  private readonly threat: Threat
  private readonly t: ThreatDef
  private ctx: Record<string, string> = {}
  private towns: Draft[] = []
  private routes: Route[] = []
  private hints: Hint[] = []
  private enemies = new Map<string, EnemyDef>()
  private sources: ChallengeSource[] = []
  private recipes: Recipe[] = []
  private townNames = new Set<string>()
  private people = new Set<string>()
  /** One-use rows of the tables: parcels, lost things, wanted goods, keys, named foes, reward items. */
  private used = new Set<string>()
  private fortress = false

  constructor(o: GenerateOptions) {
    this.rng = new Rng(o.seed)
    this.id = o.id
    this.items = new Map(o.catalog.items.map((i) => [i.id, i]))
    this.threat = o.threat ?? this.rng.pick(THREATS)
    this.t = THREAT_DEFS[this.threat]
  }

  build(): GameFile {
    const rng = this.rng
    const layout = layRegion(rng)
    this.makeTowns(layout)
    this.makeRoutes(layout)
    const [start, crisis] = this.towns
    const bossName = rng.pick(this.t.boss.names)
    const region = rng.pick(M.REGION_NAMES)
    const kit = this.t.kit
    const ruler = KINGDOM.monarch.title
    this.ctx = {
      region, Region: cap(region), realm: KINGDOM.name, ruler: `the ${ruler}`, Ruler: `The ${ruler}`,
      boss: bossName.name, Boss: cap(bossName.name), bossShort: bossName.short, BossShort: cap(bossName.short),
      start: start.name, crisis: crisis.name,
      weapon: this.the(kit.weapon), Weapon: cap(this.the(kit.weapon)), armor: this.the(kit.armor), Armor: cap(this.the(kit.armor)),
      relic: this.the(kit.relic), Relic: cap(this.the(kit.relic)),
    }
    const lair = { name: fill(rng.pick(this.t.lair.names), this.ctx), emoji: this.t.lair.emoji, text: rng.pick(this.t.lair.texts) }
    this.ctx.lair = lair.name

    for (const d of this.towns) this.populate(d)
    this.specialists()
    this.placeChallenge()
    this.sideQuests()
    this.sideChest()
    this.fillSpots()
    this.crisisTown()
    this.stockShops()
    this.sideRecipes()
    this.roadFinds()
    this.generalHints()
    this.handOutHints()

    const b = this.t.boss
    const boss: EnemyDef = {
      id: slug(bossName.name), name: bossName.name, emoji: b.emoji, family: b.family, tier: 5,
      ...(b.weakness ? { weakness: b.weakness } : {}), ...(b.resist ? { resist: b.resist } : {}), ...(b.attack ? { attack: b.attack } : {}),
      gold: [0, 0], taunt: fill(rng.pick(b.taunts), this.ctx), boss: true, avatar: rng.pick(b.avatars),
    }
    const mids = this.towns.filter((d) => d.i >= 2).map((d) => d.biome)
    const common = [...new Set(mids)].sort((p, q) => mids.filter((x) => x === q).length - mids.filter((x) => x === p).length)
    const middle = common.slice(0, 2).map((x) => rng.pick(M.LAND[x])).join(' and ')
    const title = fill(rng.pick(this.t.titles), this.ctx)

    return {
      schemaVersion: 1,
      id: this.id,
      title,
      theme: 'medieval',
      region: {
        name: region,
        blurb: `${cap(rng.pick(M.LAND.plains))} in the west, ${middle} in the middle, and in the east ${fill(this.t.east, this.ctx)}.`,
        width: REGION.width,
        height: REGION.height,
      },
      startTown: start.id,
      towns: this.towns.map((d) => ({
        id: d.id, name: d.name, biome: d.biome, appearance: d.look, x: d.x, y: d.y, blurb: d.blurb,
        ...(d.crisis ? { crisis: true } : {}),
        mayor: { ...d.mayor, ...(d.quest ? { quest: d.quest } : {}) },
        shop: d.shop, workshop: d.workshop, npcs: d.npcs, spots: d.spots,
      })),
      routes: this.routes,
      enemies: [...this.enemies.values(), boss],
      hints: this.hints,
      recipes: this.recipes,
      challenge: {
        threat: this.threat,
        title,
        summons: [
          rng.pick(M.SUMMONS.open),
          fill(this.t.danger, this.ctx),
          fill(rng.pick(M.SUMMONS.three), { ...this.ctx, weaponLore: this.t.lore.weapon, armorLore: this.t.lore.armor, relicLore: this.t.lore.relic }),
          fill(rng.pick(M.SUMMONS.find), this.ctx),
          fill(rng.pick(M.SUMMONS.close), this.ctx),
        ],
        crisisTown: crisis.id,
        lair,
        requires: [kit.weapon, kit.armor, kit.relic],
        boss: boss.id,
        victory: this.t.victory.map((l) => fill(l, this.ctx)),
        sources: this.sources,
      },
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  private item(id: string): ItemDef {
    const i = this.items.get(id)
    if (!i) throw new Error(`the generator wants item "${id}", which is not in the catalog`)
    return i
  }

  /** "Frostbrand", "the Tidestone". */
  private the(id: string): string {
    return PROPER_NAMES.has(id) ? this.item(id).name : `the ${this.item(id).name}`
  }

  private draft(id: string): Draft {
    return this.towns.find((d) => d.id === id)!
  }

  private routesOf(d: Draft): Route[] {
    return this.routes.filter((r) => r.a === d.id || r.b === d.id)
  }

  /** Roads out of a town that have no named foe yet and don't lead to the crisis. */
  private freeRoads(d: Draft): Route[] {
    const crisis = this.towns[1].id
    return this.routesOf(d).filter((r) => !r.fixed && r.a !== crisis && r.b !== crisis)
  }

  private at(): number {
    return Math.round(this.rng.range(0.35, 0.65) * 100) / 100
  }

  /** An unused row of a one-use table. */
  private fresh<T>(kind: string, list: readonly T[], key: (row: T) => string): T {
    const free = list.filter((row) => !this.used.has(`${kind}:${key(row)}`))
    const row = this.rng.pick(free.length ? free : list)
    this.used.add(`${kind}:${key(row)}`)
    return row
  }

  private other(not: Draft[], ok: (d: Draft) => boolean = () => true): Draft {
    const pool = this.towns.filter((d) => !d.crisis && !not.includes(d) && ok(d))
    return this.rng.pick(pool.length ? pool : this.towns.filter((d) => !d.crisis && !not.includes(d)))
  }

  /** Fill a line of the tables for someone in town `d`. */
  private say(t: string, d: Draft, extra: Record<string, string> = {}): string {
    return fill(t, { ...this.ctx, town: d.name, neighbor: this.towns[d.near[0]].name, foe: this.foePhrase(d), ...extra })
  }

  /** "a grey wolf" or "cave bats": something met on this town's roads. */
  private foePhrase(d: Draft): string {
    const ids = this.routesOf(d).flatMap((r) => r.enemies)
    const name = (this.enemies.get(this.rng.pick(ids)) ?? ENEMIES.wolf).name.toLowerCase()
    return /[^s]s$/.test(name) ? name : withArticle(name)
  }

  /** Women and men in equal numbers, and now and then someone who is neither, from the genders `allowed`. */
  private gender(allowed: readonly Gender[] = ['f', 'm', 'n']): Gender {
    return weighted(this.rng, allowed.map((g) => [g, g === 'n' ? 2 : 9] as const))
  }

  /** A person emoji in a random skin tone. */
  private face(emoji: string): string {
    return withTone(emoji, this.rng.pick(TONES))
  }

  private firstName(g: Gender): string {
    const free = M.FIRST_NAMES[g].filter((n) => !this.people.has(n))
    const name = this.rng.pick(free.length ? free : M.FIRST_NAMES[g])
    this.people.add(name)
    return name
  }

  // --- the land ------------------------------------------------------------------------------------

  private makeTowns(L: Layout): void {
    const biomes = this.assignBiomes(L)
    const xs = L.sites.map((s) => s.x)
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
    L.sites.forEach((s, i) => {
      const biome = biomes[i]
      const crisis = i === 1
      const name = this.townName(i === 0 ? 'capital' : biome)
      this.towns.push({
        i, id: slug(name), name, biome, x: s.x, y: s.y, crisis,
        look: i === 0 ? 'capital' : crisis ? 'ruins' : this.lookFor(biome),
        depth: (s.x - x0) / (x1 - x0),
        near: L.links.filter((l) => l.a === i || l.b === i).map((l) => (l.a === i ? l.b : l.a)),
        blurb: '',
        mayor: { id: '', name: '', emoji: '', avatar: '', title: '', greeting: [] },
        shop: { name: '', keeper: { id: '', name: '', emoji: '', avatar: '' }, lines: [], stock: [] },
        workshop: { name: '', keeper: { id: '', name: '', emoji: '', avatar: '' }, lines: [] },
        must: [], npcs: [], spots: [], tell: [], busy: new Set(),
      })
    })
  }

  /** The start is farmland, the crisis suits the threat; the rest by latitude, with no land used more than twice. */
  private assignBiomes(L: Layout): Biome[] {
    const rng = this.rng
    const out: Biome[] = L.sites.map(() => 'plains')
    out[1] = rng.pick(this.t.crisis)
    const count = new Map<Biome, number>([['plains', 1]])
    count.set(out[1], (count.get(out[1]) ?? 0) + 1)
    const byCrisis = new Set(L.links.filter((l) => l.a === 1 || l.b === 1).map((l) => (l.a === 1 ? l.b : l.a)))
    const order = L.sites.map((_, i) => i).slice(2).sort((p, q) => L.sites[p].x - L.sites[q].x)
    for (const i of order) {
      const { y } = L.sites[i]
      let pool: Biome[] = y < 210 ? ['snow', 'mountain', 'hills', 'forest'] : y > 450 ? ['coast', 'swamp', 'plains', 'forest', 'desert'] : ['forest', 'plains', 'hills', 'swamp', 'mountain']
      if (byCrisis.has(i) && rng.chance(0.6)) pool = this.t.near
      const ok = (b: Biome): boolean => (count.get(b) ?? 0) < (b === 'plains' ? 3 : 2)
        && b !== 'volcano'
        && (b !== 'coast' || y > 430 || byCrisis.has(i))
        && (b !== 'snow' || y < 330)
        && (b !== 'desert' || !count.get('desert'))
      const choices = pool.filter(ok)
      const b = choices.length ? weighted(rng, choices.map((c) => [c, c === 'desert' ? 1 : count.get(c) ? 1 : 3] as const)) : 'forest'
      out[i] = b
      count.set(b, (count.get(b) ?? 0) + 1)
    }
    return out
  }

  private townName(kind: Biome | 'capital'): string {
    const parts = M.TOWN_NAMES[kind]
    for (let n = 0; n < 500; n++) {
      const pre = this.rng.pick(parts.pre)
      const suf = this.rng.pick(parts.suf)
      const name = pre + suf
      if (pre.toLowerCase() === suf || this.townNames.has(name) || M.RESERVED_TOWNS.includes(name)) continue
      if ([...this.townNames].some((t) => t.startsWith(pre))) continue
      this.townNames.add(name)
      return name
    }
    throw new Error(`ran out of ${kind} town names`)
  }

  private lookFor(b: Biome): string {
    const r = this.rng
    switch (b) {
      case 'coast': return 'port'
      case 'mountain':
        if (!this.fortress && r.chance(0.6)) {
          this.fortress = true
          return 'fortress'
        }
        return 'hillside'
      case 'snow':
      case 'volcano': return 'hillside'
      case 'hills': return r.chance(0.5) ? 'hillside' : 'village'
      case 'plains': return r.chance(0.5) ? 'river' : 'village'
      default: return 'village'
    }
  }

  private makeRoutes(L: Layout): void {
    const crisis = this.towns[1]
    for (const l of L.links) {
      const [a, b] = [this.towns[l.a], this.towns[l.b]]
      const [lo, hi] = WILD.indexOf(a.biome) <= WILD.indexOf(b.biome) ? [a.biome, b.biome] : [b.biome, a.biome]
      const toCrisis = a === crisis || b === crisis
      let terrain: Biome = lo === hi ? lo : this.rng.chance(0.75) ? hi : lo
      if (lo === 'plains' && (hi === 'mountain' || hi === 'snow') && this.rng.chance(0.5)) terrain = 'hills'
      if (toCrisis) terrain = crisis.biome
      let danger = 0.6 + 0.5 * Math.min(1, Math.max(0, ((a.x + b.x) / 2 - 150) / 650))
      if (toCrisis) danger = Math.max(danger, 1.1) + this.rng.range(0, 0.2)
      danger = Math.round(danger * 10) / 10
      this.routes.push({ id: `r_${a.id}_${b.id}`, a: a.id, b: b.id, distance: l.distance, terrain, danger, enemies: this.roadEnemies(terrain, danger, toCrisis) })
    }
  }

  private roadEnemies(terrain: Biome, danger: number, toCrisis: boolean): string[] {
    const maxTier = danger < 0.9 ? 2 : 3
    const pool = ROADSIDE[terrain].filter((id) => ENEMIES[id].tier <= maxTier)
    let picks = sample(this.rng, pool, 3)
    if (toCrisis) picks = [...this.t.minions, picks[0]]
    picks = [...new Set(picks)]
    for (const id of picks) this.enemies.set(id, ENEMIES[id])
    return picks
  }

  // --- people ---------------------------------------------------------------------------------------

  /** The mayor, the shop, the workshop and the blurb. */
  private populate(d: Draft): void {
    const r = this.rng
    const g = this.gender()
    const title = r.pick(M.MAYOR.titles[g])
    const first = this.firstName(g)
    d.mayor = {
      id: slug(first), name: `${title} ${first}`, title, emoji: this.face(r.pick(M.MAYOR.emoji[g])),
      avatar: fill(M.MAYOR.avatar, {
        build: r.pick(M.MAYOR.builds), title: title.toLowerCase(), feature: r.pick(M.MAYOR.features[g]),
        garment: r.pick(M.MAYOR.garments), accessory: r.pick(M.MAYOR.accessories),
      }),
      greeting: d.crisis
        ? this.t.greeting.map((l) => fill(l, this.ctx))
        : [this.say(r.pick(M.MAYOR.hello), d), this.say(r.pick(d.i === 0 ? M.MAYOR.capital : M.MAYOR.local[d.biome]), d)],
    }
    const kg = this.gender()
    const [emoji, avatar] = r.pick(M.KEEPERS[kg])
    const keeper = this.firstName(kg)
    const shop = d.crisis ? { names: M.CRISIS.shopNames, lines: M.CRISIS.shopLines } : M.SHOPS[d.biome]
    d.shop = {
      name: fill(r.pick(shop.names), { keeper }), keeper: { id: slug(keeper), name: keeper, emoji: this.face(emoji), avatar },
      lines: [this.say(r.pick(shop.lines), d)], stock: [],
    }
    const wg = this.gender()
    const [wEmoji, wAvatar] = r.pick(M.CRAFTERS[wg])
    const crafter = this.firstName(wg)
    const ws = d.crisis ? { names: M.CRISIS.workshopNames, lines: M.CRISIS.workshopLines } : M.WORKSHOPS[d.biome]
    d.workshop = {
      name: fill(r.pick(ws.names), { keeper: crafter }), keeper: { id: slug(crafter), name: crafter, emoji: this.face(wEmoji), avatar: wAvatar },
      lines: [this.say(r.pick(ws.lines), d)],
    }
    const blurbs = M.BLURBS[d.look === 'capital' ? 'capital' : `${d.look}:${d.biome}`] ?? M.BLURBS[d.look] ?? M.BLURBS[`village:${d.biome}`]
    d.blurb = d.crisis ? fill(r.pick(this.t.crisisBlurbs), this.ctx) : this.say(r.pick(blurbs), d)
  }

  private addNpc(d: Draft, role: RoleDef, extra: Partial<Npc> = {}, lines?: string[], tokens: Record<string, string> = {}): Npc {
    const g = this.gender((['f', 'm', 'n'] as const).filter((x) => (role[x] ?? []).length))
    const first = this.firstName(g)
    const prefix = this.rng.pick(role.prefix)
    const npc: Npc = {
      id: slug(first), name: prefix ? `${prefix} ${first}` : first, role: role.role, emoji: this.face(this.rng.pick(role[g] ?? [])),
      avatar: this.rng.pick(role.avatar),
      lines: (lines ?? sample(this.rng, role.lines, 2)).map((l) => this.say(l, d, tokens)),
      ...extra,
    }
    d.npcs.push(npc)
    return npc
  }

  /** Someone ordinary who lives here, preferring the local trades. */
  private addFolk(d: Draft): Npc {
    const roles = M.FOLK.filter((f) => (!f.biomes || f.biomes.includes(d.biome)) && !d.npcs.some((n) => n.role === f.role))
    return this.addNpc(d, weighted(this.rng, roles.map((f) => [f, f.biomes ? 3 : 1] as const)))
  }

  /** A child with a present in the capital, three trainers, the wizard, and at least two folk everywhere. */
  private specialists(): void {
    const [start] = this.towns
    const mids = shuffle(this.rng, this.towns.filter((d) => d.i >= 2))
    this.addNpc(start, M.FOLK.find((f) => f.role === 'child')!, { gives: { item: 'healing_draught', line: M.GIFT_LINE } })
    const trainer = (d: Draft, stat: 'strength' | 'vigor' | 'magic'): void => {
      const role = this.rng.pick(M.TRAINERS[stat])
      d.busy.add(this.addNpc(d, role, { trains: { stat, price: 40 } }, role.lines).id)
    }
    trainer(start, 'strength')
    trainer(mids[0], 'vigor')
    trainer(mids[1], 'magic')
    const home = mids.slice(2).sort((p, q) => Math.abs(p.depth - 0.5) - Math.abs(q.depth - 0.5))[0]
    const W = M.WIZARD
    const g = this.gender()
    const first = this.firstName(g)
    const wizard: Npc = {
      id: slug(first), name: `${first} the ${this.rng.pick(W.epithets)}`, role: W.role, emoji: this.face(this.rng.pick(W[g])),
      avatar: this.rng.pick(W.avatar), lines: [...this.rng.pick(W.lines)], restyle: { price: W.price },
    }
    home.npcs.push(wizard)
    home.busy.add(wizard.id)
    for (const d of this.towns) if (!d.crisis) while (d.npcs.length < 2) this.addFolk(d)
  }

  // --- the three things the boss requires ------------------------------------------------------------

  private placeChallenge(): void {
    const weights: Record<Slot, [Pattern, number][]> = {
      weapon: [['slay', 5], ['fetch', 2], ['deliver', 2]],
      armor: [['shop', 6], ['slay', 1], ['deliver', 1]],
      relic: [['keys', 6], ['fetch', 2], ['deliver', 1]],
    }
    const used = new Set<Pattern>()
    const holders: Draft[] = []
    const made = KIT_RECIPES[this.threat].slot
    for (const slot of ['weapon', 'armor', 'relic'] as const) {
      // One of the three is always made at the workshop, so every game asks for some crafting.
      const pattern: Pattern = slot === made ? 'craft' : weighted(this.rng, weights[slot].filter(([p]) => !used.has(p)))
      used.add(pattern)
      const fits = (d: Draft): boolean => d.i >= 2 && !holders.includes(d) && !d.quest
        && (pattern !== 'slay' || this.freeRoads(d).length > 0) && (pattern !== 'shop' || d.depth >= 0.3)
      const pool = this.towns.filter(fits)
      const d = this.rng.pick(pool.length ? pool : this.towns.filter((x) => x.i >= 2 && !holders.includes(x) && !x.quest))
      holders.push(d)
      // The first of the three is the capital mayor's news, so the hero knows where to start.
      this.source(slot, pattern, d, slot === 'weapon' ? this.towns[0] : null)
    }
  }

  private source(slot: Slot, pattern: Pattern, d: Draft, starter: Draft | null): void {
    const id = this.t.kit[slot]
    const item = this.item(id)
    const reward: Reward = { gold: 40, items: [id], kit: slot }
    const main = (text: string): void => this.tellMain(text, d, starter)
    switch (pattern) {
      case 'slay': {
        const { foe, other } = this.slayQuest(d, reward)
        main(fill(M.HINTS.slay[0], { mayor: d.mayor.name, town: d.name, item: this.the(id), foe: foe.name }))
        this.tell(other, this.hint(fill(M.HINTS.slay[1], { Foe: cap(foe.name), town: d.name, other: other.name })), 'npc')
        this.sources.push({ item: id, how: 'quest', town: d.id, ref: d.quest!.id })
        break
      }
      case 'shop': {
        d.must.push({ item: id, qty: 1 })
        const words = { shop: d.shop.name, town: d.name, itemA: withArticle(item.name), price: String(item.value) }
        main(fill(M.HINTS.shop[0], words))
        const attack = M.ATTACK_WORD[this.t.boss.attack ?? 'fire']
        this.tell(this.towns[this.rng.pick(d.near)], this.hint(fill(M.HINTS.shop[1], { ...words, bossShort: this.ctx.bossShort, attack })), 'any')
        this.sources.push({ item: id, how: 'shop', town: d.id, ref: d.shop.keeper.id })
        break
      }
      case 'keys': {
        const k = this.lockedPlace(d, id)
        main(fill(M.HINTS.keys[0], { Item: cap(this.the(id)), spot: k.spot.name, town: d.name }))
        this.tell(d, this.hint(fill(M.HINTS.keys[1], { Spot: cap(k.spot.name), town: d.name, holder: k.holder.name, role: k.holder.role, other: k.home.name })), 'npc')
        this.tell(k.home, this.hint(fill(M.HINTS.keys[2], { holder: k.holder.name, other: k.home.name, goodA: withArticle(k.good.name.toLowerCase()) })), 'npc')
        this.tell(k.home, this.hint(fill(M.HINTS.keys[3], { shop: k.seller.shop.name, goodTown: k.seller.name, plural: M.GOODS[k.good.id] })), 'npc')
        this.sources.push({ item: id, how: 'spot', town: d.id, ref: k.spot.id })
        break
      }
      case 'fetch': {
        const f = this.lostQuest(d, reward)
        main(fill(M.HINTS.fetch[0], { mayor: d.mayor.name, town: d.name, item: this.the(id), thing: f.thing.name }))
        const hid = this.hint(fill(M.HINTS.fetch[1], { thing: f.thing.name, town: d.name, spot: f.spot.name, where: f.where.name }))
        this.tell(d, hid, 'npc')
        this.tell(f.where, hid, 'npc')
        this.sources.push({ item: id, how: 'quest', town: d.id, ref: d.quest!.id })
        break
      }
      case 'deliver': {
        const { to, who } = this.deliverQuest(d, reward)
        main(fill(M.HINTS.deliver[0], { Who: cap(who), other: to.name, item: this.the(id), parcel: this.item(d.quest!.item!).name.toLowerCase(), town: d.name }))
        this.tell(to, this.hint(fill(M.HINTS.deliver[1], { mayor: d.mayor.name, town: d.name, other: to.name })), 'any')
        this.sources.push({ item: id, how: 'quest', town: d.id, ref: d.quest!.id })
        break
      }
      case 'craft':
        this.kitRecipe(id, d, starter)
        this.sources.push({ item: id, how: 'craft', town: d.id, ref: id })
        break
    }
  }

  /**
   * One of the three is made at the workshop rather than found (KIT_RECIPES): from things sold in shops that never
   * run out, and a treasure found once in `d`, somewhere to search or as someone's gift. Hints say where.
   */
  private kitRecipe(id: string, d: Draft, starter: Draft | null): void {
    const k = KIT_RECIPES[this.threat]
    this.recipes.push({ item: id, needs: k.needs, seconds: KIT_SECONDS })
    this.tellMain(fill(M.HINTS.craft[0], { Item: cap(this.the(id)), words: k.words }), d, starter)
    const sellers: Draft[] = []
    for (const n of k.needs) {
      const it = this.item(n.item)
      if (n.qty > 1 || it.type === 'potion' || it.type === 'weapon') {
        // Sold where it never runs out, so drinking, selling or losing one can't strand the hero.
        const seller = this.other([d, ...sellers])
        sellers.push(seller)
        seller.must.push({ item: it.id })
        const plural = M.GOODS[it.id] ?? M.PLURALS[it.id] ?? `${it.name.toLowerCase()}s`
        const hid = this.hint(fill(M.HINTS.craft[1], { shop: seller.shop.name, town: seller.name, plural }))
        this.tell(seller, hid, 'any')
        this.tell(this.other([seller]), hid, 'npc')
        continue
      }
      const a = withArticle(it.name.toLowerCase())
      let hid: string
      if (d.npcs.length < MAX_NPCS && this.rng.chance(0.5)) {
        const npc = this.addFolk(d)
        npc.gives = { item: it.id, line: fill(M.CRAFT_GIFT, { thing: it.name.toLowerCase(), item: this.the(id) }) }
        d.busy.add(npc.id)
        hid = this.hint(fill(M.HINTS.craft[3], { npc: npc.name, town: d.name, a }))
      } else {
        const spot = this.newSpot(d, it.id, a)
        hid = this.hint(fill(M.HINTS.craft[2], { a, spot: spot.name, town: d.name }))
      }
      this.tell(this.other([d]), hid, 'any')
      this.tell(this.other([d]), hid, 'npc')
    }
  }

  /** What any hero can make: a Healing Draught and a tonic from pedaling alone, and a few things from local finds. */
  private sideRecipes(): void {
    const pedal = (id: string): Recipe => ({ item: id, seconds: this.item(id).value * CONFIG.craftSecondsPerGold })
    const lands = new Set<Biome>([...this.towns.map((d) => d.biome), ...this.routes.map((r) => r.terrain)])
    const local = LOCAL_RECIPES.filter((r) => r.lands.some((b) => lands.has(b)))
    this.recipes.push(
      pedal('healing_draught'),
      pedal(this.rng.pick(['travelers_tonic', 'shield_tonic', 'potion_of_might'])),
      { item: 'greater_healing', needs: [{ item: 'healing_draught', qty: 2 }], seconds: 45 },
      ...sample(this.rng, local, 2).map(({ item, needs, seconds }) => ({ item, needs, seconds })),
    )
  }

  /** A locked place in `d` holding `item`; its key is traded by someone elsewhere for a good sold in a third town. */
  private lockedPlace(d: Draft, item: string): { spot: Spot; holder: Npc; home: Draft; good: ItemDef; seller: Draft } {
    const r = this.rng
    const keys = Object.keys(M.LOCKS).filter((k) => !this.used.has(`key:${k}`) && (!M.LOCKS[k].biomes || M.LOCKS[k].biomes!.includes(d.biome)))
    const keyId = r.pick(keys)
    this.used.add(`key:${keyId}`)
    const lock = M.LOCKS[keyId]
    const key = this.item(keyId)
    const spot: Spot = {
      id: slug(lock.spot.name), name: lock.spot.name, emoji: lock.spot.emoji, item, requiresKey: keyId,
      text: fill(lock.spot.text, { key: key.name, a: this.the(item) }), lockedText: lock.spot.locked,
    }
    d.spots.push(spot)
    const home = this.other([d], (x) => x.npcs.length < MAX_NPCS)
    const good = this.item(this.fresh('good', Object.keys(M.GOODS), (g) => g))
    const seller = this.other([home])
    seller.must.push({ item: good.id })
    const goodA = withArticle(good.name.toLowerCase())
    const holder = this.addNpc(home, lock.holder, {
      trade: { wants: good.id, gives: keyId, line: fill(lock.trade, { GoodA: cap(goodA), goodA, key: key.name }) },
    }, lock.holder.lines, { spot: spot.name, Spot: cap(spot.name), spotTown: d.name })
    home.busy.add(holder.id)
    return { spot, holder, home, good, seller }
  }

  // --- quests ------------------------------------------------------------------------------------

  private promise(r: Reward): string {
    return r.kit ? fill(M.QUEST.promiseKit, { item: this.the(r.items[0]), story: M.QUEST.story[r.kit] }) : this.rng.pick(M.QUEST.promise)
  }

  private rewardLine(r: Reward, d: Draft): string {
    return r.kit ? fill(M.QUEST.rewardKit, { item: this.the(r.items[0]), bossShort: this.ctx.bossShort }) : fill(this.rng.pick(M.QUEST.reward), { town: d.name })
  }

  /** A named foe waits on one of the town's roads while the quest is active. */
  private slayQuest(d: Draft, reward: Reward): { foe: EnemyDef; other: Draft } {
    const road = this.rng.pick(this.freeRoads(d))
    const other = this.draft(road.a === d.id ? road.b : road.a)
    const fresh = (list: EnemyDef[]): EnemyDef[] => list.filter((e) => !this.used.has(`foe:${e.id}`))
    const local = fresh(NAMED[road.terrain])
    const foe = this.rng.pick(local.length ? local : fresh(Object.values(NAMED).flat()))
    this.used.add(`foe:${foe.id}`)
    this.enemies.set(foe.id, foe)
    const id = `q_${d.id}`
    road.fixed = [{ id: `foe_${foe.id}`, enemy: foe.id, at: this.at(), quest: id }]
    const Foe = cap(foe.name)
    d.quest = {
      id, type: 'slay', title: Foe,
      offer: [
        fill(M.QUEST.slayOffer, { Foe, to: other.name, trouble: this.rng.pick(M.QUEST.slayTrouble) }),
        fill(M.QUEST.slayEnd, { foe: foe.name, promise: this.promise(reward) }),
      ],
      reminder: fill(M.QUEST.slayReminder, { Foe, to: other.name }),
      done: [fill(M.QUEST.slayDone, { Foe, town: d.name }), this.rewardLine(reward, d)],
      foe: `foe_${foe.id}`,
      reward: { gold: reward.gold, items: reward.items },
    }
    return { foe, other }
  }

  /** Something lost, hidden in a place to search in another town. */
  private lostQuest(d: Draft, reward: Reward): { thing: ItemDef; spot: Spot; where: Draft } {
    const lost = this.fresh('lost', M.LOST, (l) => l.item)
    const where = this.other([d], (x) => x.spots.length < 2)
    const thing = this.item(lost.item)
    const spot = this.newSpot(where, thing.id, this.the(thing.id))
    const how = fill(lost.how, { where: where.name })
    d.quest = {
      id: `q_${d.id}`, type: 'fetch', title: cap(this.the(thing.id)),
      offer: [this.say(lost.loss, d), fill(M.QUEST.lostEnd, { how, promise: this.promise(reward) })],
      reminder: fill(M.QUEST.lostReminder, { thing: thing.name, how }),
      done: [this.say(lost.joy, d), this.rewardLine(reward, d)],
      item: thing.id,
      reward: { gold: reward.gold, items: reward.items },
    }
    return { thing, spot, where }
  }

  /** Something to buy in another town's shop. */
  private wantedQuest(d: Draft, reward: Reward): void {
    const w = this.fresh('wanted', M.WANTED, (x) => x.item)
    const seller = this.other([d])
    seller.must.push({ item: w.item })
    const it = this.item(w.item)
    const words = { shop: seller.shop.name, where: seller.name, plural: M.GOODS[w.item] ?? M.PLURALS[w.item] ?? `${it.name}s`, itemA: w.a ?? withArticle(it.name.toLowerCase()) }
    d.quest = {
      id: `q_${d.id}`, type: 'fetch', title: w.title,
      offer: [this.say(w.need, d), fill(M.QUEST.wantedEnd, words)],
      reminder: fill(M.QUEST.wantedReminder, words),
      done: [this.say(w.joy, d), this.rewardLine(reward, d)],
      item: w.item,
      reward: { gold: reward.gold, items: reward.items },
    }
  }

  /** A parcel for another town's mayor or one of its people, who pays on delivery. */
  private deliverQuest(d: Draft, reward: Reward): { to: Draft; who: string } {
    const p = this.fresh('parcel', M.PARCELS, (x) => x.item)
    const to = this.other([d])
    const folk = to.npcs.filter((n) => !to.busy.has(n.id) && !n.gives)
    const npc = folk.length && this.rng.chance(0.4) ? this.rng.pick(folk) : null
    const who = npc ? npc.name : to.mayor.name
    const parcel = this.item(p.item)
    const lower = parcel.name.toLowerCase()
    const kit = reward.kit ? this.the(reward.items[0]) : ''
    d.quest = {
      id: `q_${d.id}`, type: 'deliver', title: `${cap(withArticle(parcel.name))} for ${to.name}`,
      offer: [
        fill(M.QUEST.deliverOffer, { parcel: lower, who, to: to.name, reason: p.reason }),
        kit ? fill(M.QUEST.deliverPayKit, { Who: cap(who), item: kit }) : this.rng.pick(M.QUEST.deliverPay),
      ],
      reminder: fill(M.QUEST.deliverReminder, { Who: cap(who), to: to.name, parcel: lower }),
      done: [fill(p.thanks, { from: d.name }), kit ? fill(M.QUEST.rewardKitDeliver, { item: kit }) : this.rng.pick(M.QUEST.rewardDeliver)],
      item: p.item,
      to: { town: to.id, ...(npc ? { npc: npc.id } : {}) },
      reward: { gold: reward.gold, items: reward.items },
    }
    return { to, who }
  }

  /** Every other town's mayor has a quest of their own: gold and something useful. */
  private sideQuests(): void {
    const rewards = shuffle(this.rng, SIDE_REWARDS)
    for (const d of this.towns) {
      if (d.crisis || d.quest) continue
      const item = rewards.pop() ?? 'greater_healing'
      this.used.add(`item:${item}`)
      const reward: Reward = { gold: Math.round((30 + 60 * d.depth) / 5) * 5, items: [item], kit: null }
      const kinds: [string, number][] = [['deliver', 4], ['wanted', 2]]
      if (this.freeRoads(d).length) kinds.push(['slay', 3])
      if (this.towns.some((x) => !x.crisis && x !== d && x.spots.length < 2)) kinds.push(['fetch', 3])
      switch (weighted(this.rng, kinds)) {
        case 'slay': {
          const { foe, other } = this.slayQuest(d, reward)
          this.tell(other, this.hint(fill(M.HINTS.slay[1], { Foe: cap(foe.name), town: d.name, other: other.name })), 'npc')
          break
        }
        case 'fetch': {
          const f = this.lostQuest(d, reward)
          const id = this.hint(fill(M.HINTS.lost, { thing: f.thing.name, town: d.name, spot: f.spot.name, where: f.where.name }))
          this.tell(d, id, 'npc')
          this.tell(f.where, id, 'npc')
          break
        }
        case 'wanted':
          this.wantedQuest(d, reward)
          break
        default:
          this.deliverQuest(d, reward)
      }
    }
  }

  // --- places to search, shops and road finds -------------------------------------------------------

  /** A new place to search in `d`, holding `item` (described as `phrase`) or gold. */
  private newSpot(d: Draft, item: string | null, phrase: string, gold?: number): Spot {
    const defs = [...M.SPOTS[d.biome], ...M.ANY_SPOTS].filter(([name]) => !d.spots.some((s) => s.name === name))
    const [name, emoji, text] = this.rng.pick(defs)
    const spot: Spot = { id: slug(name), name, emoji, ...(item ? { item } : {}), ...(gold ? { gold } : {}), text: fill(text, { a: phrase, A: cap(phrase) }) }
    d.spots.push(spot)
    return spot
  }

  /** Sometimes a key lies in one town and opens an old chest in another. */
  private sideChest(): void {
    if (!this.rng.chance(0.7)) return
    const keyTown = this.other([], (x) => x.spots.length === 0)
    const chestTown = this.other([keyTown], (x) => x.spots.length < 2)
    const key = this.item(M.OLD_CHEST.key)
    const keySpot = this.newSpot(keyTown, key.id, withArticle(key.name))
    const tomes = TOMES.filter((id) => !this.used.has(`item:${id}`))
    const prize = this.item(tomes.length ? this.rng.pick(tomes) : 'golden_idol')
    const c = M.OLD_CHEST.spot
    chestTown.spots.push({
      id: slug(c.name), name: c.name, emoji: c.emoji, item: prize.id, requiresKey: key.id,
      text: fill(c.text, { key: key.name, a: withArticle(prize.name) }), lockedText: c.locked,
    })
    this.tell(chestTown, this.hint(fill(M.HINTS.chest, { Spot: cap(c.name), town: chestTown.name, keySpot: keySpot.name, keyTown: keyTown.name })), 'any')
  }

  /** Every town has somewhere to search: treasure, a potion, or a purse of gold. */
  private fillSpots(): void {
    for (const d of this.towns) {
      if (d.crisis || d.spots.length) continue
      const roll = this.rng.float()
      if (roll < 0.4) {
        const t = this.item(this.rng.pick(TREASURE[d.biome]))
        this.newSpot(d, t.id, withArticle(t.name))
      } else if (roll < 0.8) {
        const p = this.item(this.rng.pick(SPOT_POTIONS))
        this.newSpot(d, p.id, withArticle(p.name))
      } else {
        const gold = this.rng.int(3, 8) * 5
        this.newSpot(d, null, `a purse of ${gold} gold`, gold)
      }
    }
  }

  private stockShops(): void {
    const r = this.rng
    for (const d of this.towns) {
      if (d.crisis) {
        const stock = ['healing_draught', 'greater_healing', 'shield_tonic', 'quickening_elixir', FLASK[this.t.boss.weakness ?? 'fire']]
        d.shop.stock = stock.map((item) => ({ item }))
        continue
      }
      // Weapons that hit what walks this town's roads, better toward the east.
      const weak = new Set(this.routesOf(d).flatMap((rt) => rt.enemies.map((id) => this.enemies.get(id)?.weakness)))
      const tiers = d.depth < 0.35 ? (['low', 'low'] as const) : d.depth < 0.65 ? (['low', 'mid'] as const) : (['mid', 'high'] as const)
      const weapons = tiers.map((t) => {
        const suits = WEAPONS[t].filter((id) => weak.has(this.item(id).weapon?.element))
        return r.pick(suits.length && r.chance(0.6) ? suits : WEAPONS[t])
      })
      const potions = sample(r, [
        'potion_of_might', 'shield_tonic', 'travelers_tonic', ...(d.depth > 0.3 ? ['greater_healing', 'quickening_elixir'] : []),
        ...(LOCAL_POTION[d.biome] ? [LOCAL_POTION[d.biome]!] : []),
      ], 2)
      const gear = sample(r, ['leather_cap', 'leather_vest', 'iron_helm', 'oak_shield', 'travelers_cloak', ...(d.depth > 0.4 ? ['chainmail', 'gauntlets_of_might'] : [])], 1)
      const extra = [...(LOCAL_GEAR[d.biome] ? [LOCAL_GEAR[d.biome]!] : []), ...(r.chance(0.4) ? [r.pick(M.PRODUCE[d.biome])] : [])]
      const all = [...d.must, ...['healing_draught', ...potions, ...weapons, ...gear, ...extra].map((item) => ({ item }))]
      const seen = new Set<string>()
      d.shop.stock = all.filter((e) => !seen.has(e.item) && !!seen.add(e.item)).slice(0, Math.max(8, d.must.length))
    }
  }

  private roadFinds(): void {
    for (const rt of this.routes) {
      const potions = rt.danger > 1 ? ['greater_healing', 'potion_of_might', 'shield_tonic'] : ['healing_draught', 'travelers_tonic', 'shield_tonic', 'potion_of_might']
      const item = this.rng.chance(0.5) ? this.rng.pick(potions) : this.rng.pick(TREASURE[rt.terrain])
      rt.finds = [{ id: `f${rt.id.slice(1)}`, item, at: this.at() }]
    }
  }

  // --- the crisis town and hints --------------------------------------------------------------------

  private crisisTown(): void {
    const d = this.towns[1]
    const all = this.hint(fill(M.HINTS.all, this.ctx))
    this.tell(d, all, 'mayor')
    const elder = this.rng.pick(M.FOLK.filter((f) => f.role === 'grandmother' || f.role === 'grandfather'))
    d.busy.add(this.addNpc(d, elder, { hint: all }, [this.rng.pick(M.CRISIS.elder), M.CRISIS.elderAll]).id)
    d.busy.add(this.addNpc(d, M.CRISIS.watchman, {}, this.t.watchman).id)
    const [name, emoji, text] = M.CRISIS.spot
    d.spots.push({ id: slug(name), name, emoji, item: 'greater_healing', text: fill(text, { a: withArticle(this.item('greater_healing').name) }) })
  }

  /** The boss's weakness, and the quickest road to the crisis. */
  private generalHints(): void {
    const crisis = this.towns[1]
    this.tell(this.rng.pick(this.towns.filter((d) => d.i >= 2)), this.hint(this.t.weakHint), 'npc')
    const road = this.routesOf(crisis).sort((p, q) => p.distance - q.distance)[0]
    const from = this.draft(road.a === crisis.id ? road.b : road.a)
    this.tell(from, this.hint(fill(M.HINTS.roads, { crisis: crisis.name, town: from.name })), 'npc')
  }

  private hint(text: string): string {
    const id = `h_${this.hints.length + 1}`
    this.hints.push({ id, text })
    return id
  }

  private tell(d: Draft, hint: string, by: Teller): void {
    d.tell.push({ hint, by })
  }

  /** The main hint for one of the three: told by a mayor (the capital's, for the first) and in one more town. */
  private tellMain(text: string, source: Draft, starter: Draft | null): void {
    const id = this.hint(text)
    const first = starter ?? this.other([source], (x) => x.i !== 0)
    this.tell(first, id, 'mayor')
    this.tell(this.other([source, first]), id, 'any')
  }

  /**
   * Each mayor tells one hint (the one meant for a mayor, if any); townsfolk tell the rest, one each. A town
   * with more hints than people gets another townsperson, or passes the hint to a neighbour.
   */
  private handOutHints(): void {
    const text = (id: string): string => this.hints.find((h) => h.id === id)!.text
    const give = (d: Draft, npc: Npc, id: string): void => {
      npc.hint = id
      npc.lines = d.busy.has(npc.id) ? [...npc.lines, text(id)] : [npc.lines[0], text(id)]
    }
    const leftover: { hint: string; from: Draft }[] = []
    for (const d of this.towns) {
      const queue = [...d.tell]
      const mi = queue.findIndex((x) => x.by === 'mayor') >= 0 ? queue.findIndex((x) => x.by === 'mayor') : queue.findIndex((x) => x.by === 'any')
      if (mi >= 0) {
        d.mayor.hint = queue[mi].hint
        queue.splice(mi, 1)
      }
      for (const x of queue) {
        if (d.npcs.some((n) => n.hint === x.hint)) continue
        const npc = d.npcs.find((n) => !n.hint) ?? (!d.crisis && d.npcs.length < MAX_NPCS ? this.addFolk(d) : null)
        if (npc) give(d, npc, x.hint)
        else leftover.push({ hint: x.hint, from: d })
      }
    }
    for (const { hint, from } of leftover) {
      const d = [...from.near.map((i) => this.towns[i]), ...this.towns].find((x) => !x.crisis && (x.npcs.some((n) => !n.hint) || x.npcs.length < MAX_NPCS))
      if (!d) continue
      give(d, d.npcs.find((n) => !n.hint) ?? this.addFolk(d), hint)
    }
  }
}
