/**
 * The trail itself: a ribbon laid along the route's own profile, a few hundred metres ahead of the rider and a
 * short way behind, rebuilt as they move.
 *
 * Six columns of vertices rather than two, because a road is not a flat grey band. The outer pair are the worn
 * shoulder where the surface meets the dirt, the inner pair are the surface proper, and the middle pair carry
 * a painted centre line on anything paved — dashed, and only where OSM says the surface is asphalt. The Katy
 * Trail's packed limestone gets no line, which is correct and also the fastest way to tell the two apart.
 *
 * It sits a few centimetres above the profile the ride model uses, which is what the rider's wheels stand on.
 * The ground under it was already pulled up to the same profile (see terrain.ts), so the two meet. There is no
 * depth bias: biasing the ribbon toward the camera to beat z-fighting also pulls the far side of a hairpin
 * through the hillside between them, and on a road with twenty-one of them that is most of the view.
 */
import { Color3, Mesh, type Scene, StandardMaterial, VertexData } from '@babylonjs/core'
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'
import { SurfacePlugin, type SurfaceTextures } from './materials/surface.ts'
import type { SurfaceName } from '../route/package.ts'
import { SURFACES } from './palette.ts'

/**
 * Metres between rings of the ribbon, on a straight. Through a bend the rings close up: at Alpe d'Huez's
 * tightest hairpin the radius is about seven metres, where four-metre rings are thirty degrees apart and the
 * road's inner edge folds over itself into a blob. `RING_ANGLE` is the arc each ring is allowed to span.
 */
const STEP = 4
const MIN_STEP = 0.7
const RING_ANGLE = 0.1 // radians
const COLUMNS = 8
/** the painted line: metres on, metres off */
const DASH_ON = 12
const DASH_OFF = 8
const LINE = new Color3(0.88, 0.86, 0.79)

/** What the vertex colour's alpha says the surface is. See render/materials/surface.ts. */
const SURFACE_CODE: Record<SurfaceName, number> = { paved: 0, gravel: 0.5, dirt: 1 }

/**
 * Across the road, left to right: the worn shoulder, the surface, then a pair of coincident columns either
 * side of the painted line. The duplicates are what give the paint a hard edge — a vertex-coloured strip
 * blends between neighbouring columns, so without them a 34 cm line smears into a metre and a half of pale
 * road and the whole surface reads as concrete.
 */
const ACROSS = [-1.34, -0.90, -0.055, -0.055, 0.055, 0.055, 0.90, 1.34]
/** which columns carry the paint */
const PAINTED = [3, 4]
/** which columns are the shoulder: they hang past the surface and drop into the bed cut for the road */
const SHOULDER = [0, 7]

export class Trail {
  private mesh: Mesh | null = null
  readonly material: StandardMaterial
  private builtAt = Number.NaN
  /** the world point the current mesh's vertices are relative to */
  private anchorX = 0
  private anchorZ = 0

  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame

  constructor(scene: Scene, route: Route, frame: Frame, atmosphere?: Atmosphere, surfaces?: SurfaceTextures) {
    this.scene = scene
    this.route = route
    this.frame = frame
    this.material = new StandardMaterial('trail', scene)
    this.material.diffuseColor = Color3.White()
    this.material.specularColor = new Color3(0.05, 0.05, 0.05)
    this.material.roughness = 0.9
    if (surfaces) new SurfacePlugin(this.material, surfaces)
    atmosphere?.attach(this.material)
    frame.onShift((dx, dz) => {
      if (this.mesh) { this.mesh.position.x -= dx; this.mesh.position.z -= dz }
    })
  }

  /** Whatever ribbon is currently drawn, for the shadow generator to keep its map fed. */
  get meshes(): Mesh[] { return this.mesh ? [this.mesh] : [] }

  /** Rebuild when the rider has used up a good part of what was drawn behind them. */
  update(s: number): void {
    if (Number.isFinite(this.builtAt) && Math.abs(s - this.builtAt) < Config.ribbonBehind * 0.5) return
    this.build(s)
  }

  private build(centre: number): void {
    const from = Math.max(0, centre - Config.ribbonBehind)
    const to = Math.min(this.route.length, centre + Config.ribbonAhead)
    const half = Config.trailWidth / 2

    // where the rings fall: close together through the bends, spread out on the straights
    const stations: number[] = []
    for (let s = from; s < to; ) {
      stations.push(s)
      const kappa = Math.abs(this.route.poseAt(s).curvature)
      s += Math.max(MIN_STEP, Math.min(STEP, kappa > 1e-4 ? RING_ANGLE / kappa : STEP))
    }
    stations.push(to)
    const rings = stations.length

    const positions = new Float32Array(rings * COLUMNS * 3)
    const colours = new Float32Array(rings * COLUMNS * 4)
    // Across the road in metres, and along it in metres from the route's start. Along-the-road is the
    // station itself rather than anything the mesh counts, so the surface does not crawl when the ribbon is
    // rebuilt behind the rider, and `s` owes nothing to the floating origin — it is a distance, not a place.
    const uvs = new Float32Array(rings * COLUMNS * 2)
    const indices: number[] = []

    const anchor = this.route.poseAt(from)
    this.anchorX = anchor.x
    this.anchorZ = anchor.z
    const shoulder = new Color3()

    for (let i = 0; i < rings; i++) {
      const s = stations[i]
      const p = this.route.poseAt(s)
      const nx = -p.hz
      const nz = p.hx
      const y = p.y + Config.trailLift
      const surface = this.route.surfaceAt(s)
      const paint = SURFACES[surface]
      // a line only where there is asphalt to paint it on, and only on the dashes
      const painted = surface === 'paved' && s % (DASH_ON + DASH_OFF) < DASH_ON
      /**
       * The shoulder, darker and wider than it was.
       *
       * The edge of the trail is in every single frame of this game and it was a hard bright line: packed
       * limestone meeting grass with nothing in between, which reads as a ribbon laid on the ground rather than
       * a path worn into it. A real shoulder is the surface gone dirty — trodden material mixed with soil,
       * a good half-metre of it, dropping away into the bed the road sits in. Three quarters of the way to the
       * edge colour rather than under half, and wider by the same amount.
       */
      Color3.LerpToRef(paint.colour, paint.edge, 0.78, shoulder)

      for (let c = 0; c < COLUMNS; c++) {
        const w = ACROSS[c] * half
        const v = i * COLUMNS + c
        const isEdge = SHOULDER.includes(c)
        positions[v * 3] = p.x + nx * w - this.anchorX
        // the shoulder falls away into the bed the terrain was cut to, which both catches the light along the
        // edge of the road and hides the join with the ground
        /**
         * The shoulder drops into the bed the terrain is cut to — but not THROUGH it.
         *
         * The ground inside the corridor sits `roadInset` below the trail's own profile, so a shoulder that
         * hangs any further than that is underground, and what that looks like on a steep hairpin is the
         * hillside sawing through the edge of the road in a hard zigzag, one tooth per terrain triangle. Four
         * fifths of the inset keeps the edge just clear of it at every gradient.
         */
        positions[v * 3 + 1] = y - (isEdge ? Config.trailLift + Config.roadInset * 0.8 : 0)
        positions[v * 3 + 2] = p.z + nz * w - this.anchorZ
        const isLine = painted && PAINTED.includes(c)
        const col = isLine ? LINE : isEdge ? shoulder : paint.colour
        colours[v * 4] = col.r
        colours[v * 4 + 1] = col.g
        colours[v * 4 + 2] = col.b
        // which of the three surfaces this is, for the material to pick between (render/materials/surface.ts)
        colours[v * 4 + 3] = SURFACE_CODE[surface]
        uvs[v * 2] = w
        uvs[v * 2 + 1] = s
      }

      if (i > 0) {
        const a = (i - 1) * COLUMNS
        const b = i * COLUMNS
        for (let c = 0; c < COLUMNS - 1; c++) {
          indices.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1)
        }
      }
    }

    this.mesh?.dispose()
    const mesh = new Mesh('trail', this.scene)
    const data = new VertexData()
    data.positions = positions as unknown as number[]
    data.indices = indices
    data.colors = colours as unknown as number[]
    data.uvs = uvs as unknown as number[]
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(mesh, false)
    mesh.material = this.material
    // the alpha channel says which surface this is, not how see-through it is
    mesh.hasVertexAlpha = false
    mesh.renderingGroupId = Layer.near
    mesh.position.set(this.anchorX - this.frame.x, 0, this.anchorZ - this.frame.z)
    mesh.receiveShadows = true
    mesh.isPickable = false
    this.mesh = mesh
    this.builtAt = centre
  }

  dispose(): void {
    this.mesh?.dispose()
    this.material.dispose()
  }
}
