/**
 * Moving along the route. Two machines, two genuinely different models, and the difference is coasting.
 *
 * ON A BIKE the rider's measured power is one force among several, and the others do not stop when the pedals
 * do. Stop pedalling on the flat and the bike rolls on and slowly stops; stop pedalling on a descent and it
 * speeds up. Distance keeps accruing the whole time, because that is what happens on a road. So the bike is
 * integrated properly:
 *
 *     m·dv/dt = P·η/v  −  m·g·sin θ  −  Crr·m·g·cos θ  −  ½·ρ·CdA·v²
 *                ↑            ↑              ↑                ↑
 *            the rider     the hill    what the trail    the air, thinner
 *                                       is made of        the higher you get
 *
 * ON A TREADMILL there is no such thing. The belt speed IS the rider's speed: stop running and you are standing
 * still, on a 12% descent as much as on the flat, and you cover no ground at all. A runner never gets a metre
 * for free, and pretending otherwise would be the one lie that makes a training game worthless. So the
 * treadmill model is a single line — follow the belt — and the only smoothing is for the eye, because the
 * machine reports once a second and the screen draws sixty times.
 *
 * What the game asks the machine for is the route's real grade, in percent. The platform scales it by the
 * rider's difficulty setting and clamps it to what the machine can do. Most treadmills cannot go below zero,
 * so on a descent the request saturates and the HUD says so rather than quietly pretending the hill is flat.
 */
import { Config, airDensity, totalMass } from '../config.ts'
import type { Measured } from '../controls.ts'
import type { Route } from '../route/route.ts'

const G = 9.81

export interface RideState {
  /** metres along the route */
  s: number
  /** metres per second */
  speed: number
  /** metres actually travelled this session (distinct from s, which a resumed session starts partway along) */
  travelled: number
  /** the trail's own grade here, rise over run */
  grade: number
  /** what the machine is being asked for, in percent, smoothed and stepped */
  request: number
  /** watts being put in, or null on a treadmill */
  power: number | null
  /** the cranks are turning / the feet are moving */
  working: boolean
  /** the bike is rolling with no power going in — impossible on a treadmill */
  coasting: boolean
  /** the corner cap is holding the speed down */
  braking: boolean
  /** crank angle, radians, for the avatar's legs */
  crank: number
  /** the route has run out */
  finished: boolean
}

export class Ride {
  private s: number
  private v = 0
  private travelled = 0
  private crank = 0
  private smoothedGrade = 0
  private braking = false

  private readonly route: Route

  constructor(route: Route, startS = 0) {
    this.route = route
    this.s = Math.min(route.length, Math.max(0, startS))
  }

  get position(): number { return this.s }
  get velocity(): number { return this.v }

  /**
   * One step. `active` is false before the ride starts, while the session is paused and after it finishes;
   * everything stands still then, including a bike that would otherwise be rolling — a paused session is not
   * a rider freewheeling, it is a rider who has stopped.
   */
  update(m: Measured, dt: number, active = true): RideState {
    const pose = this.route.poseAt(this.s)
    const surface = this.route.surfaceAt(this.s)
    let power: number | null = null
    let working = false
    let coasting = false

    if (!active) {
      this.v = 0
    } else if (Config.deviceType === 'bike') {
      // no reading yet is not zero watts; it is "keep doing what you were doing", and the first reading takes over
      power = m.power ?? 0
      const theta = Math.atan(pose.grade)
      const mass = totalMass()
      const rho = airDensity(pose.y)
      const crr = Config.rollingResistance[surface]
      // below a walking pace the P/v term runs away, so power is applied as if the bike were already moving,
      // and the force it makes is capped at what a rider could actually put through the pedals
      const propulsion = Math.min(Config.maxPropulsionForce, (power * Config.driveEfficiency) / Math.max(this.v, Config.minPropulsionSpeed))
      const gravity = -mass * G * Math.sin(theta)
      const rolling = this.v > 0.05 ? -crr * mass * G * Math.cos(theta) : 0
      const drag = -0.5 * rho * Config.cdA * this.v * Math.abs(this.v)
      this.v += ((propulsion + gravity + rolling + drag) / mass) * dt
      // a rider does not roll backwards up a hill: they stop and put a foot down
      if (this.v < 0) this.v = 0
      // and a rider does not sit at a standstill on the flat with the pedals still
      if (power < 1 && this.v < 0.3 && pose.grade >= -0.005) this.v = 0
      working = power > Config.pedallingWatts
      coasting = !working && this.v > 0.5
      this.applyCornerCap(dt)
    } else {
      // the belt is the ground. There is no coasting here and no free descent.
      const belt = m.speed ?? 0
      this.v += (belt - this.v) * (1 - Math.exp(-dt / Config.beltTau))
      if (belt <= 0 && this.v < 0.05) this.v = 0
      working = this.v > 0.2
      this.braking = false
    }

    this.v = Math.min(this.v, Config.maxSpeed)
    const ds = this.v * dt
    this.s += ds
    this.travelled += ds
    let finished = false
    if (this.s >= this.route.length) {
      this.s = this.route.length
      this.v = 0
      finished = true
    }

    // the cranks turn with the wheels, so they stop when a coasting rider stops pedalling
    if (Config.deviceType === 'bike' && working) this.crank += ((this.v / Config.wheelRadius) / Config.gearRatio) * dt
    else if (Config.deviceType === 'bike' && m.cadence) this.crank += (m.cadence / 60) * 2 * Math.PI * dt

    // the request to the machine: the real grade, smoothed so a 1 Hz message does not chatter, and stepped
    const target = pose.grade * 100
    this.smoothedGrade += (target - this.smoothedGrade) * (1 - Math.exp(-dt / Config.gradeTau))
    const request = Math.round(this.smoothedGrade / Config.gradeStep) * Config.gradeStep

    return {
      s: this.s,
      speed: this.v,
      travelled: this.travelled,
      grade: pose.grade,
      request,
      power,
      working,
      coasting,
      braking: this.braking,
      crank: this.crank,
      finished,
    }
  }

  /**
   * Nobody descends a hairpin flat out. A bend can be taken at the speed where the lateral acceleration is
   * bearable — v = sqrt(a/κ) — so the rider looks a little way ahead, finds the sharpest thing coming, and
   * brakes into it. Without this a coasting bike reaches 60 km/h on Alpe d'Huez's twenty-one bends, which is
   * the one place it demonstrably never happens.
   */
  private applyCornerCap(dt: number): void {
    const kappa = this.route.worstCurvatureAhead(this.s, Config.cornerLookahead)
    if (kappa < 1e-4) { this.braking = false; return }
    const cap = Math.sqrt(Config.corneringAccel / kappa)
    if (this.v > cap) {
      this.v -= (this.v - cap) * Config.brakingRate * dt
      this.braking = true
    } else this.braking = false
  }

  /** Put the rider somewhere else on the route (resuming, or a debug jump). */
  seek(s: number): void {
    this.s = Math.min(this.route.length, Math.max(0, s))
    this.v = 0
  }
}
