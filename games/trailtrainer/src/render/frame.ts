/**
 * The floating origin.
 *
 * The Katy Trail is 386 km long, so a rider three hundred kilometres in has a world x of 300,000. A 32-bit
 * float has about 3 cm of resolution up there, and that is what Babylon's matrices and vertex buffers are made
 * of: the ground would visibly crawl and the rider would jitter on it. Alpe d'Huez, 14 km end to end, would
 * never show the problem, which is exactly why it has to be built in from the start rather than discovered at
 * km 300.
 *
 * So the scene is drawn about a moving origin. Everything in the world has true coordinates, which are the
 * ones the route and the ride model use; everything in the scene is placed at (true − origin), which stays
 * within a few hundred metres of zero. When the rider wanders a kilometre from the origin it moves, and
 * everything already placed is told to shift by the same amount.
 */
import type { Vector3 } from '@babylonjs/core'

export type ShiftListener = (dx: number, dz: number) => void

export class Frame {
  /** the world point currently drawn at the scene's zero */
  x = 0
  z = 0
  private readonly listeners: ShiftListener[] = []

  private readonly reach: number

  constructor(reach = 1000) { this.reach = reach }

  /** Called when the origin moves, with how far the world has slid under the scene. */
  onShift(fn: ShiftListener): void { this.listeners.push(fn) }

  /**
   * Put the origin near a world point. Moves in whole `reach` steps so the shift is a round number and every
   * listener gets the same one. Returns true when it moved.
   */
  follow(worldX: number, worldZ: number): boolean {
    if (Math.abs(worldX - this.x) < this.reach && Math.abs(worldZ - this.z) < this.reach) return false
    const nx = Math.round(worldX / this.reach) * this.reach
    const nz = Math.round(worldZ / this.reach) * this.reach
    const dx = nx - this.x
    const dz = nz - this.z
    this.x = nx
    this.z = nz
    for (const fn of this.listeners) fn(dx, dz)
    return true
  }

  /** World metres to scene metres. */
  localX(worldX: number): number { return worldX - this.x }
  localZ(worldZ: number): number { return worldZ - this.z }

  /** Place a Babylon vector at a world point. */
  place(v: Vector3, worldX: number, y: number, worldZ: number): void {
    v.set(worldX - this.x, y, worldZ - this.z)
  }
}
