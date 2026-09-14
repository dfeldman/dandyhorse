/**
 * A player who has read the game file. For each item the Queen needs it works out every way to get it (shops,
 * gifts, trades, keys and the spots they open, road finds, quests and recipes, following chains like honey → key
 * → shrine or sea glass → Tidestone), does whichever step is nearest, earns gold when that is all that stands in
 * the way, and then faces the boss, pedaling steadily throughout. It plays the real engine through the choice
 * list, so a game it finishes can be won, and its clock says roughly how long a steady player needs.
 */
import type { Quest, Recipe } from '../content/types.ts'
import type { Engine } from '../engine/engine.ts'
import * as R from '../engine/rules.ts'
import type { HeroClass } from '../engine/save.ts'
import { Bot, roads } from './bot.ts'

type Task =
  | { kind: 'buy'; town: string; item: string }
  | { kind: 'gift' | 'trade'; town: string; npc: string }
  | { kind: 'search'; town: string; spot: string }
  | { kind: 'accept' | 'handin'; town: string; quest: Quest }
  | { kind: 'deliver'; town: string; npc?: string; quest: Quest }
  | { kind: 'walk'; route: string; why: string }
  /** At the nearest town's workshop. */
  | { kind: 'craft'; town: string; recipe: Recipe }

export interface SolveOptions {
  cls?: HeroClass
  /** Give up after this much play. */
  maxMinutes?: number
}

export interface SolveResult {
  ok: boolean
  minutes: number
  battlesWon: number
  battlesLost: number
  /** What it did, in order. */
  steps: string[]
  reason?: string
}

export function solve(e: Engine, opts: SolveOptions = {}): SolveResult {
  return new Solver(e, opts).run()
}

class Solver {
  private e: Engine
  private bot: Bot
  private cls: HeroClass
  private maxMinutes: number
  private steps: string[] = []
  private bossTries = 0
  /** Set while planning when something needed is for sale but too dear. */
  private short = false

  constructor(e: Engine, opts: SolveOptions) {
    this.e = e
    this.bot = new Bot(e)
    this.cls = opts.cls ?? 'knight'
    this.maxMinutes = opts.maxMinutes ?? 360
  }

  run(): SolveResult {
    const e = this.e
    try {
      this.bot.start(this.cls)
      for (let n = 0; n < 400; n++) {
        if (e.save.totals.playSeconds / 60 > this.maxMinutes) return this.result(false, `not finished after ${this.maxMinutes} minutes`)
        const need = R.missing(e.save, e.world)
        if (!need.length) {
          if (this.faceBoss()) return this.result(true)
          continue
        }
        this.short = false
        const tasks = need.flatMap((id) => this.stepsFor(id, new Set()))
        if (tasks.length) this.act(this.nearest(tasks))
        else if (this.short) this.earnGold()
        else return this.result(false, `stuck: no way to get the ${need.map((id) => e.world.item(id).name).join(', ')}`)
      }
      return this.result(false, 'gave up after 400 steps')
    } catch (err) {
      return this.result(false, err instanceof Error ? err.message : String(err))
    }
  }

  private result(ok: boolean, reason?: string): SolveResult {
    const t = this.e.save.totals
    return { ok, minutes: t.playSeconds / 60, battlesWon: t.battlesWon, battlesLost: t.battlesLost, steps: this.steps, reason }
  }

  private get here(): string {
    const w = this.e.save.where
    if (w.kind !== 'town') throw new Error(`expected a town, not ${w.kind}`)
    return w.town
  }

  /** Everything that can be done right now toward having `item`, following what each way depends on. */
  private stepsFor(item: string, seen: Set<string>): Task[] {
    if (seen.has(item)) return []
    seen.add(item)
    const e = this.e
    const s = e.save
    const w = e.world
    const out: Task[] = []
    for (const t of w.game.towns) {
      for (const st of t.shop.stock) {
        if (st.item !== item) continue
        const left = R.stockLeft(s, t.id, st)
        if (left !== null && left <= 0) continue
        if (s.gold >= w.item(item).value) out.push({ kind: 'buy', town: t.id, item })
        else this.short = true
      }
      for (const n of t.npcs) {
        if (n.gives?.item === item && !e.isTaken(`gift:${t.id}:${n.id}`)) out.push({ kind: 'gift', town: t.id, npc: n.id })
        if (n.trade?.gives === item && !e.isTaken(`trade:${t.id}:${n.id}`)) {
          if (R.count(s, n.trade.wants) > 0) out.push({ kind: 'trade', town: t.id, npc: n.id })
          else out.push(...this.stepsFor(n.trade.wants, seen))
        }
      }
      for (const sp of t.spots) {
        if (sp.item !== item || e.isTaken(`spot:${t.id}:${sp.id}`)) continue
        if (!sp.requiresKey || R.count(s, sp.requiresKey) > 0) out.push({ kind: 'search', town: t.id, spot: sp.id })
        else out.push(...this.stepsFor(sp.requiresKey, seen))
      }
      const q = t.mayor.quest
      if (q && (q.reward.items ?? []).includes(item)) out.push(...this.questSteps(t.id, q, seen))
    }
    for (const r of w.game.routes) {
      for (const f of r.finds ?? []) if (f.item === item && !e.isTaken(`find:${f.id}`)) out.push({ kind: 'walk', route: r.id, why: `for the ${w.item(item).name}` })
    }
    const recipe = R.recipeFor(w, item)
    if (recipe) {
      const short = (recipe.needs ?? []).filter((n) => R.count(s, n.item) < n.qty)
      if (!short.length) out.push({ kind: 'craft', town: this.workshopTown(), recipe })
      else for (const n of short) out.push(...this.stepsFor(n.item, seen))
    }
    return out
  }

  /** The nearest town with a workshop: this one, if it has one. */
  private workshopTown(): string {
    const w = this.e.world
    const { dist } = roads(w, this.here)
    const towns = w.game.towns.filter((t) => t.workshop)
    if (!towns.length) throw new Error('no town has a workshop')
    return towns.reduce((best, t) => ((dist.get(t.id) ?? Infinity) < (dist.get(best.id) ?? Infinity) ? t : best)).id
  }

  /** The next step of a mayor's quest: take it, then fetch, deliver or slay, then hand it in. */
  private questSteps(town: string, q: Quest, seen: Set<string>): Task[] {
    const e = this.e
    const s = e.save
    const status = s.quests[q.id]
    if (status === 'done') return []
    if (!status) return [{ kind: 'accept', town, quest: q }]
    if (R.questReady(s, q)) return [{ kind: 'handin', town, quest: q }]
    if (q.type === 'fetch') return this.stepsFor(q.item!, seen)
    if (q.type === 'deliver' && q.to && R.count(s, q.item!) > 0) return [{ kind: 'deliver', town: q.to.town, npc: q.to.npc, quest: q }]
    if (q.type === 'slay') {
      const foe = e.world.foes.get(q.foe!)
      if (foe) return [{ kind: 'walk', route: foe.route.id, why: `to face ${e.world.enemy(foe.foe.enemy).name}` }]
    }
    return []
  }

  /** The task that is the shortest walk away. */
  private nearest(tasks: Task[]): Task {
    const w = this.e.world
    const { dist } = roads(w, this.here)
    const cost = (t: Task): number => {
      if (t.kind !== 'walk') return dist.get(t.town) ?? Infinity
      const r = w.route(t.route)
      return Math.min(dist.get(r.a) ?? Infinity, dist.get(r.b) ?? Infinity) + r.distance
    }
    return tasks.reduce((best, t) => (cost(t) < cost(best) ? t : best))
  }

  private act(t: Task): void {
    const b = this.bot
    const w = this.e.world
    if (t.kind === 'walk') {
      const r = w.route(t.route)
      const { dist } = roads(w, this.here)
      const [from, to] = (dist.get(r.a) ?? Infinity) <= (dist.get(r.b) ?? Infinity) ? [r.a, r.b] : [r.b, r.a]
      b.goTo(from)
      b.travelTo(to)
      this.steps.push(`walked ${w.town(from).name} → ${w.town(to).name} ${t.why}`)
      return
    }
    b.goTo(t.town)
    const at = w.town(t.town).name
    switch (t.kind) {
      case 'buy':
        b.buy(t.item)
        this.steps.push(`bought the ${w.item(t.item).name} in ${at}`)
        break
      case 'gift':
        b.talk(t.npc)
        this.steps.push(`was given a present by ${w.npc(t.town, t.npc).name} in ${at}`)
        break
      case 'trade':
        b.trade(t.npc)
        this.steps.push(`traded with ${w.npc(t.town, t.npc).name} in ${at}`)
        break
      case 'search':
        b.search(t.spot)
        this.steps.push(`searched ${t.spot.replace(/_/g, ' ')} in ${at}`)
        break
      case 'accept':
      case 'handin':
        b.mayor(t.kind)
        this.steps.push(`${t.kind === 'accept' ? 'took' : 'finished'} "${t.quest.title}" in ${at}`)
        break
      case 'deliver':
        b.deliver(t.npc)
        this.steps.push(`delivered for "${t.quest.title}" in ${at}`)
        break
      case 'craft': {
        const started = this.e.save.totals.playSeconds
        b.craft(t.recipe.item)
        this.steps.push(`made the ${w.item(t.recipe.item).name} in ${at} (${Math.round(this.e.save.totals.playSeconds - started)} s)`)
        break
      }
    }
  }

  /** Short of gold for something needed: sell treasure, do a quest that pays, or walk a road and back. */
  private earnGold(): void {
    const e = this.e
    if (R.owned(e.save, e.world).some(({ item }) => item.tags?.includes('treasure') && R.canSell(item, e.save, e.world))) {
      this.bot.sellTreasure()
      this.steps.push(`sold treasure in ${e.world.town(this.here).name} (${e.save.gold} gold)`)
      return
    }
    const quests = [...e.world.quests.values()].flatMap(({ quest, town }) => this.questSteps(town.id, quest, new Set()))
    if (quests.length) return this.act(this.nearest(quests))
    this.act({ kind: 'walk', route: e.world.routesFrom(this.here)[0].route.id, why: 'for gold' })
  }

  private faceBoss(): boolean {
    const e = this.e
    const c = e.world.game.challenge
    const boss = e.world.enemy(c.boss)
    this.bot.goTo(c.crisisTown)
    this.bot.pick('lair')
    this.bot.settle()
    this.bot.pick('fight')
    this.bot.run(() => e.top.kind === 'victory' || e.top === e.base)
    const won = e.top.kind === 'victory'
    this.steps.push(`${won ? 'beat' : 'lost to'} ${boss.name}`)
    if (!won && ++this.bossTries >= 3) throw new Error(`lost to ${boss.name} three times`)
    return won
  }
}
