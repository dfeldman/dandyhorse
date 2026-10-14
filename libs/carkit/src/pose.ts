/**
 * Where a vehicle sits on the ground, and how its front wheels point. Plain numbers, no Babylon.
 *
 * **Hills.** A vehicle drawn level on a slope buries its nose going uphill and floats its tail; on San
 * Francisco's 20% grades the error is half a metre over a bus. `groundPose` samples the ground under all
 * four tyres, takes pitch from the front-versus-rear heights over the wheelbase and roll from left-versus-right
 * over the track, and puts the body's origin (the road, midway between the axles) at their mean. Whatever
 * twist is left — one wheel in a dip the other three straddle — goes to that wheel's suspension, within its
 * travel, so all four still touch.
 *
 * Angles are in Babylon's `RotationYawPitchRoll` convention, so they can be passed straight to it:
 * yaw turns +z towards +x (heading 0 is +z), positive pitch puts the nose DOWN, positive roll lifts the right
 * side. A vehicle climbing a hill therefore has a negative pitch.
 *
 * **Steering.** One angle, positive to the right, as a bicycle model would have it; `ackermann` splits it so
 * the inside wheel turns more than the outside one, which is what makes the two wheels' axles meet at the
 * centre of the turn rather than skid.
 */
import type { CarLayout } from './geometry/body.ts'

export interface Pose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
}

export interface GroundPose extends Pose {
  /** per wheel (layout order): how far it hangs below its rest position, metres (negative = pushed up) */
  drops: number[]
}

export type HeightFn = (x: number, z: number) => number

/** World x, z of a point given in the vehicle frame (lx right, lz forward), turned by `yaw`. */
export function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return [x + lx * c + lz * s, z - lx * s + lz * c]
}

export function groundPose(layout: CarLayout, x: number, z: number, yaw: number, height: HeightFn,
                           travel = 0.08): GroundPose {
  const hs = layout.wheels.map((w) => {
    const [wx, wz] = toWorld(x, z, yaw, w.x, w.z)
    return height(wx, wz)
  })
  let front = 0, rear = 0, left = 0, right = 0, nf = 0, nr = 0, nl = 0, nrt = 0
  layout.wheels.forEach((w, i) => {
    if (w.z > 0) { front += hs[i]; nf++ } else { rear += hs[i]; nr++ }
    if (w.side < 0) { left += hs[i]; nl++ } else { right += hs[i]; nrt++ }
  })
  front /= nf; rear /= nr; left /= nl; right /= nrt
  const y = (front + rear) / 2
  const pitch = -Math.atan2(front - rear, layout.wheelbase)
  const roll = Math.atan2(right - left, layout.track)
  const pose = { x, y, z, yaw, pitch, roll }
  return { ...pose, drops: wheelDrops(layout, pose, height, travel) }
}

/**
 * How far each wheel must hang below its rest position for its tyre to touch the ground, given the body's
 * pose — clamped to the suspension's travel. Separate from `groundPose` so a smoothed (lagging) body still
 * gets wheels on the road rather than wheels placed for a slope the body hasn't reached yet.
 */
export function wheelDrops(layout: CarLayout, p: Pose, height: HeightFn, travel = 0.08): number[] {
  const sp = Math.sin(p.pitch), cp = Math.cos(p.pitch), sr = Math.sin(p.roll)
  return layout.wheels.map((w) => {
    // the rest contact point (w.x, 0, w.z) through roll, then pitch (yaw doesn't change height)
    const cy = p.y + w.x * sr * cp - w.z * sp
    const [wx, wz] = toWorld(p.x, p.z, p.yaw, w.x, w.z * cp)
    return Math.max(-travel, Math.min(travel, cy - height(wx, wz)))
  })
}

/**
 * The pose on a surface whose grade is known rather than sampled: a bridge deck or a ramp the game models as
 * a line. `grade` is rise over run along the heading (0.2 = 20% uphill), `bank` the same across it (positive
 * = right side higher). `y` is the surface height at the vehicle's origin.
 */
export function slopePose(x: number, y: number, z: number, yaw: number, grade: number, bank = 0): Pose {
  return { x, y, z, yaw, pitch: -Math.atan(grade), roll: Math.atan(bank) }
}

/**
 * Smooths a pose over time, so a vehicle settles over a crest instead of snapping to each new slope.
 * `tau` is the time constant in seconds; at 0.12 s a car at 15 m/s lags its slope by under two metres.
 */
export class PoseSmoother {
  private last?: Pose
  private readonly tau: number
  constructor(tau = 0.12) { this.tau = tau }

  update<T extends Pose>(target: T, dt: number): T {
    const prev = this.last
    if (!prev || dt <= 0) { this.last = { ...target }; return target }
    const k = 1 - Math.exp(-dt / this.tau)
    const out = { ...target, y: prev.y + (target.y - prev.y) * k,
      pitch: prev.pitch + (target.pitch - prev.pitch) * k, roll: prev.roll + (target.roll - prev.roll) * k }
    this.last = { ...out }
    return out
  }

  reset(): void { this.last = undefined }
}

/** The left and right front wheel angles for a bicycle-model steer angle (positive = right). */
export function ackermann(layout: CarLayout, steer: number): [left: number, right: number] {
  const a = Math.max(-layout.maxSteer, Math.min(layout.maxSteer, steer))
  if (Math.abs(a) < 1e-5) return [a, a]
  const turn = layout.wheelbase / Math.tan(Math.abs(a))   // radius of the turn at the rear axle's centre
  const inner = Math.atan(layout.wheelbase / (turn - layout.track / 2))
  const outer = Math.atan(layout.wheelbase / (turn + layout.track / 2))
  return a > 0 ? [outer, inner] : [-inner, -outer]
}

/** The steer angle that follows a path of the given curvature (1/radius, positive turning right). */
export function steerForCurvature(layout: CarLayout, curvature: number): number {
  return Math.atan(layout.wheelbase * curvature)
}
