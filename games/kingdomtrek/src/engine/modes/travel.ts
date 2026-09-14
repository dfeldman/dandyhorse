import type { Route, Town } from '../../content/types.ts'
import { CONFIG } from '../../config.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import type { TravelWhere } from '../save.ts'

/**
 * On the road. No input needed: the hero walks at the pace the player pedals, and banked Energy adds a boost
 * on top until it runs out. Enemies and roadside finds trigger as the hero passes them. The trip lives in
 * `save.where`, so a reload resumes mid-road.
 */
export class TravelMode implements Mode {
  readonly kind = 'travel' as const
  readonly spendsEffort = true
  /** Energy per second the hero is walking at (for the view). */
  rate = 0
  /** Spending banked Energy right now. */
  boosting = false
  private engine: Engine

  constructor(engine: Engine) {
    this.engine = engine
  }

  get trip(): TravelWhere {
    return this.engine.save.where as TravelWhere
  }

  get route(): Route {
    return this.engine.world.route(this.trip.route)
  }

  get from(): Town {
    return this.engine.world.town(this.trip.from)
  }

  get to(): Town {
    return this.engine.world.town(this.trip.to)
  }

  /** Energy still needed to arrive. */
  get remaining(): number {
    return R.tripLeft(this.trip) * this.trip.cost
  }

  step(dt: number, effort: number): void {
    const e = this.engine
    const s = e.save
    const t = this.trip
    const income = Math.max(0, effort) * CONFIG.energyPerSecond * dt
    const boost = Math.min(s.energy, CONFIG.boostExtra * dt)
    s.energy -= boost
    const move = income + boost
    this.boosting = boost > 0
    this.rate = move / dt

    const prev = t.pos
    t.pos = Math.min(1, Math.max(0, t.pos + (t.dir * move) / t.cost))
    s.totals.distance += Math.abs(t.pos - prev) * this.route.distance
    const crossed = (x: number): boolean => (t.dir > 0 ? prev < x && x <= t.pos : t.pos <= x && x < prev)

    for (const f of this.route.finds ?? []) {
      const key = `find:${f.id}`
      if (e.isTaken(key) || !crossed(f.at)) continue
      e.markTaken(key)
      const item = e.world.item(f.item)
      e.give(f.item, 1, true)
      e.toast(`${item.emoji} Found by the roadside: ${item.name}!`)
    }

    const enc = t.plan.find((p) => !p.done && crossed(p.at))
    if (enc) {
      enc.done = true
      t.pos = enc.at
      e.startEncounter(enc)
      return
    }
    if ((t.dir > 0 && t.pos >= 1) || (t.dir < 0 && t.pos <= 0)) {
      e.wearTravelGear()
      e.arrive(t.to)
    }
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const opts: ChoiceOption[] = [{ id: 'journal', label: '📜 Journal', hint: 'Quests, bag, hero, map, hints' }]
    for (const { item, qty } of R.owned(e.save, e.world)) {
      if (item.potion?.effect === 'travel') {
        opts.push({ id: `drink:${item.id}`, label: `${item.emoji} Drink ${item.name} ×${qty}`, itemId: item.id, hint: 'The rest of this trip costs less Energy' })
      }
    }
    opts.push({ id: 'turn', label: `↩ Turn back to ${this.from.name}`, hint: 'Walk back the way you came' })
    opts.push({ id: 'menu', label: '⏸ Pause', hint: 'Stop the clock, or end the session' })
    return { title: `The road to ${this.to.name}`, options: opts, backId: 'menu' }
  }

  choose(id: string): void {
    const e = this.engine
    if (id === 'journal') e.openJournal()
    else if (id === 'menu') e.openMenu()
    else if (id.startsWith('drink:')) e.drinkTravelPotion(id.slice(6))
    else if (id === 'turn') {
      const t = this.trip
      const back = t.from
      t.from = t.to
      t.to = back
      t.dir = t.dir > 0 ? -1 : 1
      e.toast(`↩ You turn back toward ${this.to.name}`)
    }
  }
}
