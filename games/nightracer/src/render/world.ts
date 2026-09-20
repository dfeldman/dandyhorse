/**
 * Everything that belongs to one track: sky, skyline, ground, road, barriers, lamps, bend chevrons, the start
 * gantry with its countdown lights, searchlights and the city. Rebuilt for every race; dispose() frees it.
 *
 * Strip winding (geometry.ts): with rows running forward (t) and columns in some direction c, a face points along
 * t × c. So columns left→right give an upward face, bottom→top a face looking left (−right)...
 */
import {
  Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3, Vector4, VertexData,
  type ShaderMaterial, type Scene,
} from '@babylonjs/core'
import { Config, ROAD_HALF } from '../config.ts'
import { smoothstep } from '../rng.ts'
import type { Track } from '../sim/track.ts'
import { newPose } from '../sim/track.ts'
import { buildCity, BLOCK, STREET, type City } from './city.ts'
import { trackStrip } from './geometry.ts'
import { LAMP_SPACING, makeShader } from './shaders.ts'
import { hex, type Theme } from './theme.ts'

export const MOON_DIR = new Vector3(-0.45, 0.42, 0.78).normalize()
const WALL_H = 1.1
const WALL_T = 0.5

export interface CarLight { x: number; y: number; z: number; dx: number; dy: number; dz: number; tint: Color3 }

export class World {
  readonly track: Track
  readonly theme: Theme
  private readonly scene: Scene
  private readonly meshes: Mesh[] = []
  private readonly shaders: ShaderMaterial[] = []
  private readonly lit: ShaderMaterial[] = []
  private readonly city: City
  private readonly gantryLights: StandardMaterial[] = []
  private readonly searchlights: Mesh[] = []
  private readonly textures: DynamicTexture[] = []
  private readonly carPos = new Array<number>(12).fill(0)
  private readonly carDir = new Array<number>(12).fill(0)
  private readonly carTint = new Array<number>(12).fill(0)

  constructor(scene: Scene, track: Track, theme: Theme, gridLanes: number[]) {
    this.scene = scene
    this.track = track
    this.theme = theme
    scene.fogMode = 2 // exp2
    scene.fogDensity = theme.fogDensity
    scene.fogColor = hex(theme.fog)
    scene.clearColor = hex(theme.skyHorizon).toColor4(1)

    this.buildSky()
    this.buildGround()
    this.buildRoad(gridLanes)
    this.buildWalls()
    this.buildLamps()
    this.buildChevrons()
    this.buildGantry()
    this.buildSearchlights()
    this.city = buildCity(scene, track, theme)
    this.shaders.push(...this.city.meshes.map((m) => m.material).filter((m): m is ShaderMaterial => !!m && m.getClassName() === 'ShaderMaterial'))

    for (const m of this.shaders) {
      m.setColor3('fogColor', hex(theme.fog))
      m.setFloat('fogDensity', theme.fogDensity)
      m.setVector3('moonDir', MOON_DIR)
    }
    for (const m of this.lit) {
      m.setColor3('lampColor', hex(theme.lamp))
      m.setFloat('lampSide', ROAD_HALF + 1)
    }
  }

  private track3(m: Mesh): Mesh {
    m.isPickable = false
    m.freezeWorldMatrix()
    this.meshes.push(m)
    return m
  }

  private shader(kind: Parameters<typeof makeShader>[1], name: string, carLit = false): ShaderMaterial {
    const m = makeShader(this.scene, kind, name)
    m.backFaceCulling = false
    this.shaders.push(m)
    if (carLit) this.lit.push(m)
    return m
  }

  private buildSky(): void {
    const t = this.theme
    const sky = MeshBuilder.CreateSphere('sky', { diameter: 5000, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene)
    const m = makeShader(this.scene, 'sky', 'skyMat')
    m.setColor3('skyTop', hex(t.skyTop))
    m.setColor3('skyHorizon', hex(t.skyHorizon))
    m.setColor3('skyGlow', hex(t.skyGlow))
    m.setVector3('moonDir', MOON_DIR)
    m.disableDepthWrite = true
    m.backFaceCulling = false
    sky.material = m
    sky.infiniteDistance = true
    sky.applyFog = false
    sky.renderingGroupId = 0
    this.skyMat = m
    this.track3(sky)

    const ring = MeshBuilder.CreateCylinder('skyline', { diameter: 3400, height: 420, tessellation: 96, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE }, this.scene)
    ring.position.y = 150
    const b = this.track.bounds
    ring.position.x = (b.minX + b.maxX) / 2
    ring.position.z = (b.minZ + b.maxZ) / 2
    const rm = makeShader(this.scene, 'skyline', 'skylineMat')
    rm.setColor3('skyHorizon', hex(t.skyHorizon))
    rm.setColor3('silhouette', hex(t.silhouette))
    rm.setColor3('winWarm', hex(t.winWarm))
    rm.backFaceCulling = false
    ring.material = rm
    ring.applyFog = false
    this.track3(ring)
  }
  private skyMat: ShaderMaterial | null = null

  private buildGround(): void {
    const b = this.track.bounds
    const M = Config.CITY_MARGIN + 260
    const x0 = b.minX - M, x1 = b.maxX + M, z0 = b.minZ - M, z1 = b.maxZ + M
    const cell = 12
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell)
    const positions: number[] = [], uvs: number[] = [], uv2: number[] = [], indices: number[] = []
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * cell, z = z0 + j * cell
        const g = this.track.groundAt(x, z)
        // far out, sink the ground a little so the skyline ring stays above the horizon
        const edge = Math.max(Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2)), Math.abs((z - (z0 + z1) / 2) / ((z1 - z0) / 2)))
        positions.push(x, g.h - 30 * smoothstep(0.85, 1, edge), z)
        uvs.push(x, z)
        uv2.push(1 - smoothstep(ROAD_HALF + 7, ROAD_HALF + 16, g.d), 0)
      }
    }
    const row = nx + 1
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * row + i, bb = a + 1, c = a + row, d = c + 1
      indices.push(a, bb, c, bb, d, c)
    }
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    const vd = new VertexData()
    Object.assign(vd, { positions, indices, normals, uvs, uvs2: uv2 })
    const mesh = new Mesh('ground', this.scene)
    vd.applyToMesh(mesh)
    const m = this.shader('ground', 'groundMat')
    m.setColor3('groundColor', hex(this.theme.ground))
    m.setColor3('streetGlow', hex(this.theme.streetGlow))
    m.setFloat('block', BLOCK)
    m.setFloat('street', STREET)
    mesh.material = m
    this.track3(mesh)
  }

  private buildRoad(gridLanes: number[]): void {
    const H = ROAD_HALF
    const road = trackStrip(this.scene, 'road', this.track, 2, [
      { lat: -H, lift: 0, u: -H }, { lat: 0, lift: 0, u: 0 }, { lat: H, lift: 0, u: H },
    ])
    const m = this.shader('road', 'roadMat', true)
    m.setFloat('trackLength', this.track.length)
    m.setFloat('roadHalf', H)
    m.setFloat('laneWidth', Config.LANE_WIDTH)
    m.setColor3('asphalt', hex(this.theme.asphalt))
    m.setColor3('kerbColor', hex(this.theme.neon[0]).scale(0.9))
    m.setVector4('gridSlots', new Vector4(gridLanes[0] ?? 1, gridLanes[1] ?? 2, gridLanes[2] ?? 0, gridLanes[3] ?? 3))
    road.material = m
    this.track3(road)
  }

  private buildWalls(): void {
    const H = ROAD_HALF
    for (const side of [-1, 1]) {
      const inner = side * H, outer = side * (H + WALL_T)
      // inner face: bottom→top faces left (−right); the left wall's inner face must face right, so reverse
      const innerCols = [{ lat: inner, lift: -0.4, u: -0.4 }, { lat: inner, lift: WALL_H, u: WALL_H }]
      const topCols = [{ lat: Math.min(inner, outer), lift: WALL_H, u: WALL_H }, { lat: Math.max(inner, outer), lift: WALL_H, u: WALL_H }]
      const outerCols = [{ lat: outer, lift: WALL_H, u: WALL_H }, { lat: outer, lift: -4, u: -4 }]
      const m = this.shader('wall', `wallMat${side}`, true)
      m.setColor3('wallA', hex(this.theme.wallA))
      m.setColor3('wallB', hex(this.theme.wallB))
      m.setColor3('neon', hex(this.theme.neon[side < 0 ? 0 : 1]))
      m.setFloat('roadHalfW', H)
      for (const [name, cols] of [['in', side > 0 ? innerCols : [...innerCols].reverse()], ['top', topCols], ['out', side > 0 ? outerCols : [...outerCols].reverse()]] as const) {
        const strip = trackStrip(this.scene, `wall-${name}-${side}`, this.track, 2, cols as never, side)
        strip.material = m
        this.track3(strip)
      }
      // a neon tube along the top of the inner face
      const tube = trackStrip(this.scene, `neon${side}`, this.track, 2, side > 0
        ? [{ lat: inner - 0.02, lift: WALL_H - 0.16, u: 0 }, { lat: inner - 0.02, lift: WALL_H + 0.02, u: 1 }]
        : [{ lat: inner + 0.02, lift: WALL_H + 0.02, u: 1 }, { lat: inner + 0.02, lift: WALL_H - 0.16, u: 0 }], side)
      const tm = new StandardMaterial(`neonMat${side}`, this.scene)
      tm.emissiveColor = hex(this.theme.neon[side < 0 ? 0 : 1])
      tm.diffuseColor = Color3.Black()
      tm.specularColor = Color3.Black()
      tm.disableLighting = true
      tm.backFaceCulling = false
      tube.material = tm
      this.track3(tube)
    }
  }

  private buildLamps(): void {
    const scene = this.scene
    const n = Math.floor(this.track.length / LAMP_SPACING)
    const pole = MeshBuilder.CreateCylinder('lampPole', { height: 9, diameterTop: 0.18, diameterBottom: 0.32, tessellation: 6 }, scene)
    pole.position.y = 4.5
    pole.bakeCurrentTransformIntoVertices()
    const arm = MeshBuilder.CreateBox('lampArm', { width: 0.14, height: 0.14, depth: 1 }, scene)
    const head = MeshBuilder.CreateBox('lampHead', { width: 0.55, height: 0.2, depth: 1.3 }, scene)
    const poleMat = new StandardMaterial('poleMat', scene)
    poleMat.diffuseColor = new Color3(0.18, 0.19, 0.24)
    poleMat.specularColor = new Color3(0.2, 0.2, 0.25)
    pole.material = poleMat
    arm.material = poleMat
    const headMat = new StandardMaterial('lampHeadMat', scene)
    headMat.emissiveColor = hex(this.theme.lamp).scale(1.2)
    headMat.disableLighting = true
    head.material = headMat
    const pbuf = new Float32Array(n * 16), abuf = new Float32Array(n * 16), hbuf = new Float32Array(n * 16)
    const pose = newPose()
    const reach = 3.4
    for (let k = 0; k < n; k++) {
      const side = k % 2 === 0 ? 1 : -1
      const s = k * LAMP_SPACING
      const p = this.track.poseAt(s, pose)
      const hl = Math.hypot(p.tx, p.tz) || 1
      const hx = p.tx / hl, hz = p.tz / hl
      const lat = side * (ROAD_HALF + 1.0)
      const bx = p.x + hz * lat, bz = p.z - hx * lat
      const by = p.y + p.ry * lat - 0.4
      const yaw = Math.atan2(hx, hz)
      const q = Quaternion.FromEulerAngles(0, yaw, 0)
      Matrix.Compose(Vector3.One(), q, new Vector3(bx, by, bz)).copyToArray(pbuf, k * 16)
      // the arm reaches toward the road (local x points right)
      const armLen = reach
      const ax = bx - hz * side * armLen / 2, az = bz + hx * side * armLen / 2
      const qa = Quaternion.FromEulerAngles(0, yaw + Math.PI / 2, 0)
      Matrix.Compose(new Vector3(1, 1, armLen), qa, new Vector3(ax, by + 8.9, az)).copyToArray(abuf, k * 16)
      const hx2 = bx - hz * side * (armLen - 0.3), hz2 = bz + hx * side * (armLen - 0.3)
      Matrix.Compose(Vector3.One(), qa, new Vector3(hx2, by + 8.75, hz2)).copyToArray(hbuf, k * 16)
    }
    pole.thinInstanceSetBuffer('matrix', pbuf, 16)
    arm.thinInstanceSetBuffer('matrix', abuf, 16)
    head.thinInstanceSetBuffer('matrix', hbuf, 16)
    for (const m of [pole, arm, head]) { m.isPickable = false; this.meshes.push(m) }
  }

  private chevronTexture(dir: 1 | -1): DynamicTexture {
    const tex = new DynamicTexture(`chev${dir}`, { width: 256, height: 128 }, this.scene, true)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = '#0b0b12'
    ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = '#ffd42a'
    ctx.shadowColor = '#ffd42a'
    ctx.shadowBlur = 6
    for (let i = 0; i < 3; i++) {
      const cx = 56 + i * 72
      ctx.beginPath()
      if (dir > 0) { ctx.moveTo(cx - 26, 18); ctx.lineTo(cx + 22, 64); ctx.lineTo(cx - 26, 110); ctx.lineTo(cx - 6, 110); ctx.lineTo(cx + 42, 64); ctx.lineTo(cx - 6, 18) }
      else { ctx.moveTo(cx + 26, 18); ctx.lineTo(cx - 22, 64); ctx.lineTo(cx + 26, 110); ctx.lineTo(cx + 6, 110); ctx.lineTo(cx - 42, 64); ctx.lineTo(cx + 6, 18) }
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = '#ffd42a'
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, 250, 122)
    tex.update()
    this.textures.push(tex)
    return tex
  }

  private buildChevrons(): void {
    const scene = this.scene
    const L = this.track.length
    const pose = newPose()
    const lists: Record<string, Matrix[]> = { '1': [], '-1': [] }
    for (let s = 0; s < L; s += 9) {
      const k = this.track.curvatureAt(s)
      if (Math.abs(k) < 1 / 75) continue
      if (Math.abs(this.track.gap(s, 0)) < 60) continue
      const dir = k > 0 ? 1 : -1
      const p = this.track.poseAt(s, pose)
      const hl = Math.hypot(p.tx, p.tz) || 1
      const hx = p.tx / hl, hz = p.tz / hl
      const lat = -dir * (ROAD_HALF + 0.9)
      const x = p.x + hz * lat, z = p.z - hx * lat
      const y = p.y + p.ry * lat + WALL_H + 0.8
      // face the oncoming cars, turned a little toward the road's centre
      const yaw = Math.atan2(hx, hz) + dir * 0.35
      lists[String(dir)]!.push(Matrix.Compose(new Vector3(2.6, 1.3, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(x, y, z)))
    }
    for (const dir of [1, -1] as const) {
      const list = lists[String(dir)]!
      if (!list.length) continue
      const board = MeshBuilder.CreatePlane(`chevron${dir}`, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene)
      const m = new StandardMaterial(`chevMat${dir}`, scene)
      m.emissiveTexture = this.chevronTexture(dir)
      m.diffuseColor = Color3.Black()
      m.specularColor = Color3.Black()
      m.disableLighting = true
      board.material = m
      const buf = new Float32Array(list.length * 16)
      list.forEach((mm, i) => mm.copyToArray(buf, i * 16))
      board.thinInstanceSetBuffer('matrix', buf, 16)
      board.isPickable = false
      this.meshes.push(board)
    }
  }

  private buildGantry(): void {
    const scene = this.scene
    const p = this.track.poseAt(1.5, newPose())
    const hl = Math.hypot(p.tx, p.tz) || 1
    const hx = p.tx / hl, hz = p.tz / hl
    const yaw = Math.atan2(hx, hz)
    const root = new Mesh('gantryRoot', scene)
    root.position.set(p.x, p.y, p.z)
    root.rotation.y = yaw
    const frame = new StandardMaterial('gantryMat', scene)
    frame.diffuseColor = new Color3(0.22, 0.22, 0.3)
    frame.emissiveColor = new Color3(0.05, 0.05, 0.08)
    const span = ROAD_HALF + WALL_T + 0.8
    for (const side of [-1, 1]) {
      const pillar = MeshBuilder.CreateBox('pillar', { width: 1.1, height: 11, depth: 1.1 }, scene)
      pillar.position.set(side * span, 3.5, 0)
      pillar.material = frame
      pillar.parent = root
      this.meshes.push(pillar)
    }
    const beam = MeshBuilder.CreateBox('beam', { width: span * 2 + 1.1, height: 2.6, depth: 1.2 }, scene)
    beam.position.set(0, 8.4, 0)
    beam.material = frame
    beam.parent = root
    this.meshes.push(beam)
    // banner on the face toward the grid (-z)
    const tex = new DynamicTexture('bannerTex', { width: 1024, height: 128 }, scene, true)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    for (let i = 0; i < 64; i++) for (let j = 0; j < 8; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#101018' : '#f4f4f4'
      ctx.fillRect(i * 16, j * 16, 16, 16)
    }
    ctx.fillStyle = '#0b0a14'
    ctx.fillRect(170, 14, 684, 100)
    ctx.font = '800 76px "Baloo 2", "Arial Black", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffd42a'
    ctx.shadowColor = '#e8890c'
    ctx.shadowBlur = 14
    ctx.fillText('NIGHT RACER', 512, 70)
    tex.update()
    this.textures.push(tex)
    const banner = MeshBuilder.CreatePlane('banner', { width: span * 2 - 2, height: 2.2 }, scene)
    banner.position.set(0, 8.4, -0.62)
    const bm = new StandardMaterial('bannerMat', scene)
    bm.emissiveTexture = tex
    bm.diffuseColor = Color3.Black()
    bm.disableLighting = true
    banner.material = bm
    banner.parent = root
    this.meshes.push(banner)
    // countdown lights hang under the beam, facing the grid
    for (let i = 0; i < 5; i++) {
      const lamp = MeshBuilder.CreateSphere(`startLight${i}`, { diameter: 0.9, segments: 8 }, scene)
      lamp.position.set((i - 2) * 1.5, 6.5, -0.4)
      const lm = new StandardMaterial(`startLightMat${i}`, scene)
      lm.disableLighting = true
      lm.emissiveColor = new Color3(0.12, 0.05, 0.05)
      lamp.material = lm
      lamp.parent = root
      this.gantryLights.push(lm)
      this.meshes.push(lamp)
    }
    const housing = MeshBuilder.CreateBox('lightHousing', { width: 8, height: 1.3, depth: 0.5 }, scene)
    housing.position.set(0, 6.5, 0)
    housing.material = frame
    housing.parent = root
    this.meshes.push(housing, root)
  }

  private buildSearchlights(): void {
    const scene = this.scene
    const b = this.track.bounds
    const m = new StandardMaterial('beamMat', scene)
    m.emissiveColor = hex(this.theme.skyGlow).scale(0.5).add(new Color3(0.3, 0.3, 0.3))
    m.diffuseColor = Color3.Black()
    m.disableLighting = true
    m.alpha = 0.07
    m.alphaMode = 1 // add
    m.backFaceCulling = false
    m.disableDepthWrite = true
    const spots = [[b.minX - 150, b.minZ + 100], [b.maxX + 120, b.maxZ - 60], [b.maxX + 60, b.minZ - 140]]
    spots.forEach(([x, z], i) => {
      const cone = MeshBuilder.CreateCylinder(`searchlight${i}`, { height: 900, diameterTop: 70, diameterBottom: 3, tessellation: 16, cap: Mesh.NO_CAP }, scene)
      cone.setPivotPoint(new Vector3(0, -450, 0))
      cone.position.set(x!, 450 + this.track.heightAt(x!, z!), z!)
      cone.material = m
      cone.applyFog = false
      cone.isPickable = false
      this.searchlights.push(cone)
      this.meshes.push(cone)
    })
  }

  /** Countdown lights: n red lamps lit (0–5), or 'go' for all green, or null for off. */
  setStartLights(n: number | 'go' | null): void {
    this.gantryLights.forEach((m, i) => {
      if (n === 'go') m.emissiveColor.set(0.1, 1, 0.3)
      else if (n !== null && i < n) m.emissiveColor.set(1, 0.08, 0.05)
      else m.emissiveColor.set(0.12, 0.05, 0.05)
    })
  }

  getGlowExcluded(): Mesh[] { return this.searchlights }

  /** Once a frame: time, camera, and the cars (for headlight pools). */
  update(t: number, camera: Vector3, cars: CarLight[]): void {
    for (let i = 0; i < 4; i++) {
      const c = cars[i]
      if (!c) { this.carPos[i * 3 + 1] = -9999; continue }
      this.carPos[i * 3] = c.x; this.carPos[i * 3 + 1] = c.y; this.carPos[i * 3 + 2] = c.z
      this.carDir[i * 3] = c.dx; this.carDir[i * 3 + 1] = c.dy; this.carDir[i * 3 + 2] = c.dz
      this.carTint[i * 3] = c.tint.r; this.carTint[i * 3 + 1] = c.tint.g; this.carTint[i * 3 + 2] = c.tint.b
    }
    for (const m of this.shaders) {
      m.setVector3('cameraPos', camera)
      m.setFloat('time', t)
    }
    this.skyMat?.setFloat('time', t)
    for (const m of this.lit) {
      m.setArray3('carPos', this.carPos)
      m.setArray3('carDir', this.carDir)
      m.setArray3('carTint', this.carTint)
    }
    const blink = (t % 1.6) < 0.8
    this.city.beaconMats.forEach((m, g) => m.emissiveColor.set((blink === (g === 0)) ? 1 : 0.15, 0.06, 0.06))
    this.searchlights.forEach((s, i) => {
      s.rotation.z = Math.sin(t * 0.21 + i * 2.1) * 0.45
      s.rotation.x = Math.cos(t * 0.17 + i * 1.3) * 0.35
    })
  }

  dispose(): void {
    this.city.dispose()
    for (const m of this.meshes) m.dispose(false, true)
    for (const t of this.textures) t.dispose()
    this.skyMat?.dispose()
  }
}
