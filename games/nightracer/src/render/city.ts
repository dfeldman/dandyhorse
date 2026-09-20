/**
 * The city: dark buildings of random heights with lit windows (the building shader draws the windows), a row of
 * buildings lining the race road, blocks on a street grid beyond, downtown clusters of towers, neon signs facing the
 * road, and red beacons on the tallest roofs.
 */
import {
  Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3, type Scene,
} from '@babylonjs/core'
import { Config, ROAD_HALF } from '../config.ts'
import { makeRng, smoothstep } from '../rng.ts'
import type { Track } from '../sim/track.ts'
import { newPose } from '../sim/track.ts'
import { MeshBuilder2 } from './geometry.ts'
import { makeShader } from './shaders.ts'
import { hex, type Theme } from './theme.ts'

export const BLOCK = 64
export const STREET = 12

export interface City {
  meshes: Mesh[]
  beaconMats: StandardMaterial[]
  dispose(): void
}

interface Footprint { cx: number; cz: number; w: number; d: number; yaw: number }

const SIGN_WORDS = ['HOTEL', 'RAMEN', 'ARCADE', 'BAR', '24H', 'PIZZA', 'DINER', 'NOODLES', 'KARAOKE', 'TURBO',
  'GARAGE', 'DISCO', 'SUSHI', 'CINEMA', 'TACOS', 'MOTEL', 'CAFE', 'JAZZ', 'OPEN', 'GAMES', 'DONUTS', 'BOWLING', 'PARTS', 'GAS']
const SIGN_COLS = 4
const SIGN_ROWS = 6
const VSIGN_WORDS = ['HOTEL', 'BAR', 'CLUB', 'ZAP', 'OPEN', 'INN', 'POP', 'EAT']

function signAtlas(scene: Scene, theme: Theme): DynamicTexture {
  const W = 1024, H = 576
  const tex = new DynamicTexture('signAtlas', { width: W, height: H }, scene, true)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.fillStyle = '#05040a'
  ctx.fillRect(0, 0, W, H)
  const cw = W / SIGN_COLS, ch = H / SIGN_ROWS
  SIGN_WORDS.forEach((word, i) => {
    const x = (i % SIGN_COLS) * cw, y = Math.floor(i / SIGN_COLS) * ch
    const col = theme.signColors[i % theme.signColors.length]!
    ctx.save()
    ctx.strokeStyle = col
    ctx.lineWidth = 5
    ctx.shadowColor = col
    ctx.shadowBlur = 12
    ctx.strokeRect(x + 8, y + 8, cw - 16, ch - 16)
    ctx.font = `800 ${word.length > 5 ? 46 : 58}px "Baloo 2", "Arial Black", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.shadowBlur = 18
    ctx.fillText(word, x + cw / 2, y + ch / 2 + 3)
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = col
    ctx.globalAlpha = 0.55
    ctx.fillText(word, x + cw / 2, y + ch / 2 + 3)
    ctx.restore()
  })
  tex.update()
  return tex
}

function verticalAtlas(scene: Scene, theme: Theme): DynamicTexture {
  const n = VSIGN_WORDS.length
  const W = 64 * n, H = 256
  const tex = new DynamicTexture('vsignAtlas', { width: W, height: H }, scene, true)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.fillStyle = '#05040a'
  ctx.fillRect(0, 0, W, H)
  VSIGN_WORDS.forEach((word, i) => {
    const x = i * 64
    const col = theme.signColors[(i + 1) % theme.signColors.length]!
    ctx.save()
    ctx.strokeStyle = col
    ctx.shadowColor = col
    ctx.shadowBlur = 8
    ctx.lineWidth = 4
    ctx.strokeRect(x + 5, 5, 54, H - 10)
    ctx.fillStyle = col
    ctx.font = '800 38px "Baloo 2", "Arial Black", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const step = (H - 30) / word.length
    for (let k = 0; k < word.length; k++) ctx.fillText(word[k]!, x + 32, 18 + step * (k + 0.5))
    ctx.restore()
  })
  tex.update()
  return tex
}

export function buildCity(scene: Scene, track: Track, theme: Theme): City {
  const rng = makeRng(track.seed, 'city')
  const pose = newPose()
  const meshes: Mesh[] = []
  const b = track.bounds
  const M = Config.CITY_MARGIN
  const x0 = b.minX - M, x1 = b.maxX + M, z0 = b.minZ - M, z1 = b.maxZ + M
  const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2
  const rx = (x1 - x0) / 2, rz = (z1 - z0) / 2

  // occupancy on a 4 m grid, so lots never overlap
  const OCC = 4
  const occ = new Set<number>()
  const okey = (i: number, j: number): number => (i + 2000) * 4000 + (j + 2000)
  const cells = (f: Footprint, pad: number): number[] => {
    const out: number[] = []
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw)
    const ex = Math.abs(c) * (f.w / 2 + pad) + Math.abs(s) * (f.d / 2 + pad)
    const ez = Math.abs(s) * (f.w / 2 + pad) + Math.abs(c) * (f.d / 2 + pad)
    for (let i = Math.floor((f.cx - ex) / OCC); i <= Math.floor((f.cx + ex) / OCC); i++)
      for (let j = Math.floor((f.cz - ez) / OCC); j <= Math.floor((f.cz + ez) / OCC); j++) out.push(okey(i, j))
    return out
  }
  const corners = (f: Footprint): [number, number][] => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw)
    const hw = f.w / 2, hd = f.d / 2
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0], [0, hd], [0, -hd], [hw, 0], [-hw, 0]].map(([lx, lz]) =>
      [f.cx + lx * c + lz * s, f.cz - lx * s + lz * c] as [number, number])
  }
  const clearOfRoad = (f: Footprint, min: number): boolean =>
    corners(f).every(([x, z]) => { const n = track.nearest(x, z); return !n || n.d >= min })
  const free = (f: Footprint): boolean => cells(f, 1).every((k) => !occ.has(k))
  const claim = (f: Footprint): void => { for (const k of cells(f, 1)) occ.add(k) }

  // downtown clusters
  const centers = Array.from({ length: 3 }, () => ({
    x: cxm + rng.range(-0.6, 0.6) * rx, z: czm + rng.range(-0.6, 0.6) * rz, r: rng.range(160, 300), k: rng.range(1.4, 2.6),
  }))
  const heightFor = (x: number, z: number, roadside: boolean): number => {
    let h = 9 + 42 * Math.pow(rng(), 1.9)
    let boost = 0
    for (const c of centers) boost = Math.max(boost, c.k * Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r)))
    h *= 1 + boost
    if (rng.chance(0.04)) h += rng.range(40, 90)
    if (roadside) h = Math.max(h, 12)
    return Math.min(h, 230)
  }

  const builder = new MeshBuilder2()
  const bodies = theme.buildings.map(hex)
  const beacons: Vector3[][] = [[], []]
  const signs: { m: Matrix; cell: number; w: number; h: number }[] = []
  const vsigns: { m: Matrix; cell: number }[] = []

  const addBuilding = (f: Footprint, h: number, roadSideFacing: number[] | null): void => {
    let gMin = Infinity, gMax = -Infinity
    for (const [x, z] of corners(f).slice(0, 5)) {
      const g = track.heightAt(x, z)
      gMin = Math.min(gMin, g)
      gMax = Math.max(gMax, g)
    }
    const base = gMin - 4
    const ground = gMax
    const body = bodies[rng.int(0, bodies.length - 1)]!
    const tint = rng.range(0.8, 1.35)
    const color = [body.r * tint, body.g * tint, body.b * tint, rng()]
    const density = rng.range(0.22, 0.78)
    const style = rng.pick([0, 0, 0, 1, 2, 3])
    const uv2 = [density, style]
    const top = ground + h
    if (h > 55 && rng.chance(0.75)) {
      // setback tower
      const t1 = ground + h * rng.range(0.45, 0.6)
      const t2 = ground + h * rng.range(0.72, 0.86)
      builder.box(f.cx, f.cz, f.w, f.d, f.yaw, base, t1, ground, uv2, color)
      builder.box(f.cx, f.cz, f.w * 0.78, f.d * 0.78, f.yaw, t1, t2, ground, uv2, color)
      builder.box(f.cx, f.cz, f.w * 0.55, f.d * 0.55, f.yaw, t2, top, ground, uv2, color)
    } else {
      builder.box(f.cx, f.cz, f.w, f.d, f.yaw, base, top, ground, uv2, color)
    }
    // roof clutter
    const roofTop = top
    if (h < 70) {
      for (let k = rng.int(0, 2); k > 0; k--) {
        const s = rng.range(2, 4)
        const lx = rng.range(-f.w / 4, f.w / 4), lz = rng.range(-f.d / 4, f.d / 4)
        const c = Math.cos(f.yaw), sn = Math.sin(f.yaw)
        builder.box(f.cx + lx * c + lz * sn, f.cz - lx * sn + lz * c, s, s, f.yaw, roofTop, roofTop + rng.range(1.5, 3.5), ground, [0, 0], [color[0]! * 0.8, color[1]! * 0.8, color[2]! * 0.8, 0])
      }
    }
    if (h > 90) {
      const sh = rng.range(12, 30)
      builder.box(f.cx, f.cz, 0.8, 0.8, f.yaw, roofTop, roofTop + sh, ground, [0, 0], [0.25, 0.25, 0.3, 0])
      beacons[rng.int(0, 1)]!.push(new Vector3(f.cx, roofTop + sh + 0.6, f.cz))
    } else if (h > 50) {
      beacons[rng.int(0, 1)]!.push(new Vector3(f.cx, roofTop + 0.8, f.cz))
    }
    // a neon sign on the face toward the road
    if (roadSideFacing && rng.chance(0.55)) {
      const [nx, nz] = roadSideFacing as [number, number]
      const yaw = Math.atan2(-nx, -nz) // plane fronts face -local z; point that along the facade's normal
      const faceDist = (Math.abs(nx * Math.sin(f.yaw) + nz * Math.cos(f.yaw)) > 0.5 ? f.d : f.w) / 2 + 0.25
      const px = f.cx + nx * faceDist, pz = f.cz + nz * faceDist
      const along = [Math.cos(yaw), -Math.sin(yaw)] as const // plane's local x in world
      if (rng.chance(0.3) && h > 16) {
        const sh = Math.min(h - 4, rng.range(9, 14))
        const off = rng.range(-0.3, 0.3) * (f.w - 2)
        const y = ground + 3 + sh / 2 + rng.range(0, Math.max(0, h - sh - 6))
        vsigns.push({
          m: Matrix.Compose(new Vector3(2.4, sh, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(px + along[0] * off, y, pz + along[1] * off)),
          cell: rng.int(0, VSIGN_WORDS.length - 1),
        })
      } else {
        const sw = Math.min(rng.range(6, 10), Math.max(f.w, f.d) - 2)
        const sh2 = sw * 0.36
        const y = ground + rng.range(4.5, Math.max(5, Math.min(h - sh2 - 1, 16)))
        signs.push({
          m: Matrix.Compose(new Vector3(sw, sh2, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(px, y, pz)),
          cell: rng.int(0, SIGN_WORDS.length - 1), w: sw, h: sh2,
        })
      }
    }
  }

  // 1. buildings lining the road, square to it
  const L = track.length
  for (const side of [-1, 1]) {
    let s = rng.range(0, 10)
    while (s < L - 30) {
      const w = rng.range(12, 26) // along the road
      const d = rng.range(12, 24) // away from it
      const gap = rng.range(3, 8)
      const sc = s + w / 2
      if (Math.abs(track.gap(sc, 0)) < 40) { s += w + gap; continue } // keep the gantry clear
      const p = track.poseAt(sc, pose)
      const hl = Math.hypot(p.tx, p.tz) || 1
      const hx = p.tx / hl, hz = p.tz / hl
      const setback = ROAD_HALF + rng.range(8, 13) + d / 2
      // yaw = heading, so the footprint's local x is across the road and local z along it
      const f: Footprint = { cx: p.x + hz * side * setback, cz: p.z - hx * side * setback, w: d, d: w, yaw: Math.atan2(hx, hz) }
      if (!rng.chance(0.08) && clearOfRoad(f, ROAD_HALF + 6) && free(f)) {
        claim(f)
        addBuilding(f, heightFor(f.cx, f.cz, true), [-hz * side, hx * side])
      }
      s += w + gap
    }
  }

  // 2. blocks on the street grid
  for (let bx = Math.floor(x0 / BLOCK); bx <= Math.floor(x1 / BLOCK); bx++) {
    for (let bz = Math.floor(z0 / BLOCK); bz <= Math.floor(z1 / BLOCK); bz++) {
      const ox = bx * BLOCK + STREET + 1.5, oz = bz * BLOCK + STREET + 1.5
      const size = BLOCK - STREET - 3
      const ex = ((ox + size / 2 - cxm) / rx) ** 2 + ((oz + size / 2 - czm) / rz) ** 2
      if (ex > 1.05) continue
      if (rng.chance(0.05)) continue // a park
      const split = rng.pick([1, 2, 2, 4, 4, 4])
      const lots: Footprint[] = []
      if (split === 1) lots.push({ cx: ox + size / 2, cz: oz + size / 2, w: size - 4, d: size - 4, yaw: 0 })
      else if (split === 2) {
        const horiz = rng.chance(0.5)
        for (const k of [0, 1]) {
          const half = size / 2
          lots.push(horiz
            ? { cx: ox + half / 2 + k * half, cz: oz + size / 2, w: half - 3, d: size - 4, yaw: 0 }
            : { cx: ox + size / 2, cz: oz + half / 2 + k * half, w: size - 4, d: half - 3, yaw: 0 })
        }
      } else {
        const half = size / 2
        for (const i of [0, 1]) for (const j of [0, 1]) lots.push({ cx: ox + half / 2 + i * half, cz: oz + half / 2 + j * half, w: half - 3, d: half - 3, yaw: 0 })
      }
      for (const f of lots) {
        f.w *= rng.range(0.75, 1)
        f.d *= rng.range(0.75, 1)
        if (!clearOfRoad(f, ROAD_HALF + 7) || !free(f)) continue
        claim(f)
        const edge = smoothstep(0.6, 1.05, ex)
        addBuilding(f, heightFor(f.cx, f.cz, false) * (1 - 0.5 * edge), null)
      }
    }
  }

  const mat = makeShader(scene, 'building', 'buildingMat')
  mat.setColor3('winWarm', hex(theme.winWarm))
  mat.setColor3('winCool', hex(theme.winCool))
  mat.setColor3('winAccent', hex(theme.winAccent))
  const buildings = builder.build(scene, 'buildings')
  buildings.material = mat
  buildings.isPickable = false
  buildings.freezeWorldMatrix()
  meshes.push(buildings)

  // signs (one merged mesh each for horizontal and vertical)
  const signTex = signAtlas(scene, theme)
  const signMat = new StandardMaterial('signMat', scene)
  signMat.emissiveTexture = signTex
  signMat.diffuseColor = Color3.Black()
  signMat.specularColor = Color3.Black()
  signMat.disableLighting = true
  signMat.backFaceCulling = false
  if (signs.length) {
    const parts = signs.map((sg, i) => {
      const q = MeshBuilder.CreatePlane(`sign${i}`, { size: 1, frontUVs: undefined }, scene)
      const cu = sg.cell % SIGN_COLS, cv = Math.floor(sg.cell / SIGN_COLS)
      const u0 = cu / SIGN_COLS, u1 = (cu + 1) / SIGN_COLS
      const v1 = 1 - cv / SIGN_ROWS, v0 = 1 - (cv + 1) / SIGN_ROWS
      q.setVerticesData('uv', [u0, v0, u1, v0, u1, v1, u0, v1])
      q.bakeTransformIntoVertices(sg.m)
      return q
    })
    const merged = Mesh.MergeMeshes(parts, true, true)
    if (merged) { merged.material = signMat; merged.isPickable = false; meshes.push(merged) }
  }
  const vTex = verticalAtlas(scene, theme)
  const vMat = signMat.clone('vsignMat') as StandardMaterial
  vMat.emissiveTexture = vTex
  if (vsigns.length) {
    const parts = vsigns.map((sg, i) => {
      const q = MeshBuilder.CreatePlane(`vsign${i}`, { size: 1 }, scene)
      const u0 = sg.cell / VSIGN_WORDS.length, u1 = (sg.cell + 1) / VSIGN_WORDS.length
      q.setVerticesData('uv', [u0, 0, u1, 0, u1, 1, u0, 1])
      q.bakeTransformIntoVertices(sg.m)
      return q
    })
    const merged = Mesh.MergeMeshes(parts, true, true)
    if (merged) { merged.material = vMat; merged.isPickable = false; meshes.push(merged) }
  }

  // beacons, in two groups that blink out of step
  const beaconMats: StandardMaterial[] = []
  beacons.forEach((list, g) => {
    if (!list.length) return
    const m = new StandardMaterial(`beaconMat${g}`, scene)
    m.emissiveColor = new Color3(1, 0.1, 0.1)
    m.diffuseColor = Color3.Black()
    m.disableLighting = true
    const s = MeshBuilder.CreateSphere(`beacon${g}`, { diameter: 1.4, segments: 4 }, scene)
    s.material = m
    s.isPickable = false
    const buf = new Float32Array(list.length * 16)
    list.forEach((p, i) => Matrix.Translation(p.x, p.y, p.z).copyToArray(buf, i * 16))
    s.thinInstanceSetBuffer('matrix', buf, 16)
    meshes.push(s)
    beaconMats.push(m)
  })

  return {
    meshes,
    beaconMats,
    dispose() {
      for (const m of meshes) m.dispose(false, true)
      signTex.dispose()
      vTex.dispose()
    },
  }
}
