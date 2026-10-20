/**
 * The command line, kept apart from the command itself so it can be tested without running anything.
 *
 *   cli.ts backfill marta kenji --weeks 9 --max 8 --at-once 2
 *
 * The thing to get right is that a flag's value is never mistaken for a bot's name: `--weeks 9` once left
 * a bot called "9" to look for, and the run died before a single session.
 */

/** Every flag that takes a value. */
export const VALUE_FLAGS = ['weeks', 'max', 'at-once', 'minutes', 'game'] as const

/** The bare words: the bots asked for, with no flag's value among them. */
export function namedBots(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      if ((VALUE_FLAGS as readonly string[]).includes(a.slice(2))) i++ // skip its value
      continue
    }
    out.push(a)
  }
  return out
}

export function numberFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}

export function stringFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
