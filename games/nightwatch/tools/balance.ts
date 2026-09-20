/**
 * Play many nights headless with bot keepers and print how effort turns into stars.
 *   node tools/balance.ts [nights=30] [minutes=30] [difficulty=normal] [weather=mixed]
 *
 * What "fun" looks like here:
 *   - a keeper who follows the timetable (target + a little, reacting like a person on a treadmill) earns mostly
 *     three stars and never loses a ship;
 *   - one who just holds a steady 50 and ignores the board brings the easy ships in perfectly, scrapes the strong
 *     ones and loses some sprints, about 2 stars a ship;
 *   - a tired keeper (steady 40) loses ships, but not all of them;
 *   - the horn visibly saves ships for a keeper who slips.
 */
import { Config, type Difficulty, type WeatherMode } from '../src/config.ts'
import { makeRng } from '../src/rng.ts'
import { Night, type ButtonId } from '../src/sim/night.ts'

// KNOBS="LAMP_FADE=20,DRIFT_MAX=0.14" node tools/balance.ts  tries numbers without editing config.ts
for (const kv of (process.env.KNOBS ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=')
  ;(Config as Record<string, unknown>)[k!] = Number(v)
}

const N = Number(process.argv[2] ?? 30)
const MINUTES = Number(process.argv[3] ?? 30)
const DIFF = (process.argv[4] ?? 'normal') as Difficulty
const WEATHER = (process.argv[5] ?? 'mixed') as WeatherMode
const DT = 0.1

export interface Bot {
  name: string
  /** steady: hold `pedal`; follow: aim at target + margin, ramping early when the board says a ship is due */
  kind: 'steady' | 'follow'
  pedal?: number
  margin?: number
  /** Pedal units per second the player can change pace (a treadmill belt is slow). */
  slew?: number
  /** Starts ramping this many seconds before a watch (0 = only reacts to the gauge). */
  lead?: number
  horn?: boolean
}

export const BOTS: Bot[] = [
  { name: 'follow +2, early', kind: 'follow', margin: 2, slew: 4, lead: 8, horn: true },
  { name: 'follow +0, late', kind: 'follow', margin: 0, slew: 3, lead: 0, horn: true },
  { name: 'follow −3, horn', kind: 'follow', margin: -3, slew: 3, lead: 4, horn: true },
  { name: 'follow −3', kind: 'follow', margin: -3, slew: 3, lead: 4, horn: false },
  { name: 'steady 55, horn', kind: 'steady', pedal: 55, horn: true },
  { name: 'steady 50, horn', kind: 'steady', pedal: 50, horn: true },
  { name: 'steady 50', kind: 'steady', pedal: 50, horn: false },
  { name: 'steady 40, horn', kind: 'steady', pedal: 40, horn: true },
]

export interface Result {
  ships: number
  stars: number[]
  hails: number
  hailsSeen: number
  blasts: number
  meanPedal: number
  above50: number
  points: number
}

export function playNight(seed: number, bot: Bot, minutes = MINUTES, difficulty = DIFF, weather = WEATHER): Result {
  const night = new Night({ seed, duration: minutes * 60, difficulty, weather })
  const rng = makeRng(seed, 'bot')
  let pedal = bot.kind === 'steady' ? bot.pedal! : 30
  let wobble = 0
  const LAG = 0.9
  const queue: { at: number; b: ButtonId }[] = []
  let nextLook = 0
  let sum = 0, above = 0, n = 0
  const seenHail = new Set<number>()
  while (night.phase !== 'done') {
    const t = night.time
    wobble += (rng() - 0.5) * 2 * DT * 6
    wobble *= 0.985
    if (bot.kind === 'follow') {
      let want = night.target + bot.margin!
      const ghost = night.ghost()
      if (ghost && bot.lead && ghost.in <= bot.lead) want = Math.max(want, ghost.need + bot.margin!)
      // the gauge target climbs over TARGET_RAMP; a person aims for the ship's full need once the watch starts
      for (const s of night.watching) want = Math.max(want, s.plan.need + bot.margin!)
      if (night.watching.length === 0 && !(ghost && bot.lead && ghost.in <= bot.lead)) want = Math.max(Config.REST_TARGET + 5, 32)
      const slew = bot.slew! * DT
      pedal += Math.max(-slew * 2, Math.min(slew, want - pedal))
    }
    if (bot.horn && t >= nextLook) {
      nextLook = t + 1 + rng() * 1.5
      const worst = Math.max(0, ...night.watching.map((s) => s.drift))
      if (worst > 0.45 && night.lamp.charges > 0) queue.push({ at: t + LAG, b: 'horn' })
      for (const s of night.watching) {
        if (s.hail && !s.hail.answered && !s.hail.missed && !seenHail.has(s.id) && rng() < 0.6) {
          seenHail.add(s.id)
          queue.push({ at: t + LAG + rng() * 3, b: 'horn' })
        }
      }
    }
    const presses: ButtonId[] = []
    while (queue.length && queue[0]!.at <= t) presses.push(queue.shift()!.b)
    queue.sort((a, b) => a.at - b.at)
    const p = Math.max(0, pedal + wobble)
    night.step(DT, { pedal: p, presses })
    night.takeEvents()
    sum += p
    if (p > 50) above++
    n++
  }
  return {
    ships: night.ships.length,
    stars: night.ships.map((s) => s.stars ?? 0),
    hails: night.hailsAnswered,
    hailsSeen: night.hailsSeen,
    blasts: night.blasts,
    meanPedal: sum / n,
    above50: above / n,
    points: night.points,
  }
}

function scheduleStats(seed: number) {
  const night = new Night({ seed, duration: MINUTES * 60, difficulty: DIFF, weather: WEATHER })
  const ships = night.ships
  const watch = ships.reduce((a, s) => a + s.plan.watchEnd - s.plan.watchStart, 0)
  const hard = ships.filter((s) => s.plan.need > 50).reduce((a, s) => a + s.plan.watchEnd - s.plan.watchStart, 0)
  const levels = [0, 0, 0, 0, 0]
  for (const s of ships) levels[s.plan.level]!++
  return { ships: ships.length, watch: watch / night.duration, hard: hard / night.duration, levels, spells: night.weather.spells.map((s) => s.kind) }
}

const pct = (x: number): string => `${Math.round(x * 100)}%`.padStart(4)

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Night Watch balance: ${N} nights of ${MINUTES} min, ${DIFF}, weather ${WEATHER}\n`)
  let sShips = 0, sWatch = 0, sHard = 0
  const lv = [0, 0, 0, 0, 0]
  const kinds: Record<string, number> = {}
  for (let i = 0; i < N; i++) {
    const s = scheduleStats(1000 + i)
    sShips += s.ships; sWatch += s.watch; sHard += s.hard
    s.levels.forEach((v, j) => { lv[j]! += v })
    for (const k of s.spells) kinds[k] = (kinds[k] ?? 0) + 1
  }
  console.log(`schedule: ${(sShips / N).toFixed(1)} ships a night, on watch ${pct(sWatch / N)} of the night, above steady ${pct(sHard / N)}`)
  console.log(`          levels 1–4: ${lv.slice(1).map((v) => (v / N).toFixed(1)).join(' / ')} per night; weather spells ${JSON.stringify(kinds)}\n`)
  console.log('keeper               ★ avg   3★   2★   1★  aground  blasts  hails   mean pedal  >50   points')
  for (const bot of BOTS) {
    let ships = 0, stars = 0, hails = 0, seen = 0, blasts = 0, mean = 0, above = 0, points = 0
    const dist = [0, 0, 0, 0]
    for (let i = 0; i < N; i++) {
      const r = playNight(1000 + i, bot)
      ships += r.ships
      for (const s of r.stars) { stars += s; dist[s]!++ }
      hails += r.hails; seen += r.hailsSeen; blasts += r.blasts; mean += r.meanPedal; above += r.above50; points += r.points
    }
    console.log(
      `${bot.name.padEnd(20)} ${(stars / ships).toFixed(2).padStart(5)}  ${pct(dist[3]! / ships)} ${pct(dist[2]! / ships)} ${pct(dist[1]! / ships)}   ${pct(dist[0]! / ships)}   ` +
      `${(blasts / N).toFixed(1).padStart(5)}  ${pct(hails / Math.max(1, seen))}   ${(mean / N).toFixed(1).padStart(8)}   ${pct(above / N)}  ${Math.round(points / N)}`,
    )
  }
}
