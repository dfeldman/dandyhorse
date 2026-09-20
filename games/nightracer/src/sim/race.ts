/**
 * One race: four cars on one track, from the grid to the flag.
 *
 * Nobody steers. Every car (the player's too) picks its own lane: it tucks in behind a car it is catching to draft,
 * pulls out to pass when it gets close, returns to its home lane when the road is clear, and (rivals only) tries to
 * dodge an oil slick it sees in time. The player's input is the pedal (speed) and two buttons:
 *   turbo  a burst of speed from a charge that fills as you pedal (faster while drafting); a tap around GO is a
 *          rocket start
 *   oil    drops a slick behind the car; a rival tailgating in your lane spins out
 * Phases: intro (camera sweep) → countdown (lights) → racing → finished (the player took the flag; cars keep
 * cruising while the results show).
 */
import { Config, laneCenter, ROAD_HALF } from '../config.ts'
import { clamp, makeRng, type Rng } from '../rng.ts'
import { effortOf, newCar, speedFor, terrainFactor, type ButtonId, type Car } from './car.ts'
import { Track, newPose } from './track.ts'

export type Phase = 'intro' | 'countdown' | 'racing' | 'finished'

export type RaceEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'rocket'; car: string }
  | { type: 'tooEarly' }
  | { type: 'turbo'; car: string }
  | { type: 'turboNotReady' }
  | { type: 'oilDrop'; id: number }
  | { type: 'noOil' }
  | { type: 'oilCharged' }
  | { type: 'spin'; car: string; by: string | null }
  | { type: 'dodge'; car: string }
  | { type: 'overtake'; car: string; place: number }
  | { type: 'overtaken'; car: string; place: number }
  | { type: 'lap'; lap: number; final: boolean }
  | { type: 'finish'; place: number }
  | { type: 'bump'; a: string; b: string; hard: boolean }
  | { type: 'draft'; on: boolean }
  | { type: 'land'; car: string; air: number }

export interface Slick {
  id: number
  /** Track position (wrapped) and lateral offset. */
  s: number
  x: number
  owner: string
  age: number
}

export interface Result {
  id: string
  name: string
  color: string
  place: number
  /** Race time (s), null for a car still on the road when the player finished. */
  time: number | null
  points: number
}

export interface RaceInput {
  /** 0–100, 50 = steady; null = unknown (the last value holds). */
  pedal: number | null
  presses: ButtonId[]
}

export interface RaceOptions {
  seed: number
  laps: number
  /** Rival pace multiplier (Config.DIFFICULTY). */
  difficulty: number
  /** Car ids, front of the grid first. */
  grid: string[]
  /** A shared race clock for the rivals' wobble, so it doesn't restart in sync every race. */
  clockOffset?: number
}

export const PLAYER_ID = 'player'
export const PLAYER_NAME = 'You'
export const PLAYER_COLOR = '#ff2d2d'

const G_AIR = 7.5 // cartoon gravity for crest hops

export class Race {
  readonly track: Track
  readonly laps: number
  readonly cars: Car[]
  readonly player: Car
  phase: Phase = 'intro'
  phaseTime = 0
  /** Race clock, from GO. */
  time = 0
  slicks: Slick[] = []
  results: Result[] | null = null
  events: RaceEvent[] = []
  pedal = 0
  rocketArmed = false
  private slickId = 0
  private readonly rng: Rng
  private readonly difficulty: number
  private readonly clockOffset: number
  private lastCount = 0
  private readonly pose = newPose()
  private readonly byId = new Map<string, Car>()

  constructor(opts: RaceOptions) {
    this.track = new Track(opts.seed)
    this.laps = Math.max(1, opts.laps)
    this.difficulty = opts.difficulty
    this.clockOffset = opts.clockOffset ?? 0
    this.rng = makeRng(opts.seed, 'race')
    const defs = [
      { id: PLAYER_ID, name: PLAYER_NAME, color: PLAYER_COLOR, pace: 1, dodge: 0, isPlayer: true },
      ...Config.RIVALS.map((r) => ({ ...r, isPlayer: false })),
    ]
    const cars = opts.grid.map((id) => {
      const d = defs.find((x) => x.id === id)
      if (!d) throw new Error(`unknown car ${id}`)
      return newCar({
        id: d.id, name: d.name, color: d.color, isPlayer: d.isPlayer, dodge: d.dodge,
        pace: d.isPlayer ? 1 : d.pace * (1 + this.rng.range(-Config.FORM, Config.FORM)),
        wobblePeriod: this.rng.range(Config.WOBBLE_PERIOD[0], Config.WOBBLE_PERIOD[1]),
        wobblePhase: this.rng.range(0, Math.PI * 2),
        finale: d.isPlayer ? 0 : this.rng.range(0, Config.FINALE_PUSH),
      })
    })
    // staggered grid, one car per lane; the player always gets a middle lane (the camera shows more that way)
    const lanes = [1, 2, 0, 3]
    const pSlot = cars.findIndex((c) => c.isPlayer)
    if (pSlot >= 0 && (lanes[pSlot] === 0 || lanes[pSlot] === 3)) {
      const swap = lanes[pSlot] === 0 ? 0 : 1 // slot holding lane 1 or lane 2
      const t = lanes[pSlot]!; lanes[pSlot] = lanes[swap]!; lanes[swap] = t
    }
    cars.forEach((c, k) => {
      c.dist = c.prevDist = -(7 + 8 * k)
      c.lane = c.homeLane = lanes[k % lanes.length]!
      c.x = laneCenter(c.lane)
      c.turbo = c.isPlayer ? 100 : this.rng.range(50, 150)
      c.oil = c.isPlayer ? Config.OIL_START_CHARGES : 0
      c.place = k + 1
      this.byId.set(c.id, c)
    })
    this.cars = cars
    this.player = cars.find((c) => c.isPlayer)!
  }

  car(id: string): Car | undefined { return this.byId.get(id) }

  /** Drain the events since the last call. */
  takeEvents(): RaceEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  /** Seconds left in the countdown (0 once racing). */
  get countdown(): number {
    return this.phase === 'countdown' ? Math.max(0, Config.COUNTDOWN_TIME - this.phaseTime) : 0
  }

  /** The player's lap, 1-based, capped at the race's laps. */
  get playerLap(): number { return clamp(this.player.lap + 1, 1, this.laps) }

  step(dt: number, input: RaceInput): void {
    if (input.pedal !== null && Number.isFinite(input.pedal)) this.pedal = clamp(input.pedal, 0, Config.PEDAL_MAX)
    this.phaseTime += dt
    switch (this.phase) {
      case 'intro':
        if (this.phaseTime >= Config.INTRO_TIME) this.setPhase('countdown')
        break
      case 'countdown': {
        const left = Config.COUNTDOWN_TIME - this.phaseTime
        const n = Math.ceil(left)
        if (n !== this.lastCount && n > 0) { this.lastCount = n; this.events.push({ type: 'countdown', n }) }
        for (const b of input.presses) {
          if (b !== 'turbo' || this.rocketArmed) continue
          if (left <= Config.ROCKET_WINDOW[0]) this.rocketArmed = true
          else this.events.push({ type: 'tooEarly' })
        }
        if (left <= 0) this.go()
        break
      }
      case 'racing':
      case 'finished':
        this.time += dt
        if (this.phase === 'racing') for (const b of input.presses) this.press(b)
        this.simulate(dt)
        break
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p
    this.phaseTime = 0
  }

  private go(): void {
    this.setPhase('racing')
    this.events.push({ type: 'go' })
    for (const c of this.cars) {
      c.lapStarts = [0]
      const rocket = c.isPlayer ? this.rocketArmed : this.rng.chance(Config.RIVAL_ROCKET_CHANCE)
      if (rocket) this.rocket(c)
    }
  }

  private rocket(c: Car): void {
    c.boost = Math.max(c.boost, Config.ROCKET_TIME)
    c.stats.rocket = true
    this.events.push({ type: 'rocket', car: c.id })
  }

  private press(b: ButtonId): void {
    const p = this.player
    if (p.finished) return
    if (b === 'turbo') {
      // a late tap still counts as a rocket start
      if (!this.rocketArmed && this.time <= Config.ROCKET_WINDOW[1]) {
        this.rocketArmed = true
        this.rocket(p)
        return
      }
      if (!this.fireTurbo(p)) this.events.push({ type: 'turboNotReady' })
    } else if (b === 'oil') {
      if (p.oil < 1 || this.slicks.length >= 4) { this.events.push({ type: 'noOil' }); return }
      p.oil--
      const slick: Slick = { id: ++this.slickId, s: this.track.wrap(p.dist - Config.OIL_DROP_BACK), x: p.x, owner: p.id, age: 0 }
      this.slicks.push(slick)
      this.events.push({ type: 'oilDrop', id: slick.id })
    }
  }

  private fireTurbo(c: Car): boolean {
    if (c.turbo < 100 || c.spin > 0) return false
    if (c.boost > Config.TURBO_TIME * (Config.TURBO_MAX_STACK - 1)) return false
    c.turbo -= 100
    c.boost += Config.TURBO_TIME
    c.stats.turbos++
    this.events.push({ type: 'turbo', car: c.id })
    return true
  }

  /** The rival an oil slick dropped now would catch: behind the player, in range, on the player's line. */
  oilTarget(): Car | null {
    const p = this.player
    if (this.phase !== 'racing' || p.finished) return null
    let best: Car | null = null, bestGap = Infinity
    for (const c of this.cars) {
      if (c === p || c.spin > 0 || c.finished) continue
      const g = p.dist - c.dist
      if (g < Config.OIL_RANGE[0] || g > Config.OIL_RANGE[1]) continue
      const reach = Config.OIL_HALF_WIDTH + 0.5
      if (Math.abs(c.x - p.x) > reach && Math.abs(laneCenter(c.lane) - p.x) > reach) continue
      if (g < bestGap) { bestGap = g; best = c }
    }
    return best
  }

  /** Metres from the player to a car, + ahead. */
  gapTo(c: Car): number { return c.dist - this.player.dist }

  // --- the simulation ------------------------------------------------------------------------------------------

  private simulate(dt: number): void {
    const L = this.track.length
    for (const s of this.slicks) s.age += dt
    this.slicks = this.slicks.filter((s) => s.age < Config.OIL_LIFETIME)

    for (const c of this.cars) {
      c.think -= dt
      if (c.think <= 0) {
        c.think = Config.LANE_THINK * this.rng.range(0.8, 1.2)
        this.thinkLane(c)
        if (!c.isPlayer) this.thinkItems(c)
      }
      c.laneHold = Math.max(0, c.laneHold - dt)
    }
    for (const c of this.cars) this.moveCar(c, dt)
    this.chargeTurbo(dt)
    this.resolveContacts()
    for (const c of this.cars) {
      this.checkSlicks(c)
      this.laps_(c, L)
    }
    this.updatePlaces()

    // the player's items
    const p = this.player
    if (this.phase === 'racing' && !p.finished) {
      if (p.oil < Config.OIL_CHARGES) {
        p.oilTimer += dt
        if (p.oilTimer >= Config.OIL_RECHARGE) {
          p.oilTimer = 0
          p.oil++
          this.events.push({ type: 'oilCharged' })
        }
      } else p.oilTimer = 0
    }
  }

  private freeSpeed(c: Car): number {
    const pose = this.track.poseAt(c.dist, this.pose)
    let v: number
    if (c.isPlayer) {
      v = speedFor(this.pedal)
    } else {
      const t = this.time + this.clockOffset
      const wobble = 1 + Config.WOBBLE * Math.sin((2 * Math.PI * t) / c.wobblePeriod + c.wobblePhase)
      let band = 1
      if (!this.player.finished && !c.finished) {
        const gap = c.dist - this.player.dist
        const L = this.track.length
        const toGo = this.laps * L - Math.max(c.dist, this.player.dist)
        const fade = clamp(toGo / (Config.BAND_FADE * L), 0, 1)
        const strength = Config.BAND_FINAL + (1 - Config.BAND_FINAL) * fade
        band *= 1 + c.finale * (1 - fade)
        if (gap > Config.BAND_START) {
          band = 1 - strength * Config.BAND_SLOW * clamp((gap - Config.BAND_START) / Config.BAND_RANGE, 0, 1)
            - Config.BAND_FAR_SLOW * clamp((gap - Config.BAND_FAR) / (Config.BAND_RANGE * 2), 0, 1)
        } else if (gap < -Config.BAND_BEHIND) {
          band = 1 + strength * Config.BAND_PUSH * clamp((-gap - Config.BAND_BEHIND) / Config.BAND_RANGE, 0, 1)
            + Config.BAND_FAR_PUSH * clamp((-gap - Config.BAND_FAR) / (Config.BAND_RANGE * 2), 0, 1)
        }
      }
      const cool = c.finished || this.player.finished ? 0.9 : 1
      v = Config.CRUISE_SPEED * c.pace * this.difficulty * wobble * band * cool
    }
    v *= terrainFactor(pose.grade, pose.k)
    if (c.drafting) v *= 1 + Config.DRAFT_BOOST
    if (c.boost > 0) v = Math.max(v, Config.CRUISE_SPEED * 0.6) * (1 + Config.TURBO_BOOST)
    if (c.spin > 0) v = Math.min(v, Config.CRUISE_SPEED * Config.SPIN_SPEED)
    return v
  }

  /** The nearest car ahead whose body overlaps lateral position `x` (or that is heading into `lane`). */
  private leadIn(c: Car, x: number, lane: number, range: number): { car: Car; gap: number } | null {
    let best: Car | null = null, bestGap = Infinity
    for (const o of this.cars) {
      if (o === c) continue
      const g = this.track.gap(c.dist, o.dist)
      if (g <= 0 || g > range) continue
      const overlaps = Math.abs(o.x - x) < Config.CAR_WIDTH + 0.4 || (o.lane === lane && Math.abs(o.x - x) < Config.LANE_WIDTH * 1.2)
      if (overlaps && g < bestGap) { bestGap = g; best = o }
    }
    return best ? { car: best, gap: bestGap } : null
  }

  /** No car in `lane` from `back` metres behind to `ahead` metres ahead of car c. */
  private laneFree(c: Car, lane: number, back: number, ahead: number): boolean {
    if (lane < 0 || lane >= Config.LANES) return false
    const lx = laneCenter(lane)
    for (const o of this.cars) {
      if (o === c) continue
      const g = this.track.gap(c.dist, o.dist)
      if (g < -back || g > ahead) continue
      if (Math.abs(o.x - lx) < Config.CAR_WIDTH + 0.5 || o.lane === lane) return false
    }
    return true
  }

  private changeLane(c: Car, lane: number): void {
    if (lane === c.lane) return
    c.lane = lane
    c.laneHold = 1.4
  }

  private thinkLane(c: Car): void {
    if (c.spin > 0) return
    const look = 12 + c.speed * Config.LOOK_AHEAD
    const back = Config.CAR_LENGTH + 3
    const lx = laneCenter(c.lane)
    const lead = this.leadIn(c, lx, c.lane, look)
    const blocked = lead !== null && (lead.car.speed < c.freeSpeed - 0.4 || lead.gap < Config.CAR_LENGTH + 4)

    // 1. an oil slick ahead on our line (rivals decide once per slick whether they saw it in time)
    if (!c.isPlayer) {
      for (const s of this.slicks) {
        if (s.owner === c.id) continue
        const g = this.track.gap(this.track.wrap(c.dist), s.s)
        if (g <= 0 || g > 75 || Math.abs(s.x - c.x) > Config.OIL_HALF_WIDTH + 1.3) continue
        let dodge = c.seen.get(s.id)
        if (dodge === undefined) {
          dodge = g >= Config.OIL_REACT && this.rng.chance(c.dodge)
          c.seen.set(s.id, dodge)
        }
        if (!dodge) continue
        const away = s.x > c.x ? -1 : 1
        for (const l of [c.lane + away, c.lane - away, c.lane + 2 * away]) {
          if (Math.abs(laneCenter(l) - s.x) > Config.OIL_HALF_WIDTH + 1.2 && this.laneFree(c, l, back, 25)) {
            this.changeLane(c, l)
            this.events.push({ type: 'dodge', car: c.id })
            c.seen.set(s.id, false)
            return
          }
        }
      }
    }

    // 2. blocked: pull out when close enough (after drafting a while) or stuck
    if (blocked && lead) {
      c.blocked += Config.LANE_THINK
      const closing = Math.max(0, c.freeSpeed - lead.car.speed)
      const pullOut = Config.CAR_LENGTH + 6 + closing * 2.2
      if (lead.gap < pullOut || c.blocked > 1.5) {
        let bestLane = -1, bestRoom = -1
        for (const l of [c.lane - 1, c.lane + 1]) {
          if (!this.laneFree(c, l, back, Math.min(look, 30))) continue
          const next = this.leadIn(c, laneCenter(l), l, look)
          const room = next ? next.gap + (next.car.speed - lead.car.speed) * 3 : 999
          // a small preference for the inside of the coming bend, so passes happen on the racing line
          const inside = Math.sign(this.track.curvatureAt(c.dist + 40)) * (l - c.lane) > 0 ? 5 : 0
          if (room + inside > bestRoom) { bestRoom = room + inside; bestLane = l }
        }
        if (bestLane >= 0 && bestRoom > lead.gap + 2) this.changeLane(c, bestLane)
      }
      return
    }
    c.blocked = 0
    if (c.laneHold > 0) return

    // 3. catching a car in another lane: tuck in behind it to draft
    let target: Car | null = null, tg = Infinity
    for (const o of this.cars) {
      if (o === c || o.spin > 0) continue
      const g = this.track.gap(c.dist, o.dist)
      if (g < 14 || g > Config.DRAFT_SEEK) continue
      if (c.freeSpeed < o.speed + 0.3) continue
      if (g < tg) { tg = g; target = o }
    }
    if (target && target.lane !== c.lane) {
      const step = Math.sign(target.lane - c.lane)
      const l = c.lane + step
      if (this.laneFree(c, l, back, tg - 8)) { this.changeLane(c, l); return }
    }
    if (target) return

    // 4. home when the road is clear
    if (c.lane !== c.homeLane) {
      const step = Math.sign(c.homeLane - c.lane)
      const l = c.lane + step
      if (this.laneFree(c, l, back + 4, look)) this.changeLane(c, l)
    }
  }

  private thinkItems(c: Car): void {
    if (c.finished || c.spin > 0 || this.phase !== 'racing') return
    const p = this.player
    const fill = (Config.LANE_THINK * 100) / Config.RIVAL_TURBO_CHARGE_TIME * (c.drafting ? Config.TURBO_DRAFT_FILL : 1)
    c.turbo = Math.min(100 * Config.TURBO_SEGMENTS, c.turbo + fill)
    if (c.turbo < 100 || c.boost > 0.3) return
    const gap = c.dist - p.dist
    const lapsLeft = this.laps * this.track.length - c.dist
    let want: boolean
    if (c.spunBy) { want = true; c.spunBy = null } // revenge after a spin
    else if (gap > 120) want = c.turbo >= 300 && this.rng.chance(0.05) // well ahead: mostly save it
    else if (gap < 0 && gap > -70) want = this.rng.chance(0.3) // chasing the player
    else if (gap >= 0 && gap < 30) want = this.rng.chance(0.15) // holding the player off
    else if (lapsLeft < 700) want = this.rng.chance(0.4) // the run to the flag
    else want = c.turbo >= 300 ? this.rng.chance(0.2) : this.rng.chance(0.03)
    if (want) this.fireTurbo(c)
  }

  private moveCar(c: Car, dt: number): void {
    const track = this.track
    c.prevDist = c.dist
    if (c.boost > 0) c.boost = Math.max(0, c.boost - dt)
    if (c.spin > 0) {
      c.spin = Math.max(0, c.spin - dt)
      const t = 1 - c.spin / Config.SPIN_TIME
      c.spinYaw = Math.PI * 4 * (1 - (1 - t) * (1 - t))
      if (c.spin === 0) c.spinYaw = 0
    }

    // drafting: close behind a car on the same line
    const lead = this.leadIn(c, c.x, c.lane, Config.DRAFT_MAX)
    const wasDrafting = c.drafting
    c.drafting = lead !== null && lead.gap >= Config.DRAFT_MIN && Math.abs(lead.car.x - c.x) < 1.4 && c.spin <= 0
    if (c.isPlayer && c.drafting !== wasDrafting && this.phase === 'racing') this.events.push({ type: 'draft', on: c.drafting })

    let target = this.freeSpeed(c)
    c.freeSpeed = target
    // follow the car ahead instead of driving through it (a boosting car rams instead)
    const front = this.leadIn(c, c.x, -1, 40)
    if (front && Math.abs(front.car.x - c.x) < Config.CAR_WIDTH + 0.1 && c.boost <= 0) {
      const clear = front.gap - Config.CAR_LENGTH
      const want = 1.5 + c.speed * 0.22
      if (clear < want) target = Math.min(target, front.car.speed + (clear - want) * 1.5)
    }
    target = Math.max(0, target)
    if (target > c.speed) c.speed = Math.min(target, c.speed + (c.boost > 0 ? Config.TURBO_ACCEL : Config.ACCEL) * dt)
    else c.speed = Math.max(target, c.speed - (c.spin > 0 ? 22 : target < c.speed - 8 ? Config.BRAKE : Config.DECEL) * dt)
    c.dist += c.speed * dt

    // lateral: a critically damped move toward the lane's centre
    const desired = laneCenter(c.lane)
    const vxTarget = clamp((desired - c.x) * 2.4, -Config.LANE_SPEED, Config.LANE_SPEED)
    const dv = vxTarget - c.vx
    c.vx += clamp(dv, -14 * dt, 14 * dt)
    c.x += c.vx * dt
    const edge = ROAD_HALF - Config.CAR_WIDTH / 2 - 0.3
    if (Math.abs(c.x) > edge) { c.x = Math.sign(c.x) * edge; c.vx = 0 }

    // hops over crests: leave the road when it curves down faster than cartoon gravity
    const s = c.dist
    const y0 = track.poseAt(s - 6, this.pose).y
    const pose = track.poseAt(s, this.pose)
    const y1 = pose.y
    const y2 = track.poseAt(s + 6, this.pose).y
    const kv = (y2 - 2 * y1 + y0) / 36
    const roadVy = pose.grade * c.speed
    if (c.onGround) {
      c.air = 0
      c.airVy = roadVy
      if (c.speed > 20 && c.speed * c.speed * kv < -G_AIR) { c.onGround = false; c.air = 0.001 }
    } else {
      // height above the road: the car's vertical speed against the road's own
      c.airVy -= G_AIR * dt
      c.air += (c.airVy - roadVy) * dt
      if (c.air <= 0) {
        const impact = roadVy - c.airVy
        if (impact > 2) this.events.push({ type: 'land', car: c.id, air: impact })
        c.air = 0
        c.onGround = true
      }
    }
  }

  private resolveContacts(): void {
    const cars = this.cars
    const W = Config.CAR_WIDTH + 0.1, Lc = Config.CAR_LENGTH + 0.2
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i]!, b = cars[j]!
      const g = this.track.gap(a.dist, b.dist) // + means b ahead of a
      const dx = b.x - a.x
      if (Math.abs(g) >= Lc || Math.abs(dx) >= W) continue
      const rear = g >= 0 ? a : b, front = g >= 0 ? b : a
      const along = Math.abs(g)
      if (along > Lc * 0.55) {
        // nose to tail
        const rel = rear.speed - front.speed
        if (rear.boost > 0 && front.boost <= 0) {
          // turbo ram: shove the front car aside
          const side = Math.sign(front.x - rear.x) || (front.lane < 2 ? -1 : 1)
          const nl = clamp(front.lane + side, 0, Config.LANES - 1)
          front.lane = nl === front.lane ? clamp(front.lane - side, 0, Config.LANES - 1) : nl
          front.laneHold = 1.5
          front.vx += side * 5
          front.speed *= 0.93
          if (along < Lc * 0.56) rear.dist -= Lc * 0.56 - along
          if (rel > 1) this.events.push({ type: 'bump', a: rear.id, b: front.id, hard: true })
        } else {
          rear.dist -= Lc - along
          rear.speed = Math.min(rear.speed, front.speed)
          if (rel > 3.5) this.events.push({ type: 'bump', a: rear.id, b: front.id, hard: rel > 8 })
        }
      } else {
        // side by side: push apart
        const push = (W - Math.abs(dx)) / 2
        const sgn = dx >= 0 ? 1 : -1
        a.x -= sgn * push
        b.x += sgn * push
        const rv = b.vx - a.vx
        if (rv * sgn < 0) { a.vx -= sgn * 1.5; b.vx += sgn * 1.5 }
        if (Math.abs(rv) > 1.5) this.events.push({ type: 'bump', a: a.id, b: b.id, hard: false })
      }
    }
  }

  private checkSlicks(c: Car): void {
    if (c.spin > 0) return
    for (const s of this.slicks) {
      if (s.owner === c.id) continue
      const g0 = this.track.gap(this.track.wrap(c.prevDist), s.s)
      const g1 = this.track.gap(this.track.wrap(c.dist), s.s)
      const half = Config.OIL_LENGTH / 2
      const inside = Math.abs(g1) <= half
      const jumped = g0 > half && g1 < -half && g0 - g1 < 60
      if (!inside && !jumped) continue
      if (Math.abs(c.x - s.x) > Config.OIL_HALF_WIDTH + 0.5) continue
      c.spin = Config.SPIN_TIME
      c.spunBy = s.owner
      c.boost = 0
      c.stats.spins++
      const owner = this.byId.get(s.owner)
      if (owner) owner.stats.oilHits++
      this.events.push({ type: 'spin', car: c.id, by: s.owner })
      return
    }
  }

  private laps_(c: Car, L: number): void {
    if (c.dist < 0) return
    const lap = Math.floor(c.dist / L)
    if (lap > c.lap) {
      c.lap = lap
      c.lapStarts.push(this.time)
      if (lap >= this.laps && !c.finished) {
        c.finished = true
        c.finishTime = this.time
        if (c.isPlayer) this.finishRace()
      } else if (c.isPlayer && !c.finished) {
        this.events.push({ type: 'lap', lap: lap + 1, final: lap + 1 === this.laps })
      }
    }
  }

  private finishRace(): void {
    this.updatePlaces()
    const order = this.order()
    this.results = order.map((c, k) => ({
      id: c.id, name: c.name, color: c.color, place: k + 1,
      time: c.finished ? c.finishTime : null,
      points: Config.POINTS[k] ?? 0,
    }))
    this.events.push({ type: 'finish', place: this.player.place })
    this.setPhase('finished')
  }

  /** Cars in race order: finishers by time, then by distance. */
  order(): Car[] {
    if (this.results) return this.results.map((r) => this.byId.get(r.id)!)
    return [...this.cars].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      if (a.finished && b.finished) return a.finishTime - b.finishTime
      return b.dist - a.dist
    })
  }

  private updatePlaces(): void {
    if (this.results) return
    const p = this.player
    const before = p.place
    const order = this.order()
    order.forEach((c, k) => { c.place = k + 1 })
    if (this.phase !== 'racing' || p.place === before) return
    if (p.place < before) {
      // who did we pass? the car now just behind us
      const passed = order[p.place]
      if (passed) { p.stats.overtakes++; this.events.push({ type: 'overtake', car: passed.id, place: p.place }) }
    } else {
      const by = order[p.place - 2]
      if (by) this.events.push({ type: 'overtaken', car: by.id, place: p.place })
    }
  }

  /** The player's fill rate follows the pedal; rivals fill in thinkItems. */
  chargeTurbo(dt: number): void {
    const p = this.player
    if (this.phase !== 'racing' || p.finished) return
    const rate = (100 / Config.TURBO_CHARGE_TIME) * effortOf(this.pedal) * (p.drafting ? Config.TURBO_DRAFT_FILL : 1)
    p.turbo = Math.min(100 * Config.TURBO_SEGMENTS, p.turbo + rate * dt)
  }
}
