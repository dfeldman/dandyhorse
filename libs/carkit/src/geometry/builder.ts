/**
 * A flat-shaded triangle soup with a ROLE per vertex. No Babylon here, so it runs in tests, workers and tools.
 *
 * Flat shading is the low-poly look: no vertex is shared between faces, every triangle carries its own face
 * normal, computed from its winding — so the winding is the one thing a caller must get right (the outward
 * normal is (b − a) × (c − a) by the right-hand rule; `tests/geometry.test.ts` checks every vehicle
 * encloses a positive volume, which fails the moment any part of it is inside out).
 *
 * The role tells the material what a face is: paint (recoloured per copy), glass, a lamp that lights with the
 * brakes or flashes with an indicator, or plain fixed-colour trim. See `Role`.
 */
import type { Rgb } from '../spec.ts'

export type V3 = [number, number, number]

/** What a face is, for the material. Stored per vertex as a float. */
export const Role = {
  /** keeps its built colour (tyres, bumpers, grille, wheel wells) */
  FIXED: 0,
  /** the copy's main paint */
  PAINT: 1,
  /** the copy's second paint: roof, pillars, mirrors, a truck's box */
  PAINT2: 2,
  /** opaque glass: dark, with a sky reflection; nobody is ever seen inside */
  GLASS: 3,
  HEAD: 4,
  /** tail lamps: dim with the headlights on, bright with the brakes */
  TAIL: 5,
  IND_L: 6,
  IND_R: 7,
  REVERSE: 8,
  /** emergency lamps: A flashes against B */
  BEACON_A: 9,
  BEACON_B: 10,
  /** a taxi's roof sign, a bus's destination blind */
  SIGN: 11,
} as const
export type RoleId = (typeof Role)[keyof typeof Role]

export interface GeometryData {
  positions: Float32Array
  normals: Float32Array
  /** rgba; alpha 1 for bodies (ground-darkened in the material), 0 for the wheel */
  colors: Float32Array
  roles: Float32Array
  indices: Uint32Array
}

const WHITE: Rgb = [1, 1, 1]

export class Builder {
  /** written as every vertex's colour alpha: 1 = body (darkened towards the road by the material), 0 = opt out */
  alpha = 1
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly roles: number[] = []

  /** One triangle whose outward normal is (b − a) × (c − a). Degenerate triangles are dropped. */
  tri(a: V3, b: V3, c: V3, role: RoleId, colour: Rgb = WHITE): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    // the face normal is u × v, so a, b, c must turn counter-clockwise about it (right-hand rule)
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) return
    nx /= len; ny /= len; nz /= len
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2])
      this.normals.push(nx, ny, nz)
      this.colors.push(colour[0], colour[1], colour[2], this.alpha)
      this.roles.push(role)
    }
  }

  /** A quad a→b→c→d, wound like `tri`; split on the diagonal that keeps it flattest. */
  quad(a: V3, b: V3, c: V3, d: V3, role: RoleId, colour: Rgb = WHITE): void {
    this.tri(a, b, c, role, colour)
    this.tri(a, c, d, role, colour)
  }

  /** A quad whose winding is chosen so its normal points along `hint` (for lathed parts like wheels). */
  quadToward(a: V3, b: V3, c: V3, d: V3, hint: V3, role: RoleId, colour: Rgb = WHITE): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let dot = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2]
    if (Math.abs(dot) < 1e-12) {
      // a, b, c in a line (a quad collapsed to a triangle at one end): judge by the other half
      const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2]
      dot = (vy * wz - vz * wy) * hint[0] + (vz * wx - vx * wz) * hint[1] + (vx * wy - vy * wx) * hint[2]
    }
    if (dot >= 0) this.quad(a, b, c, d, role, colour)
    else this.quad(d, c, b, a, role, colour)
  }

  /** A convex (or star-shaped about its centroid) polygon, wound like `tri`. */
  fan(pts: V3[], role: RoleId, colour: Rgb = WHITE): void {
    const c: V3 = [0, 0, 0]
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
    c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length
    for (let i = 0; i < pts.length; i++) this.tri(c, pts[i], pts[(i + 1) % pts.length], role, colour)
  }

  /**
   * An axis-aligned box from its min and max corners, with every edge chamfered by `bevel` (0 for a plain
   * box). Lamps, bumpers, mirrors, roof signs and the truck's cargo box are all these.
   */
  box(min: V3, max: V3, role: RoleId, colour: Rgb = WHITE, bevel = 0): void {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    const b = Math.min(bevel, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3)
    if (b <= 0) {
      // the six faces, each wound outward
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], role, colour)   // +z
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], role, colour)   // −z
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], role, colour)   // +x
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], role, colour)   // −x
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], role, colour)   // +y
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], role, colour)   // −y
      return
    }
    // a chamfered box is a ring of 8 points (the x/y outline with cut corners) swept along z, with the
    // front and back rings pulled in by the bevel and capped
    const ring = (inset: number, z: number): V3[] => {
      const e = b - inset   // the corner cut, smaller on the inset end rings so their faces meet the bevel
      const xa = x0 + inset, xb = x1 - inset, ya = y0 + inset, yb = y1 - inset
      return [
        [xa + e, ya, z], [xb - e, ya, z], [xb, ya + e, z], [xb, yb - e, z],
        [xb - e, yb, z], [xa + e, yb, z], [xa, yb - e, z], [xa, ya + e, z],
      ]
    }
    const rings = [ring(b, z0), ring(0, z0 + b), ring(0, z1 - b), ring(b, z1)]
    this.sweep(rings, role, colour)
  }

  /**
   * Quads between consecutive rings, then the two end caps. Rings run from −z to +z and each ring's points
   * go counter-clockwise in the x–y plane (x right, y up): that winding makes every side face outward.
   */
  sweep(rings: V3[][], role: RoleId | ((seg: number, ring: number) => RoleId), colour: Rgb = WHITE): void {
    const roleOf = typeof role === 'function' ? role : () => role
    const n = rings[0].length
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1]
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        this.quad(A[i], A[j], B[j], B[i], roleOf(i, r), colour)
      }
    }
    this.fan([...rings[0]].reverse(), roleOf(-1, 0), colour)
    this.fan(rings[rings.length - 1], roleOf(-2, rings.length - 1), colour)
  }

  /** Append another builder's triangles, transformed by `f`. */
  append(other: Builder, f: (p: V3) => V3 = (p) => p): void {
    for (let i = 0; i < other.positions.length; i += 9) {
      const pt = (k: number): V3 => f([other.positions[i + k], other.positions[i + k + 1], other.positions[i + k + 2]])
      const ci = (i / 3) * 4
      this.tri(pt(0), pt(3), pt(6), other.roles[i / 3] as RoleId,
        [other.colors[ci], other.colors[ci + 1], other.colors[ci + 2]])
    }
  }

  get triangles(): number { return this.positions.length / 9 }

  build(): GeometryData {
    const n = this.positions.length / 3
    // Babylon (left-handed) treats a triangle as front-facing when it runs CLOCKWISE on screen, the opposite
    // of the right-hand rule the normals above are built by: so the index buffer lists each triangle a, c, b.
    // Without this every face culls its outside and the vehicles render inside out.
    const indices = new Uint32Array(n)
    for (let i = 0; i < n; i += 3) { indices[i] = i; indices[i + 1] = i + 2; indices[i + 2] = i + 1 }
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      roles: new Float32Array(this.roles),
      indices,
    }
  }
}
