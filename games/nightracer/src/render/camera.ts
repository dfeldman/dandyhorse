/**
 * The camera: third person, a little above and to the side of the player's car (toward the middle of the road, so
 * the other lanes are in view), swinging to the outside of the coming bend so you can see into it. It sweeps
 * around the grid before a race, pulls back when a rival is on your tail, and circles the car after the flag.
 */
import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core'
import { Config, ROAD_HALF } from '../config.ts'
import { clamp, smoothstep } from '../rng.ts'
import type { Race } from '../sim/race.ts'
import { newPose } from '../sim/track.ts'
import type { CarView } from './carView.ts'

export class ChaseCamera {
  readonly camera: UniversalCamera
  /** Camera and look-at point as offsets from the car, smoothed in the car's frame so speed adds no lag. */
  private readonly pos = new Vector3()
  private readonly look = new Vector3()
  private side = 1.5
  private dist = 11
  private height = 4.4
  private fov = 0.95
  private shake = 0
  private orbit = 0
  private readonly pose = newPose()
  private snapped = false

  constructor(scene: Scene) {
    this.camera = new UniversalCamera('cam', new Vector3(0, 10, -20), scene)
    this.camera.minZ = 0.3
    this.camera.maxZ = 6000
    this.camera.fov = this.fov
    this.camera.inputs.clear()
  }

  kick(amount: number): void { this.shake = Math.max(this.shake, amount) }

  /** Jump straight to the target next frame (a new race). */
  snap(): void { this.snapped = false }

  update(dt: number, race: Race, player: CarView, t: number, showingResults: boolean): void {
    const track = race.track
    const car = race.player
    const P = player.pos
    const p = track.poseAt(car.dist, this.pose)
    const hl = Math.hypot(p.tx, p.tz) || 1
    const fx = p.tx / hl, fz = p.tz / hl
    const rx = fz, rz = -fx

    // chase target
    let kAhead = 0
    for (let d = 25; d <= 85; d += 15) kAhead += track.curvatureAt(car.dist + d)
    kAhead /= 5
    const threat = race.oilTarget() !== null
    const boosting = car.boost > 0
    const speedK = clamp((car.speed - 25) / 30, 0, 1)
    const sideT = clamp(-car.x * 0.75, -3.2, 3.2) + clamp(-kAhead * 260, -2.6, 2.6)
    const distT = 10.5 + speedK * 1.5 + (boosting ? 2.5 : 0) + (threat ? 3 : 0)
    const heightT = 4.2 + (threat ? 1.6 : 0) + speedK * 0.4
    const k = 1 - Math.exp(-dt * 2.2)
    this.side += (sideT - this.side) * k
    this.dist += (distT - this.dist) * k
    this.height += (heightT - this.height) * k

    const chase = new Vector3(P.x - fx * this.dist + rx * this.side, P.y + this.height, P.z - fz * this.dist + rz * this.side)
    const chaseLook = new Vector3(P.x + fx * 14 + rx * this.side * 0.25, P.y + 1.3, P.z + fz * 14 + rz * this.side * 0.25)
    const fovT = 0.92 + speedK * 0.12 + (boosting ? 0.14 : 0)

    let target = chase, lookT = chaseLook
    if (race.phase === 'intro') {
      // sweep round the grid, then settle in behind
      const u = clamp(race.phaseTime / Config.INTRO_TIME, 0, 1)
      const g = track.poseAt(-18, newPose())
      const ang = Math.PI * (0.15 + 1.0 * u)
      const R = 30 - 12 * u
      const ox = Math.sin(ang) * R, oz = Math.cos(ang) * R
      const orbitPos = new Vector3(g.x + rx * ox + fx * oz, g.y + 11 - 5 * u, g.z + rz * ox + fz * oz)
      const orbitLook = new Vector3(g.x, g.y + 1, g.z)
      const blend = smoothstep(0.7, 1, u)
      target = Vector3.Lerp(orbitPos, chase, blend)
      lookT = Vector3.Lerp(orbitLook, chaseLook, blend)
    } else if (race.phase === 'finished' && showingResults) {
      // a slow swing from front three-quarters to the side, staying on the road
      this.orbit += dt * 0.3
      const room = ROAD_HALF - 1.2
      const want = car.x > 0 ? -7 : 7
      const lat = Math.max(-room - car.x, Math.min(room - car.x, want))
      const ahead = 8 + Math.sin(this.orbit) * 4
      target = new Vector3(P.x + rx * lat + fx * ahead, P.y + 2.8, P.z + rz * lat + fz * ahead)
      lookT = new Vector3(P.x + fx * 0.5, P.y + 0.8, P.z + fz * 0.5)
    }

    // don't dip under the road or the ground
    const n = track.nearest(target.x, target.z)
    if (n) target.y = Math.max(target.y, n.y + 1.8)

    const offT = target.subtract(P)
    const lookOffT = lookT.subtract(P)
    if (!this.snapped) {
      this.pos.copyFrom(offT)
      this.look.copyFrom(lookOffT)
      this.snapped = true
    } else {
      const kp = 1 - Math.exp(-dt * 4)
      const kl = 1 - Math.exp(-dt * 8)
      Vector3.LerpToRef(this.pos, offT, kp, this.pos)
      Vector3.LerpToRef(this.look, lookOffT, kl, this.look)
    }
    const camPos = P.add(this.pos)
    const camLook = P.add(this.look)
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 3))
    this.shake = Math.max(0, this.shake - dt * 2.5)
    const sh = this.shake * this.shake
    const jx = (Math.sin(t * 61) + Math.sin(t * 37)) * 0.18 * sh
    const jy = (Math.sin(t * 53) + Math.cos(t * 29)) * 0.14 * sh
    this.camera.position.set(camPos.x + jx, camPos.y + jy, camPos.z)
    this.camera.fov = this.fov
    this.camera.setTarget(camLook)
  }
}
