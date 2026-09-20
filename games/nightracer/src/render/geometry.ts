/** Small mesh builders: strips that follow the track, and a triangle list that keeps faces pointing outward. */
import { Mesh, VertexData, type Scene } from '@babylonjs/core'
import type { Track } from '../sim/track.ts'
import { newPose } from '../sim/track.ts'

export interface StripColumn {
  /** metres right of the centreline */
  lat: number
  /** metres above the (banked) road surface */
  lift: number
  /** the u texture coordinate */
  u: number
}

/**
 * A strip along the whole loop: one row every `step` metres, columns as given. Rows run with the track (v = s),
 * so faces point along (forward × column direction): order columns left→right for an upward face, bottom→top
 * for a face looking left... (see the winding note in world.ts).
 * uv2 = (curvature, side).
 */
export function trackStrip(scene: Scene, name: string, track: Track, step: number, cols: StripColumn[], side = 0): Mesh {
  const L = track.length
  const rows = Math.ceil(L / step)
  const nc = cols.length
  const positions: number[] = []
  const uvs: number[] = []
  const uv2: number[] = []
  const indices: number[] = []
  const pose = newPose()
  for (let r = 0; r <= rows; r++) {
    const s = Math.min(L, r * step)
    const p = track.poseAt(s, pose)
    for (const c of cols) {
      positions.push(p.x + p.rx * c.lat + p.ux * c.lift, p.y + p.ry * c.lat + p.uy * c.lift, p.z + p.rz * c.lat + p.uz * c.lift)
      uvs.push(c.u, s)
      uv2.push(p.k, side)
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < nc - 1; c++) {
      const a = r * nc + c, b = a + 1, cc = a + nc, d = cc + 1
      indices.push(a, b, cc, b, d, cc)
    }
  }
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  const vd = new VertexData()
  vd.positions = positions
  vd.indices = indices
  vd.normals = normals
  vd.uvs = uvs
  vd.uvs2 = uv2
  const mesh = new Mesh(name, scene)
  vd.applyToMesh(mesh)
  return mesh
}

/** Accumulates quads with explicit outward normals (flat shaded), uvs, uv2s and colours. */
export class MeshBuilder2 {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  uv2: number[] = []
  colors: number[] = []
  indices: number[] = []

  get vertexCount(): number { return this.positions.length / 3 }

  /**
   * A quad p0 p1 p2 p3 (in order around the edge) facing `n`. uv per corner; uv2 and colour for all four.
   */
  quad(p: number[][], n: number[], uv: number[][], uv2: number[], color: number[]): void {
    const base = this.vertexCount
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i]![0]!, p[i]![1]!, p[i]![2]!)
      this.normals.push(n[0]!, n[1]!, n[2]!)
      this.uvs.push(uv[i]![0]!, uv[i]![1]!)
      this.uv2.push(uv2[0]!, uv2[1]!)
      this.colors.push(color[0]!, color[1]!, color[2]!, color[3]!)
    }
    // Babylon's face normal is (p1 - p2) x (p3 - p2); flip the order when that disagrees with n
    const [a, b, c] = [p[0]!, p[1]!, p[2]!]
    const e1 = [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
    const e2 = [c[0]! - b[0]!, c[1]! - b[1]!, c[2]! - b[2]!]
    const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!
    const cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!
    const cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!
    const agree = cx * n[0]! + cy * n[1]! + cz * n[2]! >= 0
    if (agree) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  /**
   * An upright box rotated by `yaw` about its centre (cx, cz), from y0 to y1, footprint w (local x) × d (local z).
   * Walls get uv = (metres along the wall, metres above `groundTop`); the roof gets uv2.x = 0 (no windows).
   */
  box(cx: number, cz: number, w: number, d: number, yaw: number, y0: number, y1: number, groundTop: number, uv2: number[], color: number[], roof = true): void {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    // local (lx, lz) -> world: x = cx + lx*c + lz*s, z = cz - lx*s + lz*c  (Babylon yaw: +z turns toward +x)
    const P = (lx: number, lz: number, y: number): number[] => [cx + lx * c + lz * s, y, cz - lx * s + lz * c]
    const N = (lx: number, lz: number): number[] => [lx * c + lz * s, 0, -lx * s + lz * c]
    const hw = w / 2, hd = d / 2
    const v0 = y0 - groundTop, v1 = y1 - groundTop
    const faces: { a: number[]; b: number[]; n: number[]; len: number; off: number }[] = [
      { a: [-hw, hd], b: [hw, hd], n: N(0, 1), len: w, off: 0 },
      { a: [hw, hd], b: [hw, -hd], n: N(1, 0), len: d, off: w },
      { a: [hw, -hd], b: [-hw, -hd], n: N(0, -1), len: w, off: w + d },
      { a: [-hw, -hd], b: [-hw, hd], n: N(-1, 0), len: d, off: 2 * w + d },
    ]
    for (const f of faces) {
      this.quad(
        [P(f.a[0]!, f.a[1]!, y0), P(f.b[0]!, f.b[1]!, y0), P(f.b[0]!, f.b[1]!, y1), P(f.a[0]!, f.a[1]!, y1)],
        f.n,
        [[f.off, v0], [f.off + f.len, v0], [f.off + f.len, v1], [f.off, v1]],
        uv2, color,
      )
    }
    if (roof) {
      this.quad([P(-hw, -hd, y1), P(hw, -hd, y1), P(hw, hd, y1), P(-hw, hd, y1)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0], color)
    }
  }

  build(scene: Scene, name: string): Mesh {
    const vd = new VertexData()
    vd.positions = this.positions
    vd.normals = this.normals
    vd.uvs = this.uvs
    vd.uvs2 = this.uv2
    vd.colors = this.colors
    vd.indices = this.indices
    const mesh = new Mesh(name, scene)
    vd.applyToMesh(mesh)
    return mesh
  }
}
