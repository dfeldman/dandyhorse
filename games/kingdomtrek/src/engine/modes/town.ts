import type { Npc, Town } from '../../content/types.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { TERRAIN_NAME, cap, dangerWord, minutes } from '../text.ts'

/** The town square: every place worth visiting, the gate, and the journal. Moving about town is free. */
export class TownMode implements Mode {
  readonly kind = 'town' as const
  readonly town: Town
  private engine: Engine

  constructor(engine: Engine, town: Town) {
    this.engine = engine
    this.town = town
  }

  /** Something new to do with this mayor: a quest to take or hand in, or a delivery. */
  mayorNews(): boolean {
    const s = this.engine.save
    const q = this.town.mayor.quest
    return (!!q && (!s.quests[q.id] || R.questReady(s, q))) || !!R.deliveryFor(s, this.engine.world, this.town.id)
  }

  /** A gift waiting, a trade possible, or a delivery for them. */
  npcNews(n: Npc): boolean {
    const e = this.engine
    const t = this.town.id
    if (n.gives && !e.isTaken(`gift:${t}:${n.id}`)) return true
    if (n.trade && !e.isTaken(`trade:${t}:${n.id}`) && R.count(e.save, n.trade.wants) > 0) return true
    return !!R.deliveryFor(e.save, e.world, t, n.id)
  }

  /** One of the Queen's items can be made right now. */
  craftNews(): boolean {
    const e = this.engine
    return R.missing(e.save, e.world).some((id) => {
      const r = R.recipeFor(e.world, id)
      return !!r && R.canCraft(e.save, r)
    })
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const t = this.town
    const c = e.world.game.challenge
    const opts: ChoiceOption[] = [
      { id: 'mayor', label: `🏛️ ${t.mayor.name}${this.mayorNews() ? ' ❗' : ''}`, hint: `The ${t.mayor.title.toLowerCase()}'s hall` },
      { id: 'shop', label: `🏪 ${t.shop.name}`, hint: `${t.shop.keeper.name}'s shop: buy and sell` },
    ]
    if (t.workshop && R.recipes(e.world).length) {
      opts.push({ id: 'craft', label: `⚒️ ${t.workshop.name}${this.craftNews() ? ' ❗' : ''}`, hint: `${t.workshop.keeper.name}'s workshop: make things by pedaling` })
    }
    for (const n of t.npcs) {
      opts.push({ id: `npc:${n.id}`, label: `${n.emoji} ${n.name}${this.npcNews(n) ? ' ❗' : ''}`, hint: cap(n.role) })
    }
    for (const sp of t.spots) {
      if (!e.isTaken(`spot:${t.id}:${sp.id}`)) opts.push({ id: `spot:${sp.id}`, label: `${sp.emoji} Search ${sp.name}`, hint: 'Have a look around' })
    }
    if (t.crisis) {
      opts.push({ id: 'lair', label: `${c.lair.emoji} ${cap(c.lair.name)}`, hint: `Where ${cap(e.world.enemy(c.boss).name)} waits` })
    }
    opts.push({ id: 'gate', label: '🚪 Town gate: travel', hint: 'Choose where to go next' })
    opts.push({ id: 'journal', label: '📜 Journal', hint: 'Quests, bag, hero, map, hints' })
    opts.push({ id: 'menu', label: '⏸ Pause', hint: 'Stop the clock, or end the session' })
    return { title: t.name, options: opts, backId: 'menu' }
  }

  choose(id: string): void {
    const e = this.engine
    const t = this.town
    if (id === 'mayor') e.openMayor(t)
    else if (id === 'shop') e.openShop(t)
    else if (id === 'craft') e.openCraft(t)
    else if (id === 'gate') e.openGate(t)
    else if (id === 'journal') e.openJournal()
    else if (id === 'menu') e.openMenu()
    else if (id === 'lair') e.openLair(t)
    else if (id.startsWith('npc:')) e.openNpc(t, id.slice(4))
    else if (id.startsWith('spot:')) e.searchSpot(t, id.slice(5))
  }
}

/** Pick a neighbouring town: Energy cost and roughly how long at a steady pace. */
export class GateMode implements Mode {
  readonly kind = 'gate' as const
  readonly town: Town
  private engine: Engine

  constructor(engine: Engine, town: Town) {
    this.engine = engine
    this.town = town
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const s = e.save
    const heavy = R.overloaded(s, e.world)
    const opts: ChoiceOption[] = e.world.routesFrom(this.town.id).map(({ route, to }) => {
      const cost = R.tripCost(s, e.world, route)
      const eta = R.etaSeconds(cost, s.energy, Math.max(0.5, e.effort))
      const notes = [cap(TERRAIN_NAME[route.terrain]), dangerWord(route.danger)]
      if (!s.visited.includes(to.id)) notes.push('not visited yet')
      if (heavy) notes.push('your bag is too heavy: +40% Energy')
      return { id: `travel:${route.id}`, label: `${to.name} · ⚡${cost} · ${minutes(eta)}`, hint: notes.join(' · ') }
    })
    opts.push({ id: 'back', label: '↩ Back into town' })
    return { title: `${this.town.name} gate: where to?`, options: opts, backId: 'back' }
  }

  choose(id: string): void {
    if (id === 'back') this.engine.pop()
    else if (id.startsWith('travel:')) this.engine.startTrip(id.slice(7))
  }
}
