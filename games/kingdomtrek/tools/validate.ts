/**
 * Checks every game in public/data/games/index.json: the validator first, then the solver bot plays it with
 * each class on a few seeds, pedaling steadily. Prints whether each game can be won and how long a steady
 * player needs. Exits with 1 if any game is invalid, can't be won, or takes too long or too little.
 *
 *   npm run validate                  check every game
 *   npm run validate -- --write       also store the median time in the index as `minutes`
 *   npm run validate -- --steps       also print what the bot did in the first run
 */
import { validateGame } from '../src/content/validate.ts'
import { BAND, catalog, games, index, playtest, writeIndex } from './load.ts'

const write = process.argv.includes('--write')
const showSteps = process.argv.includes('--steps')
const fmt = (n: number | undefined): string => (n === undefined || Number.isNaN(n) ? '—' : n.toFixed(0))

let failed = false
for (const entry of index.games) {
  const game = games.get(entry.id)
  const errs = game ? validateGame(game, catalog) : [`missing file games/${entry.id}.json`]
  if (!game || errs.length) {
    failed = true
    console.log(`✗ ${entry.id}: invalid\n    ${errs.join('\n    ')}`)
    continue
  }
  const p = playtest(game)
  const inBand = p.median >= BAND[0] && p.median <= BAND[1]
  const ok = p.won === p.runs.length && inBand
  if (!ok) failed = true
  console.log(`${ok ? '✓' : '✗'} ${entry.id} "${entry.title}": won ${p.won}/${p.runs.length} · ${fmt(p.minutes[0])}–${fmt(p.minutes.at(-1))} min, median ${fmt(p.median)} (index says ${entry.minutes ?? '—'}) · lost ${p.lost} of ${p.fights} fights`)
  for (const x of p.runs.filter((y) => !y.r.ok)) console.log(`    ${x.cls}, seed ${x.seed}: ${x.r.reason}`)
  if (p.minutes.length && !inBand) console.log(`    a level should take ${BAND[0]}–${BAND[1]} minutes`)
  if (showSteps) for (const step of p.runs[0].r.steps) console.log(`    · ${step}`)
  if (write && p.minutes.length) entry.minutes = Math.round(p.median / 5) * 5
}

if (write) {
  writeIndex(index)
  console.log('Wrote the measured minutes to games/index.json')
}
process.exit(failed ? 1 : 0)
