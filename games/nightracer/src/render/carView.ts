/** Puts a car model where the simulation says the car is, with the toy-like motion on top: lean, drift, hops, spins. */
import { Color3, Quaternion, Vector3, type Scene } from '@babylonjs/core'
import { Config } from '../config.ts'
import { clamp } from '../rng.ts'
import type { Car } from '../sim/car.ts'
import { newPose, type Track } from '../sim/track.ts'
import { buildCar, STYLES, type CarModel } from './carModel.ts'
import { hex } from './theme.ts'
import type { CarLight } from './world.ts'

const WHEEL_R = 0.43

export class CarView {
  readonly id: string
  readonly model: CarModel
  readonly tint: Color3
  /** World position of the car body centre and its forward direction (for the camera and the lights). */
  readonly pos = new Vector3()
  readonly fwd = new Vector3(0, 0, 1)
  readonly right = new Vector3(1, 0, 0)
  readonly up = new Vector3(0, 1, 0)
  private wheelAngle = 0
  private lean = 0
  private drift = 0
  private pitch = 0
  private lastSpeed = 0
  private squash = 0
  private readonly pose = newPose()
  private readonly q = new Quaternion()

  constructor(scene: Scene, id: string) {
    this.id = id
    const style = STYLES[id] ?? STYLES.player!
    this.model = buildCar(scene, id, style)
    this.tint = hex(style.body)
    this.model.root.rotationQuaternion = new Quaternion()
  }

  /** A landing or a bump: squash the body for a moment. */
  thump(amount: number): void { this.squash = Math.max(this.squash, amount) }

  update(car: Car, track: Track, dt: number, t: number): void {
    const p = track.poseAt(car.dist, this.pose)
    const m = this.model
    const x = car.x
    this.pos.set(p.x + p.rx * x, p.y + p.ry * x, p.z + p.rz * x)
    this.fwd.set(p.tx, p.ty, p.tz)
    this.right.set(p.rx, p.ry, p.rz)
    this.up.set(p.ux, p.uy, p.uz)
    m.root.position.copyFrom(this.pos)
    Quaternion.RotationQuaternionFromAxisToRef(this.right, this.up, this.fwd, this.q)
    m.root.rotationQuaternion!.copyFrom(this.q)

    const k = dt > 0 ? 1 - Math.exp(-dt * 6) : 1
    const v = car.speed
    const turn = p.k * v * v
    // drift: nose into the bend, more when fast; lane changes turn the car a little
    const driftTarget = clamp(turn * 0.0042, -0.34, 0.34) + Math.atan2(car.vx, Math.max(8, v)) * 0.9
    this.drift += (driftTarget - this.drift) * k
    this.lean += (clamp(turn * 0.0022, -0.1, 0.1) - this.lean) * k
    const accel = dt > 0 ? (v - this.lastSpeed) / dt : 0
    this.lastSpeed = v
    this.pitch += (clamp(-accel * 0.006, -0.06, 0.05) - this.pitch) * k
    this.squash = Math.max(0, this.squash - dt * 3)

    const b = m.body
    b.rotation.y = this.drift + car.spinYaw
    b.rotation.z = this.lean
    b.rotation.x = this.pitch + (car.onGround ? 0 : clamp(-car.airVy * 0.01, -0.12, 0.12))
    const idle = v < 1 ? Math.sin(t * 40) * 0.01 : 0
    const rumble = Math.sin(t * 23 + car.dist) * 0.012 * clamp(v / 40, 0, 1)
    b.position.y = car.air + rumble + idle - this.squash * 0.12
    b.scaling.y = 1 - this.squash * 0.18
    b.scaling.x = b.scaling.z = 1 + this.squash * 0.06

    this.wheelAngle += (v / WHEEL_R) * dt
    for (const w of m.wheels) w.rotation.x = this.wheelAngle
    const steer = clamp(p.k * 3.2, -0.45, 0.45) - this.drift * 0.6
    for (const w of m.frontWheels) w.rotation.y = steer

    // turbo flames
    const boosting = car.boost > 0
    for (const f of m.flames) {
      f.isVisible = boosting
      if (boosting) {
        f.scaling.y = 0.7 + Math.random() * 0.7
        f.scaling.x = f.scaling.z = 0.8 + Math.random() * 0.4
      }
    }
    // brake lights
    const braking = accel < -3 || car.spin > 0
    m.taillightMat.emissiveColor.set(braking ? 1 : 0.6, braking ? 0.12 : 0.03, braking ? 0.15 : 0.06)
  }

  light(): CarLight {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, dx: this.fwd.x, dy: this.fwd.y, dz: this.fwd.z, tint: this.tint }
  }

  /** Where tags, sparks and smoke go. */
  point(back: number, up: number, side = 0): Vector3 {
    return new Vector3(
      this.pos.x - this.fwd.x * back + this.up.x * up + this.right.x * side,
      this.pos.y - this.fwd.y * back + this.up.y * up + this.right.y * side,
      this.pos.z - this.fwd.z * back + this.up.z * up + this.right.z * side,
    )
  }

  dispose(): void { this.model.dispose() }
}

export const carHalfLength = Config.CAR_LENGTH / 2
