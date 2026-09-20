/**
 * The night's timetable, which is also the workout: each ship is an effort (its need) for a while (its watch),
 * followed by a rest. Harder ships are shorter. The night warms up, peaks in the middle (with one big ship in longer
 * workouts), and winds down toward dawn. Everything comes from the seed and the workout length.
 */
import { Config } from '../config.ts'
import { makeRng, type Rng } from '../rng.ts'
import { kindForWatch, nameFor, type HullKind } from './fleet.ts'
import type { WeatherKind, WeatherPlan } from './weather.ts'

export type Level = 1 | 2 | 3 | 4

export interface ShipPlan {
  id: number
  name: string
  kind: HullKind
  level: Level
  /** Pedal units the lamp must reach for this ship, weather included. */
  need: number
  /** The worst weather on its watch (the timetable shows it). */
  weather: WeatherKind
  /** The watch: the lamp matters from watchStart to watchEnd; the channel starts at approachEnd. */
  watchStart: number
  approachEnd: number
  watchEnd: number
  /** Which rocks the current sets it toward: +1 the reef, −1 the headland. */
  side: 1 | -1
  /** When it flashes a hail, if it does. */
  hailAt: number | null
  /** Where on the horizon it appears, −1..1. */
  lane: number
  bigOne: boolean
  /** It follows close behind another ship (hard nights). */
  convoy: boolean
}

interface Draft { level: Level; watch: number; rest: number; big: boolean; partner: boolean }

function pickLevel(p: number, last: number, rng: Rng): Level {
  let stage = Config.STAGE_ENDS.findIndex((e) => p < e)
  if (stage < 0) stage = Config.STAGE_ENDS.length - 1
  const w = [...Config.LEVEL_WEIGHTS[stage]!]
  if (last === 4) w[3] = 0 // never two sprints back to back
  const total = w.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < w.length; i++) {
    r -= w[i]!
    if (r <= 0) return (i + 1) as Level
  }
  return 2
}

export function needFor(level: Level, difficulty: number): number {
  const rest = Config.REST_TARGET
  return rest + ((Config.LEVELS[level] ?? 50) - rest) * difficulty
}

export function buildSchedule(seed: number, duration: number, difficulty: number, weather: WeatherPlan, convoys = false): ShipPlan[] {
  const rng = makeRng(seed, 'schedule')
  const end = duration - Config.COOLDOWN
  const drafts: Draft[] = []
  let t = Config.WARMUP
  let bigDone = duration < Config.BIG_ONE_MINUTES * 60
  let last = 0
  for (;;) {
    const room = end - t
    if (room < Config.MIN_WATCH) break
    const p = t / duration
    let level: Level
    let watch: number
    let big = false
    if (drafts.length === 0) {
      // the first ship is always a gentle one, so the player learns the lamp before it matters much
      level = 1
      watch = Math.min(rng.range(...Config.WATCH_BY_LEVEL[1]!), Math.max(Config.MIN_WATCH, room * 0.45))
    } else if (!bigDone && p >= Config.BIG_ONE_AT) {
      level = 3
      watch = rng.range(...Config.BIG_ONE_WATCH)
      big = true
      bigDone = true
    } else {
      level = pickLevel(p, last, rng)
      watch = rng.range(...Config.WATCH_BY_LEVEL[level]!)
    }
    watch = Math.min(watch, room)
    const rest = Config.REST_BASE + Config.REST_PER_LEVEL * level + rng.range(-Config.REST_JITTER, Config.REST_JITTER)
    const partner = convoys && !big && p >= Config.CONVOY_FROM && level <= 3 && watch > 60 && rng.chance(Config.CONVOY_CHANCE)
    drafts.push({ level, watch, rest, big, partner })
    last = level
    t += watch + rest
  }

  // stretch the rests so the last watch ends exactly at `end`
  let used = 0
  drafts.forEach((d, i) => { used += d.watch + (i < drafts.length - 1 ? d.rest : 0) })
  const slack = Math.max(0, end - Config.WARMUP - used)
  const perRest = drafts.length > 1 ? slack / (drafts.length - 1) : 0

  const plans: ShipPlan[] = []
  const used_names = new Set<string>()
  let lastKind: HullKind | null = null
  t = Config.WARMUP
  let id = 1
  const make = (level: Level, start: number, watch: number, big: boolean, convoy: boolean): ShipPlan => {
    const kind: HullKind = big ? 'liner' : kindForWatch(watch, rng, lastKind)
    lastKind = kind
    const watchEnd = start + watch
    const w = weather.needBetween(start, watchEnd)
    return {
      id: id++,
      name: nameFor(kind, rng, used_names),
      kind,
      level,
      need: Math.round(needFor(level, difficulty) + w),
      weather: weather.worstBetween(start, watchEnd),
      watchStart: start,
      approachEnd: start + watch * Config.APPROACH_SHARE,
      watchEnd,
      side: rng.chance(0.5) ? 1 : -1,
      hailAt: rng.chance(Config.HAIL_CHANCE) ? start + watch * rng.range(0.2, 0.7) : null,
      lane: rng.range(-1, 1),
      bigOne: big,
      convoy,
    }
  }
  drafts.forEach((d, i) => {
    const lead = make(d.level, t, d.watch, d.big, false)
    plans.push(lead)
    const rest = i < drafts.length - 1 ? d.rest + perRest : Config.COOLDOWN
    if (d.partner) {
      const gap = rng.range(...Config.CONVOY_GAP)
      const start = t + gap
      const latest = Math.min(end, t + d.watch + rest - 15)
      const watch = Math.min(d.watch - gap + rng.range(0, 12), latest - start)
      if (watch >= Config.MIN_WATCH) {
        const follower = make(Math.min(d.level, 2) as Level, start, watch, false, true)
        follower.lane = -lead.lane
        plans.push(follower)
      }
    }
    t += d.watch + rest
  })
  return plans
}
