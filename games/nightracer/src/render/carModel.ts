/**
 * One chunky cartoon car template, dressed per racer: body colour, stripes, wing, hubcaps, headlights, a roof number.
 * The body and cabin are lofted from a side profile and flat-shaded for a low-poly toy look. Nose faces +z.
 */
import {
  Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, VertexData, type Scene,
} from '@babylonjs/core'
import { hex } from './theme.ts'

export interface CarStyle {
  body: string
  accent: string
  stripe: 'center' | 'twin' | 'side' | 'none'
  stripeColor: string
  wing: 'gt' | 'twin' | 'lip' | 'none'
  hubcap: 'star' | 'disc' | 'spoke' | 'ring'
  headlight: 'round' | 'square' | 'slit' | 'quad'
  number: number
  scoop?: boolean
  pipes?: boolean
}

export const STYLES: Record<string, CarStyle> = {
  player: { body: '#ff2d2d', accent: '#ffffff', stripe: 'center', stripeColor: '#ffffff', wing: 'gt', hubcap: 'star', headlight: 'round', number: 1, pipes: true },
  blue: { body: '#2f7dff', accent: '#e8f0ff', stripe: 'twin', stripeColor: '#ffffff', wing: 'twin', hubcap: 'disc', headlight: 'slit', number: 7 },
  gold: { body: '#ffc21a', accent: '#2a2a33', stripe: 'side', stripeColor: '#1e1e28', wing: 'lip', hubcap: 'spoke', headlight: 'quad', number: 3, pipes: true },
  green: { body: '#38d45a', accent: '#8f3dff', stripe: 'center', stripeColor: '#8f3dff', wing: 'none', hubcap: 'ring', headlight: 'square', number: 9, scoop: true },
}

// side profile of the body (z forward, y up), counter-clockwise seen from the right
const BODY: [number, number][] = [
  [2.25, 0.3], [2.36, 0.46], [2.3, 0.66], [2.0, 0.78], [1.2, 0.86], [0.5, 0.93],
  [-1.4, 0.98], [-2.05, 1.0], [-2.28, 0.9], [-2.34, 0.6], [-2.2, 0.3],
]
const CABIN: [number, number][] = [
  [0.62, 0.88], [-0.15, 1.42], [-1.1, 1.46], [-1.72, 0.96],
]

/**
 * Loft a closed side profile across the car: at each station x the profile is scaled by f around its centroid.
 * Ends are capped with fans. Returns flat-shaded geometry.
 */
function loft(scene: Scene, name: string, profile: [number, number][], stations: [number, number][]): Mesh {
  const n = profile.length
  let cz = 0, cy = 0
  for (const [z, y] of profile) { cz += z; cy += y }
  cz /= n; cy /= n
  const positions: number[] = []
  const indices: number[] = []
  const ring = (x: number, f: number): number => {
    const base = positions.length / 3
    for (const [z, y] of profile) positions.push(x, cy + (y - cy) * f, cz + (z - cz) * f)
    return base
  }
  const rings = stations.map(([x, f]) => ring(x, f))
  // stations run -x → +x; the profile runs nose → roof → tail → floor, so this winding faces outward
  for (let r = 0; r < rings.length - 1; r++) {
    const a0 = rings[r]!, b0 = rings[r + 1]!
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      indices.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i)
    }
  }
  const capL = positions.length / 3
  positions.push(stations[0]![0], cy, cz)
  const capR = positions.length / 3
  positions.push(stations[stations.length - 1]![0], cy, cz)
  const first = rings[0]!, last = rings[rings.length - 1]!
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(capL, first + j, first + i)
    indices.push(capR, last + i, last + j)
  }
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  const vd = new VertexData()
  vd.positions = positions
  vd.indices = indices
  vd.normals = normals
  const mesh = new Mesh(name, scene)
  vd.applyToMesh(mesh, true)
  mesh.convertToFlatShadedMesh()
  return mesh
}

function mat(scene: Scene, name: string, color: Color3, opts: { spec?: number; power?: number; emissive?: number; unlit?: boolean } = {}): StandardMaterial {
  const m = new StandardMaterial(name, scene)
  if (opts.unlit) {
    m.disableLighting = true
    m.emissiveColor = color
    m.diffuseColor = Color3.Black()
  } else {
    m.diffuseColor = color
    m.specularColor = new Color3(1, 1, 1).scale(opts.spec ?? 0.3)
    m.specularPower = opts.power ?? 32
    m.emissiveColor = color.scale(opts.emissive ?? 0)
  }
  return m
}

export interface CarModel {
  root: TransformNode
  /** Leans, pitches and spins; the wheels ride on it. */
  body: TransformNode
  wheels: TransformNode[]
  /** Front wheels steer. */
  frontWheels: TransformNode[]
  headlightMat: StandardMaterial
  taillightMat: StandardMaterial
  flames: Mesh[]
  beams: Mesh
  meshes: Mesh[]
  dispose(): void
}

export function buildCar(scene: Scene, id: string, style: CarStyle): CarModel {
  const meshes: Mesh[] = []
  const root = new TransformNode(`car-${id}`, scene)
  const body = new TransformNode(`carBody-${id}`, scene)
  body.parent = root
  const bodyCol = hex(style.body)
  const bodyMat = mat(scene, `${id}-paint`, bodyCol, { spec: 0.55, power: 48, emissive: 0.22 })
  const accentMat = mat(scene, `${id}-accent`, hex(style.accent), { spec: 0.4, emissive: 0.15 })
  const stripeMat = mat(scene, `${id}-stripe`, hex(style.stripeColor), { spec: 0.3, emissive: 0.2 })
  const glassMat = mat(scene, `${id}-glass`, new Color3(0.06, 0.08, 0.14), { spec: 1, power: 96 })
  glassMat.emissiveColor = new Color3(0.03, 0.05, 0.1)
  const darkMat = mat(scene, `${id}-dark`, new Color3(0.07, 0.07, 0.09), { spec: 0.05 })
  const chromeMat = mat(scene, `${id}-chrome`, new Color3(0.8, 0.82, 0.88), { spec: 1, power: 64, emissive: 0.25 })
  const headlightMat = mat(scene, `${id}-head`, new Color3(1, 0.96, 0.82), { unlit: true })
  const taillightMat = mat(scene, `${id}-tail`, new Color3(0.9, 0.05, 0.1), { unlit: true })

  const add = (m: Mesh, material: StandardMaterial, parent: TransformNode = body): Mesh => {
    m.material = material
    m.parent = parent
    m.isPickable = false
    meshes.push(m)
    return m
  }

  // body and cabin
  add(loft(scene, `${id}-shell`, BODY, [[-1.0, 0.7], [-0.94, 0.9], [-0.82, 1], [0.82, 1], [0.94, 0.9], [1.0, 0.7]]), bodyMat)
  add(loft(scene, `${id}-cabin`, CABIN, [[-0.8, 0.75], [-0.72, 1], [0.72, 1], [0.8, 0.75]]), glassMat)
  const roof = add(MeshBuilder.CreateBox(`${id}-roof`, { width: 1.36, height: 0.07, depth: 0.95 }, scene), bodyMat)
  roof.position.set(0, 1.47, -0.62)

  // stripes follow the top of the body: short boxes laid along the profile
  const topChain: [number, number][] = [[2.25, 0.72], [2.0, 0.795], [1.2, 0.875], [0.55, 0.94]]
  const layStripe = (x: number, w: number): void => {
    for (let i = 0; i < topChain.length - 1; i++) {
      const [z0, y0] = topChain[i]!, [z1, y1] = topChain[i + 1]!
      const seg = MeshBuilder.CreateBox(`${id}-stripe`, { width: w, height: 0.03, depth: Math.hypot(z1 - z0, y1 - y0) + 0.04 }, scene)
      seg.position.set(x, (y0 + y1) / 2 + 0.012, (z0 + z1) / 2)
      seg.rotation.x = Math.atan2(y1 - y0, z0 - z1) // tilt +z down toward the nose
      add(seg, stripeMat)
    }
    const rs = MeshBuilder.CreateBox(`${id}-rstripe`, { width: w, height: 0.03, depth: 0.95 }, scene)
    rs.position.set(x, 1.515, -0.62)
    add(rs, stripeMat)
    const deck = MeshBuilder.CreateBox(`${id}-dstripe`, { width: w, height: 0.03, depth: 0.5 }, scene)
    deck.position.set(x, 1.0, -1.95)
    add(deck, stripeMat)
  }
  if (style.stripe === 'center') layStripe(0, 0.42)
  if (style.stripe === 'twin') { layStripe(-0.26, 0.16); layStripe(0.26, 0.16) }
  if (style.stripe === 'side') {
    for (const sx of [-1, 1]) {
      const s = MeshBuilder.CreateBox(`${id}-side`, { width: 0.04, height: 0.14, depth: 3.4 }, scene)
      s.position.set(sx * 1.005, 0.62, -0.1)
      add(s, stripeMat)
    }
  }

  // roof number
  const numTex = new DynamicTexture(`${id}-num`, { width: 128, height: 128 }, scene, true)
  {
    const ctx = numTex.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111118'
    ctx.font = '800 84px "Baloo 2", "Arial Black", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(style.number), 64, 72)
    numTex.hasAlpha = true
    numTex.update()
  }
  const numMat = new StandardMaterial(`${id}-numMat`, scene)
  numMat.diffuseTexture = numTex
  numMat.emissiveTexture = numTex
  numMat.emissiveColor = new Color3(0.35, 0.35, 0.35)
  numMat.useAlphaFromDiffuseTexture = true
  numMat.specularColor = Color3.Black()
  const num = MeshBuilder.CreateGround(`${id}-number`, { width: 0.66, height: 0.66 }, scene)
  num.position.set(0, 1.535, -0.62)
  num.rotation.y = Math.PI
  add(num, numMat)

  // wing
  if (style.wing === 'gt' || style.wing === 'twin') {
    const y = style.wing === 'gt' ? 1.42 : 1.3
    const blade = MeshBuilder.CreateBox(`${id}-wing`, { width: 2.0, height: 0.07, depth: 0.52 }, scene)
    blade.position.set(0, y, -2.05)
    blade.rotation.x = -0.12
    add(blade, accentMat)
    if (style.wing === 'twin') {
      const b2 = MeshBuilder.CreateBox(`${id}-wing2`, { width: 2.0, height: 0.06, depth: 0.4 }, scene)
      b2.position.set(0, y + 0.24, -2.12)
      b2.rotation.x = -0.18
      add(b2, bodyMat)
    }
    for (const sx of [-1, 1]) {
      const plate = MeshBuilder.CreateBox(`${id}-plate`, { width: 0.05, height: style.wing === 'twin' ? 0.52 : 0.34, depth: 0.62 }, scene)
      plate.position.set(sx * 1.0, y + (style.wing === 'twin' ? 0.13 : 0.02), -2.07)
      add(plate, bodyMat)
      const strut = MeshBuilder.CreateBox(`${id}-strut`, { width: 0.08, height: y - 0.95, depth: 0.16 }, scene)
      strut.position.set(sx * 0.55, (y + 0.95) / 2, -1.98)
      add(strut, darkMat)
    }
  } else if (style.wing === 'lip') {
    const lip = MeshBuilder.CreateBox(`${id}-lip`, { width: 1.8, height: 0.14, depth: 0.3 }, scene)
    lip.position.set(0, 1.07, -2.14)
    lip.rotation.x = 0.35
    add(lip, accentMat)
  }
  if (style.scoop) {
    const scoop = MeshBuilder.CreateBox(`${id}-scoop`, { width: 0.6, height: 0.28, depth: 0.9 }, scene)
    scoop.position.set(0, 1.0, 1.25)
    add(scoop, accentMat)
    const mouth = MeshBuilder.CreateBox(`${id}-mouth`, { width: 0.48, height: 0.18, depth: 0.05 }, scene)
    mouth.position.set(0, 1.02, 1.71)
    add(mouth, darkMat)
  }

  // lights
  const front = 2.31
  if (style.headlight === 'round' || style.headlight === 'quad') {
    const spots = style.headlight === 'round' ? [[-0.6, 0.6, 0.34], [0.6, 0.6, 0.34]] : [[-0.72, 0.6, 0.2], [-0.45, 0.6, 0.2], [0.45, 0.6, 0.2], [0.72, 0.6, 0.2]]
    for (const [x, y, d] of spots) {
      const h = MeshBuilder.CreateCylinder(`${id}-hl`, { diameter: d!, height: 0.1, tessellation: 12 }, scene)
      h.rotation.x = Math.PI / 2
      h.position.set(x!, y!, front)
      add(h, headlightMat)
    }
  } else if (style.headlight === 'square') {
    for (const x of [-0.6, 0.6]) {
      const h = MeshBuilder.CreateBox(`${id}-hl`, { width: 0.4, height: 0.2, depth: 0.1 }, scene)
      h.position.set(x, 0.6, front)
      add(h, headlightMat)
    }
  } else {
    const h = MeshBuilder.CreateBox(`${id}-hl`, { width: 1.7, height: 0.08, depth: 0.1 }, scene)
    h.position.set(0, 0.68, front - 0.04)
    add(h, headlightMat)
  }
  const grille = MeshBuilder.CreateBox(`${id}-grille`, { width: 0.7, height: 0.16, depth: 0.06 }, scene)
  grille.position.set(0, 0.42, 2.34)
  add(grille, darkMat)
  for (const x of [-0.62, 0.62]) {
    const t = MeshBuilder.CreateBox(`${id}-tl`, { width: 0.5, height: 0.14, depth: 0.08 }, scene)
    t.position.set(x, 0.76, -2.3)
    add(t, taillightMat)
  }
  const bumper = MeshBuilder.CreateBox(`${id}-bumper`, { width: 1.9, height: 0.18, depth: 0.2 }, scene)
  bumper.position.set(0, 0.36, -2.26)
  add(bumper, darkMat)

  // exhausts and turbo flames
  const flameMat = new StandardMaterial(`${id}-flame`, scene)
  flameMat.emissiveColor = new Color3(1, 0.55, 0.15)
  flameMat.diffuseColor = Color3.Black()
  flameMat.disableLighting = true
  flameMat.alpha = 0.9
  const flames: Mesh[] = []
  const pipeXs = style.pipes ? [-0.45, 0.45] : [0.35]
  for (const x of pipeXs) {
    const pipe = MeshBuilder.CreateCylinder(`${id}-pipe`, { diameter: 0.16, height: 0.3, tessellation: 8 }, scene)
    pipe.rotation.x = Math.PI / 2
    pipe.position.set(x, 0.36, -2.36)
    add(pipe, chromeMat)
    const flame = MeshBuilder.CreateCylinder(`${id}-fl`, { diameterTop: 0.3, diameterBottom: 0.02, height: 1.4, tessellation: 8 }, scene)
    flame.setPivotPoint(new Vector3(0, 0.7, 0))
    flame.rotation.x = Math.PI / 2
    flame.position.set(x, 0.36, -3.2)
    add(flame, flameMat)
    flame.isVisible = false
    flames.push(flame)
  }

  // headlight beams: long additive cones
  const beamMat = new StandardMaterial(`${id}-beam`, scene)
  beamMat.emissiveColor = new Color3(1, 0.93, 0.7)
  beamMat.diffuseColor = Color3.Black()
  beamMat.disableLighting = true
  beamMat.alpha = 0.05
  beamMat.alphaMode = 1
  beamMat.backFaceCulling = false
  beamMat.disableDepthWrite = true
  const beams = MeshBuilder.CreateCylinder(`${id}-beams`, { diameterTop: 7, diameterBottom: 0.5, height: 16, tessellation: 12, cap: Mesh.NO_CAP }, scene)
  beams.rotation.x = Math.PI / 2 + 0.06
  beams.position.set(0, 0.55, front + 8)
  add(beams, beamMat)

  // wheels
  const wheels: TransformNode[] = []
  const frontWheels: TransformNode[] = []
  const tireMat = mat(scene, `${id}-tire`, new Color3(0.05, 0.05, 0.06), { spec: 0.1 })
  for (const [x, z] of [[-0.98, 1.38], [0.98, 1.38], [-0.98, -1.4], [0.98, -1.4]] as const) {
    const steer = new TransformNode(`${id}-steer`, scene)
    steer.parent = body
    steer.position.set(x, 0.43, z)
    const spin = new TransformNode(`${id}-spin`, scene)
    spin.parent = steer
    const tire = MeshBuilder.CreateCylinder(`${id}-tire`, { diameter: 0.86, height: 0.42, tessellation: 14 }, scene)
    tire.rotation.z = Math.PI / 2
    add(tire, tireMat, spin)
    const out = Math.sign(x)
    const capX = out * 0.215
    if (style.hubcap === 'disc') {
      const d = MeshBuilder.CreateCylinder(`${id}-cap`, { diameter: 0.56, height: 0.04, tessellation: 14 }, scene)
      d.rotation.z = Math.PI / 2
      d.position.x = capX
      add(d, chromeMat, spin)
      const dot = MeshBuilder.CreateCylinder(`${id}-dot`, { diameter: 0.18, height: 0.06, tessellation: 8 }, scene)
      dot.rotation.z = Math.PI / 2
      dot.position.x = capX + out * 0.02
      add(dot, bodyMat, spin)
    } else if (style.hubcap === 'ring') {
      const r = MeshBuilder.CreateTorus(`${id}-ring`, { diameter: 0.46, thickness: 0.09, tessellation: 14 }, scene)
      r.rotation.z = Math.PI / 2
      r.position.x = capX
      add(r, accentMat, spin)
      const bar = MeshBuilder.CreateBox(`${id}-bar`, { width: 0.04, height: 0.44, depth: 0.08 }, scene)
      bar.position.x = capX
      add(bar, chromeMat, spin)
    } else {
      const arms = style.hubcap === 'star' ? 5 : 8
      const thick = style.hubcap === 'star' ? 0.11 : 0.04
      for (let k = 0; k < arms; k++) {
        const a = MeshBuilder.CreateBox(`${id}-arm`, { width: 0.04, height: 0.27, depth: thick }, scene)
        a.setPivotPoint(new Vector3(0, -0.135, 0))
        a.position.set(capX, 0.135, 0)
        a.rotation.x = (k / arms) * Math.PI * 2
        add(a, style.hubcap === 'star' ? chromeMat : accentMat, spin)
      }
      const hub = MeshBuilder.CreateCylinder(`${id}-hub`, { diameter: 0.16, height: 0.06, tessellation: 8 }, scene)
      hub.rotation.z = Math.PI / 2
      hub.position.x = capX
      add(hub, chromeMat, spin)
    }
    wheels.push(spin)
    if (z > 0) frontWheels.push(steer)
  }

  // soft blob shadow under the car
  const shadowTex = new DynamicTexture(`${id}-shadow`, { width: 64, height: 64 }, scene, false)
  {
    const ctx = shadowTex.getContext() as CanvasRenderingContext2D
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    shadowTex.hasAlpha = true
    shadowTex.update()
  }
  const shadowMat = new StandardMaterial(`${id}-shadowMat`, scene)
  shadowMat.diffuseTexture = shadowTex
  shadowMat.useAlphaFromDiffuseTexture = true
  shadowMat.diffuseColor = Color3.Black()
  shadowMat.specularColor = Color3.Black()
  shadowMat.disableLighting = true
  const shadow = MeshBuilder.CreateGround(`${id}-shadowQuad`, { width: 2.8, height: 5.4 }, scene)
  shadow.position.y = 0.04
  add(shadow, shadowMat, root)

  return {
    root, body, wheels, frontWheels, headlightMat, taillightMat, flames, beams, meshes,
    dispose() {
      for (const m of meshes) m.dispose(false, true)
      numTex.dispose()
      shadowTex.dispose()
      root.dispose()
    },
  }
}
