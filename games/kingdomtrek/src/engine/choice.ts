/**
 * The choice framework (docs/DESIGN.md §3). Every screen is one list of text options. The game draws it and
 * the six buttons drive it; a phone could mirror it later. Option ids are stable and semantic so tests and
 * bots pick by id, never by position.
 */

export type Press = 'up' | 'down' | 'left' | 'right' | 'select' | 'back'

export const LABEL_MAX = 40
export const OPTIONS_MAX = 100

export interface ChoiceOption {
  id: string
  /** Plain text, at most LABEL_MAX characters; may start with one emoji. */
  label: string
  disabled?: boolean
  /** Show this item's card while the option is highlighted. */
  itemId?: string
  /** One line of explanation shown for the highlighted option. */
  hint?: string
}

export interface ChoiceList {
  /** Changes whenever the list changes, so a mirror knows to redraw. */
  key: string
  title: string
  options: ChoiceOption[]
  /** The option the Back button picks. */
  backId?: string
  /** Seconds until the list picks its first option by itself (results screens). */
  countdown?: number
}

export type ChoiceSpec = Omit<ChoiceList, 'key'>

/** Enforce the limits and compute the key. */
export function finalize(spec: ChoiceSpec, scope: string): ChoiceList {
  const options = spec.options.slice(0, OPTIONS_MAX).map((o) =>
    o.label.length > LABEL_MAX ? { ...o, label: o.label.slice(0, LABEL_MAX - 1) + '…' } : o,
  )
  const key = `${scope}|${spec.title}|${options.map((o) => `${o.id}${o.disabled ? '-' : ''}:${o.label}`).join(',')}`
  return { ...spec, options, key }
}
