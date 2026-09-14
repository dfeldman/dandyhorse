/** Small helpers for the generator: shuffling, picking, and filling text templates. */
import type { Rng } from '../engine/rng.ts'

export { cap } from '../engine/text.ts'

export function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function sample<T>(rng: Rng, list: readonly T[], n: number): T[] {
  return shuffle(rng, list).slice(0, n)
}

export function weighted<T>(rng: Rng, list: readonly (readonly [T, number])[]): T {
  let r = rng.range(0, list.reduce((n, [, w]) => n + w, 0))
  for (const [v, w] of list) if ((r -= w) < 0) return v
  return list[list.length - 1][0]
}

/** Replace {name} tokens. A token with no value is a bug in the tables, so it throws. */
export function fill(template: string, ctx: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = ctx[k]
    if (v === undefined) throw new Error(`template token {${k}} has no value in "${template}"`)
    return v
  })
}

export const withArticle = (name: string): string => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`)

/** The five emoji skin tones. */
export const TONES = ['🏻', '🏼', '🏽', '🏾', '🏿']

/** A person emoji in a skin tone. Anything that can't take one (🐝, 🎣) is left as it is. */
export function withTone(emoji: string, tone: string): string {
  const [first, ...rest] = [...emoji]
  if (!/\p{Emoji_Modifier_Base}/u.test(first)) return emoji
  return first + tone + (rest[0] === '\uFE0F' ? rest.slice(1) : rest).join('')
}

export const slug = (s: string): string => s.toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
