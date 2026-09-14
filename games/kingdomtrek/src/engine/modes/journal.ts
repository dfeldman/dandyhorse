import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { STAT_INFO } from '../text.ts'

export type JournalPage = 'royal' | 'quests' | 'bag' | 'hero' | 'workout' | 'map' | 'hints'
export const JOURNAL_PAGES: JournalPage[] = ['royal', 'quests', 'bag', 'hero', 'workout', 'map', 'hints']

/**
 * The journal: the royal quest, town quests, the bag, the hero, the map, and hints heard. The page shown is
 * the highlighted one (keyboard) or the last one picked (phone). The bag lets you wield weapons and read tomes.
 */
export class JournalMode implements Mode {
  readonly kind = 'journal' as const
  page: JournalPage = 'royal'
  view: 'pages' | 'bag' | 'item' = 'pages'
  item: string | null = null
  /** Times the shown page was picked again: each turns to its next screen (a phone can't scroll). */
  turns = 0
  private engine: Engine

  constructor(engine: Engine) {
    this.engine = engine
  }

  choices(): ChoiceSpec {
    const e = this.engine
    const s = e.save
    const w = e.world
    if (this.view === 'pages') {
      const req = w.game.challenge.requires
      const have = req.length - R.missing(s, w).length
      const open = Object.values(s.quests).filter((q) => q === 'active').length
      const things = R.owned(s, w).reduce((n, o) => n + o.qty, 0)
      return {
        title: 'Journal',
        options: [
          { id: 'page:royal', label: `👑 Royal quest (${have}/${req.length})` },
          { id: 'page:quests', label: `📋 Town quests (${open} open)` },
          { id: 'page:bag', label: `🎒 Bag (${things} things)`, hint: 'Pick to wield weapons or read tomes' },
          { id: 'page:hero', label: '🧍 Hero' },
          { id: 'page:workout', label: '🚴 Workout' },
          { id: 'page:map', label: '🗺️ Map' },
          { id: 'page:hints', label: `💡 Hints (${s.hints.length})` },
          { id: 'close', label: '↩ Close journal' },
        ],
        backId: 'close',
      }
    }
    if (this.view === 'bag') {
      const opts: ChoiceOption[] = R.owned(s, w).map(({ item, qty }) => ({
        id: `item:${item.id}`,
        label: `${item.emoji} ${item.name}${qty > 1 ? ` ×${qty}` : ''}${item.id === s.weapon ? ' ✓' : ''}`,
        itemId: item.id,
      }))
      opts.push({ id: 'back', label: '↩ Back' })
      return { title: 'Bag', options: opts, backId: 'back' }
    }
    const item = w.item(this.item!)
    const opts: ChoiceOption[] = []
    if (item.weapon && s.weapon !== item.id) opts.push({ id: 'wield', label: `⚔️ Wield the ${item.name}`, itemId: item.id })
    if (item.potion?.effect === 'stat' && item.potion.stat) {
      opts.push({ id: 'read', label: `📖 Read it: +${item.potion.power} ${STAT_INFO[item.potion.stat].name}`, itemId: item.id })
    }
    if (item.potion?.effect === 'travel' && s.where.kind === 'travel') opts.push({ id: 'drink', label: '🍵 Drink it now', itemId: item.id })
    opts.push({ id: 'back', label: '↩ Back to the bag', itemId: item.id })
    return { title: item.name, options: opts, backId: 'back' }
  }

  choose(id: string): void {
    const e = this.engine
    if (id.startsWith('page:')) {
      const page = id.slice(5) as JournalPage
      this.turns = page === this.page ? this.turns + 1 : 0
      this.page = page
      if (this.page === 'bag') this.view = 'bag'
    } else if (id === 'close') e.pop()
    else if (id.startsWith('item:')) {
      this.item = id.slice(5)
      this.view = 'item'
    } else if (id === 'back') this.view = this.view === 'item' ? 'bag' : 'pages'
    else if (id === 'wield' && this.item) {
      e.save.weapon = this.item
      e.toast(`${e.world.item(this.item).emoji} Now wielding the ${e.world.item(this.item).name}`)
      this.view = 'bag'
    } else if (id === 'read' && this.item) {
      e.readTome(this.item)
      this.view = 'bag'
    } else if (id === 'drink' && this.item) {
      e.drinkTravelPotion(this.item)
      this.view = 'bag'
    }
  }
}
