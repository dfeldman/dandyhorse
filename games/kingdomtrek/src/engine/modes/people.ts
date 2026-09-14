/** Talking to townsfolk and to the mayor. */
import type { Npc, Quest, Town } from '../../content/types.ts'
import type { ChoiceOption } from '../choice.ts'
import type { Engine } from '../engine.ts'
import * as R from '../rules.ts'
import { STAT_INFO } from '../text.ts'
import { Room } from './room.ts'

const withArticle = (name: string): string => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`)

export class NpcMode extends Room {
  readonly kind = 'npc' as const
  readonly town: Town
  readonly npc: Npc

  constructor(engine: Engine, town: Town, npc: Npc) {
    super(engine)
    this.town = town
    this.npc = npc
    const gift = `gift:${town.id}:${npc.id}`
    if (npc.gives && !engine.isTaken(gift)) {
      engine.markTaken(gift)
      this.say(npc, npc.gives.line)
      engine.give(npc.gives.item)
    }
    this.say(npc, ...npc.lines)
    if (npc.hint) engine.hearHint(npc.hint)
  }

  private get tradeKey(): string {
    return `trade:${this.town.id}:${this.npc.id}`
  }

  title(): string {
    return `${this.npc.name}, ${this.npc.role}`
  }

  menu(): ChoiceOption[] {
    const e = this.engine
    const s = e.save
    const n = this.npc
    const opts: ChoiceOption[] = [{ id: 'talk', label: '💬 Talk' }]
    const d = R.deliveryFor(s, e.world, this.town.id, n.id)
    if (d) opts.push({ id: 'deliver', label: `✉️ Give the ${e.world.item(d.item!).name}`, hint: d.title })
    if (n.trade && !e.isTaken(this.tradeKey)) {
      const want = e.world.item(n.trade.wants)
      opts.push({ id: 'trade', label: `🔄 Offer ${withArticle(want.name)}`, itemId: want.id, hint: `${n.name} would trade for ${withArticle(want.name)}` })
    }
    if (n.trains) {
      const st = STAT_INFO[n.trains.stat]
      opts.push({ id: 'train', label: `🏋️ Train ${st.name}: ${R.trainPrice(n, s)} gold`, hint: `+1 ${st.name}: ${st.blurb}` })
    }
    if (n.restyle) opts.push({ id: 'restyle', label: `✨ Change your look: ${n.restyle.price} gold`, hint: 'Your build, skin, clothes and hair' })
    opts.push({ id: 'bye', label: '👋 Goodbye' })
    return opts
  }

  backId(): string {
    return 'bye'
  }

  onMenu(id: string): void {
    const e = this.engine
    const s = e.save
    const n = this.npc
    if (id === 'talk') this.say(n, ...n.lines)
    else if (id === 'deliver') {
      const d = R.deliveryFor(s, e.world, this.town.id, n.id)
      if (d) {
        this.say(n, ...d.done)
        e.completeQuest(d)
      }
    } else if (id === 'trade' && n.trade) {
      const t = n.trade
      if (R.count(s, t.wants) > 0) {
        e.take(t.wants)
        e.markTaken(this.tradeKey)
        this.say(n, t.line)
        e.give(t.gives)
      } else this.say(n, `Bring me ${withArticle(e.world.item(t.wants).name)} and we can talk.`)
    } else if (id === 'train' && n.trains) {
      const price = R.trainPrice(n, s)
      const stat = n.trains.stat
      if (e.spendGold(price)) {
        s.trained[stat] += 1
        e.raiseStat(stat, 1)
        this.say(n, `There! Feel that? Your ${STAT_INFO[stat].name} is now ${s.stats[stat]}.`)
      } else this.say(n, `Come back when you have ${price} gold.`)
    } else if (id === 'restyle' && n.restyle) {
      if (s.gold >= n.restyle.price) e.openCreator(n.restyle.price)
      else this.say(n, `A little magic costs a little gold: ${n.restyle.price}, to be exact.`)
    } else if (id === 'bye') e.pop()
  }
}

export class MayorMode extends Room {
  readonly kind = 'mayor' as const
  readonly town: Town

  constructor(engine: Engine, town: Town) {
    super(engine)
    this.town = town
    const met = `met:${town.id}`
    const first = !engine.isTaken(met)
    engine.markTaken(met)
    this.say(town.mayor, ...(first ? town.mayor.greeting : town.mayor.greeting.slice(0, 1)))
    this.talk(first)
  }

  /** The hint (on the first visit, or when asked), then whatever the quest calls for. */
  private talk(withHint: boolean): void {
    const e = this.engine
    const m = this.town.mayor
    const s = e.save
    if (m.hint && withHint) {
      const h = e.world.hints.get(m.hint)
      if (h) this.say(m, h.text)
      e.hearHint(m.hint)
    }
    const q = m.quest
    if (!q) return
    const st = s.quests[q.id]
    if (!st) this.say(m, ...q.offer)
    else if (st === 'active' && R.questReady(s, q)) {
      this.say(m, q.type === 'fetch' ? `Is that the ${e.world.item(q.item!).name} I see?` : 'They say the road is safe again. Is it true?')
    } else if (st === 'active') this.say(m, q.reminder)
    else this.say(m, `Thank you again, ${s.heroName}. ${this.town.name} will not forget you.`)
  }

  title(): string {
    return `${this.town.mayor.name} of ${this.town.name}`
  }

  private rewardText(q: Quest): string {
    const items = (q.reward.items ?? []).map((id) => this.engine.world.item(id).name)
    return `Reward: ${[`${q.reward.gold} gold`, ...items].join(', ')}`
  }

  menu(): ChoiceOption[] {
    const e = this.engine
    const s = e.save
    const q = this.town.mayor.quest
    const opts: ChoiceOption[] = []
    const d = R.deliveryFor(s, e.world, this.town.id)
    if (d) opts.push({ id: 'deliver', label: `✉️ Give the ${e.world.item(d.item!).name}`, hint: d.title })
    if (q && !s.quests[q.id]) opts.push({ id: 'accept', label: `✅ Accept: ${q.title}`, hint: this.rewardText(q) })
    if (q && R.questReady(s, q)) {
      opts.push({ id: 'handin', label: q.type === 'fetch' ? `🎁 Hand over the ${e.world.item(q.item!).name}` : `⚔️ Report: ${q.title}`, hint: this.rewardText(q) })
    }
    opts.push({ id: 'talk', label: '💬 Talk' })
    if (this.town.crisis) {
      const lair = e.world.game.challenge.lair
      opts.push({ id: 'lair', label: `${lair.emoji} To ${lair.name}` })
    }
    opts.push({ id: 'leave', label: '👋 Leave' })
    return opts
  }

  backId(): string {
    return 'leave'
  }

  onMenu(id: string): void {
    const e = this.engine
    const m = this.town.mayor
    const q = m.quest
    if (id === 'accept' && q) {
      e.acceptQuest(q)
      if (q.type === 'deliver' && q.to) {
        const to = e.world.town(q.to.town)
        const who = q.to.npc ? e.world.npc(to.id, q.to.npc).name : to.mayor.name
        this.say(m, `Here is the ${e.world.item(q.item!).name}. ${who} in ${to.name} is expecting it.`)
      } else this.say(m, q.type === 'slay' ? 'Be careful out there, Hero.' : 'I will be waiting. Good luck!')
    } else if (id === 'handin' && q) {
      this.say(m, ...q.done)
      e.completeQuest(q)
    } else if (id === 'deliver') {
      const d = R.deliveryFor(e.save, e.world, this.town.id)
      if (d) {
        this.say(m, ...d.done)
        e.completeQuest(d)
      }
    } else if (id === 'talk') {
      this.say(m, m.greeting[0])
      this.talk(true)
    } else if (id === 'lair') {
      e.pop()
      e.openLair(this.town)
    } else if (id === 'leave') e.pop()
  }
}
