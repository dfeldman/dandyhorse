/**
 * Low-poly ships, bow toward +x, port toward +z, waterline at y = 0. One lofted hull builder, and a recipe per kind:
 * lit windows and portholes, running lights (red to port, green to starboard, white on the mast), a signal lamp
 * that blinks when the ship hails, and funnel tops for smoke.
 */
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core'
import { makeRng, smoothstep, type Rng } from '../rng.ts'
import type { HullKind } from '../sim/fleet.ts'
import { Kit, Tris, hex, shade, v3, type Rgb } from './kit.ts'

export interface ShipModel {
  root: TransformNode
  /** Bobs, pitches and rolls. */
  body: TransformNode
  signal: Mesh
  signalMat: StandardMaterial
  /** Funnel tops in model space, for smoke. */
  funnels: Vector3[]
  length: number
  beam: number
  /** Where the wake starts (model space). */
  stern: number
}

interface HullOpts { bow: number; sheer: number; transom: number; color: Rgb; bottom: Rgb; deck: Rgb }

/** Half-width of the hull at station s (0 stern … 1 bow), as a share of the half-beam. */
function widthAt(s: number, o: HullOpts): number {
  if (s > 1 - o.bow) {
    const t = (s - (1 - o.bow)) / o.bow
    return Math.max(0.01, Math.pow(Math.cos((t * Math.PI) / 2), 0.8))
  }
  return o.transom + (1 - o.transom) * smoothstep(0, 0.22, s)
}

function hull(len: number, beam: number, fb: number, draft: number, o: HullOpts): Tris {
  const t = new Tris()
  const N = 14
  const rings: Vector3[][] = []
  const decks: number[] = []
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const x = -len / 2 + s * len
    const hw = (beam / 2) * widthAt(s, o)
    const bowT = s > 1 - o.bow ? (s - (1 - o.bow)) / o.bow : 0
    const deck = fb + o.sheer * (2 * s - 1) ** 2 * (s > 0.5 ? 1.4 : 0.6)
    const keel = -draft * (1 - 0.55 * bowT * bowT)
    decks.push(deck)
    rings.push([
      v3(x, deck, hw), v3(x, deck * 0.4, hw * 0.99), v3(x, keel * 0.55, hw * 0.8), v3(x, keel, 0),
      v3(x, keel * 0.55, -hw * 0.8), v3(x, deck * 0.4, -hw * 0.99), v3(x, deck, -hw),
    ])
  }
  const bands = [o.color, o.bottom, shade(o.bottom, 0.8), shade(o.bottom, 0.8), o.bottom, o.color]
  for (let i = 0; i < N; i++) {
    const a = rings[i]!, b = rings[i + 1]!
    const cx = (a[0]!.x + b[0]!.x) / 2
    for (let j = 0; j < 6; j++) {
      const away = v3(cx, (decks[i]! - draft) / 2, 0)
      t.quad(a[j]!, b[j]!, b[j + 1]!, a[j + 1]!, bands[j]!, away)
    }
    t.quad(a[6]!, a[0]!, b[0]!, b[6]!, o.deck, undefined, v3(0, 1, 0))
  }
  // transom
  const r0 = rings[0]!
  const c = v3(r0[0]!.x, (decks[0]! - draft) / 2, 0)
  for (let j = 0; j < 7; j++) t.tri(c, r0[j]!, r0[(j + 1) % 7]!, j === 6 ? o.color : o.color, undefined, v3(-1, 0, 0))
  return t
}

const WARM = '#ffc76a'
const WARM2 = '#ffe0a0'
const COOL = '#cfe6ff'
const WHITE = '#f1ede2'
const DARK = '#2a2c38'

/** Rows of lit windows along both sides of a box-shaped deckhouse. */
function sideWindows(k: Kit, x0: number, x1: number, y: number, halfW: number, step: number, size: [number, number], rng: Rng, color = WARM): void {
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    for (const s of [1, -1]) {
      if (rng() < 0.12) continue
      k.box([size[0], size[1], 0.12], [x, y, s * (halfW + 0.04)], rng() < 0.25 ? WARM2 : color, { glow: true })
    }
  }
}

function frontWindows(k: Kit, x: number, y: number, halfW: number, n: number, size: [number, number], color = WARM, facing = 1): void {
  for (let i = 0; i < n; i++) {
    const z = -halfW + ((i + 0.5) / n) * 2 * halfW
    k.box([0.12, size[1], size[0]], [x + facing * 0.04, y, z], color, { glow: true })
  }
}

function portholes(k: Kit, len: number, beam: number, o: HullOpts, y: number, x0: number, x1: number, step: number, rng: Rng, d = 0.55): void {
  for (let x = x0; x <= x1; x += step) {
    const s = (x + len / 2) / len
    const hw = (beam / 2) * widthAt(s, o) * 0.99
    for (const side of [1, -1]) {
      if (rng() < 0.2) continue
      k.box([d, d, 0.12], [x, y, side * (hw + 0.05)], rng() < 0.3 ? WARM2 : WARM, { glow: true })
    }
  }
}

/** A sagging string of party lights from a to b. */
function lightString(k: Kit, a: Vector3, b: Vector3, n: number, bulb: number): void {
  const colors = ['#ffdf7a', '#ff7a7a', '#7affc0', '#7ab8ff']
  for (let i = 1; i < n; i++) {
    const t = i / n
    const p = Vector3.Lerp(a, b, t)
    p.y -= Math.sin(t * Math.PI) * a.subtract(b).length() * 0.06
    k.sphere(bulb, [p.x, p.y, p.z], colors[i % colors.length]!, { glow: true, seg: 2 })
  }
}

function runningLights(k: Kit, x: number, y: number, halfW: number, mast: [number, number, number], size = 0.7): void {
  k.sphere(size, [x, y, halfW + 0.2], '#ff3a3a', { glow: true, seg: 3 })
  k.sphere(size, [x, y, -halfW - 0.2], '#3aff7a', { glow: true, seg: 3 })
  k.sphere(size * 1.1, mast, '#ffffff', { glow: true, seg: 3 })
}

/** A sail: a flat quad (or triangle) with a little thickness, in the x-y plane, turned `twist` about the mast at px. */
function sail(k: Kit, pts: [number, number][], color: Rgb, px: number, twist = 0): void {
  const t = new Tris()
  const th = 0.09
  const c = Math.cos(twist), sn = Math.sin(twist)
  const at = (x: number, y: number, dz: number): Vector3 => v3(px + (x - px) * c + dz * sn, y, -(x - px) * sn + dz * c)
  const front = pts.map(([x, y]) => at(x, y, th))
  const back = pts.map(([x, y]) => at(x, y, -th))
  const n = at(px, 0, 1).subtract(at(px, 0, 0))
  const tri = (i: number, j: number, l: number): void => {
    t.tri(front[i]!, front[j]!, front[l]!, color, undefined, n)
    t.tri(back[i]!, back[j]!, back[l]!, shade(color, 0.92), undefined, n.scale(-1))
  }
  tri(0, 1, 2)
  if (pts.length === 4) tri(0, 2, 3)
  k.shape(t)
}

const HULLS: Record<HullKind, string[]> = {
  skiff: ['#e8e0d0', '#3a7ab8', '#d85a3a', '#4a9a6a', '#e8c040'],
  packet: ['#1f3a6a', '#2a2a3a', '#6a1f2a', '#1f5a5a'],
  trawler: ['#2a7a6a', '#3a5aa0', '#c04a3a', '#d89a2a'],
  schooner: ['#6a4028', '#2a3a5a', '#1f4a3a', '#7a2a2a'],
  steamer: ['#23263a', '#5a1f2a', '#1f3a2a'],
  freighter: ['#8a2a2a', '#1f3a5a', '#2a4a2a', '#3a3a44', '#c06020'],
  liner: ['#15161f', '#1a2240'],
}

export function buildShip(scene: Scene, kind: HullKind, id: number): ShipModel {
  const rng = makeRng(id, `ship-${kind}`)
  const root = new TransformNode(`ship${id}`, scene)
  const body = new TransformNode(`ship${id}-body`, scene)
  body.parent = root
  const k = new Kit(scene, `ship${id}`)
  const hc = hex(rng.pick(HULLS[kind]))
  const funnels: Vector3[] = []
  let signalAt: [number, number, number] = [0, 5, 0]
  let len = 20, beam = 6

  switch (kind) {
    case 'skiff': {
      len = 9; beam = 3.4
      const fb = 1.2
      const o: HullOpts = { bow: 0.35, sheer: 0.35, transom: 0.6, color: hc, bottom: hex('#8a3a2a'), deck: hex('#b08a5a') }
      k.shape(hull(len, beam, fb, 0.7, o))
      k.box([2.6, 2.2, 2.3], [-1.2, fb + 1.1, 0], WHITE)
      k.box([3, 0.25, 2.7], [-1.2, fb + 2.3, 0], hc)
      frontWindows(k, 0.12, fb + 1.5, 0.9, 2, [0.7, 0.8])
      k.box([1.2, 0.7, 0.12], [-1.2, fb + 1.5, 1.2], WARM, { glow: true })
      k.box([1.2, 0.7, 0.12], [-1.2, fb + 1.5, -1.2], WARM, { glow: true })
      k.cyl(4.2, 0.18, 0.22, [1.8, fb + 2.1, 0], DARK, { tess: 5 })
      k.sphere(0.6, [1.8, fb + 4.3, 0], '#ffe7b0', { glow: true, seg: 3 })
      k.box([2, 0.6, 2.2], [-3.4, fb + 0.3, 0], '#4a8a6a')
      k.sphere(0.8, [2.8, fb + 0.3, 0.9], '#ff8a3a', { seg: 2 })
      runningLights(k, -0.2, fb + 1.8, 1.25, [1.8, fb + 4.3, 0], 0.45)
      signalAt = [-1.2, fb + 2.9, 0]
      break
    }
    case 'packet': {
      len = 16; beam = 4.6
      const fb = 1.8
      const o: HullOpts = { bow: 0.38, sheer: 0.45, transom: 0.7, color: hc, bottom: hex('#b8322a'), deck: hex('#c8b890') }
      k.shape(hull(len, beam, fb, 1.1, o))
      k.box([8, 2.2, 3.4], [-1.2, fb + 1.1, 0], WHITE)
      sideWindows(k, -4.4, 2, fb + 1.2, 1.7, 1.3, [0.8, 0.7], rng)
      k.box([2.8, 1.9, 3], [1.6, fb + 3.15, 0], WHITE)
      frontWindows(k, 3.02, fb + 3.3, 1.2, 3, [0.7, 0.7], COOL)
      k.cyl(3, 1.2, 1.4, [-2.4, fb + 3.7, 0], '#d8342a', { tess: 10 })
      k.cyl(0.7, 1.25, 1.25, [-2.4, fb + 5.4, 0], '#1a1a22', { tess: 10 })
      k.cyl(5.5, 0.18, 0.25, [4.2, fb + 2.8, 0], DARK, { tess: 5 })
      funnels.push(v3(-2.4, fb + 5.8, 0))
      runningLights(k, 1.6, fb + 3.2, 1.5, [4.2, fb + 5.6, 0], 0.55)
      signalAt = [1.6, fb + 4.5, 0]
      portholes(k, len, beam, o, fb * 0.5, -5, 4, 1.6, rng, 0.45)
      break
    }
    case 'trawler': {
      len = 20; beam = 6
      const fb = 2.2
      const o: HullOpts = { bow: 0.36, sheer: 0.9, transom: 0.72, color: hc, bottom: hex('#a8322a'), deck: hex('#8a8a90') }
      k.shape(hull(len, beam, fb, 1.8, o))
      k.box([5, 3, 4.6], [2.4, fb + 1.5, 0], WHITE)
      k.box([3.6, 2.2, 4], [2.8, fb + 4.1, 0], WHITE)
      k.box([4.2, 0.3, 4.6], [2.8, fb + 5.3, 0], hc)
      frontWindows(k, 4.62, fb + 4.2, 1.8, 3, [0.9, 0.9], COOL)
      sideWindows(k, 1.2, 3.6, fb + 1.8, 2.3, 1.2, [0.7, 0.7], rng)
      k.cyl(8, 0.25, 0.32, [5.6, fb + 4, 0], DARK, { tess: 5 })
      k.box([0.2, 0.2, 4], [5.6, fb + 6.5, 0], DARK)
      k.cyl(2.8, 0.8, 0.9, [0.4, fb + 4.2, 1.4], '#1a1a22', { tess: 8 })
      funnels.push(v3(0.4, fb + 5.7, 1.4))
      for (const s of [1, -1]) k.cyl(6, 0.35, 0.45, [-8.4, fb + 3, s * 2.4], '#e0a020', { tess: 5, rot: [s * 0.12, 0, 0.1] })
      k.box([0.4, 0.4, 5.4], [-8.1, fb + 6, 0], '#e0a020')
      k.cyl(4, 2.2, 2.2, [-4.8, fb + 1.2, 0], '#e8702a', { rot: [Math.PI / 2, 0, 0], tess: 10 })
      k.sphere(0.9, [-8.1, fb + 6.4, 1.6], '#ffffff', { glow: true, seg: 3 })
      k.sphere(0.9, [-8.1, fb + 6.4, -1.6], '#ffffff', { glow: true, seg: 3 })
      runningLights(k, 2.8, fb + 4.8, 2.1, [5.6, fb + 8.1, 0], 0.6)
      signalAt = [2.8, fb + 6, 0]
      portholes(k, len, beam, o, fb * 0.55, -6, 6, 2.2, rng, 0.5)
      break
    }
    case 'schooner': {
      len = 28; beam = 7
      const fb = 2
      const o: HullOpts = { bow: 0.32, sheer: 1.3, transom: 0.58, color: hc, bottom: hex('#2e2e36'), deck: hex('#c9a878') }
      k.shape(hull(len, beam, fb, 2.4, o))
      k.cyl(9, 0.3, 0.45, [len / 2 + 3, fb + 1.8, 0], '#6a4a2a', { tess: 5, rot: [0, 0, -Math.PI / 2 + 0.18] })
      const fore = 5, main = -4
      k.cyl(20, 0.4, 0.65, [fore, fb + 10, 0], '#7a5a3a', { tess: 6 })
      k.cyl(24, 0.4, 0.7, [main, fb + 12, 0], '#7a5a3a', { tess: 6 })
      const cream = hex('#f2ead8')
      sail(k, [[fore - 0.4, fb + 2.2], [fore - 8.5, fb + 2.2], [fore - 7.5, fb + 14.5], [fore - 0.4, fb + 17.5]], cream, fore, 0.22)
      sail(k, [[main - 0.4, fb + 2.2], [main - 10.5, fb + 2.2], [main - 9, fb + 17.5], [main - 0.4, fb + 21.5]], cream, main, 0.22)
      sail(k, [[fore + 0.6, fb + 17], [len / 2 + 7, fb + 3.5], [fore + 1.2, fb + 2.2]], shade(cream, 0.97), fore, -0.1)
      k.box([5.2, 1.7, 3.6], [-9, fb + 0.85, 0], '#8a6a4a')
      sideWindows(k, -10.6, -7.4, fb + 1, 1.8, 1.6, [0.8, 0.6], rng)
      for (const z of [-1.6, 0, 1.6]) k.box([0.12, 0.8, 0.9], [-len / 2 - 0.06, fb * 0.75, z], WARM, { glow: true })
      k.sphere(0.8, [fore, fb + 9, 0.5], '#ffdc9a', { glow: true, seg: 3 })
      k.sphere(0.8, [main, fb + 10, 0.5], '#ffdc9a', { glow: true, seg: 3 })
      runningLights(k, 8, fb + 1.6, 2.8, [main, fb + 24.2, 0], 0.7)
      signalAt = [fore, fb + 20.5, 0]
      lightString(k, v3(len / 2 + 7, fb + 3.2, 0), v3(fore, fb + 19.5, 0), 9, 0.45)
      break
    }
    case 'steamer': {
      len = 32; beam = 7
      const fb = 2.4
      const o: HullOpts = { bow: 0.26, sheer: 0.5, transom: 0.7, color: hc, bottom: hex('#b8322a'), deck: hex('#c8b890') }
      k.shape(hull(len, beam, fb, 1.6, o))
      k.box([22, 2.8, 6.6], [-1, fb + 1.4, 0], WHITE)
      sideWindows(k, -11, 9, fb + 1.5, 3.3, 1.8, [1, 1], rng)
      k.box([15, 2.4, 5.2], [-2, fb + 4, 0], WHITE)
      sideWindows(k, -8.5, 4.5, fb + 4.1, 2.6, 1.9, [1, 0.9], rng)
      k.box([3.4, 2.3, 3.8], [6, fb + 6.35, 0], WHITE)
      frontWindows(k, 7.72, fb + 6.5, 1.6, 3, [0.9, 0.9], COOL)
      for (const s of [1, -1]) {
        k.cyl(1.8, 8, 8, [-1, fb - 0.4, s * (beam / 2 + 0.9)], '#c43a3a', { rot: [Math.PI / 2, 0, 0], tess: 14 })
        k.cyl(1.9, 5, 5, [-1, fb - 0.4, s * (beam / 2 + 0.95)], '#f0e8d8', { rot: [Math.PI / 2, 0, 0], tess: 14 })
      }
      k.cyl(10, 2.1, 2.3, [-1.5, fb + 9.8, 0], '#1a1a22', { tess: 12 })
      k.cyl(1.6, 2.35, 2.35, [-1.5, fb + 12.6, 0], '#d8342a', { tess: 12 })
      funnels.push(v3(-1.5, fb + 14.9, 0))
      k.cyl(13, 0.25, 0.35, [11.5, fb + 6.5, 0], DARK, { tess: 5 })
      k.cyl(10, 0.25, 0.35, [-12, fb + 5, 0], DARK, { tess: 5 })
      lightString(k, v3(len / 2 + 0.5, fb + 1.6, 0), v3(11.5, fb + 12.8, 0), 8, 0.5)
      lightString(k, v3(11.5, fb + 12.8, 0), v3(-12, fb + 9.8, 0), 14, 0.5)
      lightString(k, v3(-12, fb + 9.8, 0), v3(-len / 2, fb + 1.2, 0), 7, 0.5)
      runningLights(k, 6, fb + 7.6, 1.9, [11.5, fb + 13.2, 0], 0.7)
      signalAt = [6, fb + 8.2, 0]
      break
    }
    case 'freighter': {
      len = 46; beam = 10
      const fb = 3.4
      const o: HullOpts = { bow: 0.22, sheer: 0.9, transom: 0.82, color: hc, bottom: hex('#b83a2a'), deck: hex('#6a6a72') }
      k.shape(hull(len, beam, fb, 3.2, o))
      k.box([7, 9, 9.4], [-16, fb + 4.5, 0], WHITE)
      k.box([3, 0.6, 12.4], [-13.4, fb + 8.8, 0], WHITE)
      for (let f = 0; f < 3; f++) {
        frontWindows(k, -12.45, fb + 1.6 + f * 2.5, 4, 6, [0.9, 0.9], WARM)
        sideWindows(k, -18.6, -13.4, fb + 1.6 + f * 2.5, 4.7, 1.7, [0.9, 0.8], rng)
      }
      frontWindows(k, -11.85, fb + 9.7, 5.6, 8, [1, 0.8], COOL)
      k.box([2.6, 1.5, 12.2], [-13.2, fb + 9.7, 0], WHITE)
      const band = rng.pick(['#e8b83a', '#3a8ad8', '#d83a3a', '#3ac88a'])
      k.cyl(5.5, 3, 3.3, [-19, fb + 11.8, 0], '#e8e4dc', { tess: 10 })
      k.cyl(1.3, 3.1, 3.1, [-19, fb + 13.4, 0], band, { tess: 10 })
      funnels.push(v3(-19, fb + 14.6, 0))
      const cols = ['#d84a3a', '#3a7ad8', '#e8b83a', '#3aa86a', '#e87a2a', '#8a5ac8', '#e8e8e8']
      for (const bx of [13, 4.5, -4]) {
        for (const bz of [-3.1, 0, 3.1]) {
          const tiers = rng.int(1, 3)
          for (let t = 0; t < tiers; t++) k.box([7.8, 2.5, 2.9], [bx, fb + 1.25 + t * 2.55, bz], rng.pick(cols))
        }
      }
      k.box([6, 1.6, 9], [len / 2 - 4.5, fb + 0.8, 0], hc)
      for (const cx of [17.5, 0]) {
        k.cyl(9, 0.8, 1, [cx, fb + 4.5, 4.2], '#e0b030', { tess: 6 })
        k.box([12, 0.6, 0.6], [cx - 4.5, fb + 7.5, 3], '#e0b030', { rot: [0, 0.35, 0.3] })
      }
      k.cyl(7, 0.3, 0.4, [len / 2 - 5, fb + 5, 0], DARK, { tess: 5 })
      for (let x = -8; x <= 18; x += 6.5) k.sphere(0.6, [x, fb + 8.5, 0], '#fff2c8', { glow: true, seg: 2 })
      runningLights(k, -13.4, fb + 9.2, 6.2, [len / 2 - 5, fb + 8.7, 0], 0.9)
      signalAt = [-16, fb + 11.4, 0]
      portholes(k, len, beam, o, fb * 0.6, -21, -11, 2, rng, 0.6)
      break
    }
    case 'liner': {
      len = 64; beam = 12
      const fb = 7
      const o: HullOpts = { bow: 0.2, sheer: 1.2, transom: 0.72, color: hc, bottom: hex('#b8322a'), deck: hex('#d8d0c0') }
      k.shape(hull(len, beam, fb, 4, o))
      // the white band at the top of the hull
      k.box([len * 0.62, 1.2, beam + 0.3], [-3, fb - 0.5, 0], WHITE)
      k.box([46, 3, 10.6], [-3, fb + 1.5, 0], WHITE)
      k.box([37, 3, 9.8], [-5, fb + 4.5, 0], WHITE)
      k.box([27, 2.8, 8.8], [-6, fb + 7.4, 0], WHITE)
      k.box([5, 2.6, 11.4], [13, fb + 7.4, 0], WHITE)
      sideWindows(k, -25, 19, fb + 1.6, 5.3, 1.6, [1, 1], rng)
      sideWindows(k, -22, 12.5, fb + 4.6, 4.9, 1.7, [1, 1], rng)
      sideWindows(k, -18, 6.5, fb + 7.5, 4.4, 2, [1, 0.9], rng)
      frontWindows(k, 15.55, fb + 7.6, 5, 7, [1.1, 0.9], COOL)
      frontWindows(k, 19.55, fb + 1.6, 4.8, 8, [0.9, 0.9], WARM)
      portholes(k, len, beam, o, fb * 0.55, -28, 26, 1.8, rng, 0.6)
      portholes(k, len, beam, o, fb * 0.25, -26, 24, 2.2, rng, 0.55)
      for (const fx of [8, -3, -14]) {
        k.cyl(10, 3.3, 3.8, [fx, fb + 13.5, 0], '#d8342a', { tess: 12 })
        k.cyl(2, 3.35, 3.35, [fx, fb + 17.5, 0], '#15161f', { tess: 12 })
        funnels.push(v3(fx, fb + 18.6, 0))
      }
      for (let x = -20; x <= 12; x += 5) for (const s of [1, -1]) k.box([3.4, 1.2, 1.4], [x, fb + 9.4, s * 4.6], '#f4f0e8')
      k.cyl(18, 0.35, 0.5, [24, fb + 9, 0], DARK, { tess: 5 })
      k.cyl(15, 0.35, 0.5, [-24, fb + 7.5, 0], DARK, { tess: 5 })
      lightString(k, v3(len / 2 + 0.5, fb + 1.8, 0), v3(24, fb + 17.8, 0), 9, 0.7)
      lightString(k, v3(24, fb + 17.8, 0), v3(-24, fb + 14.8, 0), 26, 0.7)
      lightString(k, v3(-24, fb + 14.8, 0), v3(-len / 2, fb + 1.6, 0), 8, 0.7)
      runningLights(k, 13, fb + 8.8, 5.9, [24, fb + 18.3, 0], 1.1)
      signalAt = [13, fb + 9.6, 0]
      break
    }
  }

  k.build(body)
  const signalMat = new StandardMaterial(`signal${id}`, scene)
  signalMat.disableLighting = true
  signalMat.emissiveColor = new Color3(1, 0.95, 0.75)
  const signal = MeshBuilder.CreateSphere(`signal${id}`, { diameter: 1.3 + len * 0.012, segments: 6 }, scene)
  signal.material = signalMat
  signal.parent = body
  signal.position.set(signalAt[0], signalAt[1], signalAt[2])
  signal.isPickable = false
  signal.setEnabled(false)
  return { root, body, signal, signalMat, funnels, length: len, beam, stern: -len / 2 }
}
