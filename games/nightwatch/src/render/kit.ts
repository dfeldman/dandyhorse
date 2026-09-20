/**
 * Low-poly model building: primitives with baked colours, merged into one lit mesh and one glowing mesh per model.
 * Also a flat-shaded triangle accumulator for custom shapes (hulls, sails, rocks) and a few shared materials.
 */
import {
  Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData, type Scene,
} from '@babylonjs/core'

export type Rgb = [number, number, number]

export function hex(c: string): Rgb {
  const v = parseInt(c.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
export const c3 = (c: string | Rgb): Color3 => {
  const [r, g, b] = typeof c === 'string' ? hex(c) : c
  return new Color3(r, g, b)
}

const shared = new WeakMap<Scene, { solid: StandardMaterial; glow: StandardMaterial; solidTwo: StandardMaterial }>()

/** The two materials every model uses: lit vertex colours, and unlit glowing vertex colours. */
export function kitMaterials(scene: Scene): { solid: StandardMaterial; glow: StandardMaterial; solidTwo: StandardMaterial } {
  let m = shared.get(scene)
  if (m) return m
  const solid = new StandardMaterial('kitSolid', scene)
  solid.diffuseColor = new Color3(1, 1, 1)
  solid.specularColor = new Color3(0.12, 0.12, 0.14)
  solid.specularPower = 24
  solid.maxSimultaneousLights = 6
  const solidTwo = solid.clone('kitSolidTwo')
  solidTwo.backFaceCulling = false
  solidTwo.twoSidedLighting = true
  const glow = new StandardMaterial('kitGlow', scene)
  glow.disableLighting = true
  glow.emissiveColor = new Color3(1, 1, 1)
  glow.diffuseColor = new Color3(0, 0, 0)
  m = { solid, glow, solidTwo }
  shared.set(scene, m)
  return m
}

function paint(mesh: Mesh, c: Rgb, a = 1): void {
  const n = mesh.getTotalVertices()
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) colors.set([c[0], c[1], c[2], a], i * 4)
  mesh.setVerticesData(VertexBuffer.ColorKind, colors)
}

export interface PartOpts {
  rot?: [number, number, number]
  glow?: boolean
  flat?: boolean
}

/** Collects parts for one model. Positions are in the model's own space. */
export class Kit {
  private readonly solids: Mesh[] = []
  private readonly glows: Mesh[] = []
  private readonly scene: Scene
  private readonly name: string
  private n = 0

  constructor(scene: Scene, name: string) {
    this.scene = scene
    this.name = name
  }

  add(mesh: Mesh, color: string | Rgb, pos: [number, number, number] = [0, 0, 0], opts: PartOpts = {}): Mesh {
    mesh.position.set(pos[0], pos[1], pos[2])
    if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2])
    mesh.bakeCurrentTransformIntoVertices()
    if (opts.flat !== false && !opts.glow) mesh.convertToFlatShadedMesh()
    paint(mesh, typeof color === 'string' ? hex(color) : color)
    ;(opts.glow ? this.glows : this.solids).push(mesh)
    return mesh
  }

  box(size: [number, number, number], pos: [number, number, number], color: string | Rgb, opts: PartOpts = {}): Mesh {
    const m = MeshBuilder.CreateBox(`${this.name}b${this.n++}`, { width: size[0], height: size[1], depth: size[2] }, this.scene)
    return this.add(m, color, pos, opts)
  }

  cyl(h: number, dTop: number, dBot: number, pos: [number, number, number], color: string | Rgb, opts: PartOpts & { tess?: number; arc?: number } = {}): Mesh {
    const m = MeshBuilder.CreateCylinder(`${this.name}c${this.n++}`, { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: opts.tess ?? 10, arc: opts.arc ?? 1, enclose: (opts.arc ?? 1) < 1 }, this.scene)
    return this.add(m, color, pos, opts)
  }

  sphere(d: number, pos: [number, number, number], color: string | Rgb, opts: PartOpts & { seg?: number; scale?: [number, number, number] } = {}): Mesh {
    const m = MeshBuilder.CreateSphere(`${this.name}s${this.n++}`, { diameter: d, segments: opts.seg ?? 4 }, this.scene)
    if (opts.scale) {
      m.scaling.set(opts.scale[0], opts.scale[1], opts.scale[2])
    }
    return this.add(m, color, pos, opts)
  }

  /** A custom flat-shaded shape. */
  shape(tris: Tris, pos: [number, number, number] = [0, 0, 0], opts: PartOpts = {}): Mesh {
    const m = tris.mesh(`${this.name}t${this.n++}`, this.scene)
    m.position.set(pos[0], pos[1], pos[2])
    if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2])
    m.bakeCurrentTransformIntoVertices()
    ;(opts.glow ? this.glows : this.solids).push(m)
    return m
  }

  /** Merge everything under `parent`. */
  build(parent: TransformNode, twoSided = false): { solid: Mesh | null; glow: Mesh | null } {
    const mats = kitMaterials(this.scene)
    const keep = new Set<string>([VertexBuffer.PositionKind, VertexBuffer.NormalKind, VertexBuffer.ColorKind])
    const merge = (list: Mesh[], name: string): Mesh | null => {
      if (!list.length) return null
      // primitives carry uvs, custom shapes don't: merge only what they share
      for (const m of list) for (const kind of m.getVerticesDataKinds()) if (!keep.has(kind)) m.removeVerticesData(kind)
      const m = list.length === 1 ? list[0]! : Mesh.MergeMeshes(list, true, true)!
      m.name = name
      m.parent = parent
      m.isPickable = false
      return m
    }
    const solid = merge(this.solids, `${this.name}-solid`)
    const glow = merge(this.glows, `${this.name}-glow`)
    if (solid) solid.material = twoSided ? mats.solidTwo : mats.solid
    if (glow) glow.material = mats.glow
    return { solid, glow }
  }
}

/**
 * Triangles with per-face colours and flat normals. Each face is wound so its normal points along `out`
 * (a hint direction, or a point the face should face away from).
 */
export class Tris {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly indices: number[] = []

  tri(a: Vector3, b: Vector3, c: Vector3, color: Rgb, away?: Vector3, hint?: Vector3): void {
    // Babylon's face normal is (a - b) x (c - b); flip the winding if that points the wrong way
    let n = Vector3.Cross(a.subtract(b), c.subtract(b))
    const len = n.length()
    if (len < 1e-9) return
    n.scaleInPlace(1 / len)
    let want: Vector3 | null = hint ?? null
    if (!want && away) want = a.add(b).add(c).scale(1 / 3).subtract(away)
    if (want && Vector3.Dot(n, want) < 0) {
      const t = b; b = c; c = t
      n = n.scale(-1)
    }
    const base = this.positions.length / 3
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
      this.colors.push(color[0], color[1], color[2], 1)
    }
    this.indices.push(base, base + 1, base + 2)
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Rgb, away?: Vector3, hint?: Vector3): void {
    this.tri(a, b, c, color, away, hint)
    this.tri(a, c, d, color, away, hint)
  }

  mesh(name: string, scene: Scene): Mesh {
    const vd = new VertexData()
    vd.positions = this.positions
    vd.normals = this.normals
    vd.colors = this.colors
    vd.indices = this.indices
    const m = new Mesh(name, scene)
    vd.applyToMesh(m, true)
    return m
  }
}

export const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z)

/** Mix two colours. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const shade = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k]
