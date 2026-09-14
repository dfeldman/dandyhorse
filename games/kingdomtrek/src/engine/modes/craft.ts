import type { Recipe, Town } from '../../content/types.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { STATION_VERB, craftTime, station } from '../text.ts'

/**
 * A town's workshop: pick something to make, then pedal. A meter fills at the pace you pedal (the
 * recipe's `seconds` at a steady pace, sooner when you push); each time it fills you make one, using up its
 * ingredients, and it starts on the next, until you stop or run out. Your pedaling goes into the work, so no
 * Energy is banked meanwhile.
 */
export class CraftMode implements Mode {
  readonly kind = 'craft' as const
  readonly town: Town
  /** What is being made; null while choosing. */
  recipe: Recipe | null = null
  /** How far through the one being made, 0–1. */
  progress = 0
  /** How many made since starting on the current (or last) recipe. */
  made = 0
  /** The item of the current (or last) recipe, for the shelf of things made. */
  lastMade: string | null = null
  /** The latest news, shown on the workshop screen. */
  message = 'Pick something to make, then pedal.'
  /** Work put aside half-done, per recipe, while the workshop stays open. */
  private partial = new Map<string, number>()
  private engine: Engine

  constructor(engine: Engine, town: Town) {
    this.engine = engine
    this.town = town
    const keeper = town.workshop?.lines[0]
    if (keeper) this.message = keeper
  }

  get name(): string {
    return this.town.workshop?.name ?? 'Workshop'
  }

  get spendsEffort(): boolean {
    return this.recipe !== null
  }

  step(dt: number, effort: number): void {
    const r = this.recipe
    if (!r) return
    this.progress += (Math.max(0, effort) * dt) / r.seconds
    // A hair under 1 counts, so a minute of steady pedaling makes a one-minute recipe despite rounding.
    while (this.recipe && this.progress >= 1 - 1e-6) {
      this.progress = Math.max(0, this.progress - 1)
      this.makeOne(r)
    }
  }

  private makeOne(r: Recipe): void {
    const e = this.engine
    const item = e.world.item(r.item)
    if (!e.craft(r)) return this.stop()
    this.made++
    e.toast(`${item.emoji} ${item.name} made${this.made > 1 ? ` (${this.made} so far)` : ''}`)
    const out = (r.needs ?? []).find((n) => R.count(e.save, n.item) < n.qty)
    if (out) {
      this.progress = 0
      this.stop(`Not enough ${e.world.item(out.item).name} for another.`)
    }
  }

  /** Put the work down: what is made is kept, and a half-made one waits while the workshop is open. */
  private stop(note = ''): void {
    const r = this.recipe
    if (!r) return
    const item = this.engine.world.item(r.item)
    this.partial.set(r.item, this.progress)
    this.message = [this.made ? `Made ${item.emoji} ${item.name} ×${this.made}.` : 'You put the work aside.', note].filter(Boolean).join(' ')
    this.recipe = null
    this.progress = 0
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const s = e.save
    const w = e.world
    if (this.recipe) {
      // The list stays the same while the meter fills (its key must not change); progress is drawn on screen.
      const item = w.item(this.recipe.item)
      return {
        title: `${STATION_VERB[station(item)]}: ${item.name}`,
        options: [
          { id: 'pedal', label: '🚴 Keep pedaling!', hint: `About ${craftTime(this.recipe.seconds)} each at a steady pace, sooner if you push` },
          { id: 'stop', label: '✋ Stop', hint: 'Keep what you have made' },
        ],
        backId: 'stop',
      }
    }
    const opts: ChoiceOption[] = R.recipes(w).map((r) => {
      const item = w.item(r.item)
      const ready = R.canCraft(s, r)
      const uses = (r.needs ?? []).map((n) => `${w.item(n.item).emoji} ${w.item(n.item).name} ×${n.qty} (you have ${R.count(s, n.item)})`).join(', ')
      return {
        id: `make:${r.item}`,
        label: `${item.emoji} ${item.name} · ${craftTime(r.seconds)}`,
        itemId: r.item,
        disabled: !ready,
        hint: !uses ? 'Pedaling alone makes it: as many as you like' : `${ready ? '' : 'Not enough yet. '}Each one uses ${uses}`,
      }
    })
    opts.push({ id: 'leave', label: `↩ Back to ${this.town.name}` })
    return { title: `⚒️ ${this.name}`, options: opts, backId: 'leave' }
  }

  choose(id: string): void {
    const e = this.engine
    if (id === 'leave') e.pop()
    else if (id === 'stop') this.stop()
    else if (id.startsWith('make:')) {
      const r = R.recipeFor(e.world, id.slice(5))
      if (!r || !R.canCraft(e.save, r)) return
      this.recipe = r
      this.progress = this.partial.get(r.item) ?? 0
      this.made = 0
      this.lastMade = r.item
      this.message = 'Pedal! The harder you go, the sooner it is done.'
    }
    // 'pedal' changes nothing: pedaling does the work.
  }
}
