/**
 * Bridges, where the trail goes over water.
 *
 * Until there was water this could not exist and was not missed; with water it is the first thing the eye
 * looks for, because a path that runs into a river and out the other side is not a path. The Katy crosses
 * creeks and sloughs every few kilometres — it is an old railroad, so it crosses them on trestles — and the
 * Alpe's road goes over torrents on little stone-walled culvert bridges.
 *
 * **Nothing here is in the map.** The crossings are found by asking, along the trail itself, where the water
 * is: a run of route positions with water under them is a crossing, and its two ends are the abutments. That
 * is more robust than reading `bridge=yes` off the map, because it cannot disagree with the water that is
 * actually drawn — a bridge tagged fifteen metres from where the river was rendered would be a bridge over
 * dry land, and this one lands on the water by construction.
 *
 * The deck is not drawn: the trail ribbon is already there, at the right height, with the right surface on it.
 * What is drawn is everything that makes it read as a bridge — the beam under it, the parapet either side, and
 * the piers going down into the water — which is a few hundred triangles per crossing and only for the
 * crossings the rider is near.
 */
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, type Scene, StandardMaterial, Vector3 } from '@babylonjs/core'
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { groundHeight } from './ground.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'
import type { Water } from './water.ts'

interface Crossing { from: number; to: number }

export class Bridges {
  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame
  private readonly water: Water
  private readonly deck: Mesh
  private readonly post: Mesh
  private readonly rail: Mesh
  private readonly pier: Mesh
  private readonly materials: StandardMaterial[] = []
  private readonly parts: Mesh[]
  private scannedAt = Number.NaN
  private crossings: Crossing[] = []

  constructor(scene: Scene, route: Route, frame: Frame, water: Water, atmosphere?: Atmosphere) {
    this.scene = scene
    this.route = route
    this.frame = frame
    this.water = water

    const timber = new StandardMaterial('bridgeTimber', scene)
    // a rail trail's trestles are creosoted timber, which is nearly black in the shade and grey in the sun
    timber.diffuseColor = new Color3(0.26, 0.23, 0.21)
    timber.specularColor = Color3.Black()
    timber.emissiveColor = new Color3(0.04, 0.035, 0.03)
    this.materials.push(timber)
    atmosphere?.attach(timber)

    /**
     * Four pieces, instanced: the beam under the deck, a post, a length of rail, and a pier.
     *
     * Thin instances of four small meshes rather than a mesh per bridge, because a bridge is the same bridge
     * every time — what differs is how many posts it has and how deep its piers go, and both of those are a
     * matrix. A hundred-metre trestle is sixty instances and four draw calls.
     */
    const half = Config.trailWidth / 2
    this.deck = MeshBuilder.CreateBox('bridgeBeam', { width: half * 2 + 0.5, height: 0.42, depth: 1 }, scene)
    this.post = MeshBuilder.CreateBox('bridgePost', { width: 0.12, height: 1.05, depth: 0.12 }, scene)
    this.rail = MeshBuilder.CreateBox('bridgeRail', { width: 0.09, height: 0.11, depth: 1 }, scene)
    this.pier = MeshBuilder.CreateBox('bridgePier', { width: 0.34, height: 1, depth: 0.34 }, scene)
    this.parts = [this.deck, this.post, this.rail, this.pier]
    for (const m of this.parts) {
      m.material = timber
      m.renderingGroupId = Layer.near
      m.isPickable = false
      m.receiveShadows = false
      m.alwaysSelectAsActiveMesh = true
      m.setEnabled(false)
    }
    frame.onShift(() => { this.scannedAt = Number.NaN })
  }

  /**
   * Find the crossings near the rider and build what stands on them.
   *
   * Both together, because the scan is cheap — a few hundred water lookups, most of them answered from the
   * cache in render/water.ts — and doing it on the same clock keeps the two from disagreeing.
   */
  update(s: number): void {
    if (Number.isFinite(this.scannedAt) && Math.abs(s - this.scannedAt) < 120) return
    this.scannedAt = s
    const from = Math.max(0, s - 300)
    const to = Math.min(this.route.length, s + Config.markerReach)

    this.crossings = []
    let open: Crossing | null = null
    for (let at = from; at <= to; at += 4) {
      const pose = this.route.poseAt(at)
      const wet = this.water.isWater(pose.x, pose.z)
        || this.water.isWater(pose.x + pose.hz * 2, pose.z - pose.hx * 2)
        || this.water.isWater(pose.x - pose.hz * 2, pose.z + pose.hx * 2)
      if (wet) {
        if (!open) open = { from: at, to: at }
        else open.to = at
      } else if (open) {
        // a gap of one sample is an island or a lapse in the map, not the end of the bridge
        if (at - open.to > 12) { this.crossings.push(open); open = null }
      }
    }
    if (open) this.crossings.push(open)
    // nothing is built for a puddle: a crossing has to be worth a structure
    this.crossings = this.crossings.filter((c) => c.to - c.from >= 6)

    this.build()
  }

  private build(): void {
    const beams: number[] = []
    const posts: number[] = []
    const rails: number[] = []
    const piers: number[] = []
    const scaling = new Vector3(1, 1, 1)
    const position = new Vector3()
    const rotation = new Quaternion()
    const half = Config.trailWidth / 2

    const push = (into: number[], sx: number, sy: number, sz: number, x: number, y: number, z: number, yaw: number): void => {
      scaling.set(sx, sy, sz)
      position.set(x - this.frame.x, y, z - this.frame.z)
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, rotation)
      const m = Matrix.Compose(scaling, rotation, position)
      for (let i = 0; i < 16; i++) into.push(m.m[i])
    }

    for (const crossing of this.crossings) {
      // the abutments sit a little back on dry land, so the deck lands on the bank rather than in the water
      const from = crossing.from - 5
      const to = crossing.to + 5
      const span = to - from
      const step = 2.2
      const count = Math.max(2, Math.round(span / step))

      for (let k = 0; k <= count; k++) {
        const at = from + (span * k) / count
        const pose = this.route.poseAt(at)
        const yaw = Math.atan2(pose.hx, pose.hz)
        const deckY = pose.y + Config.trailLift
        const length = (span / count) * 1.06

        // the beam under the deck, one per section
        if (k < count) push(beams, 1, 1, length, pose.x, deckY - 0.26, pose.z, yaw)

        // parapet: a post each side, with the rail running between them
        for (const side of [-1, 1]) {
          const px = pose.x + pose.hz * half * side * 0.97
          const pz = pose.z - pose.hx * half * side * 0.97
          push(posts, 1, 1, 1, px, deckY + 0.52, pz, yaw)
          if (k < count) push(rails, 1, 1, length, px, deckY + 0.98, pz, yaw)
        }

        /**
         * And the piers, every fourth section, down to whatever is under them.
         *
         * Down to the BED, not to the water: a pier that stops at the surface is a post standing on a river,
         * and the one thing everybody notices about a trestle is that you can see how far down it goes. The
         * ground under the water is the same ground the terrain is drawn from, so they meet it exactly.
         */
        if (k % 4 === 0 && k < count) {
          for (const side of [-1, 1]) {
            const px = pose.x + pose.hz * half * side * 0.72
            const pz = pose.z - pose.hx * half * side * 0.72
            const bed = groundHeight(this.route, px, pz)
            if (!Number.isFinite(bed)) continue
            const drop = deckY - 0.45 - bed
            if (drop < 0.6) continue
            push(piers, 1, drop, 1, px, bed + drop / 2, pz, yaw)
          }
        }
      }
    }

    const upload = (mesh: Mesh, matrices: number[]): void => {
      if (!matrices.length) { mesh.setEnabled(false); return }
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true)
      mesh.setEnabled(true)
    }
    upload(this.deck, beams)
    upload(this.post, posts)
    upload(this.rail, rails)
    upload(this.pier, piers)
  }

  dispose(): void {
    for (const m of this.parts) m.dispose()
    for (const m of this.materials) m.dispose()
  }
}
