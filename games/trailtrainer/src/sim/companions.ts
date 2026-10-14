/**
 * Other people on the same road.
 *
 * Not competitors and not networked: a famous climb has people on it, and an empty one feels wrong in a way
 * that is hard to place until you put a few back. They are traffic, and the point of them is scale and
 * company — something to measure your own pace against without being raced.
 *
 * They are simulated, not animated along a curve. A companion cyclist is given a power and run through the
 * same force balance the player is, so they slow on the steep sections and pick up on the shallow ones, and
 * being passed by one means they are genuinely putting out more than you are for their weight. Someone on foot
 * is given a pace on the flat and slowed by the hill using the usual rule of thumb. Either way the speed on
 * screen is a consequence rather than a decoration.
 *
 * Whoever drifts too far ahead or behind is quietly moved round to the other side, so a handful of bodies is
 * enough to populate an unbounded road.
 */
import { Config, airDensity } from '../config.ts'
import type { Route } from '../route/route.ts'

const G = 9.81

export type CompanionMode = 'bike' | 'run' | 'walk'

export interface CompanionState {
  /** metres along the route */
  s: number
  /** metres per second, always positive; `direction` says which way that is */
  speed: number
  /** +1 with the route, -1 against it */
  direction: number
  /** metres right of the centre line, from the companion's own point of view — moves to make room */
  offset: number
  mode: CompanionMode
  /** crank angle for the legs */
  crank: number
  /** they have just been moved round to the other end of the field */
  recycled: boolean
}

interface Companion extends CompanionState {
  /** where this one would rather ride, when there is nobody in the way */
  preferred: number
  /** which way this one steps when somebody is exactly on top of them; fixed, so two do not mirror each other */
  bias: number
  /** watts, for a cyclist */
  power: number
  /** kilograms of rider and machine */
  mass: number
  /** metres per second on the flat, for someone on foot */
  pace: number
  /**
   * How much room the lane they have chosen actually gives them, in metres.
   *
   * Written by `makeRoom` and read by `update`, because when the answer is "not enough" the fix is not a
   * better lane — there isn't one — it is to stop trying to be there at the same time.
   */
  room: number
}

/** A small deterministic generator, so the same seed puts the same people on the road. */
function rng(seed: number): () => number {
  let x = (seed | 0) || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 100000) / 100000
  }
}

export interface CompanionsOptions {
  count?: number
  seed?: number
  /** how far ahead and behind they are kept */
  spread?: number
  /** the share of them coming the other way; a climb has descenders, a rail trail has both */
  againstShare?: number
  /** what they are doing */
  modes?: CompanionMode[]
}

export class Companions {
  readonly all: Companion[] = []
  /**
   * How much the player should move over, in metres, on top of their own lane.
   *
   * The one body on this road that the simulation cannot steer is the player's, and on a three-metre rail
   * trail that is most of the problem: with the rider fixed a quarter of the way out and somebody coming the
   * other way, a third body has nowhere to be. A real rider does not hold their line through that — they
   * shift a little further over, which is the cheapest half-metre of clearance available to anybody. This is
   * written each update and read by main.ts, which eases the rider toward it.
   */
  playerShouldMove = 0
  private readonly route: Route
  private readonly spread: number

  constructor(route: Route, opts: CompanionsOptions = {}) {
    this.route = route
    this.spread = opts.spread ?? 260
    const count = opts.count ?? 3
    const random = rng(opts.seed ?? 20260920)
    const modes = opts.modes ?? ['bike']
    const against = opts.againstShare ?? 0.35
    for (let i = 0; i < count; i++) {
      const direction = random() < against ? -1 : 1
      const mode = modes[Math.floor(random() * modes.length) % modes.length]
      this.all.push({
        s: 0,
        speed: 0,
        direction,
        // they keep to their own side, a little way off the centre line, with some variation
        offset: Config.laneOffset * (0.65 + random() * 0.6),
        preferred: 0, // filled in below, once offset is known
        bias: random() < 0.5 ? -1 : 1,
        mode,
        crank: random() * Math.PI * 2,
        recycled: false,
        // a spread of abilities either side of an ordinary club rider
        power: 120 + random() * 170,
        mass: 62 + random() * 26 + (mode === 'bike' ? Config.bikeMassKg : 0),
        pace: mode === 'walk' ? 1.2 + random() * 0.4 : 2.6 + random() * 1.1,
        room: 9,
      })
      this.all[i].preferred = this.all[i].offset
    }
  }

  /** Put everyone somewhere plausible around the player, before the first frame. */
  place(playerS: number): void {
    const random = rng(7919)
    for (const c of this.all) {
      let ahead = (random() - 0.35) * this.spread * 2
      /**
       * Nobody starts on top of the rider.
       *
       * The lane-keeping in `makeRoom` takes about a second to move somebody aside, which is fine when they
       * are seen coming and useless when they are already there — and placing a field at random around the
       * rider puts one of them within a metre often enough to be the first thing a rider sees. Twenty metres
       * is a second or two of road at any speed anybody starts at, which is all the room the avoidance needs.
       */
      if (Math.abs(ahead) < 20) ahead = Math.sign(ahead || 1) * 20
      c.s = Math.min(this.route.length, Math.max(0, playerS + ahead))
      c.speed = c.mode === 'bike' ? 3 : c.pace
    }
  }

  /**
   * `playerS` and `playerLane` are where the player is and which side of the centre line they are on, so
   * everyone else can make room. There is no collision detection here and there should not be: riding into
   * somebody is not a thing this game wants to model, and the fix is simply never to be in the same place.
   */
  update(playerS: number, playerLane: number, playerSpeed: number, dt: number): void {
    /**
     * Whether the rider ought to be moving over, worked out before anybody else decides anything.
     *
     * Anyone coming the other way within a few seconds is a reason to take a little more of your own side;
     * anyone alongside going the same way is the same reason. What is asked for is modest — a third of a metre
     * — because the rider is already well over, and because a lane change nobody asked for should be felt
     * rather than noticed.
     */
    let move = 0
    for (const c of this.all) {
      const closing = c.direction < 0 ? c.speed + playerSpeed : Math.abs(playerSpeed - c.speed)
      const near = Math.abs(c.s - playerS) < Math.max(10, closing * 2.4)
      if (near) move = Math.max(move, c.direction < 0 ? Config.laneSwerve : Config.laneSwerve * 0.6)
    }
    this.playerShouldMove = move

    this.makeRoom(playerS, playerLane, playerSpeed, dt)
    for (const c of this.all) {
      c.recycled = false
      const pose = this.route.poseAt(c.s)
      // the hill as this companion meets it: a descender sees the same road tilted the other way
      const grade = pose.grade * c.direction
      if (c.mode === 'bike') this.pedal(c, grade, pose.y, dt)
      else this.stride(c, grade, dt)

      // the corner cap, same as the player's: nobody takes a hairpin at forty
      const kappa = this.route.worstCurvatureAhead(c.s, Config.cornerLookahead)
      if (kappa > 1e-4) {
        const cap = Math.sqrt(Config.corneringAccel / kappa)
        if (c.speed > cap) c.speed -= (c.speed - cap) * Config.brakingRate * dt
      }

      /**
       * When there is no room, sit back — which is what a rider does and what the sim would not.
       *
       * On a three-metre rail trail with the player on one side and somebody coming the other way on the
       * other, a third body simply does not fit: measured over four hours of simulated riding, the best any
       * lane could offer was under half a metre, and the avoidance dutifully took it — which on screen is a
       * stranger riding through the rider's shoulder. No amount of steering fixes a road that is too narrow.
       * Easing off until the gap opens does, and it is what anybody would actually do.
       */
      const wanted = Math.min(1.3, Config.trailWidth * 0.32) * 0.8
      const tight = Math.min(1, Math.max(0, (wanted - c.room) / wanted))
      if (tight > 0 && c.mode === 'bike') c.speed = Math.max(1.2, c.speed * (1 - 0.55 * tight * dt * 4))
      else if (tight > 0) c.speed = Math.max(0.6, c.speed * (1 - 0.45 * tight * dt * 4))

      c.s += c.speed * c.direction * dt
      if (c.mode === 'bike') c.crank += (c.speed / Config.wheelRadius / Config.gearRatio) * dt

      // off the end of the route, or too far from the player to be worth drawing: come round again
      const gap = c.s - playerS
      if (c.s <= 0 || c.s >= this.route.length || Math.abs(gap) > this.spread * 1.6) {
        c.s = Math.min(this.route.length - 5, Math.max(5, playerS - Math.sign(gap || 1) * this.spread * 1.4))
        c.recycled = true
      }
    }
  }

  /**
   * Nudge anyone who is about to occupy the same piece of road as somebody else sideways until they are not.
   *
   * Lanes are compared in the route's own frame — a companion's `offset` is on their own right, so one coming
   * the other way is on the far side of the centre line and never conflicts. Within a couple of bike lengths
   * of another body on the same side, the companion drifts outward; with nobody near, they drift back to
   * where they would rather be. It is slow enough to look like road manners rather than magnetism.
   */
  private makeRoom(playerS: number, playerLane: number, playerSpeed: number, dt: number): void {
    const LONG = 7 // metres along the road within which two bodies going the same way are "together"
    /**
     * Someone coming the other way has to be seen a great deal sooner than someone being overtaken.
     *
     * Two riders closing head-on cover the seven metres above in under half a second, and a lane change here
     * has a time constant of nearly one, so by the time an oncoming body counted as "together" the swerve
     * could not finish and they rode through each other. The window for oncoming traffic is therefore a
     * closing time rather than a distance: how far apart they are now, against how fast the gap is shutting.
     */
    const CLOSING = 3.2 // seconds of warning wanted for oncoming traffic
    const want = Math.min(1.3, Config.trailWidth * 0.32) // metres apart they would like to be
    // the whole surface is available: on a three-metre trail, passing means crossing the middle, as it does
    // in life. Only the last thirty centimetres either side are off limits.
    const edge = Config.trailWidth / 2 - Config.laneMargin
    const CANDIDATES = 17

    for (const c of this.all) {
      // everything here is in the route's frame; a companion's own offset runs the other way when oncoming
      const lane = c.offset * c.direction
      const preferred = c.preferred * c.direction

      const taken: number[] = []
      /**
       * A window in TIME, whichever way the other body is going.
       *
       * It used to be a closing time for oncoming traffic and a flat seven metres for anyone going the same
       * way, and the flat seven metres is what let a rider be ridden through from behind. A cyclist overtaking
       * a walker closes at five or six metres a second, so seven metres is a little over a second of warning
       * against a lane change whose time constant is nearly one — the swerve was still a third of the way done
       * when the two were level. Measuring the window by how fast the gap is actually shutting gives the same
       * three seconds of warning to an overtake as to a head-on pass.
       */
      const playerClosing = c.direction < 0 ? c.speed + playerSpeed : Math.abs(playerSpeed - c.speed)
      const playerWindow = Math.max(LONG, playerClosing * CLOSING)
      const playerNear = Math.abs(playerS - c.s) <= playerWindow
      if (playerNear) taken.push(playerLane)
      /**
       * Oncoming bodies are also the ones this companion must not solve by crossing the centre line, so they
       * are remembered separately: the sweep below is pulled toward this companion's own right whenever one
       * of them is about to arrive. Both parties keep right, which is the rule that makes two strangers pass
       * each other rather than mirror each other into the same gap.
       */
      /**
       * And the player counts as traffic coming the other way, which they did not.
       *
       * `oncoming` is what pulls the lane sweep back to this companion's own side of the road, and it was set
       * only from other companions. So a descender who had to get round somebody was free to solve it by
       * crossing the centre line — into the one lane whose occupant never swerves, because the player is
       * steered by a human and the sim cannot move them. That is precisely how a stranger came the other way
       * and rode straight through the rider. The player is always with the route, so they are oncoming to
       * anyone who is not.
       */
      let oncoming = playerNear && c.direction < 0
      for (const o of this.all) {
        if (o === c) continue
        const head = o.direction !== c.direction
        const closing = head ? c.speed + o.speed : Math.abs(c.speed - o.speed)
        const window = Math.max(LONG, closing * CLOSING)
        if (Math.abs(o.s - c.s) > window) continue
        taken.push(o.offset * o.direction)
        if (head) oncoming = true
      }

      let target = preferred
      let chosen = want
      if (taken.length) {
        // Try lanes right across the surface and take the roomiest, preferring the one nearest where this
        // companion would rather be and nearest where they already are. Sweeping rather than pushing outward
        // is what lets somebody go round the other side: pushed outward alone, a rider pinned against the
        // edge by someone in the middle of a narrow trail has nowhere left to go and rides through them.
        let best = -Infinity
        for (let k = 0; k < CANDIDATES; k++) {
          const candidate = -edge + (2 * edge * k) / (CANDIDATES - 1)
          let room = want
          for (const t of taken) room = Math.min(room, Math.abs(candidate - t))
          // ties broken toward the preferred lane, then toward not swerving
          /**
           * Ties are broken toward the preferred lane, then toward not swerving. With anyone coming the other
           * way, a much heavier term is added for staying on this companion's own side of the centre line:
           * crossing it to squeeze past someone is fine on an empty road and is exactly what must not happen
           * with a descender arriving. `direction` is which way they face, so `candidate * direction > 0` is
           * their own right whichever way they are going.
           */
          const ownSide = candidate * c.direction
          /**
           * With anything coming the other way, the centre line is not negotiable.
           *
           * The penalty used to be forty a metre, against a hundred a metre for room — so a body that was
           * boxed in could still buy its way across the middle of the road, and the measured result was an
           * oncoming rider passing the player at a quarter of a metre, on the player's own side, because two
           * seconds earlier that had been the roomiest lane available. Room is worth having; crossing into
           * oncoming traffic to get it is not, and at two hundred a metre it can no longer be paid for.
           */
          const keepRight = oncoming ? Math.max(0, -ownSide) * 220 + Math.max(0, 0.4 - ownSide) * 30 : 0
          const score = room * 100 - keepRight - Math.abs(candidate - preferred) - Math.abs(candidate - lane) * 0.5 - c.bias * candidate * 1e-3
          if (score > best) { best = score; target = candidate; chosen = room }
        }
      }
      c.room = taken.length ? chosen : want
      /**
       * How fast they move over depends on how soon they have to be there.
       *
       * One time constant for every situation is wrong at both ends: a second is far too quick for a rider
       * drifting back to their preferred line on an empty road, and far too slow for one who has just realised
       * somebody is arriving. Real road manners work the same way — you ease across when there is time and you
       * move smartly when there is not. The urgency here is simply how close the nearest conflict is along the
       * road, so a body ten metres off gets an easy second and one four metres off gets a third of that.
       */
      let soonest = Infinity
      if (playerNear) soonest = Math.min(soonest, Math.abs(playerS - c.s))
      for (const o of this.all) {
        if (o === c) continue
        if (Math.abs(o.offset * o.direction - target) > want) continue
        soonest = Math.min(soonest, Math.abs(o.s - c.s))
      }
      const urgency = Math.max(0.28, Math.min(0.9, soonest / 14))
      const next = lane + (target - lane) * (1 - Math.exp(-dt / urgency))
      let settled = Math.max(-edge, Math.min(edge, next))

      /**
       * And a last resort, for when the drift has run out of road.
       *
       * Everything above is road manners on a timescale of a second, which is right, and it can still be
       * beaten — by a rider who was boxed in until a moment ago, by a companion whose own dodge was solving a
       * different conflict, by a player who swerved. When two bodies are within a bike length of each other
       * along the road and closer than half the room they want across it, manners have failed and one of them
       * is about to be ridden through, which looks far worse than a quick step. So the remaining distance to
       * the lane already chosen is taken at once rather than eased into.
       */
      /**
       * A bike is not a point, and neither is a person.
       *
       * This was 1.6 m, which is about the length of a bicycle — so the step aside only fired once the two
       * were already level. Measured over seventeen minutes of simulated riding, the closest same-direction
       * pass was 45 cm centre to centre: two riders inside each other, for a second or so either side of the
       * moment this rule was watching. What matters is not whether they are level but whether they OVERLAP,
       * which for a bike and a rider is a good four metres of road, and the lane has to be clear before that
       * rather than during it.
       */
      const TOUCHING = 4.2
      for (const t of taken) {
        if (Math.abs(settled - t) >= want * 0.8) continue
        const conflicting = Math.abs(playerS - c.s) < TOUCHING
          || this.all.some((o) => o !== c && Math.abs(o.s - c.s) < TOUCHING && Math.abs(o.offset * o.direction - settled) < want * 0.8)
        if (!conflicting) continue
        settled = Math.max(-edge, Math.min(edge, target))
        // if the chosen lane is itself no further off, step clear of whoever is there — to whichever side of
        // them there is more room, since being pinned against the edge is how this happens in the first place
        if (Math.abs(settled - t) < want * 0.8) {
          const left = Math.max(-edge, t - want)
          const right = Math.min(edge, t + want)
          settled = Math.abs(left - t) >= Math.abs(right - t) ? left : right
        }
        break
      }
      c.offset = settled * c.direction
    }
  }

  /** The same force balance the player gets, at this companion's own power and weight. */
  private pedal(c: Companion, grade: number, elevation: number, dt: number): void {
    const theta = Math.atan(grade)
    const rho = airDensity(elevation)
    const crr = Config.rollingResistance[this.route.surfaceAt(c.s)]
    const propulsion = Math.min(Config.maxPropulsionForce, (c.power * Config.driveEfficiency) / Math.max(c.speed, Config.minPropulsionSpeed))
    const gravity = -c.mass * G * Math.sin(theta)
    const rolling = c.speed > 0.05 ? -crr * c.mass * G * Math.cos(theta) : 0
    const drag = -0.5 * rho * Config.cdA * c.speed * Math.abs(c.speed)
    c.speed = Math.max(0.4, Math.min(Config.maxSpeed, c.speed + ((propulsion + gravity + rolling + drag) / c.mass) * dt))
  }

  /**
   * On foot the hill costs pace rather than power. The rule of thumb runners use is a few percent per percent
   * of grade going up, and a smaller gain coming down that stops helping once the descent gets steep enough to
   * have to brake against.
   */
  private stride(c: Companion, grade: number, dt: number): void {
    const up = Math.max(0, grade)
    const down = Math.max(0, -grade)
    const factor = 1 / (1 + up * 6.5) * (1 + Math.min(down, 0.06) * 3 - Math.max(0, down - 0.09) * 2.5)
    const want = Math.max(0.5, c.pace * factor)
    c.speed += (want - c.speed) * (1 - Math.exp(-dt / 1.5))
  }
}
