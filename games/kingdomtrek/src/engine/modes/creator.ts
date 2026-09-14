/**
 * The character creator: a class, a name, a build, a skin tone, clothes and hair, one choice list each (so a
 * phone or a gamepad works). A new hero gets the class's stat nudges and starting kit; a wizard's restyle
 * changes only the look.
 */
import { STATS } from '../../content/types.ts'
import { CONFIG } from '../../config.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import { BODIES, HAIRS, HAIR_LENGTHS, HERO_CLASSES, OUTFITS, SKINS } from '../save.ts'
import type { HeroClass, HeroLook } from '../save.ts'

type Step = 'class' | 'name' | 'body' | 'skin' | 'outfit' | 'hair' | 'hairLength' | 'done'

const TITLES: Record<Step, string> = {
  class: 'Who will you be?', name: 'Your name', body: 'Your build', skin: 'Your skin', outfit: 'Your clothes', hair: 'Your hair',
  hairLength: 'Hair length', done: 'Ready, hero?',
}
const BODY_LABEL: Record<HeroLook['body'], string> = { sturdy: '🧱 Sturdy', slim: '🌿 Slim', tall: '🌲 Tall' }
const SKIN_LABEL: Record<HeroLook['skin'], string> = {
  light: '✋🏻 Light', 'medium-light': '✋🏼 Medium-light', medium: '✋🏽 Medium', 'medium-dark': '✋🏾 Medium-dark', dark: '✋🏿 Dark',
}
const OUTFIT_LABEL: Record<HeroLook['outfit'], string> = {
  blue: '🔵 Blue', red: '🔴 Red', green: '🟢 Green', purple: '🟣 Purple', gold: '🟡 Gold', black: '⚫ Black',
}
const HAIR_LABEL: Record<HeroLook['hair'], string> = {
  brown: '🟤 Brown', blond: '🟡 Blond', red: '🟠 Red', black: '⚫ Black', white: '⚪ White', none: '🥚 None',
}
const LENGTH_LABEL: Record<HeroLook['hairLength'], string> = { short: '✂️ Short', shoulder: '💇 Shoulder-length', long: '🌊 Long' }

export interface Draft { cls: HeroClass | null; name: string; look: HeroLook }

export class CreatorMode implements Mode {
  readonly kind = 'creator' as const
  /** The wizard's fee when restyling; null when making a new hero. */
  readonly price: number | null
  private engine: Engine
  private steps: Step[]
  private at = 0
  private draft: Draft

  constructor(engine: Engine, price: number | null) {
    this.engine = engine
    this.price = price
    const look: Step[] = ['body', 'skin', 'outfit', 'hair', 'hairLength', 'done']
    this.steps = price === null ? ['class', 'name', ...look] : look
    this.draft = { cls: engine.save.heroClass, name: engine.save.heroName, look: { ...engine.save.look } }
  }

  /** The creator's current step (not `step`, which a Mode uses for ticking). */
  get current(): Step {
    return this.steps[this.at]
  }

  choices(): ChoiceSpec {
    const s = this.engine.save
    const back: ChoiceOption[] = this.at > 0 ? [{ id: 'back', label: '↩ Back' }] : this.price !== null ? [{ id: 'cancel', label: '↩ Never mind' }] : []
    let opts: ChoiceOption[]
    switch (this.current) {
      case 'class':
        opts = HERO_CLASSES.map((k) => {
          const c = CONFIG.classes[k]
          return { id: `class:${k}`, label: `${c.emoji} ${c.name}`, hint: c.blurb }
        })
        break
      case 'name': {
        const names = CONFIG.classes[this.draft.cls ?? HERO_CLASSES[0]].names
        opts = [...names.map((n) => ({ id: `name:${n}`, label: `📜 ${n}` })), { id: 'name:Hero', label: '🛡️ Just "Hero"' }]
        break
      }
      case 'body': opts = BODIES.map((b) => ({ id: `body:${b}`, label: BODY_LABEL[b] })); break
      case 'skin': opts = SKINS.map((k) => ({ id: `skin:${k}`, label: SKIN_LABEL[k] })); break
      case 'outfit': opts = OUTFITS.map((o) => ({ id: `outfit:${o}`, label: OUTFIT_LABEL[o] })); break
      case 'hair': opts = HAIRS.map((h) => ({ id: `hair:${h}`, label: HAIR_LABEL[h] })); break
      case 'hairLength': opts = HAIR_LENGTHS.map((h) => ({ id: `hairLength:${h}`, label: LENGTH_LABEL[h] })); break
      case 'done': {
        const short = this.price !== null && s.gold < this.price
        opts = [{
          id: 'done',
          label: this.price === null ? '✨ This is me!' : `✨ Change it: ${this.price} gold`,
          disabled: short,
          hint: short ? `You need ${this.price! - s.gold} more gold` : undefined,
        }]
        break
      }
    }
    return { title: TITLES[this.current], options: [...opts, ...back], backId: back[0]?.id }
  }

  choose(id: string): void {
    const [what, value] = id.split(':')
    if (id === 'back') this.move(-1)
    else if (id === 'cancel') this.engine.pop()
    else if (id === 'done') this.finish()
    else if (what === this.current) {
      if (what === 'class') this.draft.cls = value as HeroClass
      else if (what === 'name') this.draft.name = value
      else this.draft.look = { ...this.draft.look, [what]: value }
      this.move(1)
    }
  }

  /** One step on or back, passing over hair length when there is no hair. */
  private move(dir: 1 | -1): void {
    this.at = Math.max(0, this.at + dir)
    if (this.current === 'hairLength' && this.draft.look.hair === 'none') this.at += dir
  }

  /** The hero as they would be if `highlighted` were picked (for the preview). */
  preview(highlighted: string | null): Draft {
    const [what, value] = (highlighted ?? '').split(':')
    if (what !== this.current || !value) return this.draft
    if (what === 'class') return { ...this.draft, cls: value as HeroClass }
    if (what === 'name') return { ...this.draft, name: value }
    return { ...this.draft, look: { ...this.draft.look, [what]: value } }
  }

  private finish(): void {
    const e = this.engine
    const s = e.save
    if (this.price !== null) {
      if (!e.spendGold(this.price)) return
      s.look = { ...this.draft.look }
      e.toast('✨ A puff of glitter. You look splendid!')
      e.pop()
      return
    }
    const cls = this.draft.cls ?? HERO_CLASSES[0]
    const def = CONFIG.classes[cls]
    s.heroClass = cls
    s.heroName = this.draft.name
    s.look = { ...this.draft.look }
    for (const k of STATS) s.stats[k] = Math.max(1, s.stats[k] + def.stats[k])
    for (const id of def.items) e.give(id, 1, true)
    e.pop()
  }
}
