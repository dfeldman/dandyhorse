/**
 * The phone's copy of the choice list (INTEGRATION.md §4.2): the current ChoiceList as a Dandyhorse menu prompt, and
 * what a tap on the phone means for the game. Pure, so tests drive it without a browser.
 */
import { isStaleAnswer, menuPrompt, readMenuAnswer } from '@dandyhorse/gamekit'
import type { InputAnswer, Prompt } from '@dandyhorse/gamekit'
import type { ChoiceList, Press } from './engine/choice.ts'

export const PROMPT_ID = 'kt'

/**
 * What `rev` follows: where the list is, its title, its Back option and which options it has (and which are
 * disabled). Not the labels: the gate's minutes follow your pace every second, and a tap on "Millbrook · 8 min" is
 * still meant for Millbrook when it says 7.
 */
export function structureOf(list: ChoiceList): string {
  const scope = list.key.split('|')[0]
  return `${scope}|${list.title}|${list.backId ?? ''}|${list.options.map((o) => `${o.id}${o.disabled ? '-' : ''}`).join(',')}`
}

export class MenuMirror {
  rev = 0
  private structure: string | null = null

  /** Follow the list: `rev` goes up whenever its structure changed. */
  sync(list: ChoiceList): number {
    const s = structureOf(list)
    if (s !== this.structure) {
      this.structure = s
      this.rev++
    }
    return this.rev
  }

  /** The menu prompt for this list, with the big screen's highlight so the phone marks the same option. */
  prompt(list: ChoiceList, highlight: string | null): Prompt {
    this.sync(list)
    return menuPrompt(PROMPT_ID, this.rev, {
      title: list.title,
      items: list.options.map((o) => ({ id: o.id, label: o.label, ...(o.hint ? { hint: o.hint } : {}), ...(o.disabled ? { disabled: true } : {}) })),
      highlight: highlight && list.options.some((o) => o.id === highlight) ? highlight : null,
      back: list.backId ?? null,
      countdown: list.countdown ?? null,
    })
  }
}

/** A button press (exactly like a key), a pick of an option on the current list, or nothing. */
export type PhoneAction = { press: Press } | { pick: string } | null

/**
 * What a phone tap does to `list`, the list on screen now. Syncs the mirror first, so a list that changed since the
 * last tick already counts as changed: a Select, Back or item tap aimed at the list before is dropped (you tapped
 * Journal on the road just as a fight began). Directions always pass.
 */
export function phoneAction(a: InputAnswer, mirror: MenuMirror, list: ChoiceList): PhoneAction {
  if (a.promptId !== PROMPT_ID || a.source === 'game') return null
  mirror.sync(list)
  const m = readMenuAnswer(a)
  if (isStaleAnswer(m, mirror.rev)) return null
  if (m.kind === 'button') return { press: m.button }
  const opt = list.options.find((o) => o.id === m.id)
  return opt && !opt.disabled ? { pick: opt.id } : null
}
