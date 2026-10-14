/**
 * A vehicle body from a spec: cross-section rings swept from the tail to the nose.
 *
 * Every ring has the same sixteen points, in the same order, so neighbouring rings join with quads and the
 * whole body is one closed tube. Where a feature is absent the points collapse onto each other — over the
 * bonnet there is no glasshouse, so its three points sit on the bonnet's edge and the quads between them
 * have no area and are dropped. That is what lets one generator do a hatchback, a pickup and a bus: they
 * differ only in where the rings are and how high each line runs at each ring.
 *
 *              gL ____________ gR          g  roof edge          d  top of the body side
 *          fL /                \ fR        f  top of the glass    c  shoulder (d less a chamfer)
 *          eL|      glass       |eR        e  foot of the glass   b  bottom of the side (the sill, or the arch)
 *        dL /                    \ dR                             a2 top of the wheel well's inner wall
 *        cL|       body side      |cR                             a  the floor, inboard of the wheels
 *        bL|__ a2L        a2R ____|bR
 *               |__aL____aR__|
 *
 * The lines along the car (pieces of straight line between "knots") are: the belt `yB` (bonnet, beltline,
 * boot lid), the roof `yT`, the half width `w`, and the side's lower edge, which follows the sill except over
 * each wheel, where it climbs round a six-sided arch. The creases where the lines bend ARE the low-poly look;
 * nothing is smoothed.
 *
 * Faces are coloured by what they are, through their role (builder.ts): paint, the second paint (roof and
 * pillars), glass, the dark wheel wells. Lamps, bumpers, mirrors and livery furniture are chamfered boxes
 * pushed through the surface, the way the toy-like reference cars are built.
 */
import { sanitize, type CarSpec, type Rgb } from '../spec.ts'
import { Builder, Role, type RoleId, type V3 } from './builder.ts'

export interface WheelSlot {
  /** centre, in the vehicle frame, at rest on flat ground */
  x: number
  y: number
  z: number
  radius: number
  width: number
  steers: boolean
  /** −1 left, +1 right */
  side: -1 | 1
}

export interface CarLayout {
  spec: CarSpec
  wheels: WheelSlot[]
  wheelbase: number
  /** distance between the left and right wheel centres */
  track: number
  frontAxleZ: number
  rearAxleZ: number
  /** the body's extent, mirrors and roof furniture included */
  min: V3
  max: V3
  /** the most the front wheels turn, radians (the inside wheel; see pose.ts for Ackermann) */
  maxSteer: number
}

const DARK: Rgb = [0.13, 0.13, 0.14]
const TRIM: Rgb = [0.18, 0.18, 0.19]
const BED: Rgb = [0.2, 0.2, 0.21]
const PLATE: Rgb = [0.92, 0.92, 0.88]
const HEAD: Rgb = [0.93, 0.93, 0.88]
const TAIL: Rgb = [0.55, 0.06, 0.06]
const AMBER: Rgb = [0.9, 0.5, 0.08]
const REVERSE: Rgb = [0.85, 0.85, 0.85]
const SIGN: Rgb = [0.95, 0.9, 0.7]
const STRIPE: Rgb = [0.85, 0.12, 0.1]

type Knot = [z: number, y: number]

/** A piecewise-linear line along the car; outside its knots it holds the end values. Knots by decreasing z. */
function line(knots: Knot[]): (z: number) => number {
  return (z: number): number => {
    if (z >= knots[0][0]) return knots[0][1]
    for (let i = 0; i < knots.length - 1; i++) {
      const [z0, y0] = knots[i]
      const [z1, y1] = knots[i + 1]
      if (z <= z0 && z >= z1) return z0 - z1 < 1e-9 ? y1 : y0 + ((z - z0) / (z1 - z0)) * (y1 - y0)
    }
    return knots[knots.length - 1][1]
  }
}

/** Keep knots strictly ordered front to back, at least `gap` apart, never past `floor`. */
function ordered(zs: number[], gap: number, floor: number): number[] {
  const out = [...zs]
  for (let i = 1; i < out.length; i++) out[i] = Math.max(floor, Math.min(out[i], out[i - 1] - gap))
  return out
}

interface Station { z: number; side: number; well: number; tie: number }

export function buildBody(input: CarSpec): { body: Builder; layout: CarLayout } {
  const s = sanitize(input)
  const out = new Builder()
  const L = s.length, W = s.width, H = s.height
  const w = W / 2
  const R = s.wheelRadius
  const Ra = R * 1.1
  const wb = s.wheelbase
  const zFA = wb / 2, zRA = -wb / 2
  const zF = zFA + s.frontOverhang
  const zR = zF - L
  const yF = s.clearance
  const big = H > 2.6       // buses and trucks: squarer corners, chunkier lamps
  const scale = Math.min(1.4, W / 1.8)
  const ch = 0.07 * scale                       // shoulder chamfer
  const rc = (big ? 0.12 : 0.07) * scale        // roof edge chamfer
  const lip = 0.025
  const noseCh = big ? 0.12 : 0.24
  const tailCh = big ? 0.1 : 0.18
  // cars get a body-colour front and back with a dark intake; vans, trucks and buses keep black bumpers
  const car = !big && s.archetype !== 'van' && s.archetype !== 'pickup'
  // the side bulges: widest a little below the shoulder, tucked in at the sill
  const tuck = (big ? 0.02 : 0.045) * scale
  // the roof and bonnet are crowned, not flat: a ridge down the middle catches the light
  const crown = (big ? 0.025 : 0.04) * scale
  // fender flares over the wheels
  const flare = ({ coupe: 0.05, suv: 0.035, pickup: 0.03, hatchback: 0.025, sedan: 0.02 } as Record<string, number>)[s.archetype] ?? 0
  const school = s.archetype === 'schoolbus'
  const wIn = w - s.wheelWidth * (s.tail === 'cargo' || s.archetype === 'bus' || school ? 1.5 : 1) - 0.06
  const sill = yF + 0.05
  const cargo = s.tail === 'cargo'

  // ---- where things are along the car, front to back --------------------------------------------------
  const zMin = zR + tailCh + 0.05
  let [ws0, ws1, re] = ordered([zF - s.hoodLength, zF - s.hoodLength - s.windscreenRake,
    zF - s.hoodLength - s.windscreenRake - s.cabinLength], 0.05, zMin)
  ws0 = Math.min(ws0, zF - 0.02)
  let rw1 = re
  if (s.tail === 'notch' || s.tail === 'fast' || s.tail === 'hatch') {
    rw1 = Math.max(re - s.rearRake, s.tail === 'hatch' ? zR + 0.1 : zR + 0.3)
    if (rw1 >= re - 0.05) { re = Math.max(rw1 + 0.05, re); }
  }
  const deck = s.deckHeight
  const beltH = s.beltHeight
  /*
   * A BOX TRUCK's cab is lower than its box (owner, 2026-10-01: "the whole front is a windshield, that's not how trucks
   * look"). The cab used to rise to the box's own height, so its windscreen ran from the beltline up 2 m to the top of
   * the box. Its roof is now about three quarters of the box (2.3–2.7 m), and the box stands above it behind.
   */
  const cabH = cargo ? Math.min(H - 0.45, Math.max(2.3, H * 0.74)) : H

  // the belt: bonnet, beltline, then whatever the tail does
  const beltKnots: Knot[] = [[zF, s.noseHeight - (big ? 0.04 : 0.08)], [zF - noseCh * 0.4, s.noseHeight - 0.015],
    [zF - noseCh, s.noseHeight], [ws0, beltH], [re, beltH]]
  // the roof: rises up the windscreen from the bonnet, then the tail's own shape; −∞ where there is no roof
  const roofKnots: Knot[] = [[ws0, beltH], [ws1, cabH]]
  let roofEnd = re
  switch (s.tail) {
    case 'notch':
    case 'fast':
      roofKnots.push([re, H], [rw1, deck])
      beltKnots.push([rw1, deck], [zR + tailCh, deck], [zR + tailCh * 0.4, deck - 0.02], [zR, deck - 0.07])
      roofEnd = rw1
      break
    case 'hatch':
      roofKnots.push([re, H], [rw1, deck])
      beltKnots.push([rw1, deck], [zR, deck - 0.05])
      roofEnd = rw1
      break
    case 'box': {
      const top = zR + Math.max(s.rearRake, 0.04)
      roofKnots.push([top, H], [zR, H - s.rearRake * 0.8])
      beltKnots.push([zR, beltH])
      roofEnd = zR
      break
    }
    case 'bed':
      roofKnots.push([re, H])
      beltKnots.push([re - 0.01, deck], [zR + tailCh, deck], [zR, deck - 0.04])
      break
    case 'cargo':
      roofKnots.push([re, cabH])
      break
  }
  const yB = line(beltKnots)
  const roofLine = line(roofKnots)
  const zBack = cargo ? re : zR
  const yT = (z: number): number => (z > ws0 || z < roofEnd - 1e-6 ? yB(z) : Math.max(yB(z), roofLine(z)))
  const noseIn = (big ? 0.035 : 0.09) * W
  const tailIn = (big ? 0.03 : 0.06) * W
  const baseW = line([[zF, w - noseIn], [zF - noseCh * 0.4, w - noseIn * 0.3], [zF - noseCh, w], [zBack + tailCh, w],
    [zBack + tailCh * 0.4, w - tailIn * 0.3], [zBack, w - tailIn]])
  const flareAt = (z: number): number => {
    let f = 0
    for (const za of cargo ? [zFA] : [zFA, zRA]) f = Math.max(f, flare * Math.max(0, Math.min(1, (Ra * 1.7 - Math.abs(z - za)) / (Ra * 0.5))))
    return f
  }
  const halfW = (z: number): number => baseW(z) + flareAt(z)

  // ---- the side windows, and the pillars between them ----------------------------------------------------
  const windowEnd = s.tail === 'box' ? zR + Math.max(s.rearRake, 0.04) + (big ? 0.25 : 0.18) : re
  const pillar = school ? 0.16 : big ? 0.14 : 0.09
  const windows: [number, number][] = []
  {
    const n = Math.max(1, s.sideWindows)
    const span = ws1 - windowEnd
    const each = (span - (n + 1) * pillar) / n
    if (each > 0.15) {
      for (let i = 0; i < n; i++) {
        const top = ws1 - pillar * (i === 0 ? 0.5 : 1) - i * (each + pillar)
        windows.push([top, top - each])
      }
    }
  }
  const glassAllowed = (i: number): boolean => s.sideGlass === 'full' || (s.sideGlass === 'front' && i === 0)

  // ---- stations: every z where some line bends ------------------------------------------------------------
  const keys = new Set<number>([zF, zF - noseCh * 0.4, zF - noseCh, ws0, ws1, re, zBack + tailCh, zBack + tailCh * 0.4, zBack])
  if (flare > 0) for (const za of cargo ? [zFA] : [zFA, zRA]) for (const d of [-1.7, -1.2, 1.2, 1.7]) keys.add(za + d * Ra)
  if (rw1 !== re) keys.add(rw1)
  if (s.tail === 'box') keys.add(zR + Math.max(s.rearRake, 0.04))
  if (s.tail === 'bed') keys.add(re - 0.01)
  for (const [a, b] of windows) { keys.add(a); keys.add(b) }
  const axles = cargo ? [zFA] : [zFA, zRA]
  // the side's lower edge: the sill, a little chin at each end, and an arch over each axle
  const sillAt = line([[zF, sill + 0.08], [zF - noseCh, sill], [zBack + tailCh, sill], [zBack, sill + 0.06]])
  const ARCH = 6
  const archAt = (za: number, z: number): number => {
    // the arch is the polygon through the points at θ = kπ/6; interpolate along its edges
    const t = Math.acos(Math.max(-1, Math.min(1, (z - za) / Ra)))
    const k = Math.min(ARCH - 1, Math.floor(t / (Math.PI / ARCH)))
    const t0 = (k * Math.PI) / ARCH, t1 = ((k + 1) * Math.PI) / ARCH
    const z0 = za + Ra * Math.cos(t0), z1 = za + Ra * Math.cos(t1)
    const y0 = R + Ra * Math.sin(t0), y1 = R + Ra * Math.sin(t1)
    return y0 + ((z - z0) / (z1 - z0)) * (y1 - y0)
  }
  const stations: Station[] = []
  const inArch = (z: number): number | undefined => axles.find((za) => Math.abs(z - za) < Ra - 1e-6)
  for (const z of keys) {
    if (z > zF + 1e-9 || z < zBack - 1e-9) continue
    const za = inArch(z)
    if (za === undefined) stations.push({ z, side: sillAt(z), well: yF, tie: 0 })
    else { const y = archAt(za, z); stations.push({ z, side: y, well: y, tie: 0 }) }
  }
  for (const za of axles) {
    stations.push({ z: za - Ra, side: sillAt(za - Ra), well: yF, tie: -1 })
    stations.push({ z: za + Ra, side: sillAt(za + Ra), well: yF, tie: 1 })
    for (let k = 0; k <= ARCH; k++) {
      const t = (k * Math.PI) / ARCH
      const y = R + Ra * Math.sin(t)
      stations.push({ z: za + Ra * Math.cos(t), side: y, well: y, tie: 0 })
    }
  }
  stations.sort((a, b) => a.z - b.z || a.tie - b.tie)
  // drop near-duplicates that would only make slivers (but keep the deliberate same-z arch pairs)
  const st: Station[] = []
  for (const x of stations) {
    const prev = st[st.length - 1]
    if (prev && Math.abs(prev.z - x.z) < 1e-4 && Math.abs(prev.side - x.side) < 1e-4) continue
    st.push(x)
  }

  // ---- rings ------------------------------------------------------------------------------------------
  const ring = (x: Station): V3[] => {
    const z = x.z
    const hw = halfW(z)
    const b = yB(z)
    const t = yT(z)
    const wD = hw - ch
    const side = Math.min(x.side, b - ch * 0.5)
    const well = Math.min(x.well, side)
    const shoulder = Math.max(side, b - ch)
    const mid = side + (shoulder - side) * 0.42
    const hG = Math.max(0, t - b)
    const k = Math.min(1, hG / Math.max(0.2, H - beltH))
    const e: [number, number] = [wD - 0.02 * k, b + Math.min(lip, hG)]
    const f: [number, number] = [wD - s.tumblehome * k, b + Math.max(Math.min(lip, hG), hG - rc * k)]
    // the crown: over the roof the edges drop (the spec height is the ridge); over the bonnet the ridge rises
    const g: [number, number] = [wD - s.tumblehome * k - rc * k, t - crown * k]
    const top = t + crown * (1 - k)
    const bx = hw - tuck, cx = hw - 0.012
    return [
      [-wIn, yF, z], [wIn, yF, z], [wIn, well, z], [bx, side, z], [hw, mid, z], [cx, shoulder, z], [wD, b, z],
      [e[0], e[1], z], [f[0], f[1], z], [g[0], g[1], z], [0, top, z], [-g[0], g[1], z], [-f[0], f[1], z],
      [-e[0], e[1], z], [-wD, b, z], [-cx, shoulder, z], [-hw, mid, z], [-bx, side, z], [-wIn, well, z],
    ]
  }
  /** what each segment of the ring is, in ring order */
  const SEG = ['floor', 'well', 'well', 'side', 'side', 'side', 'side', 'glass', 'chamfer', 'top', 'top', 'chamfer',
    'glass', 'side', 'side', 'side', 'side', 'well', 'well'] as const
  const rings = st.map(ring)

  const topRole = (z: number): RoleId => {
    if (z > ws0) return Role.PAINT
    if (z > ws1) return Role.GLASS
    if (s.tail === 'bed' && z < re) return Role.FIXED
    if (z > re || s.tail === 'box') return Role.PAINT2
    if (z > rw1) return Role.GLASS
    return Role.PAINT
  }
  const glassRole = (z: number): RoleId => {
    if (z > ws1 || z < windowEnd) return Role.PAINT2
    for (let i = 0; i < windows.length; i++) {
      const [a, b] = windows[i]
      if (z < a && z > b) return glassAllowed(i) ? Role.GLASS : Role.PAINT
    }
    return s.sideGlass === 'full' || z > (windows[0]?.[1] ?? ws1) ? Role.PAINT2 : Role.PAINT
  }
  const segRole = (seg: number, r: number): RoleId => {
    if (seg < 0) return Role.PAINT          // the end caps
    const zm = (st[r].z + st[r + 1].z) / 2
    switch (SEG[seg]) {
      case 'floor': case 'well': return Role.FIXED
      case 'glass': return glassRole(zm)
      // the roof's edge chamfer, in the roof's colour wherever there is a roof
      case 'chamfer': return zm <= ws1 && zm >= Math.max(roofEnd, s.tail === 'bed' ? re : -Infinity) ? Role.PAINT2 : Role.PAINT
      case 'top': return topRole(zm)
      default: return Role.PAINT
    }
  }
  // FIXED faces in the sweep (the wheel wells, the floor, a pickup's bed) take the dark trim colour
  out.sweep(rings, segRole, DARK)

  // ---- boxes: lamps, bumpers, mirrors, plates --------------------------------------------------------------
  const sides = [-1, 1] as const
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, role: RoleId,
               colour: Rgb = DARK, bevel = 0): void => {
    out.box([Math.min(x0, x1), y0, z0], [Math.max(x0, x1), y1, z1], role, colour, bevel)
  }
  const wF = halfW(zF)
  const noseTop = yB(zF)
  // headlamps: slim slits in the upper nose that wrap round the corner (on a bus or truck, square, low down)
  const lampH = (big ? 0.16 : car ? 0.075 : 0.1) * scale
  const headY = big ? yF + 0.45 : noseTop - 0.05 - lampH
  const bumperTop = yF + (big ? 0.32 : car ? 0.2 : 0.16) * Math.max(1, scale * 0.9)
  const zC = zF - noseCh * 0.4
  for (const sd of sides) {
    box(sd * wF * 0.42, sd * wF * 0.995, headY, headY + lampH, zF - 0.12, zF + 0.012, Role.HEAD, HEAD, 0.01)
    if (!big) {
      // the wrap: a short return along the wing
      box(sd * (halfW(zC) - 0.03), sd * (halfW(zC) + 0.006), headY + lampH * 0.15, headY + lampH, zC - 0.16, zC + 0.02,
        Role.HEAD, HEAD)
    }
    // indicators in the bumper's outer corners on a car, beside the lamps on anything bigger
    if (car) box(sd * wF * 0.74, sd * wF * 0.93, bumperTop - 0.06, bumperTop - 0.02, zF - 0.1, zF + 0.055,
      sd < 0 ? Role.IND_L : Role.IND_R, AMBER)
    else box(sd * wF * 0.87, sd * wF * 0.97, headY - lampH * 0.65, headY - 0.01, zF - 0.1, zF + 0.012,
      sd < 0 ? Role.IND_L : Role.IND_R, AMBER)
  }
  if (car) {
    // a body-colour bumper, a slim grille between the lamps, a wide dark intake and a lip below it
    box(-(wF + 0.012), wF + 0.012, yF + 0.03, bumperTop, zF - 0.28, zF + 0.04, Role.PAINT, DARK, 0.035)
    box(-wF * 0.36, wF * 0.36, headY + 0.012, headY + lampH - 0.008, zF - 0.1, zF + 0.01, Role.FIXED, TRIM)
    box(-wF * 0.58, wF * 0.58, yF + 0.07, bumperTop - 0.05, zF - 0.1, zF + 0.048, Role.FIXED, TRIM, 0.015)
    box(-(wF - 0.04), wF - 0.04, yF - 0.015, yF + 0.04, zF - 0.3, zF + 0.035, Role.FIXED, DARK)
    box(-0.22, 0.22, bumperTop - 0.17, bumperTop - 0.07, zF + 0.048, zF + 0.06, Role.FIXED, PLATE)
  } else {
    // a pickup's grille is a big square truck grille; a van's or a bus's is a band between the lamps
    const tall = s.archetype === 'pickup'
    box(-wF * (tall ? 0.42 : 0.44), wF * (tall ? 0.42 : 0.44), tall ? bumperTop + 0.02 : headY + 0.01,
      Math.min(headY + lampH, noseTop - 0.04) - (tall ? 0 : 0.01), zF - 0.08, zF + 0.008, Role.FIXED, TRIM)
    box(-(wF + 0.015), wF + 0.015, yF - 0.02, bumperTop, zF - 0.3, zF + 0.05, Role.FIXED, TRIM, 0.03)
    box(-0.24, 0.24, yF + 0.04, yF + 0.04 + 0.11, zF + 0.05, zF + 0.065, Role.FIXED, PLATE)
  }
  // side repeaters on the front wings
  for (const sd of sides) {
    const zr = Math.min(zF - noseCh - 0.05, zFA + Ra + 0.12)
    const yr = Math.max(archAt(zFA, zFA) + 0.04, yB(zr) - ch - 0.1)
    if (yr < yB(zr) - ch) box(sd * (halfW(zr) - 0.01), sd * (halfW(zr) + 0.012), yr, yr + 0.035, zr - 0.06, zr,
      sd < 0 ? Role.IND_L : Role.IND_R, AMBER)
  }
  // mirrors, at the foot of the windscreen
  const mz = Math.min(ws0 - 0.08, zF - 0.2)
  const mh = big ? 0.32 : 0.1
  const my = big ? H * 0.62 : beltH + 0.02
  for (const sd of sides) {
    box(sd * (halfW(mz) - 0.05), sd * (halfW(mz) + (big ? 0.24 : 0.13)), my, my + mh, mz - (big ? 0.12 : 0.14), mz,
      Role.PAINT2, DARK, big ? 0.015 : 0.025)
  }

  // the tail
  const tailZ = cargo ? zR : zBack
  const tailTop = cargo ? Math.max(deck, R * 2 + 0.12) + 0.3 : yB(zR)
  const wR = cargo ? w - 0.02 : halfW(zR)
  const tallTail = s.tail === 'box' || cargo
  const rearBumperTop = cargo ? yF + 0.22 : bumperTop
  for (const sd of sides) {
    if (tallTail) {
      const y0 = cargo ? Math.max(deck, R * 2 + 0.12) + 0.05 : Math.max(bumperTop + 0.05, beltH - 0.45)
      const y1 = cargo ? y0 + 0.28 : beltH + 0.08
      const yM = y0 + (y1 - y0) * 0.6
      box(sd * wR * 0.8, sd * wR * 0.96, yM, y1, tailZ - (big ? 0.05 : 0.012), tailZ + 0.04, Role.TAIL, TAIL)
      box(sd * wR * 0.8, sd * wR * 0.96, y0 + (yM - y0) * 0.45, yM - 0.01, tailZ - (big ? 0.05 : 0.012), tailZ + 0.035,
        sd < 0 ? Role.IND_L : Role.IND_R, AMBER)
      box(sd * wR * 0.8, sd * wR * 0.96, y0, y0 + (yM - y0) * 0.4, tailZ - (big ? 0.05 : 0.012), tailZ + 0.03, Role.REVERSE, REVERSE)
    } else {
      // a slim lamp cluster across the tail that wraps round the corner, indicator and reversing lamp inboard
      const y1 = tailTop - 0.05, y0 = y1 - 0.09 * scale
      box(sd * wR * 0.42, sd * wR * 0.995, y0, y1, zR - 0.015, zR + 0.12, Role.TAIL, TAIL, 0.006)
      const zT = zR + tailCh * 0.4
      box(sd * (halfW(zT) - 0.03), sd * (halfW(zT) + 0.006), y0, y1, zT - 0.02, zT + 0.14, Role.TAIL, TAIL)
      box(sd * wR * 0.22, sd * wR * 0.41, y0 + 0.01, y1, zR - 0.012, zR + 0.012,
        sd < 0 ? Role.IND_L : Role.IND_R, AMBER)
      box(sd * wR * 0.6, sd * wR * 0.8, rearBumperTop - 0.07, rearBumperTop - 0.025, zR - 0.055, zR + 0.1,
        Role.REVERSE, REVERSE)
    }
  }
  if (car) {
    box(-(wR + 0.012), wR + 0.012, yF + 0.03, rearBumperTop, zR - 0.04, zR + 0.25, Role.PAINT, DARK, 0.035)
    box(-(wR - 0.06), wR - 0.06, yF - 0.015, yF + 0.07, zR - 0.05, zR + 0.3, Role.FIXED, TRIM, 0.01)
    box(-0.22, 0.22, rearBumperTop + 0.02, rearBumperTop + 0.12, zR - 0.012, zR + 0.0, Role.FIXED, PLATE)
  } else {
    box(-(wR + 0.015), wR + 0.015, yF - 0.02, rearBumperTop, zR - 0.05, zR + (cargo ? 0.12 : 0.3), Role.FIXED, TRIM, 0.03)
    box(-0.24, 0.24, rearBumperTop + 0.03, rearBumperTop + 0.14, zR - 0.065, zR - 0.05, Role.FIXED, PLATE)
  }

  // a box tail's rear window is on the tail cap; so is a pickup cab's
  if (s.tail === 'box') {
    const top = H - s.rearRake * 0.8 - (school ? 0.4 : 0.08)
    const gw = (w - s.tumblehome - ch) * (big ? 0.85 : 0.78)
    // a bus's or a truck's back is seen from 50 m behind it in traffic: 1.2 cm proud of the panel z-fought there
    // (owner, 2026-10-02: "z fighting on the back panels of buses"), so a big vehicle's glass stands 5 cm out
    if (top - beltH > 0.2) box(-gw, gw, beltH + 0.06, top, zR - (big ? 0.05 : 0.012), zR + 0.01, Role.GLASS, DARK)
  }
  if (s.tail === 'bed' || cargo) {
    const gw = (w - s.tumblehome - ch) * 0.7
    box(-gw, gw, beltH + 0.07, cabH - rc - 0.06, re - 0.012, re + 0.01, Role.GLASS, DARK)
  }
  if (s.tail === 'bed') {
    // the bed's floor is the dark top band; give it a lip and a tailgate seam so it reads as open
    const top = yB(zR + tailCh + 0.1)
    box(-(w - 0.08), w - 0.08, top - 0.005, top + 0.01, zR + 0.1, re - 0.1, Role.FIXED, BED)
  }

  // ---- the box truck's box, on a chassis -------------------------------------------------------------------
  if (cargo) {
    const floor = Math.max(deck, R * 2 + 0.12)
    box(-wIn * 0.92, wIn * 0.92, yF, floor, zR + 0.15, re + 0.05, Role.FIXED, DARK)
    box(-(w + 0.03), w + 0.03, floor, H, zR, re - 0.1, Role.PAINT2, DARK, 0.05)
    // mud flaps / guards over the rear wheels
    for (const sd of sides) {
      box(sd * (w - s.wheelWidth * 1.5 - 0.04), sd * (w + 0.01), floor - 0.06, floor, zRA - Ra - 0.05, zRA + Ra + 0.05,
        Role.FIXED, DARK)
    }
  }

  // ---- liveries ------------------------------------------------------------------------------------------
  const roofMid = (ws1 + Math.max(re, roofEnd)) / 2
  const roofW = w - s.tumblehome - ch - rc
  let top = H
  switch (s.livery) {
    case 'taxi':
      box(-0.28, 0.28, H - 0.01, H + 0.16, roofMid - 0.13, roofMid + 0.13, Role.SIGN, SIGN, 0.03)
      top = H + 0.16
      break
    case 'police': {
      const z0 = ws1 - Math.min(0.45, (ws1 - re) * 0.35)
      box(-roofW * 0.85, roofW * 0.85, H - 0.01, H + 0.05, z0 - 0.13, z0 + 0.13, Role.FIXED, DARK, 0.02)
      box(-roofW * 0.83, -0.02, H + 0.05, H + 0.13, z0 - 0.11, z0 + 0.11, Role.BEACON_A, [0.6, 0.08, 0.08], 0.02)
      box(0.02, roofW * 0.83, H + 0.05, H + 0.13, z0 - 0.11, z0 + 0.11, Role.BEACON_B, [0.08, 0.12, 0.6], 0.02)
      // the doors in the second paint: the classic black-and-white
      const za = zFA - Ra - 0.06, zb = zRA + Ra + 0.06
      for (const sd of sides) {
        if (za > zb) box(sd * (w - 0.01), sd * (w + 0.006), sill + 0.06, beltH - ch - 0.02, zb, za, Role.PAINT2, DARK)
      }
      top = H + 0.13
      break
    }
    case 'ambulance': {
      for (const sd of sides) {
        for (const zz of [ws1 - 0.1, zR + 0.12]) {
          box(sd * roofW * 0.6, sd * roofW * 0.95, H - 0.01, H + 0.1, zz - 0.09, zz + 0.09,
            sd < 0 ? Role.BEACON_A : Role.BEACON_B, sd < 0 ? [0.6, 0.08, 0.08] : [0.08, 0.12, 0.6], 0.02)
        }
        const y0 = (beltH + sill) / 2
        box(sd * (w - 0.01), sd * (w + 0.006), y0, y0 + 0.16, zR + 0.15, ws0 - 0.1, Role.FIXED, STRIPE)
      }
      top = H + 0.1
      break
    }
    default:
      break
  }
  if (s.archetype === 'bus') {
    // destination blind at the top of the windscreen, doors on the kerb side (right: SF and Paris drive right)
    box(-w * 0.62, w * 0.62, H - 0.32, H - 0.08, ws1 - 0.03, ws1 + 0.06, Role.SIGN, SIGN)
    const doors: [number, number][] = [[zF - 0.25, zFA + Ra + 0.1], [0.65, -0.65]]
    for (const [a, b] of doors) {
      if (a - b > 0.6) box(w - 0.01, w + 0.035, sill + 0.08, H - 0.45, b, a, Role.GLASS, DARK)
    }
  }

  if (school) {
    // black rub rails along both sides, the warning lamps (red, flashing left against right, as the real ones
    // alternate), the stop arm folded against the driver's side, and the door on the kerb side
    const zFront = Math.min(ws0 - 0.05, zFA + Ra + 0.1)
    for (const sd of sides) {
      for (const y of [sill + 0.18, (sill + beltH) / 2, beltH - 0.06]) {
        box(sd * (w - 0.01), sd * (w + 0.012), y - 0.035, y + 0.035, zR + 0.12, zFront, Role.FIXED, DARK)
      }
      for (const zz of [ws1 - 0.02, zR + 0.05]) {
        const front = zz > 0
        // in front they stand proud of the raked windscreen's top; behind, of the tail above the rear window
        const z0 = front ? zz : zz - 0.05, z1 = front ? zz + 0.16 : zz + 0.02
        box(sd * w * 0.42, sd * w * 0.62, H - 0.3, H - 0.12, z0, z1, sd < 0 ? Role.BEACON_A : Role.BEACON_B, [0.75, 0.06, 0.05])
        box(sd * w * 0.66, sd * w * 0.86, H - 0.3, H - 0.12, z0, z1, Role.FIXED, AMBER)
      }
    }
    const zs = ws1 - 1.0
    box(-(w + 0.012), -(w + 0.03), beltH - 0.05, beltH + 0.38, zs - 0.42, zs, Role.FIXED, [0.8, 0.07, 0.06])
    box(w - 0.01, w + 0.008, sill + 0.06, H - 0.4, ws1 - 1.05, ws1 - 0.15, Role.GLASS, DARK)
    // the "SCHOOL BUS" header board above the windscreen
    box(-w * 0.5, w * 0.5, H - 0.28, H - 0.1, ws1 - 0.03, ws1 + 0.07, Role.FIXED, [0.95, 0.75, 0.15])
  }

  // ---- wheels ------------------------------------------------------------------------------------------
  const wheels: WheelSlot[] = []
  for (const [z, steers] of [[zFA, true], [zRA, false]] as const) {
    const dual = !steers && (s.archetype === 'bus' || school || cargo)
    const ww = s.wheelWidth * (dual ? 1.5 : 1)
    const out = flareAt(z) * 0.7
    for (const sd of sides) wheels.push({ x: sd * (w + out - ww / 2 - 0.02), y: R, z, radius: R, width: ww, steers, side: sd })
  }
  const track = wheels[1].x - wheels[0].x
  const reach = big ? 0.24 : 0.15
  const layout: CarLayout = {
    spec: s,
    wheels,
    wheelbase: wb,
    track,
    frontAxleZ: zFA,
    rearAxleZ: zRA,
    min: [-(w + flare + reach), 0, zR - 0.05],
    max: [w + flare + reach, top, zF + 0.065],
    maxSteer: big ? 0.6 : 0.62,
  }
  return { body: out, layout }
}
