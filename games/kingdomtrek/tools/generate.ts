/**
 * Makes new game files with the generator (src/gen/generate.ts). Each candidate is checked by the validator and
 * played by the solver bot with every class on three seeds; it is kept only if every run wins and the median time
 * lands in the target band. Kept games go to public/data/games/ and onto the end of the index, with their minutes.
 *
 *   npm run generate                          one new game, the threat chosen to vary the list
 *   npm run generate -- --count 5             five new games
 *   npm run generate -- --threat pirates      a particular threat
 *   npm run generate -- --seed 42 --dry       start at seed 42 and print what would be kept, writing nothing
 */
import { writeFileSync } from 'node:fs'
import { THREATS } from '../src/content/types.ts'
import type { Threat } from '../src/content/types.ts'
import { validateGame } from '../src/content/validate.ts'
import { generateGame } from '../src/gen/generate.ts'
import { catalog, dataPath, index, playtest, writeIndex } from './load.ts'

/** Keep games a steady player finishes in about this many minutes (the validator allows 60–150). */
const TARGET = [70, 120]
const TRIES = 60

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const fmt = (n: number | undefined): string => (n === undefined || Number.isNaN(n) ? '—' : n.toFixed(0))
const count = Number(arg('count') ?? 1)
const dry = process.argv.includes('--dry')
const asked = arg('threat') as Threat | undefined
if (asked && !THREATS.includes(asked)) {
  console.error(`Unknown threat "${asked}". One of: ${THREATS.join(', ')}`)
  process.exit(1)
}
let seed = Number(arg('seed') ?? 1000 + 97 * index.games.length)

/** The threat the index has used least (ties in THREATS order), never the same as the last game's. */
function nextThreat(): Threat {
  const last = index.games[index.games.length - 1]?.threat
  const uses = (t: Threat): number => index.games.filter((g) => g.threat === t).length
  return THREATS.filter((t) => t !== last).sort((a, b) => uses(a) - uses(b))[0]
}

function nextId(): string {
  const n = Math.max(-1, ...index.games.map((g) => Number(g.id.slice(5)))) + 1
  return `game-${String(n).padStart(4, '0')}`
}

for (let made = 0; made < count; made++) {
  const id = nextId()
  const threat = asked ?? nextThreat()
  let kept = false
  for (let n = 0; n < TRIES && !kept; n++, seed++) {
    let game
    try {
      game = generateGame({ id, seed, catalog, threat })
    } catch (err) {
      console.log(`  seed ${seed}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const errs = validateGame(game, catalog)
    if (errs.length) {
      console.log(`  seed ${seed}: invalid: ${errs[0]}${errs.length > 1 ? ` (and ${errs.length - 1} more)` : ''}`)
      continue
    }
    const p = playtest(game)
    const summary = `won ${p.won}/${p.runs.length} · ${fmt(p.minutes[0])}–${fmt(p.minutes.at(-1))} min, median ${fmt(p.median)} · lost ${p.lost} of ${p.fights} fights`
    if (p.won < p.runs.length || p.median < TARGET[0] || p.median > TARGET[1]) {
      const why = p.runs.find((x) => !x.r.ok)?.r.reason
      console.log(`  seed ${seed}: ${summary}${why ? ` (${why})` : ''}`)
      continue
    }
    kept = true
    console.log(`✓ ${id} "${game.title}" (${threat}, seed ${seed}): ${summary}`)
    index.games.push({ id, title: game.title, threat, minutes: Math.round(p.median / 5) * 5 })
    if (!dry) {
      writeFileSync(dataPath(`games/${id}.json`), `${JSON.stringify(game, null, 2)}\n`)
      writeIndex(index)
    }
  }
  if (!kept) {
    console.log(`✗ no keepable ${threat} game in ${TRIES} seeds`)
    process.exit(1)
  }
}
if (dry) console.log('Dry run: nothing written.')
