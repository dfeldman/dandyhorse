/**
 * The game engine: a stack of modes over one SaveState. Headless: the UI calls step() every frame, choices()
 * to draw the list and choose() when the player picks; tests and bots do exactly the same.
 * Transitions and anything that changes the save while telling the player live here, so modes stay small.
 */
import { STATS } from '../content/types.ts'
import type { EnemyDef, GameFile, GameIndex, ItemCatalog, ItemDef, Quest, Recipe, Route, Stat, Town } from '../content/types.ts'
import { CONFIG } from '../config.ts'
import type { BattleEvent } from './battle.ts'
import { finalize } from './choice.ts'
import type { ChoiceList, ChoiceOption, ChoiceSpec } from './choice.ts'
import { Rng } from './rng.ts'
import * as R from './rules.ts'
import { newSave, resetAdventure } from './save.ts'
import type { Encounter, SaveState, Totals, TravelWhere } from './save.ts'
import { STAT_INFO, cap } from './text.ts'
import { World } from './world.ts'
import { BattleMode } from './modes/battle.ts'
import { CraftMode } from './modes/craft.ts'
import { JournalMode } from './modes/journal.ts'
import { CreatorMode } from './modes/creator.ts'
import { FarewellMode, MenuMode } from './modes/menu.ts'
import { MayorMode, NpcMode } from './modes/people.ts'
import { DialogMode } from './modes/room.ts'
import type { Line } from './modes/room.ts'
import { ShopMode } from './modes/shop.ts'
import { IntroMode, TitleMode, VictoryMode } from './modes/throne.ts'
import { GateMode, TownMode } from './modes/town.ts'
import { TravelMode } from './modes/travel.ts'

export type ModeKind =
  | 'title' | 'intro' | 'town' | 'gate' | 'travel' | 'battle' | 'shop' | 'npc' | 'mayor' | 'journal' | 'dialog' | 'victory'
  | 'menu' | 'farewell' | 'creator' | 'craft'

export interface Mode {
  readonly kind: ModeKind
  /** Pedaling goes into this mode (walking, fighting, making something) instead of the Energy bank. */
  readonly spendsEffort?: boolean
  choices(): ChoiceSpec
  choose(id: string): void
  /** Called every tick while this mode is on top. */
  step?(dt: number, effort: number): void
}

export type GameEvent =
  | { type: 'mode'; kind: ModeKind }
  | { type: 'toast'; text: string }
  | { type: 'checkpoint' }
  | { type: 'arrive'; town: string; first: boolean }
  | { type: 'battle'; event: BattleEvent }
  | { type: 'statUp'; stat: Stat; value: number }
  | { type: 'levelUp'; level: number }
  /** Something was made at the workshop. */
  | { type: 'craft'; item: string }
  /** The player ended the session: the host may close the game. */
  | { type: 'exit' }

/** What the engine needs from its host: the catalog, the list of games, and the loaded game files. */
export interface EngineHost {
  catalog: ItemCatalog
  index: GameIndex
  game(id: string): GameFile | undefined
}

export interface EngineOptions {
  /** Seed for a new hero's stats (Date.now() by default; fixed in tests). */
  seedSource?: () => number
  /** Start on the title screen (default true). */
  showTitle?: boolean
}

export class Engine {
  readonly host: EngineHost
  world: World
  save: SaveState
  rng: Rng
  /** Effort of the latest tick, for labels and views. */
  effort = 1
  /** The save's totals and gold when this session began (a page load is a session), for the farewell. */
  session: { totals: Totals; gold: number }
  private seedSource: () => number
  private stack: Mode[] = []
  private events: GameEvent[] = []
  private acc = 0

  constructor(host: EngineHost, save: SaveState, opts: EngineOptions = {}) {
    this.host = host
    this.save = save
    this.session = { totals: { ...save.totals }, gold: save.gold }
    this.world = this.loadWorld(save.gameId)
    this.rng = new Rng(save.rng)
    this.seedSource = opts.seedSource ?? (() => Date.now())
    R.ensureWeapon(save, this.world)
    this.restoreBase()
    if (opts.showTitle ?? true) this.push(new TitleMode(this))
  }

  private loadWorld(id: string): World {
    const game = this.host.game(id)
    if (!game) throw new Error(`Game file ${id} is not loaded`)
    return new World(game, this.host.catalog)
  }

  private restoreBase(): void {
    const w = this.save.where
    if (w.kind === 'town' && this.world.towns.has(w.town)) this.setBase(new TownMode(this, this.world.town(w.town)))
    else if (w.kind === 'travel' && this.world.routes.has(w.route)) this.setBase(new TravelMode(this))
    else {
      this.save.where = { kind: 'intro' }
      this.setBase(new IntroMode(this))
    }
  }

  // --- the mode stack ----------------------------------------------------------------------

  get top(): Mode {
    return this.stack[this.stack.length - 1]
  }

  get base(): Mode {
    return this.stack[0]
  }

  get modes(): readonly Mode[] {
    return this.stack
  }

  push(m: Mode): void {
    this.stack.push(m)
    this.emit({ type: 'mode', kind: m.kind })
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop()
    this.emit({ type: 'mode', kind: this.top.kind })
  }

  /** Replace the whole stack. The base is what the save remembers, so checkpoint. */
  setBase(m: Mode): void {
    this.stack = [m]
    this.emit({ type: 'mode', kind: m.kind })
    this.emit({ type: 'checkpoint' })
  }

  // --- time --------------------------------------------------------------------------------

  /** Advance the game. `effort` is pedal output relative to steady pace (1.0). */
  step(seconds: number, effort: number): void {
    this.acc += seconds
    while (this.acc >= CONFIG.tick - 1e-9) {
      this.acc -= CONFIG.tick
      this.tick(CONFIG.tick, effort)
    }
  }

  private tick(dt: number, effort: number): void {
    this.effort = effort
    const top = this.top
    // The title screen, the character creator, the pause menu and the farewell are outside play: no time, no Energy.
    if (top.kind === 'title' || top.kind === 'creator' || top.kind === 'menu' || top.kind === 'farewell') return
    const income = Math.max(0, effort) * CONFIG.energyPerSecond * dt
    this.save.totals.playSeconds += dt
    this.save.adventureSeconds += dt
    this.save.totals.energyEarned += income
    // Walking spends the income as it goes; fights and the workshop use effort live. Anywhere else it is banked.
    if (top.spendsEffort) top.step?.(dt, effort)
    else {
      this.save.energy += income
      top.step?.(dt, effort)
    }
  }

  // --- choices -----------------------------------------------------------------------------

  choices(): ChoiceList {
    return finalize(this.top.choices(), `${this.stack.length}:${this.top.kind}`)
  }

  /** Pick an option by id. Returns false if it is not on the current list or is disabled. */
  choose(id: string): boolean {
    const opt = this.choices().options.find((o) => o.id === id)
    if (!opt || opt.disabled) return false
    this.top.choose(id)
    return true
  }

  back(): boolean {
    const id = this.choices().backId
    return id ? this.choose(id) : false
  }

  // --- events and saving -------------------------------------------------------------------

  emit(e: GameEvent): void {
    this.events.push(e)
  }

  toast(text: string): void {
    this.emit({ type: 'toast', text })
  }

  drain(): GameEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  /** A copy of the save for checkpointing. */
  snapshot(): SaveState {
    this.save.rng = this.rng.state
    this.save.savedAt = new Date().toISOString()
    return structuredClone(this.save)
  }

  // --- items, gold, stats, hints -----------------------------------------------------------

  give(itemId: string, n = 1, quiet = false): void {
    const item = this.world.item(itemId)
    R.give(this.save, itemId, n)
    if (!quiet) this.toast(`${item.emoji} ${item.name}${n > 1 ? ` ×${n}` : ''} added to your bag`)
    if (item.weapon) {
      const current = this.save.weapon ? this.world.item(this.save.weapon) : null
      if (!current || item.weapon.power > (current.weapon?.power ?? 0)) {
        this.save.weapon = item.id
        if (current) this.toast(`${item.emoji} Now wielding the ${item.name}`)
      }
    }
  }

  take(itemId: string, n = 1): boolean {
    const ok = R.take(this.save, itemId, n)
    R.ensureWeapon(this.save, this.world)
    return ok
  }

  addGold(n: number): void {
    this.save.gold = Math.max(0, this.save.gold + Math.round(n))
  }

  spendGold(n: number): boolean {
    if (this.save.gold < n) return false
    this.save.gold -= n
    return true
  }

  xp(stat: Stat, n: number): void {
    if (R.addXp(this.save, stat, n)) this.announceStat(stat)
  }

  raiseStat(stat: Stat, n: number): void {
    this.save.stats[stat] += n
    this.announceStat(stat)
  }

  private announceStat(stat: Stat): void {
    const info = STAT_INFO[stat]
    this.toast(`${info.icon} ${info.name} rose to ${this.save.stats[stat]}!`)
    this.emit({ type: 'statUp', stat, value: this.save.stats[stat] })
  }

  hearHint(id: string): void {
    if (this.save.hints.includes(id) || !this.world.hints.has(id)) return
    this.save.hints.push(id)
    this.toast('💡 A hint, noted in your journal')
  }

  isTaken(key: string): boolean {
    return this.save.taken.includes(key)
  }

  markTaken(key: string): void {
    if (!this.isTaken(key)) this.save.taken.push(key)
  }

  /** A stat tome: read it for a permanent point. */
  readTome(itemId: string): boolean {
    const p = this.world.item(itemId).potion
    if (p?.effect !== 'stat' || !p.stat || !this.take(itemId)) return false
    this.raiseStat(p.stat, p.power)
    return true
  }

  /** A Traveler's Tonic: the rest of the current trip costs less. */
  drinkTravelPotion(itemId: string): boolean {
    const t = this.save.where
    const item = this.world.item(itemId)
    if (t.kind !== 'travel' || item.potion?.effect !== 'travel' || !this.take(itemId)) return false
    t.cost = Math.max(1, Math.round(t.cost * (1 - item.potion.power)))
    this.toast(`${item.emoji} The rest of this trip costs ${Math.round(item.potion.power * 100)}% less Energy`)
    return true
  }

  // --- quests ------------------------------------------------------------------------------

  acceptQuest(q: Quest): void {
    this.save.quests[q.id] = 'active'
    this.toast(`📜 New quest: ${q.title}`)
    if (q.type === 'deliver' && q.item) this.give(q.item)
  }

  completeQuest(q: Quest): void {
    if ((q.type === 'fetch' || q.type === 'deliver') && q.item) this.take(q.item)
    this.save.quests[q.id] = 'done'
    const gold = Math.round(q.reward.gold * R.goldScale(this.save.level))
    this.addGold(gold)
    this.toast(`✅ ${q.title}: done! +${gold} gold`)
    for (const id of q.reward.items ?? []) this.give(id)
    this.xp('luck', 2)
  }

  // --- shops -------------------------------------------------------------------------------

  /** Buy one; returns why not, or null on success. */
  buy(town: Town, itemId: string): string | null {
    const entry = town.shop.stock.find((e) => e.item === itemId)
    if (!entry) return 'I don\'t sell that'
    const left = R.stockLeft(this.save, town.id, entry)
    if (left !== null && left <= 0) return 'that\'s sold out'
    const item = this.world.item(itemId)
    if (!this.spendGold(item.value)) return 'you can\'t afford that'
    if (entry.qty != null) {
      const key = `${town.id}:${itemId}`
      this.save.bought[key] = (this.save.bought[key] ?? 0) + 1
    }
    this.toast(`${item.emoji} Bought ${item.name} for ${item.value} gold`)
    this.give(itemId, 1, true)
    return null
  }

  sell(itemId: string): boolean {
    const item = this.world.item(itemId)
    if (!R.canSell(item, this.save, this.world) || R.count(this.save, itemId) < 1) return false
    const price = R.sellPrice(item, this.save)
    this.take(itemId)
    this.addGold(price)
    this.toast(`💰 Sold ${item.name} for ${price} gold`)
    return true
  }

  // --- town --------------------------------------------------------------------------------

  openGate(town: Town): void {
    this.push(new GateMode(this, town))
  }

  openShop(town: Town): void {
    this.push(new ShopMode(this, town))
  }

  openNpc(town: Town, npcId: string): void {
    this.push(new NpcMode(this, town, this.world.npc(town.id, npcId)))
  }

  openMayor(town: Town): void {
    this.push(new MayorMode(this, town))
  }

  openJournal(): void {
    this.push(new JournalMode(this))
  }

  /** The workshop: make things by pedaling. */
  openCraft(town: Town): void {
    this.push(new CraftMode(this, town))
  }

  /** Make one: its ingredients are used up, and it goes in the bag. */
  craft(r: Recipe): boolean {
    if (!R.canCraft(this.save, r)) return false
    for (const n of r.needs ?? []) this.take(n.item, n.qty)
    this.give(r.item, 1, true)
    this.save.totals.itemsCrafted++
    this.emit({ type: 'craft', item: r.item })
    return true
  }

  /** Lines of text with Continue, or with final options handled by `then` after the dialog closes. */
  say(heading: string, lines: Line[], options?: ChoiceOption[], then?: (id: string) => void): void {
    this.push(new DialogMode(this, heading, lines, options, then))
  }

  searchSpot(town: Town, spotId: string): void {
    const spot = town.spots.find((s) => s.id === spotId)
    const key = `spot:${town.id}:${spotId}`
    if (!spot || this.isTaken(key)) return
    if (spot.requiresKey && R.count(this.save, spot.requiresKey) === 0) {
      this.say(cap(spot.name), [{ who: null, text: spot.lockedText ?? 'It is locked.' }])
      return
    }
    this.markTaken(key)
    if (spot.requiresKey) this.take(spot.requiresKey)
    if (spot.item) this.give(spot.item)
    if (spot.gold) {
      this.addGold(spot.gold)
      this.toast(`💰 Found ${spot.gold} gold`)
    }
    this.xp('luck', 1)
    this.say(cap(spot.name), [{ who: null, text: spot.text }])
  }

  openLair(town: Town): void {
    const c = this.world.game.challenge
    const boss = this.world.enemy(c.boss)
    const miss = R.missing(this.save, this.world)
    const lines: Line[] = [{ who: null, text: c.lair.text }]
    if (miss.length) {
      const names = miss.map((id) => this.world.item(id).name).join(', ')
      lines.push({ who: null, text: `You are not ready to face ${boss.name}. You still need: ${names}.` })
      this.say(cap(c.lair.name), lines)
      return
    }
    lines.push({ who: null, text: `You carry everything the old songs spoke of. ${cap(boss.name)} waits within.` })
    this.say(
      cap(c.lair.name), lines,
      [{ id: 'fight', label: `⚔️ Face ${boss.name}` }, { id: 'no', label: `↩ Not yet: back to ${town.name}` }],
      (id) => { if (id === 'fight') this.push(new BattleMode(this, boss, null)) },
    )
  }

  // --- travel ------------------------------------------------------------------------------

  startTrip(routeId: string): void {
    const where = this.save.where
    if (where.kind !== 'town') return
    const route = this.world.route(routeId)
    const from = where.town
    const dir: 1 | -1 = route.a === from ? 1 : -1
    const to = dir > 0 ? route.b : route.a
    this.save.where = {
      kind: 'travel', route: route.id, from, to, pos: dir > 0 ? 0 : 1, dir,
      cost: R.tripCost(this.save, this.world, route), plan: this.planEncounters(route, dir),
    }
    this.setBase(new TravelMode(this))
    this.toast(`🚶 Setting out for ${this.world.town(to).name}`)
  }

  /** Random encounters by the road's danger, plus named foes whose quest is active. In walking order. */
  private planEncounters(route: Route, dir: 1 | -1): Encounter[] {
    const [lo, hi] = CONFIG.encounterSpan
    const plan: Encounter[] = []
    if (route.enemies.length) {
      const n = Math.floor(route.danger) + (this.rng.chance(route.danger % 1) ? 1 : 0)
      for (let i = 0; i < n; i++) {
        const f = this.rng.range(lo, hi)
        plan.push({ at: dir > 0 ? f : 1 - f, enemy: this.rng.pick(route.enemies) })
      }
    }
    for (const foe of route.fixed ?? []) {
      if (this.save.defeated.includes(foe.id)) continue
      if (foe.quest && this.save.quests[foe.quest] !== 'active') continue
      plan.push({ at: foe.at, enemy: foe.enemy, fixed: foe.id })
    }
    return plan.sort((a, b) => (a.at - b.at) * dir)
  }

  /** A trip is over: gear that wears out (ItemDef.lasts) wears a little, and is gone after its last trip. */
  wearTravelGear(): void {
    const s = this.save
    for (const { item } of R.owned(s, this.world)) {
      if (!item.lasts) continue
      const worn = (s.wear[item.id] ?? 0) + 1
      if (worn < item.lasts) {
        s.wear[item.id] = worn
        continue
      }
      delete s.wear[item.id]
      this.take(item.id)
      this.toast(`${item.emoji} Your ${item.name} ${item.name.endsWith('s') ? 'have' : 'has'} worn out`)
    }
  }

  arrive(townId: string): void {
    const first = !this.save.visited.includes(townId)
    if (first) this.save.visited.push(townId)
    this.save.where = { kind: 'town', town: townId }
    const town = this.world.town(townId)
    this.setBase(new TownMode(this, town))
    this.emit({ type: 'arrive', town: townId, first })
    this.toast(first ? `🏰 Welcome to ${town.name}!` : `🏰 Back in ${town.name}`)
  }

  // --- battle ------------------------------------------------------------------------------

  startEncounter(enc: Encounter): void {
    this.push(new BattleMode(this, this.world.enemy(enc.enemy), enc))
  }

  /** Apply the outcome to the save; returns the lines for the results screen. */
  settleBattle(m: BattleMode): { gold: number; items: string[]; lines: string[] } {
    const s = this.save
    const b = m.battle
    const e = m.enemy
    const lines: string[] = []
    const items: string[] = []
    let gold = 0
    if (b.outcome === 'won') {
      s.totals.battlesWon++
      if (m.encounter?.fixed) s.defeated.push(m.encounter.fixed)
      lines.push(`${cap(e.name)} is defeated!`)
      if (!e.boss) {
        const bonus = 1 + CONFIG.luck.gold * s.stats.luck + R.gear(s, this.world).gold
        gold = Math.round(this.rng.int(e.gold[0], e.gold[1]) * R.goldScale(s.level) * bonus)
        this.addGold(gold)
        if (gold) lines.push(`+${gold} gold`)
        for (const d of e.drops ?? []) {
          if (this.rng.chance(d.chance * (1 + CONFIG.luck.drops * s.stats.luck))) {
            this.give(d.item, 1, true)
            items.push(d.item)
            lines.push(`Found: ${this.world.item(d.item).emoji} ${this.world.item(d.item).name}`)
          }
        }
        const prize = items.length ? null : this.prize(e)
        if (prize) {
          this.give(prize, 1, true)
          items.push(prize)
          lines.push(`A prize! ${this.world.item(prize).emoji} ${this.world.item(prize).name}`)
        }
      }
      this.xp('strength', 1)
      if (b.potionsUsed) this.xp('magic', Math.min(CONFIG.battle.magicXpCap, b.potionsUsed))
      if (b.lowest < 0.5) this.xp('vigor', 1)
    } else if (b.outcome === 'lost') {
      s.totals.battlesLost++
      const lost = Math.floor(s.gold * CONFIG.battle.loseGoldFraction)
      const tired = Math.floor(s.energy * CONFIG.battle.loseEnergyFraction)
      s.gold -= lost
      s.energy -= tired
      lines.push(`${cap(e.name)} beat you${lost ? ` and took ${lost} gold` : ''}.`)
      if (tired) lines.push(`You lost ${tired} of your banked Energy.`)
      const dropped = this.dropSpare()
      if (dropped) lines.push(`In the scramble you lost your ${dropped.emoji} ${dropped.name}.`)
      this.xp('vigor', 1)
      if (s.where.kind === 'travel') {
        this.pushBack(CONFIG.battle.losePushback)
        lines.push('You limp back down the road a little way.')
      } else lines.push('You stagger back down to the town. Heal up and try again.')
    } else {
      const toll = Math.floor(s.gold * CONFIG.battle.fleeGoldFraction)
      s.gold -= toll
      lines.push(`You got away from ${e.name}${toll ? `, dropping ${toll} gold as you ran` : ''}.`)
      if (s.where.kind === 'travel') this.pushBack(CONFIG.battle.fleePushback)
    }
    return { gold, items, lines }
  }

  /** After a lost fight, one spare potion or treasure is gone: never gear, and never anything the game needs. */
  private dropSpare(): ItemDef | null {
    const spare = R.owned(this.save, this.world)
      .map((o) => o.item)
      .filter((i) => (i.type === 'potion' || i.tags?.includes('treasure')) && R.canSell(i, this.save, this.world) && !R.isNeeded(i, this.world))
    if (!spare.length) return null
    const item = this.rng.pick(spare)
    this.take(item.id)
    return item
  }

  /** Now and then a win turns up something extra, when the enemy's own drop didn't (CONFIG.battle.prizes). */
  private prize(e: EnemyDef): string | null {
    const b = CONFIG.battle
    if (!this.rng.chance(b.prizeChance[e.tier] * (1 + CONFIG.luck.drops * this.save.stats.luck))) return null
    const pool = b.prizes.filter((p) => p.tier <= e.tier)
    let r = this.rng.range(0, pool.reduce((n, p) => n + p.weight, 0))
    for (const p of pool) if ((r -= p.weight) < 0) return p.item
    return pool[pool.length - 1].item
  }

  private pushBack(fraction: number): void {
    const t = this.save.where as TravelWhere
    t.pos = Math.min(1, Math.max(0, t.pos - t.dir * fraction))
  }

  endBattle(m: BattleMode): void {
    if (this.top === m) this.pop()
    if (m.enemy.boss && m.battle.outcome === 'won') this.victory()
    else this.emit({ type: 'checkpoint' })
  }

  // --- the adventure's start and end -------------------------------------------------------

  /** The character creator: a new hero (price null), or a wizard's restyle for `price` gold. */
  openCreator(price: number | null = null): void {
    this.push(new CreatorMode(this, price))
  }

  /** The pause menu: Esc or B where there is nothing to back out of. The clock stops until Resume. */
  openMenu(): void {
    this.push(new MenuMode(this))
  }

  /** How this session went, then save and exit, or keep playing. */
  endSession(): void {
    this.push(new FarewellMode(this))
  }

  /** Checkpoint and tell the host the player is done for today. */
  exitSession(): void {
    this.emit({ type: 'checkpoint' })
    this.emit({ type: 'exit' })
  }

  /** Leave the throne room with the Queen's gift. */
  setOut(): void {
    const s = this.save
    const gift = CONFIG.queensGift
    const gold = Math.round(gift.gold * R.goldScale(s.level))
    const blade = R.armoryGift(s, this.world)
    this.addGold(gold)
    for (const id of gift.items) this.give(id, 1, true)
    if (blade) this.give(blade.id, 1, true)
    const n = gift.items.length
    this.toast(`👑 The Queen's gift: ${blade ? `${gold} gold, ${n} potions and the ${blade.name}` : `${gold} gold and ${n} potions`}`)
    this.arrive(this.world.game.startTown)
  }

  /** The boss is beaten: level up now (so a reload lands in the next throne room), then celebrate. */
  victory(): void {
    const s = this.save
    const lines = this.world.game.challenge.victory
    s.level += 1
    for (const k of STATS) s.stats[k] += 1
    const gold = Math.round(CONFIG.levelUpGold * R.goldScale(s.level - 1))
    this.addGold(gold)
    s.totals.kingdomsSaved++
    s.completedGames.push(this.world.game.id)
    // The relics go to the royal armory (a later adventure may need them again), keys and plot items stay
    // behind; other weapons, clothing, potions and treasure travel on.
    const requires = this.world.game.challenge.requires
    const relics = requires.filter((id) => R.count(s, id) > 0).map((id) => this.world.item(id).name)
    for (const id of Object.keys(s.inventory)) {
      const item = this.world.item(id)
      if (requires.includes(id) || item.type === 'key' || (item.type === 'general' && item.noSell)) delete s.inventory[id]
    }
    R.ensureWeapon(s, this.world)
    resetAdventure(s, R.nextGameId(s, this.host.index))
    this.setBase(new VictoryMode(this, { level: s.level, gold, relics }, lines))
    this.emit({ type: 'levelUp', level: s.level })
  }

  nextAdventure(): void {
    if (this.save.gameId !== this.world.game.id) this.world = this.loadWorld(this.save.gameId)
    this.setBase(new IntroMode(this))
  }

  newGame(): void {
    const first = this.host.index.games[0].id
    this.save = newSave(first, this.seedSource())
    this.session = { totals: { ...this.save.totals }, gold: this.save.gold }
    this.rng = new Rng(this.save.rng)
    this.world = this.loadWorld(first)
    this.setBase(new IntroMode(this))
    this.openCreator()
  }
}
