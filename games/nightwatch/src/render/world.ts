/**
 * Everything that stays put: the land (one heightfield: the headland with the lighthouse, the harbour quay, the
 * town's hills), the rocks and their surf, the channel buoys, the harbour with its pier and lamps, the town (whose
 * windows light up as ships come home), trees, and a far lighthouse blinking on the horizon.
 */
import {
  Color3, Mesh, MeshBuilder, PointLight, StandardMaterial, TransformNode, Vector3, VertexData, type Scene, type ShaderMaterial,
} from '@babylonjs/core'
import { clamp, lerp, makeNoise2D, makeRng, smoothstep, type Rng } from '../rng.ts'
import type { Ship } from '../sim/ship.ts'
import { CHANNEL_HALF, HARBOR_CENTER, LIGHTHOUSE, MOLE, MOORINGS, QUAY, channelSamples } from './coast.ts'
import { applyFog, applyLamp, type Env } from './env.ts'
import { Kit, Tris, c3, hex, mix, shade, v3, type Rgb } from './kit.ts'
import { foamMaterial, waveHeight } from './shaders.ts'

const noise = makeNoise2D(11, 'land')

const QUAY_Z = QUAY.z
const QUAY_X0 = QUAY.x0
const QUAY_X1 = QUAY.x1
const QUAY_TOP = QUAY.top
/** The promenade behind the quay edge stays flat and clear (m). */
const PROMENADE = 34

function shoreZ(x: number): number {
  let z = QUAY_Z
  if (x < QUAY_X0) {
    // the shore falls back into a bay west of the harbour, then the lighthouse's headland, then the far cliffs
    z -= smoothstep(QUAY_X0, QUAY_X0 - 50, x) * 100
    z += smoothstep(-190, -360, x) * 110
    z += noise.fbm(x * 0.012, 3.3, 3) * 12 * smoothstep(QUAY_X0 - 20, QUAY_X0 - 70, x)
  }
  if (x > QUAY_X1) z += smoothstep(QUAY_X1, 650, x) * 330 + noise.fbm(x * 0.01, 7.7, 3) * 22 * smoothstep(QUAY_X1 + 5, QUAY_X1 + 60, x)
  return z
}

/** Ground height (m) at x, z; below −1 is under the sea. */
export function landHeight(x: number, z: number): number {
  const d = shoreZ(x) - z
  let h: number
  const quay = x > QUAY_X0 && x < QUAY_X1
  if (d < 0) h = -9
  else if (quay && d < PROMENADE) h = QUAY_TOP
  else if (x <= QUAY_X0) {
    // low ground by the bay (so it doesn't hide the channel), rising to cliffs further west
    const west = smoothstep(QUAY_X0 - 40, QUAY_X0 - 150, x)
    h = 2.6 + (smoothstep(0, 30, d) * (10 + 8 * noise.fbm(x * 0.01, z * 0.01, 3)) + smoothstep(80, 300, d) * 18) * west + smoothstep(0, 24, d) * 3
  }
  else if (quay) h = QUAY_TOP + smoothstep(PROMENADE, 240, d) * (12 + 18 * noise.fbm(x * 0.006, z * 0.006, 3)) + smoothstep(220, 420, d) * 22
  else h = 2.5 + smoothstep(0, 130, d) * (20 + 26 * noise.fbm(x * 0.006, z * 0.006, 3)) + smoothstep(140, 320, d) * 30
  // the lighthouse's island: a flat top with cliffs
  const r = Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z)
  const a = Math.atan2(z - LIGHTHOUSE.z, x - LIGHTHOUSE.x)
  const edge = 50 + 7 * noise.noise(Math.cos(a) * 2 + 5, Math.sin(a) * 2)
  if (r < edge) {
    const top = LIGHTHOUSE.ground + (r > 30 ? noise.fbm(x * 0.05, z * 0.05, 2) * 1.6 : 0)
    const island = r < edge - 20 ? top : lerp(top, -9, smoothstep(edge - 20, edge, r) ** 0.7)
    h = Math.max(h, island)
  }
  return h
}

const GRASS: Rgb = hex('#3f7d52')
const GRASS2: Rgb = hex('#34694a')
const ROCK: Rgb = hex('#6c6a7c')
const SAND: Rgb = hex('#c7b68a')
const PAVE: Rgb = hex('#9d96a4')

function buildLand(scene: Scene): Mesh {
  const tris = new Tris()
  const X0 = -680, X1 = 760, Z0 = -340, Z1 = 300, S = 8
  const nx = Math.round((X1 - X0) / S), nz = Math.round((Z1 - Z0) / S)
  const hs = new Float32Array((nx + 1) * (nz + 1))
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = landHeight(X0 + i * S, Z0 + j * S)
  const up = v3(0, 1, 0)
  const pt = (i: number, j: number): Vector3 => v3(X0 + i * S, hs[j * (nx + 1) + i]!, Z0 + j * S)
  const faceColor = (a: Vector3, b: Vector3, c: Vector3): Rgb => {
    const n = Vector3.Cross(a.subtract(b), c.subtract(b)).normalize()
    const ny = Math.abs(n.y)
    const hAvg = (a.y + b.y + c.y) / 3
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3
    const vary = noise.noise(cx * 0.05, cz * 0.05)
    if (ny < 0.62) return shade(ROCK, 0.9 + 0.15 * vary)
    if (hAvg < 1.2) return SAND
    if (Math.abs(hAvg - QUAY_TOP) < 0.05 && cx > QUAY_X0 && cx < QUAY_X1) return shade(PAVE, 0.95 + 0.08 * vary)
    return shade(mix(GRASS, GRASS2, 0.5 + 0.5 * vary), 0.92 + 0.12 * noise.noise(cx * 0.2, cz * 0.2))
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1)
      if (Math.max(a.y, b.y, c.y, d.y) < -2) continue
      tris.tri(a, b, c, faceColor(a, b, c), undefined, up)
      tris.tri(a, c, d, faceColor(a, c, d), undefined, up)
    }
  }
  const m = tris.mesh('land', scene)
  m.isPickable = false
  return m
}

/** A lumpy low-poly boulder. */
function rockMesh(scene: Scene, rng: Rng, size: number): Mesh {
  const m = MeshBuilder.CreateIcoSphere('rock', { radius: 1, subdivisions: 1, flat: false }, scene)
  const pos = m.getVerticesData('position')!
  const sx = size * rng.range(0.8, 1.3), sy = size * rng.range(0.55, 1.0), sz = size * rng.range(0.8, 1.3)
  const seed = rng.range(0, 100)
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!
    const k = 0.75 + 0.5 * Math.abs(Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + seed))
    pos[i] = x * sx * k
    pos[i + 1] = Math.max(y, -0.4) * sy * k
    pos[i + 2] = z * sz * k
  }
  m.updateVerticesData('position', pos)
  m.rotation.y = rng.range(0, Math.PI * 2)
  return m
}

interface RockSpot { x: number; z: number; size: number; side: number }

function foamRings(scene: Scene, spots: RockSpot[], name: string): Mesh {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const seg = 14
  for (const s of spots) {
    const base = positions.length / 3
    const r0 = s.size * 0.7, r1 = s.size * 2.4 + 3
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2
      for (const [r, v] of [[r0, 0], [r1, 1]] as const) {
        positions.push(s.x + Math.cos(a) * r, 0.35, s.z + Math.sin(a) * r)
        uvs.push(k / seg + s.x * 0.013, v)
      }
    }
    for (let k = 0; k < seg; k++) {
      const i = base + k * 2
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2)
    }
  }
  const vd = new VertexData()
  vd.positions = positions
  vd.uvs = uvs
  vd.indices = indices
  const m = new Mesh(name, scene)
  vd.applyToMesh(m)
  m.isPickable = false
  m.alwaysSelectAsActiveMesh = true
  return m
}

interface Buoy { node: TransformNode; x: number; z: number; light: Mesh; phase: number; period: number }

export class World {
  readonly land: Mesh
  readonly excluded: Mesh[] = []
  private readonly foam: { mesh: Mesh; mat: ShaderMaterial; side: number }[] = []
  private readonly buoys: Buoy[] = []
  private readonly townGroups: { mesh: Mesh; mat: StandardMaterial; level: number; on: number }[] = []
  private readonly harborLight: PointLight
  private readonly blinkers: { mesh: Mesh; period: number; phase: number; duty: number }[] = []
  private readonly farFlare: Mesh
  private readonly dangerColor = new Color3()
  private townLevel = 0.15

  constructor(scene: Scene) {
    const rng = makeRng(5, 'world')
    this.land = buildLand(scene)
    this.buildRocks(scene, rng)
    this.buildBuoys(scene)
    this.buildHarbor(scene, rng)
    this.buildTown(scene, rng)
    this.buildTrees(scene, rng)
    this.farFlare = this.buildFarLight(scene)
    this.harborLight = new PointLight('harborLight', new Vector3(HARBOR_CENTER.x, 30, HARBOR_CENTER.z - 30), scene)
    this.harborLight.diffuse = new Color3(1, 0.75, 0.45)
    this.harborLight.range = 260
    this.harborLight.intensity = 0.8
  }

  private buildRocks(scene: Scene, rng: Rng): void {
    const spots: RockSpot[] = []
    const W = CHANNEL_HALF
    for (const s of channelSamples(11)) {
      if (s.t < 0.04 || s.t > 0.96) continue
      for (const side of [-1, 1]) {
        if (rng() < 0.18 || (side > 0 && s.t > 0.8)) continue
        const lat = side * (W + 6 + rng.range(0, 9))
        spots.push({ x: s.x + s.nx * lat, z: s.z + s.nz * lat, size: rng.range(3.5, 7.5) * (rng() < 0.15 ? 1.6 : 1), side })
      }
      // the reef spreads east, the island's spurs west
      for (let k = 0; k < 3; k++) {
        if (rng() < 0.5 || s.t > 0.62) continue
        const lat = W + 20 + rng.range(0, 150) * rng()
        spots.push({ x: s.x + s.nx * lat, z: s.z + s.nz * lat, size: rng.range(2.5, 9), side: 1 })
      }
      if (s.t > 0.45 && rng() < 0.6) {
        const lat = -(W + 20 + rng.range(0, 45))
        spots.push({ x: s.x + s.nx * lat, z: s.z + s.nz * lat, size: rng.range(3, 8), side: -1 })
      }
    }
    // around the island's foot
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2)
      const r = rng.range(50, 60)
      spots.push({ x: LIGHTHOUSE.x + Math.cos(a) * r, z: LIGHTHOUSE.z + Math.sin(a) * r, size: rng.range(2.5, 6), side: 0 })
    }
    // a few lone rocks out to sea
    for (let i = 0; i < 10; i++) spots.push({ x: rng.range(-500, 450), z: rng.range(500, 1100), size: rng.range(3, 10), side: 0 })

    const kit = new Kit(scene, 'rocks')
    for (const s of spots) {
      const m = rockMesh(scene, rng, s.size)
      const base = rng() < 0.3 ? '#57566a' : '#646274'
      kit.add(m, base, [s.x, -s.size * 0.25, s.z])
      if (rng() < 0.35) kit.add(rockMesh(scene, rng, s.size * 0.5), '#4d5a5a', [s.x + rng.range(-3, 3), -s.size * 0.1, s.z + rng.range(-3, 3)])
    }
    const root = new TransformNode('rocksRoot', scene)
    kit.build(root)
    for (const side of [-1, 0, 1]) {
      const list = spots.filter((s) => s.side === side)
      if (!list.length) continue
      const mesh = foamRings(scene, list, `foam${side}`)
      const mat = foamMaterial(scene, `foamMat${side}`)
      mat.setFloat('seed', side * 3.7 + 1)
      mat.setFloat('foamAmt', 1)
      mesh.material = mat
      this.excluded.push(mesh)
      this.foam.push({ mesh, mat, side })
    }
  }

  private buildBuoys(scene: Scene): void {
    const samples = channelSamples(8)
    const at = [0.1, 0.5, 0.88]
    for (const t of at) {
      const s = samples.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best))
      for (const side of [-1, 1]) {
        const lat = side * (CHANNEL_HALF - 1)
        const x = s.x + s.nx * lat, z = s.z + s.nz * lat
        // heading south: the east side is to port (red), the west to starboard (green)
        const color = side > 0 ? '#e23a3a' : '#2fbf5a'
        const node = new TransformNode('buoy', scene)
        const kit = new Kit(scene, 'buoy')
        kit.cyl(2.2, 1.6, 2.6, [0, 0.6, 0], color, { tess: 8 })
        kit.cyl(0.9, 2.8, 2.8, [0, -0.3, 0], '#e8e8e8', { tess: 8 })
        kit.cyl(1.8, 0.2, 1.4, [0, 2.6, 0], color, { tess: 8 })
        kit.cyl(0.6, 0.15, 0.15, [0, 3.6, 0], '#333', { tess: 4 })
        kit.build(node)
        const light = MeshBuilder.CreateSphere('buoyLight', { diameter: 0.9, segments: 6 }, scene)
        const lm = new StandardMaterial('buoyLightMat', scene)
        lm.disableLighting = true
        lm.emissiveColor = c3(side > 0 ? '#ff5050' : '#50ff80')
        light.material = lm
        light.parent = node
        light.position.y = 4.1
        node.position.set(x, 0, z)
        node.scaling.setAll(1.3)
        const phase = t * 7 + side
        this.buoys.push({ node, x, z, light, phase, period: side > 0 ? 3 : 2.4 })
      }
    }
  }

  private buildHarbor(scene: Scene, rng: Rng): void {
    const kit = new Kit(scene, 'harbor')
    const lamps = new Kit(scene, 'harborLamps')
    const wood = '#8a6a4e', stone = '#8f8894'
    const midX = (QUAY_X0 + QUAY_X1) / 2, lenX = QUAY_X1 - QUAY_X0
    // the quay wall and its coping
    kit.box([lenX, 10, 3], [midX, QUAY_TOP - 5, QUAY_Z - 1.5], stone)
    kit.box([lenX, 0.5, 1.4], [midX, QUAY_TOP + 0.25, QUAY_Z - 0.7], '#b5aeb8')
    // finger piers between the berths
    const spacing = MOORINGS[1]!.x - MOORINGS[0]!.x
    for (let i = 0; i <= MOORINGS.length; i++) {
      const x = MOORINGS[0]!.x - spacing / 2 + i * spacing
      kit.box([3.2, 0.7, 28], [x, 2.4, QUAY_Z + 14], wood)
      for (let z = QUAY_Z + 4; z < QUAY_Z + 28; z += 8) kit.cyl(7, 0.7, 0.7, [x, -1, z], '#5a4636', { tess: 5 })
      lamps.sphere(0.9, [x, 5.6, QUAY_Z + 27], '#ffd08a', { glow: true, seg: 3 })
      kit.cyl(3, 0.25, 0.3, [x, 4, QUAY_Z + 27], '#2e3040', { tess: 5 })
    }
    // bollards at each berth
    for (const m of MOORINGS) for (const dx of [-5, 5]) kit.cyl(1.2, 0.8, 1.1, [m.x + dx, QUAY_TOP + 0.6, QUAY_Z - 1.2], '#2e3040', { tess: 8 })
    // lamp posts along the quay
    const post = (x: number, y: number, z: number): void => {
      kit.cyl(6, 0.35, 0.45, [x, y + 3, z], '#2e3040', { tess: 6 })
      kit.box([1.4, 0.3, 0.3], [x + 0.5, y + 6, z], '#2e3040')
      lamps.sphere(1.2, [x + 1.1, y + 5.6, z], '#ffd08a', { glow: true, seg: 3 })
    }
    for (let x = QUAY_X0 + 12; x < QUAY_X1; x += 26) post(x, QUAY_TOP, QUAY_Z - 4)
    // the breakwater, with the harbour light at its end
    const moleLen = MOLE.z1 - MOLE.z0
    kit.box([14, 7, moleLen], [MOLE.x, -0.5, (MOLE.z0 + MOLE.z1) / 2], '#6f6c7c')
    kit.box([9, 0.6, moleLen], [MOLE.x, 3.3, (MOLE.z0 + MOLE.z1) / 2], '#9d96a4')
    for (let z = MOLE.z0 + 6; z < MOLE.z1; z += 7) {
      for (const dx of [-8, 8]) kit.add(rockMesh(scene, rng, rng.range(2.5, 4)), '#5d5a6b', [MOLE.x + dx, 0, z + rng.range(-2, 2)])
    }
    for (let z = MOLE.z0 + 20; z < MOLE.z1 - 10; z += 30) post(MOLE.x, 3.6, z)
    kit.cyl(8, 2.4, 3, [MOLE.x, 7.6, MOLE.z1 - 2], '#e8e4dc', { tess: 8 })
    kit.cyl(1, 3, 3, [MOLE.x, 12, MOLE.z1 - 2], '#2fa35a', { tess: 8 })
    const head = MeshBuilder.CreateSphere('pierLight', { diameter: 2, segments: 6 }, scene)
    const hm = new StandardMaterial('pierLightMat', scene)
    hm.disableLighting = true
    hm.emissiveColor = c3('#5dff8e')
    head.material = hm
    head.position.set(MOLE.x, 13.4, MOLE.z1 - 2)
    this.blinkers.push({ mesh: head, period: 4, phase: 0, duty: 0.5 })
    // low sheds and the harbour master's office on the promenade (kept low so they don't hide the boats)
    const sheds: [number, number, number, string][] = [[40, 14, 6, '#b0584a'], [100, 20, 5, '#5a7aa8'], [170, 16, 6, '#c89a4a'], [215, 18, 5, '#6a9a6a']]
    for (const [x, w, h, color] of sheds) {
      const z = QUAY_Z - 24
      kit.box([w, h, 12], [x, QUAY_TOP + h / 2, z], color)
      kit.box([w + 1, 0.8, 13], [x, QUAY_TOP + h + 0.4, z], '#3a3a4a')
      kit.box([w * 0.4, h * 0.6, 0.4], [x, QUAY_TOP + h * 0.3, z + 6.1], '#2a2a36')
      lamps.box([w * 0.5, 0.9, 0.3], [x, QUAY_TOP + h * 0.78, z + 6.1], '#ffcf7a', { glow: true })
    }
    const ox = 4, oz = QUAY_Z - 18
    kit.box([10, 8, 9], [ox, QUAY_TOP + 4, oz], '#ece6da')
    kit.cyl(4, 0, 12, [ox, QUAY_TOP + 10, oz], '#3a4f8a', { tess: 4, rot: [0, Math.PI / 4, 0] })
    lamps.cyl(0.3, 2.6, 2.6, [ox, QUAY_TOP + 6, oz + 4.6], '#fff0c0', { glow: true, rot: [Math.PI / 2, 0, 0], tess: 12 })
    lamps.box([2.6, 2, 0.3], [ox - 2.5, QUAY_TOP + 2.5, oz + 4.6], '#ffc466', { glow: true })
    for (let i = 0; i < 30; i++) {
      const x = rng.range(QUAY_X0 + 14, QUAY_X1 - 16), z = rng.range(QUAY_Z - 14, QUAY_Z - 4)
      if (rng() < 0.5) kit.box([2.6, 2.6, 2.6], [x, QUAY_TOP + 1.3 + (rng() < 0.3 ? 2.6 : 0), z], rng.pick(['#a8743a', '#8a5a2a', '#4a7aa8', '#b84a3a']), { rot: [0, rng.range(-0.3, 0.3), 0] })
      else kit.cyl(2.2, 1.6, 1.6, [x, QUAY_TOP + 1.1, z], rng.pick(['#3a6a8a', '#8a3a3a', '#6a6a3a']), { tess: 8 })
    }
    // a crane at the east end
    const cx = 250, cz = QUAY_Z - 8
    kit.box([4, 3, 4], [cx, QUAY_TOP + 1.5, cz], '#e0b030')
    kit.box([1.4, 26, 1.4], [cx, QUAY_TOP + 16, cz], '#e0b030')
    kit.box([30, 1.2, 1.2], [cx - 9, QUAY_TOP + 28.5, cz + 4], '#e0b030', { rot: [0, -0.5, 0.15] })
    kit.box([3, 3, 3], [cx + 2, QUAY_TOP + 28, cz - 1], '#b58a20')
    lamps.sphere(1, [cx, QUAY_TOP + 30, cz], '#ff4040', { glow: true, seg: 3 })
    const root = new TransformNode('harborRoot', scene)
    kit.build(root)
    lamps.build(root)
  }

  private buildTown(scene: Scene, rng: Rng): void {
    const kit = new Kit(scene, 'town')
    const groups = [new Kit(scene, 'win0'), new Kit(scene, 'win1'), new Kit(scene, 'win2'), new Kit(scene, 'win3')]
    const walls = ['#ead8b4', '#cfe2ea', '#f2cbc2', '#d8e8c2', '#f4e4a6', '#e6cfe8', '#f7f1e6']
    const roofs = ['#b04a3a', '#3a4f8a', '#4a6a4a', '#7a4a6a', '#c0703a']
    const placed: { x: number; z: number; r: number }[] = []
    const tryPlace = (x: number, z: number, w: number, d: number): number | null => {
      const r = Math.max(w, d) * 0.75
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) return null
      const hs = [landHeight(x - w / 2, z - d / 2), landHeight(x + w / 2, z - d / 2), landHeight(x - w / 2, z + d / 2), landHeight(x + w / 2, z + d / 2)]
      const lo = Math.min(...hs), hi = Math.max(...hs)
      if (lo < 1.5 || hi - lo > 6) return null
      placed.push({ x, z, r })
      return lo
    }
    const house = (x: number, z: number, low: boolean): void => {
      const w = rng.range(8, 13), d = rng.range(7, 10), h = low ? rng.range(5, 7.5) : rng.range(6, 10)
      const y = tryPlace(x, z, w, d)
      if (y === null) return
      const rot = rng.range(-0.25, 0.25)
      const wall = rng.pick(walls), roof = rng.pick(roofs)
      const cos = Math.cos(rot), sin = Math.sin(rot)
      const P = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos]
      kit.box([w, h + 3, d], P(0, (h - 3) / 2, 0), wall, { rot: [0, rot, 0] })
      for (const s of [1, -1]) kit.box([w + 1, 0.6, d * 0.62], P(0, h + d * 0.19, s * d * 0.24), roof, { rot: [s * 0.65, rot, 0] })
      kit.box([w - 0.2, d * 0.36, 0.4], P(0, h + d * 0.08, 0), wall, { rot: [0, rot, 0] })
      if (rng() < 0.6) kit.box([1.2, 3, 1.2], P(w * 0.25, h + 1.8, d * 0.15), '#8a5040', { rot: [0, rot, 0] })
      kit.box([1.6, 2.8, 0.3], P(rng.range(-w * 0.3, w * 0.3), 1.4, -d / 2 - 0.1), '#4a3a30', { rot: [0, rot, 0] })
      const floors = Math.max(1, Math.floor(h / 3.4))
      for (let f = 0; f < floors; f++) {
        const cols = Math.max(2, Math.floor(w / 3.2))
        for (let c = 0; c < cols; c++) {
          const lx = -w / 2 + (c + 0.5) * (w / cols)
          const g = rng() < 0.3 ? 0 : rng.int(1, 3)
          groups[g]!.box([1.3, 1.5, 0.3], P(lx, 2.6 + f * 3.3, -d / 2 - 0.12), rng() < 0.2 ? '#ffe6a8' : '#ffc466', { glow: true, rot: [0, rot, 0] })
        }
        if (rng() < 0.7) groups[rng.int(0, 3)]!.box([0.3, 1.5, 1.3], P(-w / 2 - 0.12, 2.6 + f * 3.3, 0), '#ffc466', { glow: true, rot: [0, rot, 0] })
      }
    }
    // a low waterfront row behind the promenade, a few up the hill, and the east shore's hillside
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-5, QUAY_X1)
      house(x, rng.range(QUAY_Z - PROMENADE - 8, QUAY_Z - PROMENADE - 40), true)
    }
    for (let i = 0; i < 60; i++) {
      const x = rng.range(-60, QUAY_X1)
      house(x, rng.range(QUAY_Z - 90, QUAY_Z - 240), rng() < 0.6)
    }
    for (let i = 0; i < 220; i++) {
      const x = rng.range(QUAY_X1 - 20, 680)
      const zs = shoreZ(x)
      house(x, rng.range(zs - 16, zs - 240), false)
    }
    for (let i = 0; i < 30; i++) {
      const x = rng.range(-360, -60)
      const z = rng.range(shoreZ(x) - 30, shoreZ(x) - 200)
      house(x, z, false)
    }
    // the church on the hill
    const chx = 170, chz = 10
    const y = landHeight(chx, chz)
    kit.box([12, 12, 24], [chx, y + 6, chz], '#ece6dc')
    for (const s of [1, -1]) kit.box([8.4, 0.6, 25], [chx + s * 3.3, y + 14.6, chz], '#6a3a3a', { rot: [0, 0, -s * 0.7] })
    kit.box([6, 26, 6], [chx, y + 13, chz - 14], '#ece6dc')
    kit.cyl(12, 0, 7.5, [chx, y + 32, chz - 14], '#6a3a3a', { tess: 4, rot: [0, Math.PI / 4, 0] })
    groups[0]!.cyl(0.3, 3.2, 3.2, [chx, y + 21, chz - 17.1], '#fff0c0', { glow: true, rot: [Math.PI / 2, 0, 0], tess: 12 })
    groups[1]!.box([2, 5, 0.3], [chx, y + 5, chz - 12.2], '#ffb04a', { glow: true })

    const root = new TransformNode('townRoot', scene)
    kit.build(root)
    groups.forEach((g, i) => {
      const { glow } = g.build(root)
      if (!glow) return
      const mat = new StandardMaterial(`townWin${i}`, scene)
      mat.disableLighting = true
      mat.emissiveColor = new Color3(1, 1, 1)
      glow.material = mat
      this.townGroups.push({ mesh: glow, mat, level: i / groups.length, on: i === 0 ? 1 : 0 })
    })
  }

  private buildTrees(scene: Scene, rng: Rng): void {
    const kit = new Kit(scene, 'trees')
    let n = 0
    for (let i = 0; i < 1600 && n < 420; i++) {
      // half of them on the hillside in front of the camera
      const near = i % 2 === 0
      const x = near ? rng.range(-160, 320) : rng.range(-640, 700)
      const z = near ? rng.range(-150, QUAY_Z - 50) : rng.range(-330, 280)
      const h = landHeight(x, z)
      if (h < 5 || Math.abs(h - QUAY_TOP) < 0.2 || (x > QUAY_X0 && x < QUAY_X1 && z > QUAY_Z - PROMENADE - 10)) continue
      if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 60) continue
      const s = rng.range(0.8, 1.6)
      if (rng() < 0.6) {
        kit.cyl(9 * s, 0, 5.5 * s, [x, h + 5 * s, z], rng.pick(['#244f3a', '#2a5a40', '#1f4634']), { tess: 6 })
      } else {
        kit.sphere(7 * s, [x, h + 4.5 * s, z], rng.pick(['#2f6b45', '#3a7a4a', '#2a5e40']), { seg: 2 })
      }
      kit.cyl(2.5 * s, 0.8 * s, 1 * s, [x, h + 1 * s, z], '#5a4030', { tess: 5 })
      n++
    }
    kit.build(new TransformNode('treesRoot', scene))
  }

  private buildFarLight(scene: Scene): Mesh {
    const kit = new Kit(scene, 'far')
    const fx = -820, fz = 1650
    kit.sphere(90, [fx, -18, fz], '#2c3044', { seg: 2, scale: [1.6, 0.5, 1] })
    kit.cyl(22, 4, 6, [fx + 10, 20, fz], '#dcd6cc', { tess: 8 })
    kit.build(new TransformNode('farRoot', scene))
    const m = MeshBuilder.CreateSphere('farLight', { diameter: 4, segments: 6 }, scene)
    const mat = new StandardMaterial('farLightMat', scene)
    mat.disableLighting = true
    mat.emissiveColor = new Color3(1, 0.95, 0.8)
    m.material = mat
    m.position.set(fx + 10, 33, fz)
    this.blinkers.push({ mesh: m, period: 5, phase: 1.3, duty: 0.18 })
    return m
  }

  /** Brighten the town as ships come home (0–1). */
  setTownLevel(level: number): void { this.townLevel = clamp(level, 0, 1) }

  update(dt: number, env: Env, ships: readonly Ship[]): void {
    // surf, reddening where a ship is on (or near) the rocks
    const pulse = 0.6 + 0.4 * Math.sin(env.time * 8)
    for (const f of this.foam) {
      applyFog(f.mat, env)
      applyLamp(f.mat, env)
      let danger = 0
      for (const s of ships) {
        if (!s.watching && s.state !== 'aground') continue
        if (f.side !== 0 && f.side !== s.plan.side) continue
        danger = Math.max(danger, smoothstep(0.55, 1.0, s.drift))
      }
      this.dangerColor.set(1, 0.15, 0.1).scaleInPlace(danger * pulse * 0.9)
      f.mat.setColor3('danger', this.dangerColor)
      f.mat.setColor3('foamColor', new Color3(0.72, 0.78, 0.92).scale(0.55 + 0.45 * env.look.hemi))
      f.mat.setFloat('foamAmt', 0.75 + 0.25 * Math.min(1, env.waveAmp))
    }
    for (const b of this.buoys) {
      const t = env.time
      const h = waveHeight(b.x, b.z, t, env.waveAmp)
      const hx = waveHeight(b.x + 2, b.z, t, env.waveAmp) - h
      const hz = waveHeight(b.x, b.z + 2, t, env.waveAmp) - h
      b.node.position.y = h - 0.3
      b.node.rotation.set(Math.atan2(hz, 2) * 1.5, 0, -Math.atan2(hx, 2) * 1.5)
      const on = ((t + b.phase) % b.period) / b.period < 0.3
      b.light.visibility = on ? 1 : 0.15
    }
    for (const bl of this.blinkers) bl.mesh.visibility = ((env.time + bl.phase) % bl.period) / bl.period < bl.duty ? 1 : 0.1
    this.farFlare.scaling.setAll(1 + 2 * env.fogAmt)
    for (const g of this.townGroups) {
      const want = this.townLevel >= g.level ? 1 : 0
      g.on += clamp(want - g.on, -dt * 0.5, dt * 0.5)
      g.mesh.visibility = g.on
      g.mesh.isVisible = g.on > 0.01
      // the town dims a little toward dawn
      g.mat.emissiveColor.setAll(0.85 - 0.35 * clamp(env.look.hemi - 0.6, 0, 1))
    }
    this.harborLight.intensity = 0.5 + 0.6 * this.townLevel
    env.harborGlow = 0.4 + 0.8 * this.townLevel
  }
}
