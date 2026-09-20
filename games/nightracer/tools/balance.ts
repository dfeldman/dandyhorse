/**
 * Race many seeds headless and print how a player at each pedal level does, with and without using the buttons.
 *   node tools/balance.ts [races=40] [laps=3] [difficulty=normal]
 * What "fun" looks like here: steady pace (50) finishes mid-pack without buttons and near the front with them;
 * pushing (65+) wins most races; place changes happen every race.
 */
import { Config } from '../src/config.ts'
import type { ButtonId } from '../src/sim/car.ts'
import { Race } from '../src/sim/race.ts'

const N = Number(process.argv[2] ?? 40)
const LAPS = Number(process.argv[3] ?? 3)
const DIFF = Config.DIFFICULTY[process.argv[4] ?? 'normal'] ?? 1
const DT = 1 / 30

interface Outcome { place: number; changes: number; overtakes: number; hits: number; spread: number; time: number; bumps: number; air: number; drafts: number }

export type Mode = 'none' | 'casual' | 'smart'

export function runRace(seed: number, pedal: number, mode: Mode, laps = LAPS): Outcome {
  const race = new Race({ seed, laps, difficulty: DIFF, grid: ['blue', 'gold', 'player', 'green'] })
  let changes = 0, bumps = 0, air = 0, drafts = 0, spreadSum = 0, spreadN = 0
  let wobble = 0
  // a person on a phone: decides when the screen says so, the tap lands LAG seconds later
  const LAG = 0.9
  const queue: { at: number; b: ButtonId }[] = []
  let nextLook = 0
  for (let t = 0; t < 1500 && race.phase !== 'finished'; t += DT) {
    wobble += (Math.random() - 0.5) * 2 * DT * 10
    wobble *= 0.99
    if (mode !== 'none' && t >= nextLook) {
      nextLook = t + (mode === 'smart' ? 1 : 4) * (0.7 + Math.random() * 0.6)
      if (race.phase === 'countdown' && race.countdown < 1.9 && race.countdown > 0.9 && !race.rocketArmed) queue.push({ at: t + LAG, b: 'turbo' })
      if (race.phase === 'racing') {
        const p = race.player
        const ahead = race.cars.some((c) => c !== p && c.dist - p.dist > 0 && c.dist - p.dist < 90)
        const lastLap = p.dist > (race.laps - 1) * race.track.length + race.track.length * 0.6
        if (mode === 'casual') {
          if (p.turbo >= 100) queue.push({ at: t + LAG, b: 'turbo' })
          if (p.oil > 0 && race.oilTarget() && Math.random() < 0.5) queue.push({ at: t + LAG, b: 'oil' })
        } else {
          if (p.turbo >= 100 && p.boost < 0.5 && (ahead || lastLap || p.turbo >= 280)) queue.push({ at: t + LAG, b: 'turbo' })
          if (race.oilTarget() && p.oil > 0) queue.push({ at: t + LAG, b: 'oil' })
        }
      }
    }
    const presses: ButtonId[] = []
    while (queue.length && queue[0]!.at <= t) presses.push(queue.shift()!.b)
    race.step(DT, { pedal: pedal + wobble, presses })
    for (const e of race.takeEvents()) {
      if (e.type === 'overtake' || e.type === 'overtaken') changes++
      if (e.type === 'bump') bumps++
      if (e.type === 'land' && e.car === 'player') air++
      if (e.type === 'draft' && e.on) drafts++
    }
    if (race.phase === 'racing') {
      const d = race.cars.map((c) => c.dist)
      spreadSum += Math.max(...d) - Math.min(...d)
      spreadN++
    }
  }
  const p = race.player
  return { place: p.place, changes, overtakes: p.stats.overtakes, hits: p.stats.oilHits, spread: spreadSum / Math.max(1, spreadN), time: race.time, bumps, air, drafts }
}

function summary(pedal: number, mode: Mode): string {
  const outs: Outcome[] = []
  for (let s = 1; s <= N; s++) outs.push(runRace(1000 + s, pedal, mode))
  const avg = (f: (o: Outcome) => number) => outs.reduce((a, o) => a + f(o), 0) / outs.length
  const dist = [1, 2, 3, 4].map((k) => outs.filter((o) => o.place === k).length)
  return `pedal ${String(pedal).padStart(3)} ${mode.padEnd(6)}  place ${avg((o) => o.place).toFixed(2)}  [1st..4th ${dist.join('/')}]` +
    `  changes ${avg((o) => o.changes).toFixed(1)}  passes ${avg((o) => o.overtakes).toFixed(1)}  oil hits ${avg((o) => o.hits).toFixed(2)}` +
    `  spread ${avg((o) => o.spread).toFixed(0)} m  time ${avg((o) => o.time).toFixed(0)} s  bumps ${avg((o) => o.bumps).toFixed(1)}  hops ${avg((o) => o.air).toFixed(1)}  drafts ${avg((o) => o.drafts).toFixed(1)}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const pedal of [25, 40, 50, 60, 70, 85]) {
    for (const mode of ['none', 'casual', 'smart'] as const) console.log(summary(pedal, mode))
  }
}
