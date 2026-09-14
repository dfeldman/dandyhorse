/**
 * A player who only uses the choice list, like someone with a phone and no keyboard. It pedals at a steady
 * pace, drinks a healing potion when low, and otherwise does what it is told. Tests script it directly; the
 * solver (solver.ts) decides what to tell it.
 */
import type { Engine } from '../engine/engine.ts'
import type { BattleMode } from '../engine/modes/battle.ts'
import * as R from '../engine/rules.ts'
import type { HeroClass } from '../engine/save.ts'
import type { World } from '../engine/world.ts'

/** Shortest road distances from `from` to every town, and the town before each on its best path. */
export function roads(w: World, from: string): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const open = new Set([from])
  while (open.size) {
    let cur = ''
    for (const t of open) if (!cur || dist.get(t)! < dist.get(cur)!) cur = t
    open.delete(cur)
    for (const { route, to } of w.routesFrom(cur)) {
      const d = dist.get(cur)! + route.distance
      if (d < (dist.get(to.id) ?? Infinity)) {
        dist.set(to.id, d)
        prev.set(to.id, cur)
        open.add(to.id)
      }
    }
  }
  return { dist, prev }
}

export class Bot {
  readonly e: Engine
  effort = 1

  constructor(e: Engine) {
    this.e = e
  }

  ids(): string[] {
    return this.e.choices().options.map((o) => o.id)
  }

  has(id: string): boolean {
    return this.e.choices().options.some((o) => o.id === id && !o.disabled)
  }

  pick(id: string): void {
    if (!this.e.choose(id)) throw new Error(`cannot pick "${id}" in ${this.e.top.kind}: [${this.ids().join(', ')}]`)
  }

  /** Press Continue until a menu shows. */
  settle(): void {
    for (let i = 0; i < 100 && this.ids().length === 1 && this.ids()[0] === 'continue'; i++) this.pick('continue')
  }

  get town(): string | null {
    const w = this.e.save.where
    return w.kind === 'town' ? w.town : null
  }

  /** Play second by second, fighting whatever turns up, until `done`. */
  run(done: () => boolean, maxSeconds = 3 * 3600): void {
    for (let t = 0; t < maxSeconds; t++) {
      if (done()) return
      if (this.e.top.kind === 'battle') this.fight(this.e.top as BattleMode)
      this.e.step(1, this.effort)
    }
    throw new Error(`timed out in ${this.e.top.kind}`)
  }

  private fight(m: BattleMode): void {
    if (m.phase === 'over') return this.pick('continue')
    if (m.phase !== 'fight') return
    const v = m.battle.view()
    if (v.heroHp / v.heroMaxHp < 0.35) {
      const heal = ['greater_healing', 'healing_draught'].find((id) => R.count(this.e.save, id) > 0)
      if (heal) this.pick(`potion:${heal}`)
    }
  }

  /** In the character creator: a class, then the first thing offered at every other step, then confirm. */
  create(cls: HeroClass = 'knight'): void {
    this.pick(`class:${cls}`)
    while (!this.has('done')) this.pick(this.ids().find((i) => i.includes(':'))!)
    this.pick('done')
  }

  /** From the title screen to the first town: begin (making a hero if asked), hear the Queen, set out. */
  start(cls: HeroClass = 'knight'): void {
    this.pick(this.has('begin') ? 'begin' : 'continue')
    if (this.e.top.kind === 'creator') this.create(cls)
    this.settle()
    this.pick('setout')
  }

  /** Walk to a neighbouring town, fighting on the way. */
  travelTo(townId: string): void {
    const from = this.town
    if (!from) throw new Error('not in a town')
    this.pick('gate')
    const road = this.e.world.routesFrom(from).find((r) => r.to.id === townId)
    if (!road) throw new Error(`no road from ${from} to ${townId}`)
    this.pick(`travel:${road.route.id}`)
    this.run(() => this.town === townId && this.e.top === this.e.base)
  }

  /** Walk to any town, by the shortest roads. */
  goTo(townId: string): void {
    const from = this.town
    if (!from) throw new Error('not in a town')
    if (from === townId) return
    const { prev } = roads(this.e.world, from)
    if (!prev.has(townId)) throw new Error(`no way from ${from} to ${townId}`)
    const path: string[] = []
    for (let t: string | undefined = townId; t && t !== from; t = prev.get(t)) path.unshift(t)
    for (const hop of path) this.travelTo(hop)
  }

  enter(id: string): void {
    this.pick(id)
    this.settle()
  }

  buy(itemId: string): void {
    this.enter('shop')
    this.pick('buy')
    this.pick(`buy:${itemId}`)
    this.pick('back')
    this.pick('leave')
  }

  /** Sell everything tagged treasure. */
  sellTreasure(): void {
    this.enter('shop')
    this.pick('sell')
    for (;;) {
      const id = this.ids().find((i) => i.startsWith('sell:') && this.e.world.item(i.slice(5)).tags?.includes('treasure'))
      if (!id) break
      this.pick(id)
    }
    this.pick('back')
    this.pick('leave')
  }

  mayor(action: 'accept' | 'handin'): void {
    this.enter('mayor')
    this.pick(action)
    this.settle()
    this.pick('leave')
  }

  /** Hand a parcel over, to this town's mayor or to one of its people. */
  deliver(npcId?: string): void {
    this.enter(npcId ? `npc:${npcId}` : 'mayor')
    this.pick('deliver')
    this.settle()
    this.pick(npcId ? 'bye' : 'leave')
  }

  talk(npcId: string): void {
    this.enter(`npc:${npcId}`)
    this.pick('bye')
  }

  trade(npcId: string): void {
    this.enter(`npc:${npcId}`)
    this.pick('trade')
    this.settle()
    this.pick('bye')
  }

  /** Make one `itemId` at this town's workshop, pedaling steadily. It must be makeable now. */
  craft(itemId: string): void {
    const before = R.count(this.e.save, itemId)
    this.pick('craft')
    this.pick(`make:${itemId}`)
    this.run(() => R.count(this.e.save, itemId) > before)
    if (this.has('stop')) this.pick('stop')
    this.pick('leave')
  }

  search(spotId: string): void {
    this.pick(`spot:${spotId}`)
    this.settle()
    this.pick('ok')
  }
}
