/**
 * The developer's demo: every archetype on one floor, one vehicle on the bench with every parameter on a
 * slider, one driving a hilly loop, and a few hundred in traffic.
 *
 * `window.__carkit` is the handle for tools/shots.ts and for poking at things from the console:
 * `mode(name)`, `select(spec)`, `step(dt, n)` (advance without animation frames, for headless capture),
 * `shot()` (render once and return a PNG data URL), and the `fleet` and `scene` themselves.
 */
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { CreateRibbon } from '@babylonjs/core/Meshes/Builders/ribbonBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Culling/ray'
// the demo's own floor, plate and roads use StandardMaterial: register its shaders up front, or Babylon goes
// looking for them by URL and the dev server answers with index.html
import '@babylonjs/core/Shaders/default.vertex'
import '@babylonjs/core/Shaders/default.fragment'
import {
  ARCHETYPES, DEFAULT_LOOK, Fleet, LIVERIES, PRESETS, applyLivery, painted, pickPaint, randomSpec, rng, sanitize,
  steerForCurvature, type Archetype, type Car, type CarLook, type CarSpec, type Indicator, type Livery,
} from '../index.ts'

type Mode = 'showroom' | 'inspect' | 'drive' | 'traffic'

const canvas = document.getElementById('c') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, antialias: true })
const scene = new Scene(engine)
const BG = new Color4(0.957, 0.773, 0.353, 1)
scene.clearColor = BG.clone()

const camera = new ArcRotateCamera('cam', -2.3, 1.05, 34, new Vector3(0, 0, 0), scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 400
camera.wheelDeltaPercentage = 0.01
camera.minZ = 0.1
camera.maxZ = 2000
camera.upperBetaLimit = 1.5

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
hemi.intensity = 0.75
hemi.groundColor = new Color3(0.45, 0.42, 0.38)
const sun = new DirectionalLight('sun', DEFAULT_LOOK.sun.scale(-1), scene)
sun.intensity = 0.65

const fleet = new Fleet(scene, { shadows: true })

// ---- the ground: a flat showroom floor, and hills for driving --------------------------------------------
const height = (x: number, z: number): number =>
  4 * Math.sin(x / 40) * Math.sin(z / 33) + 2 * Math.sin((x + z) / 23) + 0.8 * Math.cos(x / 11 - z / 17)

const floorMat = new StandardMaterial('floor', scene)
// unlit, the colour of the background, so the floor vanishes into it and only the shadows show
floorMat.disableLighting = true
floorMat.emissiveColor = new Color3(BG.r, BG.g, BG.b)
const floor = CreateGround('floor', { width: 600, height: 600 }, scene)
floor.material = floorMat

const hillsMat = new StandardMaterial('hills', scene)
hillsMat.diffuseColor = new Color3(0.56, 0.7, 0.42)
hillsMat.specularColor = Color3.Black()
const hills = CreateGround('hills', { width: 420, height: 420, subdivisions: 210, updatable: true }, scene)
{
  const p = hills.getVerticesData(VertexBuffer.PositionKind)!
  for (let i = 0; i < p.length; i += 3) p[i + 1] = height(p[i], p[i + 2])
  hills.updateVerticesData(VertexBuffer.PositionKind, p)
  hills.createNormals(true)
}
hills.material = hillsMat

// the bench's tilting plate, for grades and banks
const plate = CreateGround('plate', { width: 16, height: 16 }, scene)
const plateMat = new StandardMaterial('plate', scene)
plateMat.diffuseColor = new Color3(0.5, 0.48, 0.45)
plateMat.specularColor = Color3.Black()
plate.material = plateMat

// ---- loops of road over the hills ----------------------------------------------------------------------
interface Loop { x: Float32Array; z: Float32Array; yaw: Float32Array; k: Float32Array; length: number; step: number }

/** A rounded rectangle, sampled every `step` metres, driven clockwise (dir 1) or anticlockwise, offset to the right. */
function roundedRect(cx: number, cz: number, w: number, h: number, r: number, dir: 1 | -1, offset: number): Loop {
  const pts: [number, number][] = []
  const step = 0.5
  // clockwise seen from above (+x right, +z up the page): up the left side, along the top, down the right
  const straightW = w - 2 * r, straightH = h - 2 * r
  const quarter = (Math.PI / 2) * r
  const total = 2 * straightW + 2 * straightH + 4 * quarter
  const at = (s: number): [number, number] => {
    // segments: up the left side (+z), corner, along the top (+x), corner, down the right (−z), corner, back (−x), corner
    const segs: [number, (u: number) => [number, number]][] = [
      [straightH, (u) => [cx - w / 2, cz - h / 2 + r + u]],
      [quarter, (u) => { const a = Math.PI - u / r; return [cx - w / 2 + r + Math.cos(a) * r, cz + h / 2 - r + Math.sin(a) * r] }],
      [straightW, (u) => [cx - w / 2 + r + u, cz + h / 2]],
      [quarter, (u) => { const a = Math.PI / 2 - u / r; return [cx + w / 2 - r + Math.cos(a) * r, cz + h / 2 - r + Math.sin(a) * r] }],
      [straightH, (u) => [cx + w / 2, cz + h / 2 - r - u]],
      [quarter, (u) => { const a = -u / r; return [cx + w / 2 - r + Math.cos(a) * r, cz - h / 2 + r + Math.sin(a) * r] }],
      [straightW, (u) => [cx + w / 2 - r - u, cz - h / 2]],
      [quarter, (u) => { const a = -Math.PI / 2 - u / r; return [cx - w / 2 + r + Math.cos(a) * r, cz - h / 2 + r + Math.sin(a) * r] }],
    ]
    let u = ((s % total) + total) % total
    for (const [len, f] of segs) {
      if (u <= len) return f(u)
      u -= len
    }
    return segs[0][1](0)
  }
  const n = Math.round(total / step)
  for (let i = 0; i < n; i++) pts.push(at((dir > 0 ? i : n - i) * (total / n)))
  // headings, the offset to the right of travel, then headings and curvature of the offset line
  const offsetPts = pts.map((p, i) => {
    const q = pts[(i + 1) % n], o = pts[(i - 1 + n) % n]
    const yaw = Math.atan2(q[0] - o[0], q[1] - o[1])
    return [p[0] + Math.cos(yaw) * offset, p[1] - Math.sin(yaw) * offset] as [number, number]
  })
  const loop: Loop = { x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), k: new Float32Array(n),
    length: 0, step: 0 }
  let len = 0
  for (let i = 0; i < n; i++) {
    const p = offsetPts[i], q = offsetPts[(i + 1) % n], o = offsetPts[(i - 1 + n) % n]
    loop.x[i] = p[0]; loop.z[i] = p[1]
    loop.yaw[i] = Math.atan2(q[0] - o[0], q[1] - o[1])
    len += Math.hypot(q[0] - p[0], q[1] - p[1])
  }
  for (let i = 0; i < n; i++) {
    let d = loop.yaw[(i + 1) % n] - loop.yaw[(i - 1 + n) % n]
    d = Math.atan2(Math.sin(d), Math.cos(d))
    loop.k[i] = d / (2 * (len / n))
  }
  loop.length = len
  loop.step = len / n
  return loop
}

function sample(loop: Loop, s: number): { x: number; z: number; yaw: number; k: number } {
  const n = loop.x.length
  const f = (((s % loop.length) + loop.length) % loop.length) / loop.step
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f)
  let dy = loop.yaw[j] - loop.yaw[i]
  dy = Math.atan2(Math.sin(dy), Math.cos(dy))
  return { x: loop.x[i] + (loop.x[j] - loop.x[i]) * t, z: loop.z[i] + (loop.z[j] - loop.z[i]) * t,
    yaw: loop.yaw[i] + dy * t, k: loop.k[i] + (loop.k[j] - loop.k[i]) * t }
}

const BLOCKS: [number, number, number, number, number][] = [
  [0, 0, 120, 90, 9], [-95, 70, 60, 70, 7], [100, -60, 70, 110, 8], [-90, -85, 80, 60, 10], [95, 95, 90, 60, 6],
]
const LANE = 1.8
const loops: Loop[] = BLOCKS.flatMap(([cx, cz, w, h, r]) => [roundedRect(cx, cz, w, h, r, 1, LANE), roundedRect(cx, cz, w, h, r, -1, LANE)])

const roadMat = new StandardMaterial('road', scene)
roadMat.diffuseColor = new Color3(0.27, 0.27, 0.29)
roadMat.specularColor = Color3.Black()
roadMat.zOffset = -2
const roads: Mesh[] = BLOCKS.map(([cx, cz, w, h, r], i) => {
  const centre = roundedRect(cx, cz, w, h, r, 1, 0)
  const left: Vector3[] = [], right: Vector3[] = []
  for (let k = 0; k <= centre.x.length; k += 2) {
    const j = k % centre.x.length
    const yaw = centre.yaw[j], x = centre.x[j], z = centre.z[j]
    const rx = Math.cos(yaw), rz = -Math.sin(yaw)
    for (const [list, o] of [[left, -4.2], [right, 4.2]] as const) {
      const px = x + rx * o, pz = z + rz * o
      list.push(new Vector3(px, height(px, pz) + 0.03, pz))
    }
  }
  const m = CreateRibbon(`road${i}`, { pathArray: [left, right] }, scene)
  m.material = roadMat
  return m
})

// ---- drivers ----------------------------------------------------------------------------------------
interface Driver { car: Car; loop: Loop; s: number; v: number; vmax: number; turning: number }
let drivers: Driver[] = []
let followed: Car | undefined

function curvatureAhead(loop: Loop, s: number, from: number, to: number): number {
  let best = 0
  for (let d = from; d <= to; d += 2) {
    const k = sample(loop, s + d).k
    if (Math.abs(k) > Math.abs(best)) best = k
  }
  return best
}

function drive(dt: number): void {
  // the car ahead on the same loop, for following
  const byLoop = new Map<Loop, Driver[]>()
  for (const d of drivers) {
    const list = byLoop.get(d.loop) ?? []
    list.push(d)
    byLoop.set(d.loop, list)
  }
  for (const list of byLoop.values()) list.sort((a, b) => a.s - b.s)
  for (const list of byLoop.values()) {
    list.forEach((d, i) => {
      const lead = list[(i + 1) % list.length]
      let gap = Infinity
      if (lead !== d) {
        gap = lead.s - d.s
        if (gap <= 0) gap += d.loop.length
        gap -= (lead.car.length + d.car.length) / 2
      }
      const kAhead = Math.abs(curvatureAhead(d.loop, d.s, 0, Math.max(12, d.v * 2.2)))
      const vCurve = Math.sqrt(2.6 / Math.max(kAhead, 1e-4))
      const vFollow = Math.max(0, (gap - 2.5) / 1.1)
      const target = Math.min(d.vmax, vCurve, vFollow)
      const dv = target - d.v
      const prev = d.v
      d.v = Math.max(0, d.v + Math.max(-7 * dt, Math.min(2.2 * dt, dv)))
      const decel = (prev - d.v) / Math.max(dt, 1e-6)
      d.s = (d.s + d.v * dt) % d.loop.length
      const p = sample(d.loop, d.s)
      const c = d.car
      c.place(p.x, p.z, p.yaw, height, dt)
      c.steer = steerForCurvature(c.layout, p.k)
      c.drive(d.v * dt)
      c.lights.brake = decel > 1.0 || (d.v < 0.2 && target < 0.5)
      // indicate for a corner coming up; cancel once out of it
      const kNow = p.k
      const kSoon = curvatureAhead(d.loop, d.s, 3, 28)
      if (Math.abs(kNow) > 1 / 25) d.turning = Math.sign(kNow)
      else if (Math.abs(kSoon) > 1 / 25) d.turning = Math.sign(kSoon)
      else d.turning = 0
      if (c.lights.indicator !== 'hazard') c.lights.indicator = d.turning > 0 ? 'right' : d.turning < 0 ? 'left' : 'off'
    })
  }
}

// ---- state ------------------------------------------------------------------------------------------
let mode: Mode = 'showroom'
let selected: CarSpec = PRESETS['sedan']()
let bench: Car | undefined
const benchState = { grade: 0, bank: 0, bump: false, speed: 0, steer: 0, turntable: true, yaw: -0.6 }
let night = false
const lightState: { brake: boolean; indicator: Indicator; headlights: boolean; reverse: boolean; beacon: boolean; sign: boolean } =
  { brake: false, indicator: 'off', headlights: false, reverse: false, beacon: false, sign: false }
let trafficCount = 240

function look(): CarLook {
  return night
    ? { ...DEFAULT_LOOK, sunColour: new Color3(0.18, 0.2, 0.3), skyColour: new Color3(0.12, 0.14, 0.22),
        groundColour: new Color3(0.05, 0.05, 0.06), fogColour: new Color3(0.05, 0.06, 0.1), night: 1 }
    : { ...DEFAULT_LOOK, fogColour: mode === 'showroom' || mode === 'inspect' ? new Color3(BG.r, BG.g, BG.b) : DEFAULT_LOOK.fogColour }
}

function applyLook(): void {
  fleet.setLook(look())
  hemi.intensity = night ? 0.12 : 0.75
  sun.intensity = night ? 0.05 : 0.65
  const outdoors = mode === 'drive' || mode === 'traffic'
  scene.clearColor = night ? new Color4(0.04, 0.05, 0.09, 1) : outdoors ? new Color4(0.62, 0.76, 0.9, 1) : BG.clone()
  floorMat.emissiveColor = night ? new Color3(0.06, 0.06, 0.08) : new Color3(BG.r, BG.g, BG.b)
  for (const c of fleet.cars) {
    c.lights.headlights = night || (c === bench && lightState.headlights)
    if (c.spec.livery === 'taxi') c.lights.sign = true
  }
}

const SHOWROOM: CarSpec[] = (() => {
  const list: CarSpec[] = Object.values(PRESETS).map((f) => f())
  // the random variants in toy-box colours (the city's weighting is mostly white, grey and black)
  const BRIGHT = ['red', 'blue', 'yellow', 'green', 'orange', 'teal', 'purple', 'silver', 'white']
  ARCHETYPES.forEach((a, i) => [21, 22].forEach((seed, j) => {
    const spec = randomSpec(a, seed)
    list.push(a === 'boxtruck' || a === 'schoolbus' ? spec
      : painted(spec, BRIGHT[(i * 2 + j) % BRIGHT.length], (i + j) % 2 === 0 && !spec.archetype.includes('bus') ? 'black' : undefined))
  }))
  return list
})()

function setMode(m: Mode): void {
  mode = m
  fleet.clear()
  drivers = []
  bench = undefined
  followed = undefined
  floor.setEnabled(m === 'showroom' || m === 'inspect')
  plate.setEnabled(m === 'inspect')
  hills.setEnabled(m === 'drive' || m === 'traffic')
  for (const r of roads) r.setEnabled(m === 'drive' || m === 'traffic')
  floor.position.y = m === 'inspect' ? -0.6 : 0

  if (m === 'showroom') {
    // rows by size, like a toy box tipped out: small cars in front, buses at the back. The grid is laid out in
    // the cars' own frame (side by side across, rows along) and then turned, so nothing overlaps at an angle.
    const specs = [...SHOWROOM].sort((a, b) => a.length - b.length)
    const perRow = 6
    // turned to show the camera their front three-quarters
    const yaw = -2.2
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw)
    let along = 0
    for (let r = 0; r * perRow < specs.length; r++) {
      const row = specs.slice(r * perRow, (r + 1) * perRow)
      const deep = Math.max(...row.map((s) => s.length))
      const across = 3.4 + Math.max(...row.map((s) => s.width))
      row.forEach((spec, i) => {
        const c = fleet.add(spec)
        const u = (i - (row.length - 1) / 2) * across, v = along - deep / 2
        c.setPose({ x: rx * u + fx * v, y: 0, z: rz * u + fz * v, yaw, pitch: 0, roll: 0 })
        if (spec.livery === 'taxi') c.lights.sign = true
        if (spec.livery === 'police' || spec.livery === 'ambulance' || spec.archetype === 'schoolbus') c.lights.beacon = true
      })
      along -= deep + 2.5
    }
    // frame the whole grid: aim at its middle, back off to fit its farthest vehicle
    const cars = fleet.cars
    const cx = cars.reduce((a, c) => a + c.x, 0) / cars.length, cz = cars.reduce((a, c) => a + c.z, 0) / cars.length
    const reach = Math.max(...cars.map((c) => Math.hypot(c.x - cx, c.z - cz) + c.length / 2))
    camera.setTarget(new Vector3(cx, 0, cz))
    camera.radius = reach * 1.4
    camera.alpha = -1.95
    camera.beta = 0.9
  } else if (m === 'inspect') {
    bench = fleet.add(selected)
    Object.assign(bench.lights, lightState)
    camera.setTarget(new Vector3(0, selected.height * 0.45, 0))
    camera.radius = Math.max(7.5, selected.length * 1.5)
  } else if (m === 'drive') {
    const r = rng(5)
    const main = loops[0]
    const me = fleet.add(selected)
    drivers.push({ car: me, loop: main, s: 0, v: 0, vmax: 13, turning: 0 })
    followed = me
    for (let i = 0; i < 14; i++) {
      const loop = loops[i % 4]
      const spec = randomSpec(ARCHETYPES[Math.floor(r() * ARCHETYPES.length)], 1 + Math.floor(r() * 4))
      drivers.push({ car: fleet.add(spec), loop, s: 20 + i * 27, v: 5, vmax: 9 + r() * 5, turning: 0 })
    }
    camera.radius = Math.max(12, selected.length * 2.4)
    camera.beta = 1.15
  } else {
    spawnTraffic(trafficCount)
    camera.setTarget(new Vector3(0, 0, 0))
    camera.radius = 230
    camera.beta = 0.85
  }
  applyLook()
  renderPanel()
  hint.textContent = {
    showroom: 'Click a vehicle to put it on the bench. Drag to orbit, scroll to zoom.',
    inspect: 'Every number is live. Tilt the plate to see pitch, roll and the wheels find the ground.',
    drive: 'It indicates before corners, brakes into them, steers through them and pitches over the hills.',
    traffic: `${trafficCount} vehicles on ten one-way loops, in a few dozen shapes.`,
  }[m]
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === m))
}

/** A city's mix: mostly cars, a few vans and trucks, the odd bus, taxi and police car. */
const MIX: [Archetype, number, Livery][] = [
  ['sedan', 22, 'none'], ['hatchback', 18, 'none'], ['suv', 18, 'none'], ['coupe', 4, 'none'], ['minivan', 7, 'none'],
  ['pickup', 6, 'none'], ['van', 7, 'none'], ['boxtruck', 4, 'none'], ['bus', 3, 'transit'], ['schoolbus', 2, 'none'], ['sedan', 6, 'taxi'],
  ['minivan', 2, 'taxi'], ['sedan', 1, 'police'], ['suv', 1, 'police'], ['van', 1, 'ambulance'], ['boxtruck', 1, 'delivery'],
]

function spawnTraffic(n: number): void {
  const r = rng(99)
  const total = MIX.reduce((s, m) => s + m[1], 0)
  const perLoop = Math.ceil(n / loops.length)
  let made = 0
  loops.forEach((loop) => {
    const count = Math.min(perLoop, n - made, Math.floor(loop.length / 9))
    for (let i = 0; i < count; i++) {
      let x = r() * total
      let pick = MIX[0]
      for (const m of MIX) { x -= m[1]; if (x <= 0) { pick = m; break } }
      // a handful of shapes per archetype, any colour: keeps the draw calls down
      const spec = randomSpec(pick[0], 1 + Math.floor(r() * 4), pick[2])
      const c = fleet.add(spec)
      if (pick[2] === 'none') c.paint = pickPaint(r)
      if (pick[2] === 'police' || pick[2] === 'ambulance') c.lights.beacon = r() < 0.5
      drivers.push({ car: c, loop, s: (i / count) * loop.length, v: 6, vmax: 10 + r() * 5, turning: 0 })
      made++
    }
  })
}

// ---- picking in the showroom (thin instances aren't pickable; hit the floor and find the footprint) -------
canvas.addEventListener('pointerup', (e) => {
  if (mode !== 'showroom') return
  if (Math.hypot(e.movementX, e.movementY) > 2) return
  const ray = scene.createPickingRay(e.offsetX, e.offsetY, null, camera)
  if (Math.abs(ray.direction.y) < 1e-6) return
  const t = -ray.origin.y / ray.direction.y
  const px = ray.origin.x + ray.direction.x * t, pz = ray.origin.z + ray.direction.z * t
  for (const c of fleet.cars) {
    const dx = px - c.x, dz = pz - c.z
    const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)
    const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)
    if (lx > c.layout.min[0] && lx < c.layout.max[0] && lz > c.layout.min[2] && lz < c.layout.max[2]) {
      selected = c.spec
      setMode('inspect')
      return
    }
  }
})

// ---- the frame ---------------------------------------------------------------------------------------
function tick(dt: number): void {
  if (mode === 'inspect' && bench) {
    if (benchState.turntable) benchState.yaw += dt * 0.25
    const { grade, bank, bump, yaw } = benchState
    // the plate is a plane through the origin, tilted along the car's heading and across it
    const fwd = [Math.sin(yaw), Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)]
    const bumpAt = bench.layout.wheels[0]
    const bx = bumpAt.x * right[0] + bumpAt.z * fwd[0], bz = bumpAt.x * right[1] + bumpAt.z * fwd[1]
    const h = (x: number, z: number): number => {
      const along = x * fwd[0] + z * fwd[1], across = x * right[0] + z * right[1]
      let y = grade * along + bank * across
      if (bump) y += 0.09 * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / 0.08)
      return y
    }
    bench.place(0, 0, yaw, h)
    Object.assign(bench.lights, lightState)
    if (night) bench.lights.headlights = true
    bench.steer = benchState.steer
    bench.drive(benchState.speed * dt)
    plate.rotation.set(0, 0, 0)
    plate.rotationQuaternion = null
    plate.rotation.y = yaw
    plate.rotation.x = -Math.atan(grade)
    plate.rotation.z = Math.atan(bank)
    plate.position.y = -0.005
  }
  if (mode === 'drive' || mode === 'traffic') drive(dt)
  if (followed) {
    const t = new Vector3(followed.x, followed.y + 1, followed.z)
    // in place: assigning camera.target recomputes the radius from where the camera is, and it drifts away
    camera.target.copyFrom(Vector3.Lerp(camera.target, t, Math.min(1, dt * 6)))
    camera.alpha += (-followed.yaw - Math.PI / 2 - camera.alpha) * Math.min(1, dt * 0.8)
  }
  fleet.update(dt)
}

let fpsAvg = 60
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000)
  tick(dt)
})
engine.runRenderLoop(() => {
  scene.render()
  fpsAvg = fpsAvg * 0.95 + engine.getFps() * 0.05
  const s = fleet.stats
  let line = `${s.cars} vehicles · ${s.shapes} shapes · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${fpsAvg.toFixed(0)} fps`
  if (followed) {
    const d = drivers.find((x) => x.car === followed)
    if (d) line += `\n${(d.v * 3.6).toFixed(0)} km/h · steer ${(followed.steer * 57.3).toFixed(0)}° · pitch ${(-followed.pitch * 57.3).toFixed(1)}°`
  }
  stats.textContent = line
})
window.addEventListener('resize', () => engine.resize())

// ---- the panel ---------------------------------------------------------------------------------------
const panel = document.getElementById('panel')!
const stats = document.getElementById('stats')!
const hint = document.getElementById('hint')!
const tabs = document.getElementById('tabs')!
for (const m of ['showroom', 'inspect', 'drive', 'traffic'] as Mode[]) {
  const b = document.createElement('button')
  b.textContent = m[0].toUpperCase() + m.slice(1)
  b.dataset.mode = m
  b.onclick = () => setMode(m)
  tabs.append(b)
}

const NUMERIC: [keyof CarSpec, string, number, number, number][] = [
  ['length', 'Length', 2.5, 14, 0.05], ['width', 'Width', 1.3, 2.6, 0.01], ['height', 'Height', 1, 3.8, 0.01],
  ['wheelbase', 'Wheelbase', 1.8, 8, 0.05], ['frontOverhang', 'Front overhang', 0.4, 3.5, 0.02],
  ['wheelRadius', 'Wheel radius', 0.22, 0.6, 0.005], ['wheelWidth', 'Wheel width', 0.12, 0.4, 0.005],
  ['clearance', 'Clearance', 0.08, 0.5, 0.005], ['noseHeight', 'Nose height', 0.4, 1.6, 0.01],
  ['beltHeight', 'Beltline', 0.6, 2, 0.01], ['hoodLength', 'Bonnet length', 0, 2.5, 0.02],
  ['windscreenRake', 'Windscreen rake', 0.05, 1.5, 0.01], ['cabinLength', 'Roof length', 0.1, 11, 0.05],
  ['rearRake', 'Rear rake', 0.02, 1.5, 0.01], ['deckHeight', 'Deck height', 0.4, 2, 0.01],
  ['tumblehome', 'Tumblehome', 0, 0.3, 0.005], ['sideWindows', 'Side windows', 1, 9, 1],
]

const hex = (c: number[]): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
const unhex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]

function rebuildBench(): void {
  selected = sanitize(selected)
  if (mode !== 'inspect') return
  if (bench) fleet.remove(bench)
  bench = fleet.add(selected)
  Object.assign(bench.lights, lightState)
  applyLook()
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

function slider(label: string, min: number, max: number, step: number, value: number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)): HTMLElement {
  const out = el('output', {}, fmt(value))
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) })
  input.oninput = () => { const v = Number(input.value); out.textContent = fmt(v); set(v) }
  return el('div', { className: 'row' }, el('label', {}, label), input, out)
}

function select<T extends string>(label: string, options: readonly T[], value: T, set: (v: T) => void): HTMLElement {
  const s = el('select')
  for (const o of options) s.append(el('option', { value: o, selected: o === value }, o))
  s.onchange = () => set(s.value as T)
  return el('div', { className: 'row' }, el('label', {}, label), s, el('span'))
}

function renderPanel(): void {
  panel.replaceChildren()
  const add = (...n: Node[]): void => { panel.append(...n) }
  const nightBtn = el('button', { className: night ? 'on' : '' }, 'Night')
  nightBtn.onclick = () => { night = !night; applyLook(); renderPanel() }

  if (mode === 'traffic') {
    add(el('h2', {}, 'Traffic'))
    add(slider('Vehicles', 20, 1200, 10, trafficCount, (v) => { trafficCount = v }, (v) => v.toFixed(0)))
    const go = el('button', {}, 'Respawn')
    go.onclick = () => setMode('traffic')
    add(el('div', { className: 'btns' }, go, nightBtn))
    add(el('p', {}, 'Vehicles of one shape share a mesh; colour and lamps are per copy. The draw count is shapes + wheels + shadows.'))
    return
  }
  if (mode === 'showroom') {
    add(el('h2', {}, 'Showroom'))
    add(el('p', {}, 'Every preset and two random variants of each archetype. Click one to edit it.'))
    add(el('div', { className: 'btns' }, nightBtn))
    return
  }

  add(el('h2', {}, 'Vehicle'))
  add(select('Archetype', ARCHETYPES, selected.archetype, (a) => { selected = randomSpec(a, selected.seed, selected.livery); rebuildBench(); renderPanel() }))
  add(select('Livery', LIVERIES, selected.livery, (l) => { selected = applyLivery(randomSpec(selected.archetype, selected.seed), l); rebuildBench(); renderPanel() }))
  const seed = el('input', { type: 'number', value: String(selected.seed) })
  seed.onchange = () => { selected = randomSpec(selected.archetype, Number(seed.value) || 1, selected.livery); rebuildBench(); renderPanel() }
  const dice = el('button', {}, 'Random')
  dice.onclick = () => { selected = randomSpec(selected.archetype, Math.floor(Math.random() * 1e6), selected.livery); rebuildBench(); renderPanel() }
  add(el('div', { className: 'row' }, el('label', {}, 'Seed'), seed, dice))
  const presetSel = el('select')
  presetSel.append(el('option', { value: '' }, 'preset…'))
  for (const k of Object.keys(PRESETS)) presetSel.append(el('option', { value: k }, k))
  presetSel.onchange = () => { if (presetSel.value) { selected = PRESETS[presetSel.value](); rebuildBench(); renderPanel() } }
  add(el('div', { className: 'row' }, el('label', {}, 'Preset'), presetSel, el('span')))

  if (mode === 'drive') {
    const go = el('button', {}, 'Drive this')
    go.onclick = () => setMode('drive')
    add(el('div', { className: 'btns' }, go, nightBtn))
    return
  }

  add(el('h2', {}, 'Paint'))
  const p1 = el('input', { type: 'color', value: hex(selected.paint) })
  const p2 = el('input', { type: 'color', value: hex(selected.paint2) })
  p1.oninput = () => { selected.paint = unhex(p1.value); if (bench) bench.paint = selected.paint }
  p2.oninput = () => { selected.paint2 = unhex(p2.value); if (bench) bench.paint2 = selected.paint2 }
  add(el('div', { className: 'row' }, el('label', {}, 'Body / roof'), el('span', {}, p1, ' ', p2), el('span')))

  add(el('h2', {}, 'Lamps'))
  const tog = el('div', { className: 'toggles' })
  const toggle = (label: string, on: () => boolean, flip: () => void): void => {
    const b = el('button', { className: on() ? 'on' : '' }, label)
    b.onclick = () => { flip(); if (bench) Object.assign(bench.lights, lightState); applyLook(); renderPanel() }
    tog.append(b)
  }
  const ind = (i: Indicator): void => toggle(i[0].toUpperCase() + i.slice(1), () => lightState.indicator === i,
    () => { lightState.indicator = lightState.indicator === i ? 'off' : i })
  ind('left'); ind('right'); ind('hazard')
  toggle('Brake', () => lightState.brake, () => { lightState.brake = !lightState.brake })
  toggle('Headlights', () => lightState.headlights, () => { lightState.headlights = !lightState.headlights })
  toggle('Reverse', () => lightState.reverse, () => { lightState.reverse = !lightState.reverse })
  toggle('Beacon', () => lightState.beacon, () => { lightState.beacon = !lightState.beacon })
  toggle('Sign', () => lightState.sign, () => { lightState.sign = !lightState.sign })
  add(tog, el('div', { className: 'btns' }, nightBtn))

  add(el('h2', {}, 'Motion'))
  add(slider('Steer', -0.62, 0.62, 0.01, benchState.steer, (v) => { benchState.steer = v }, (v) => `${(v * 57.3).toFixed(0)}°`))
  add(slider('Wheel speed', -10, 30, 0.5, benchState.speed, (v) => { benchState.speed = v }, (v) => `${(v * 3.6).toFixed(0)}`))
  add(slider('Grade', -0.3, 0.3, 0.01, benchState.grade, (v) => { benchState.grade = v }, (v) => `${(v * 100).toFixed(0)}%`))
  add(slider('Bank', -0.2, 0.2, 0.01, benchState.bank, (v) => { benchState.bank = v }, (v) => `${(v * 100).toFixed(0)}%`))
  const tt = el('button', { className: benchState.turntable ? 'on' : '' }, 'Turntable')
  tt.onclick = () => { benchState.turntable = !benchState.turntable; renderPanel() }
  const bump = el('button', { className: benchState.bump ? 'on' : '' }, 'Bump under FL')
  bump.onclick = () => { benchState.bump = !benchState.bump; renderPanel() }
  add(el('div', { className: 'toggles' }, tt, bump))

  add(el('h2', {}, 'Shape'))
  for (const [key, label, min, max, step] of NUMERIC) {
    add(slider(label, min, max, step, selected[key] as number, (v) => { (selected as unknown as Record<string, number>)[key] = v; rebuildBench() },
      step >= 1 ? (v) => v.toFixed(0) : undefined))
  }
  add(select('Tail', ['notch', 'hatch', 'fast', 'box', 'bed', 'cargo'] as const, selected.tail, (t) => { selected.tail = t; rebuildBench() }))
  add(select('Side glass', ['full', 'front', 'none'] as const, selected.sideGlass, (g) => { selected.sideGlass = g; rebuildBench() }))

  add(el('h2', {}, 'Spec'))
  const ta = el('textarea', { readOnly: true, value: JSON.stringify(selected) })
  add(ta)
}

// ---- the handle --------------------------------------------------------------------------------------
declare global { interface Window { __carkit: unknown } }
window.__carkit = {
  scene, engine, fleet, camera,
  mode: setMode,
  select(spec: CarSpec | string) { selected = typeof spec === 'string' ? PRESETS[spec]() : spec; setMode('inspect') },
  bench: benchState,
  lights: lightState,
  setNight(v: boolean) { night = v; applyLook() },
  ready: () => scene.whenReadyAsync(),
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) { tick(dt); scene.render() } },
  /** render twice (the first frame after a change can lag a step) and read the canvas back */
  shot(): string {
    scene.render()
    scene.render()
    return canvas.toDataURL('image/png')
  },
  get stats() { return fleet.stats },
}

const start = new URLSearchParams(location.search)
const startMode = (start.get('mode') as Mode) ?? 'showroom'
if (start.get('preset')) selected = PRESETS[start.get('preset')!]()
setMode(startMode)
