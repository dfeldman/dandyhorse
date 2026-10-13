/**
 * The ground, streamed, at two levels of detail.
 *
 * A route is not a map. The Katy Trail's elevation model covers 386 km of corridor and nothing could hold it
 * all as geometry, so the world is built as a ring of chunks around wherever the rider is and taken apart
 * behind them. A rider who starts at km 300 builds the same ring there as one who rode to it, which is what
 * makes picking a route up in the middle work at all.
 *
 * Two rings, because a mountain is mostly far away. The near ring has a vertex every few metres and reaches a
 * few hundred; the far ring is coarse and reaches to the edge of what was baked, which on Alpe d'Huez is the
 * far side of the Romanche valley. The far ring is drawn a little low, so where the two overlap the near one
 * simply wins — cheaper and steadier than trying to stitch two resolutions together.
 *
 * Two elevation sources meet here, and they disagree. The trail's own profile is metres-scale — lidar in
 * France, the 10 m national model in Missouri — and the surrounding hillsides come from a 30 m model that
 * cannot see a road cut into a slope. So the ground is pulled onto the trail's profile within a narrow
 * corridor and released back to the model over the next fifty metres. Narrow on purpose: at Alpe d'Huez the
 * two legs of a hairpin are thirty metres apart, and a wide blend would have each one dragging the other's
 * height across the hillside.
 */
import { Color3, Mesh, type Scene, StandardMaterial, VertexData } from '@babylonjs/core'
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { type Detail, groundHeight, RELEASE } from './ground.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'
import { NearHolePlugin } from './materials/nearHole.ts'
import { SplatPlugin, type SplatTextures } from './materials/splat.ts'
import { type BiomePalette, BIOMES, groundColour } from './palette.ts'

interface Chunk {
  wx: number
  wz: number
  mesh: Mesh
}

export interface TerrainOptions {
  /** metres square per chunk */
  chunkSize: number
  /** metres between vertices */
  step: number
  /** metres of ground drawn around the rider */
  radius: number
  /** chunks this close to the rider are left to a finer ring */
  skipInside?: number
  /** dropped this far, so a finer ring drawn over the same ground always wins */
  drop?: number
  /** how exactly the ground follows the trail's own profile — see render/ground.ts */
  detail?: Detail
  /** rebuilt only once the rider has moved this far — the far ring does not need to keep up */
  lazyBy?: number
  /** chunks built per frame */
  perFrame?: number
  /** which depth layer this ring is drawn in — see render/layers.ts */
  layer?: number
  /**
   * Draw nothing within this many metres of `setHole` — for the coarse ring, whose triangles disagree with
   * the detailed one by more than any sensible drop can hide. See render/materials/nearHole.ts.
   */
  holeRadius?: number
  /** the air this ground is seen through — see render/materials/aerial.ts */
  atmosphere?: Atmosphere
  /** the four surfaces the ground is painted from — see render/materials/splat.ts */
  splat?: SplatTextures
  /** metres per tile of those surfaces, close up and at the larger scale over it */
  tile?: number
  macroTile?: number
}

/**
 * Deterministic value noise in world metres, for the ground's colour. The same lattice hash the terrain's own
 * relief uses (render/ground.ts), kept separate only because that one works in height and this one in colour.
 */
function hash2(ix: number, iz: number): number {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function patch(x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(x0, z0)
  const b = hash2(x0 + 1, z0)
  const c = hash2(x0, z0 + 1)
  const d = hash2(x0 + 1, z0 + 1)
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz - 0.5
}

const key = (cx: number, cz: number): number => (cx + 1048576) * 2097152 + (cz + 1048576)

export class Terrain {
  private readonly chunks = new Map<number, Chunk>()
  private readonly pending: Array<{ cx: number; cz: number }> = []
  readonly material: StandardMaterial
  private readonly hole: NearHolePlugin | null
  private readonly splat: SplatPlugin | null
  private readonly colour = new Color3()
  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame
  private readonly opts: Required<Omit<TerrainOptions, 'atmosphere' | 'splat' | 'tile' | 'macroTile'>>
  private lastX = Number.NaN
  private lastZ = Number.NaN

  constructor(scene: Scene, route: Route, frame: Frame, opts: TerrainOptions) {
    this.scene = scene
    this.route = route
    this.frame = frame
    this.opts = { skipInside: 0, drop: 0, detail: 'near', lazyBy: 0, perFrame: Config.chunksPerFrame, layer: Layer.near, holeRadius: 0, ...opts }
    // the colour is in the vertices, which Babylon picks up on its own once a mesh has a colour buffer
    this.material = new StandardMaterial(`ground${opts.step}`, scene)
    this.material.diffuseColor = Color3.White()
    this.material.specularColor = Color3.Black()
    this.hole = this.opts.holeRadius > 0 ? new NearHolePlugin(this.material) : null
    if (this.hole) this.hole.radius = this.opts.holeRadius
    this.splat = opts.splat
      ? new SplatPlugin(this.material, opts.splat, opts.tile ?? Config.splatTile, opts.macroTile ?? Config.splatMacroTile)
      : null
    opts.atmosphere?.attach(this.material)
    // The textures are projected from TRUE world position, so the shader has to be told where the scene's
    // zero currently is — here rather than in `update`, because the coarse ring skips most of its updates and
    // would otherwise keep a stale origin and slide its ground a kilometre sideways under itself.
    this.splat?.origin.set(frame.x, frame.z)
    frame.onShift((dx, dz) => {
      for (const c of this.chunks.values()) {
        c.mesh.position.x -= dx
        c.mesh.position.z -= dz
      }
      this.splat?.origin.set(frame.x, frame.z)
    })
  }

  get meshes(): Mesh[] { return [...this.chunks.values()].map((c) => c.mesh) }

  /**
   * Where the hole in this ring goes, in SCENE metres — the rider's drawn position, not their world one. Only
   * the ring built with a `holeRadius` has one; on the others this does nothing.
   */
  setHole(sceneX: number, sceneZ: number): void {
    this.hole?.centre.set(sceneX, 0, sceneZ)
  }

  /**
   * Where the snow lies here. It is the biome's number rather than a constant, and it has to reach the
   * material rather than only the vertex colours, because the snow is chosen per pixel now.
   */
  setBiome(palette: BiomePalette): void {
    if (!this.splat) return
    this.splat.snowFrom = palette.snowAbove
    this.splat.snowTo = palette.snowAbove + 200
  }

  /**
   * Keep the ring around a world point up to date. Chunks outside the view are disposed at once (cheap) and
   * missing ones are queued and built a few per frame, so streaming never costs a dropped frame.
   */
  update(worldX: number, worldZ: number): void {
    const { chunkSize: size, radius, lazyBy } = this.opts
    if (lazyBy > 0 && !this.pending.length && Number.isFinite(this.lastX) && Math.hypot(worldX - this.lastX, worldZ - this.lastZ) < lazyBy) return
    this.lastX = worldX
    this.lastZ = worldZ

    const reach = Math.ceil(radius / size)
    const cx0 = Math.floor(worldX / size)
    const cz0 = Math.floor(worldZ / size)

    for (const [k, c] of this.chunks) {
      if (Math.abs(Math.floor(c.wx / size) - cx0) > reach + 1 || Math.abs(Math.floor(c.wz / size) - cz0) > reach + 1) {
        c.mesh.dispose()
        this.chunks.delete(k)
      }
    }

    this.pending.length = 0
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = cx0 + dx
        const cz = cz0 + dz
        if (this.chunks.has(key(cx, cz))) continue
        // a chunk the finer ring covers entirely is not worth building twice
        if (this.opts.skipInside > 0) {
          const farX = Math.max(Math.abs(cx * size - worldX), Math.abs((cx + 1) * size - worldX))
          const farZ = Math.max(Math.abs(cz * size - worldZ), Math.abs((cz + 1) * size - worldZ))
          if (Math.hypot(farX, farZ) < this.opts.skipInside) continue
        }
        this.pending.push({ cx, cz })
      }
    }
    // nearest first, so the ground under the rider is never the last thing to appear
    this.pending.sort((a, b) => (a.cx - cx0) ** 2 + (a.cz - cz0) ** 2 - ((b.cx - cx0) ** 2 + (b.cz - cz0) ** 2))
    for (let i = 0; i < Math.min(this.opts.perFrame, this.pending.length); i++) this.build(this.pending[i].cx, this.pending[i].cz)
  }

  /** True once every chunk this ring wants has been built — what the screenshot harness waits on. */
  get settled(): boolean {
    return this.pending.every((c) => this.chunks.has(key(c.cx, c.cz)))
  }

  /**
   * Build the chunks within `metres` right now, so the ride never starts over a hole. The rest of the ring
   * streams in over the next second; waiting for all of it would be a visible stall before the first frame.
   */
  fill(metres: number): void {
    const want = Math.ceil(metres / this.opts.chunkSize)
    const centre = this.pending[0]
    if (!centre) return
    for (const c of this.pending.slice()) {
      if (Math.abs(c.cx - centre.cx) > want || Math.abs(c.cz - centre.cz) > want) continue
      if (!this.chunks.has(key(c.cx, c.cz))) this.build(c.cx, c.cz)
    }
  }

  private build(cx: number, cz: number): void {
    const { chunkSize: size, step, detail, drop } = this.opts
    const n = Math.round(size / step)
    const wx = cx * size
    const wz = cz * size
    const verts = (n + 1) * (n + 1)
    const positions = new Float32Array(verts * 3)
    const colours = new Float32Array(verts * 4)
    const heights = new Float64Array(verts)
    // how far each vertex is from the trail, kept from the height pass so the colouring does not ask again
    const toTrail = new Float32Array(verts).fill(Infinity)

    // the biome belongs to this stretch of route, not to each vertex: one coarse lookup for the whole chunk
    const anchor = this.route.nearestCoarse(wx + size / 2, wz + size / 2, 6000)
    const palette = BIOMES[anchor ? this.route.biomeAt(anchor.s) : 'prairie']

    // 1. heights, with the trail's own profile winning near the trail
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = j * (n + 1) + i
        const x = wx + i * step
        const z = wz + j * step
        const h = groundHeight(this.route, x, z, detail)
        if (detail === 'near') {
          const near = this.route.nearest(x, z, Config.corridor + RELEASE)
          if (near) toTrail[v] = near.distance
        }
        heights[v] = Number.isFinite(h) ? h - drop : NaN
      }
    }

    // 2. positions and colours. The mesh's vertices are relative to its own corner, so they stay small
    //    numbers however far along a route the rider is; the corner is where the floating origin is applied.
    let anyGround = false
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const v = j * (n + 1) + i
        const h = heights[v]
        const ok = Number.isFinite(h)
        if (ok) anyGround = true
        positions[v * 3] = i * step
        positions[v * 3 + 1] = ok ? h : 0
        positions[v * 3 + 2] = j * step

        // slope from the neighbours that exist
        const hx = heights[j * (n + 1) + Math.min(n, i + 1)] - heights[j * (n + 1) + Math.max(0, i - 1)]
        const hz = heights[Math.min(n, j + 1) * (n + 1) + i] - heights[Math.max(0, j - 1) * (n + 1) + i]
        const slope = Number.isFinite(hx) && Number.isFinite(hz) ? Math.hypot(hx, hz) / (2 * step) : 0
        // ground right beside the trail is worn and dusty. It is the one thing about the surface that only the
        // mesh knows — slope and height the shader can work out for itself, but how far this vertex is from
        // the road it cannot — so it is handed over in the colour's alpha (see render/materials/splat.ts).
        const dryness = toTrail[v] < Config.corridor + 6 ? 0.45 : 0
        groundColour(palette, ok ? h : 0, slope, dryness, this.colour)
        /**
         * Mottling, at two scales, fixed to the ground rather than to the mesh.
         *
         * The fine scale was here already and does its job under the wheel. What was missing is the broad one,
         * and it is the reason the middle distance read as painted: past the grass, a hillside or a bottomland
         * was one flat wash of the biome's green out to the haze, and real ground never is — it is a patchwork
         * of meadow and scrub and bare soil at a scale of a hundred metres or so, and that patchwork is most of
         * what tells the eye how far away a slope is. Two waves a hundred and sixty metres long, a little
         * warmer where it is lighter, and the far ground has texture again.
         */
        const gx = wx + i * step
        const gz = wz + j * step
        /**
         * Noise, not sine waves — which is what these were, and on open ground it showed.
         *
         * A sum of sines has a direction and a period, and the eye finds both: across a flat Missouri field
         * the mottling read as corduroy, a set of soft stripes running the width of the prairie, and the
         * stronger sun only made them clearer. Value noise has neither. It is the same handful of instructions,
         * it is a function of world position like everything else here so it does not move, and it is what the
         * ground beneath it (render/ground.ts) is already built with.
         */
        /**
         * Two scales near, one far — because the far ring has a vertex every fifty metres.
         *
         * A twenty-six-metre noise sampled on a fifty-metre lattice is not a coarse version of that noise; it
         * is a different, random one, and it changes every time the chunk is rebuilt at a different offset.
         * The coarse ring gets only the scale it can carry. The fine ring gets both, and the broad one is what
         * the eye reads at distance now that the ground texture itself gives up out there (see
         * render/materials/splat.ts) — it is the only thing keeping a far hillside from being one flat wash.
         */
        const fine = detail === 'far' ? 0 : patch(gx / 26, gz / 26) * 0.5 + patch(gx / 74, gz / 74) * 0.5
        const mottle = 0.9 + 0.2 * (fine + 0.5)
        /**
         * The coarse ring needs MORE of this than the fine one, not less.
         *
         * It is the only thing left out there. Past a few hundred metres the ground texture has given up (it
         * can only alias), so a valley floor two kilometres below a mountain road is one flat wash of the
         * biome's green seen through haze — which reads as fog filling the valley rather than as country. The
         * real thing is a patchwork of fields, wood and river at a scale of a few hundred metres, and that is
         * what these two noise terms stand in for. On the near ring the same figures would be too strong,
         * because down there the texture and the grass are carrying the detail.
         */
        const scale = detail === 'far' ? 2.6 : 1
        const broad = 1 + Config.groundPatchiness * 2 * scale
          * (patch(gx / 210, gz / 210) + patch(gx / 96, gz / 96) * 0.55
            + (detail === 'far' ? patch(gx / 560, gz / 560) * 0.9 : 0))
        colours[v * 4] = this.colour.r * mottle * (broad + 0.035)
        colours[v * 4 + 1] = this.colour.g * mottle * broad
        colours[v * 4 + 2] = this.colour.b * mottle * (broad - 0.03)
        colours[v * 4 + 3] = dryness
      }
    }

    if (!anyGround) {
      // nothing here was baked: remember the hole so it is not rebuilt every frame
      const empty = new Mesh(`chunk${step}_${cx}_${cz}`, this.scene)
      empty.setEnabled(false)
      this.chunks.set(key(cx, cz), { wx, wz, mesh: empty })
      return
    }

    // 3. triangles, skipping any that touch a post the model has nothing for
    const indices: number[] = []
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i
        const b = a + 1
        const c = a + n + 1
        const d = c + 1
        // wound so the face points at the sky: Babylon culls the other way round and the ground would vanish
        if (Number.isFinite(heights[a]) && Number.isFinite(heights[b]) && Number.isFinite(heights[c])) indices.push(a, b, c)
        if (Number.isFinite(heights[b]) && Number.isFinite(heights[c]) && Number.isFinite(heights[d])) indices.push(b, d, c)
      }
    }

    const mesh = new Mesh(`chunk${step}_${cx}_${cz}`, this.scene)
    const data = new VertexData()
    data.positions = positions as unknown as number[]
    data.indices = indices
    data.colors = colours as unknown as number[]
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(mesh, false)
    mesh.material = this.material
    // the alpha channel is data, not transparency: left alone Babylon sees alpha below one and blends the
    // ground into the sky
    mesh.hasVertexAlpha = false
    mesh.renderingGroupId = this.opts.layer
    // not frozen: the floating origin moves these, and a frozen world matrix would ignore it
    mesh.position.set(wx - this.frame.x, 0, wz - this.frame.z)
    mesh.receiveShadows = detail === 'near'
    mesh.isPickable = false
    this.chunks.set(key(cx, cz), { wx, wz, mesh })
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.dispose()
    this.chunks.clear()
    this.material.dispose()
  }
}
