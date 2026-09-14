import type { Town } from '../../content/types.ts'
import type { ChoiceOption } from '../choice.ts'
import type { Engine } from '../engine.ts'
import * as R from '../rules.ts'
import { Room } from './room.ts'

/** Buy and sell, one at a time. The highlighted item's card is shown beside the list. */
export class ShopMode extends Room {
  readonly kind = 'shop' as const
  readonly town: Town
  page: 'root' | 'buy' | 'sell' = 'root'

  constructor(engine: Engine, town: Town) {
    super(engine)
    this.town = town
    this.say(town.shop.keeper, ...town.shop.lines)
  }

  title(): string {
    const name = this.town.shop.name
    return this.page === 'buy' ? `${name}: buy` : this.page === 'sell' ? `${name}: sell` : name
  }

  private sellable(): ChoiceOption[] {
    const e = this.engine
    return R.owned(e.save, e.world)
      .filter(({ item }) => R.canSell(item, e.save, e.world))
      .map(({ item, qty }) => ({
        id: `sell:${item.id}`,
        label: `${item.emoji} ${item.name}${qty > 1 ? ` ×${qty}` : ''} — ${R.sellPrice(item, e.save)}g`,
        itemId: item.id,
        hint: item.id === e.save.weapon ? 'Your current weapon' : undefined,
      }))
  }

  menu(): ChoiceOption[] {
    const e = this.engine
    const s = e.save
    if (this.page === 'root') {
      return [
        { id: 'buy', label: '🛒 Buy', hint: `${this.town.shop.stock.length} things for sale` },
        { id: 'sell', label: '💰 Sell', hint: 'Turn treasure and spare gear into gold' },
        { id: 'leave', label: '👋 Leave' },
      ]
    }
    const opts: ChoiceOption[] = []
    if (this.page === 'buy') {
      for (const entry of this.town.shop.stock) {
        const left = R.stockLeft(s, this.town.id, entry)
        if (left !== null && left <= 0) continue
        const item = e.world.item(entry.item)
        const short = item.value - s.gold
        opts.push({
          id: `buy:${item.id}`,
          label: `${item.emoji} ${item.name} — ${item.value}g${left !== null ? ` (${left} left)` : ''}`,
          itemId: item.id,
          disabled: short > 0,
          hint: short > 0 ? `You need ${short} more gold` : `You have ${R.count(s, item.id)}`,
        })
      }
    } else opts.push(...this.sellable())
    opts.push({ id: 'back', label: '↩ Back' })
    return opts
  }

  backId(): string {
    return this.page === 'root' ? 'leave' : 'back'
  }

  onMenu(id: string): void {
    const e = this.engine
    const keeper = this.town.shop.keeper
    if (id === 'buy') this.page = 'buy'
    else if (id === 'sell') {
      this.page = 'sell'
      if (!this.sellable().length) this.say(keeper, 'You\'ve nothing I\'d buy, I\'m afraid.')
    } else if (id === 'back') this.page = 'root'
    else if (id === 'leave') e.pop()
    else if (id.startsWith('buy:')) {
      const why = e.buy(this.town, id.slice(4))
      if (why) this.say(keeper, `Sorry, ${why}.`)
    } else if (id.startsWith('sell:')) e.sell(id.slice(5))
  }
}
