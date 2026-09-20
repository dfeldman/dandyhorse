/**
 * The diorama camera: a fixed view from the land, looking out to sea over the harbour, with the lighthouse on the
 * left. It sways gently, leans toward the ship on watch, pulls back on narrow screens, and shakes for the horn.
 */
import { FreeCamera, Vector3, type Scene } from '@babylonjs/core'
import { clamp } from '../rng.ts'

export class ViewCamera {
  readonly camera: FreeCamera
  /** Where the camera sits and looks, before sway and leaning (tweakable from the console via __game.cam). */
  readonly basePos = new Vector3(-35, 95, -170)
  readonly baseTarget = new Vector3(0, 0, 265)
  baseFov = 0.8
  private readonly focus = this.baseTarget.clone()
  private shake = 0
  private readonly target = this.baseTarget.clone()

  constructor(scene: Scene) {
    this.camera = new FreeCamera('cam', this.basePos.clone(), scene)
    this.camera.minZ = 1
    this.camera.maxZ = 12000
    this.camera.fov = this.baseFov
    this.camera.setTarget(this.baseTarget)
  }

  kick(amount: number): void { this.shake = Math.max(this.shake, amount) }

  /**
   * @param interest a point worth leaning toward (the ship on watch), or null
   * @param aspect   the canvas's width / height
   */
  update(dt: number, time: number, interest: Vector3 | null, aspect: number, storm: number, snap = false): void {
    const want = interest ? new Vector3(interest.x * 0.25 + this.baseTarget.x * 0.75, 0, this.baseTarget.z + (interest.z - 340) * 0.1) : this.baseTarget
    const k = snap ? 1 : 1 - Math.exp(-dt / 3)
    this.focus.x += (clamp(want.x, -90, 60) - this.focus.x) * k
    this.focus.z += (clamp(want.z, 230, 300) - this.focus.z) * k
    this.shake = Math.max(0, this.shake - dt * 1.5)
    // narrow screens: step back and widen
    const narrow = clamp(1.6 / aspect, 1, 2.4)
    const back = (narrow - 1) * 160
    const sway = 1 + storm * 1.5
    const s = this.shake * this.shake * 1.2
    const pos = this.camera.position
    pos.set(
      this.basePos.x + Math.sin(time * 0.07) * 6 * sway + Math.sin(time * 37) * s,
      this.basePos.y + back * 0.35 + Math.sin(time * 0.11) * 2 * sway + Math.sin(time * 41) * s,
      this.basePos.z - back + Math.sin(time * 0.05) * 4,
    )
    this.target.set(this.focus.x, 0 + Math.sin(time * 0.09) * 1.5 * sway, this.focus.z)
    this.camera.setTarget(this.target)
    this.camera.fov = this.baseFov * Math.min(1.35, Math.pow(narrow, 0.35))
  }
}
