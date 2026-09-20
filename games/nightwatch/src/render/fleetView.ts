/**
 * Draws the night's ships: each follows its path (pushed sideways by its drift), rides the waves, shakes on the
 * rocks, lists when aground, gets towed in by a little tug, and sails off when the harbour needs its mooring.
 * Also wakes, funnel smoke, and where to put the HUD's name tags.
 */
import {
  Color3, Color4, Matrix, Mesh, ParticleSystem, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData,
  type Camera, type Engine, type Scene, type Texture,
} from '@babylonjs/core'
import { Config } from '../config.ts'
import { clamp, smoothstep } from '../rng.ts'
import type { Night } from '../sim/night.ts'
import type { Ship } from '../sim/ship.ts'
import {
  ANCHORAGE, CHANNEL, CHANNEL_HALF, MOORINGS, MOORING_HEADING, Polyline, SHIP_SCALE, ShipPath, berthApproach, berthCentre, departure, headingOf,
  newPose, type Pose, type XZ,
} from './coast.ts'
import type { Env } from './env.ts'
import { buildShip, type ShipModel } from './shipModels.ts'
import { waveHeight } from './shaders.ts'

const WAKE_POINTS = 36

class Wake {
  readonly mesh: Mesh
  private readonly xs = new Float32Array(WAKE_POINTS)
  private readonly zs = new Float32Array(WAKE_POINTS)
  private readonly ts = new Float32Array(WAKE_POINTS).fill(-999)
  private readonly nx = new Float32Array(WAKE_POINTS)
  private readonly nz = new Float32Array(WAKE_POINTS)
  private readonly positions = new Float32Array(WAKE_POINTS * 2 * 3)
  private readonly colors = new Float32Array(WAKE_POINTS * 2 * 4)
  private count = 0
  private readonly width: number

  constructor(scene: Scene, mat: StandardMaterial, width: number) {
    this.width = width
    const indices: number[] = []
    for (let i = 0; i < WAKE_POINTS - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const vd = new VertexData()
    vd.positions = this.positions
    vd.colors = this.colors
    vd.indices = indices
    this.mesh = new Mesh('wake', scene)
    vd.applyToMesh(this.mesh, true)
    this.mesh.material = mat
    this.mesh.hasVertexAlpha = true
    this.mesh.isPickable = false
    this.mesh.alwaysSelectAsActiveMesh = true
  }

  reset(): void {
    this.count = 0
    this.ts.fill(-999)
  }

  update(x: number, z: number, hx: number, hz: number, t: number, moving: boolean, env: Env): void {
    const lastX = this.xs[0]!, lastZ = this.zs[0]!
    if (moving && (this.count === 0 || Math.hypot(x - lastX, z - lastZ) > 4)) {
      this.xs.copyWithin(1, 0); this.zs.copyWithin(1, 0); this.ts.copyWithin(1, 0)
      this.nx.copyWithin(1, 0); this.nz.copyWithin(1, 0)
      this.xs[0] = x; this.zs[0] = z; this.ts[0] = t
      this.nx[0] = -hz; this.nz[0] = hx
      this.count = Math.min(WAKE_POINTS, this.count + 1)
    }
    for (let i = 0; i < WAKE_POINTS; i++) {
      const px = i === 0 ? x : this.xs[i]!, pz = i === 0 ? z : this.zs[i]!
      const age = t - this.ts[i]!
      const live = i < this.count ? 1 : 0
      const half = this.width * (0.5 + Math.min(age, 20) * 0.12)
      const y = waveHeight(px, pz, env.time, env.waveAmp) + 0.25
      const nx = i === 0 ? -hz : this.nx[i]!, nz = i === 0 ? hx : this.nz[i]!
      this.positions.set([px + nx * half, y, pz + nz * half, px - nx * half, y, pz - nz * half], i * 6)
      const a = live * clamp(1 - age / 18, 0, 1) * (1 - i / WAKE_POINTS) * 0.5
      const bright = 0.55 + 0.45 * env.look.hemi
      for (let k = 0; k < 2; k++) this.colors.set([0.8 * bright, 0.86 * bright, 1 * bright, a], (i * 2 + k) * 4)
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions)
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors)
  }
}

const MORSE = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0] // · — ·  pause

class ShipView {
  readonly ship: Ship
  readonly model: ShipModel
  readonly wake: Wake
  readonly smoke: ParticleSystem | null
  private path: ShipPath
  private mooringUsed = -2
  private special: Polyline | null = null
  private specialKind: 'tow' | 'leave' | null = null
  private backing = 0
  private readonly pose: Pose = newPose()
  readonly pos = new Vector3()
  heading = 0
  private placed = false
  private lastS = 0
  private grounded = false
  private groundX = 0
  private groundZ = 0
  private groundH = 0
  private speed = 0
  private listing = 0
  readonly scale: number

  constructor(scene: Scene, ship: Ship, wakeMat: StandardMaterial, dot: Texture) {
    this.ship = ship
    this.model = buildShip(scene, ship.plan.kind, ship.id)
    this.scale = SHIP_SCALE * (ship.plan.kind === 'skiff' ? 1.3 : 1)
    this.model.root.scaling.setAll(this.scale)
    this.path = new ShipPath(ship.plan.lane, null)
    this.wake = new Wake(scene, wakeMat, this.model.beam * this.scale * 0.8)
    if (this.model.funnels.length) {
      const ps = new ParticleSystem(`smoke${ship.id}`, 60 * this.model.funnels.length, scene)
      ps.particleTexture = dot
      ps.emitter = new Vector3()
      ps.emitRate = 0
      ps.color1 = new Color4(0.42, 0.42, 0.5, 0.55)
      ps.color2 = new Color4(0.3, 0.3, 0.38, 0.45)
      ps.colorDead = new Color4(0.25, 0.25, 0.32, 0)
      ps.minSize = 2.2 * this.scale; ps.maxSize = 4.2 * this.scale
      ps.minLifeTime = 2.5; ps.maxLifeTime = 4.5
      ps.minEmitPower = 1.5; ps.maxEmitPower = 3
      ps.direction1 = new Vector3(-0.3, 1, -0.3); ps.direction2 = new Vector3(0.3, 1.4, 0.3)
      ps.gravity = new Vector3(-1.2, 0.4, 0.6)
      ps.minAngularSpeed = -0.5; ps.maxAngularSpeed = 0.5
      ps.start()
      this.smoke = ps
    } else {
      this.smoke = null
    }
    this.setVisible(false)
  }

  private setVisible(v: boolean): void {
    this.model.root.setEnabled(v)
    this.wake.mesh.setEnabled(v)
    if (!v && this.smoke) this.smoke.emitRate = 0
  }

  private mooringXZ(): XZ | null {
    return this.ship.mooring >= 0 ? berthCentre(MOORINGS[this.ship.mooring]!, (this.model.length * this.scale) / 2) : null
  }

  /** Where the ship is supposed to be right now (before smoothing), and whether it's under way. */
  private target(night: Night, dt: number): { x: number; z: number; h: number; moving: boolean; fade: number } | null {
    const s = this.ship
    const t = night.time
    const halfBeam = (this.model.beam * this.scale) / 2
    const W = CHANNEL_HALF - halfBeam
    if (s.state === 'due' || s.state === 'gone') return null
    if (this.mooringUsed !== s.mooring && s.state !== 'aground') {
      this.mooringUsed = s.mooring
      this.path = new ShipPath(s.plan.lane, this.mooringXZ())
    }
    if (s.state === 'aground') {
      if (!this.grounded) {
        this.grounded = true
        // stay where it struck, pushed a little further onto the rocks
        this.path.poseAt(s.u, s.plan.side * (CHANNEL_HALF + halfBeam * 0.2) * ShipPath.driftWeight(s.u), this.pose)
        this.groundX = this.pose.x
        this.groundZ = this.pose.z
        this.groundH = headingOf(this.pose.tx, this.pose.tz) - s.plan.side * 0.25
      }
      return { x: this.groundX, z: this.groundZ, h: this.groundH, moving: false, fade: 1 }
    }
    if (s.state === 'towed') {
      if (this.specialKind !== 'tow') {
        const dock = this.mooringXZ() ?? ANCHORAGE
        const pts: XZ[] = [{ x: this.groundX, z: this.groundZ }, { x: CHANNEL.EXIT.x, z: CHANNEL.EXIT.z }]
        pts.push(...berthApproach(dock))
        this.special = ShipPath.through(pts)
        this.specialKind = 'tow'
      }
      const p = smoothstep(0, 1, clamp((t - s.towStart) / Config.TOW_TIME, 0, 1))
      this.special!.at(p * this.special!.length, this.pose)
      const end = p > 0.97
      return { x: this.pose.x, z: this.pose.z, h: end ? MOORING_HEADING : headingOf(this.pose.tx, this.pose.tz), moving: !end, fade: 1 }
    }
    if (s.state === 'leaving') {
      if (this.specialKind !== 'leave') {
        const berth = s.mooring >= 0 ? this.mooringXZ()! : { x: this.pos.x, z: this.pos.z }
        const route = departure(berth)
        this.special = ShipPath.through(route.points)
        this.backing = route.backing
        this.specialKind = 'leave'
      }
      const q = clamp((t - s.leaveStart) / Config.LEAVE_TIME, 0, 1)
      const along = q * q * this.special!.length
      this.special!.at(along, this.pose)
      // backing out keeps the bow pointing east
      const h = along < this.backing * 0.9 ? MOORING_HEADING : headingOf(this.pose.tx, this.pose.tz)
      return { x: this.pose.x, z: this.pose.z, h, moving: along > this.backing, fade: 1 - smoothstep(0.85, 1, q) }
    }
    if (s.state === 'moored') {
      const m = this.mooringXZ()
      if (m) return { x: m.x, z: m.z, h: MOORING_HEADING, moving: false, fade: 1 }
    }
    const weight = ShipPath.driftWeight(s.u)
    const lateral = s.plan.side * s.drift * W * weight
    this.path.poseAt(s.u, lateral, this.pose)
    // turn toward where the drift is taking it
    const along = this.path.line.sAt(s.u)
    const ds = Math.max(2, Math.abs(along - this.lastS) / Math.max(dt, 1e-3))
    this.lastS = along
    const latVel = s.plan.side * s.driftVel * W * weight
    const k = clamp(latVel / ds, -0.5, 0.5)
    const hx = this.pose.tx + -this.pose.tz * k
    const hz = this.pose.tz + this.pose.tx * k
    this.speed = ds
    return { x: this.pose.x, z: this.pose.z, h: headingOf(hx, hz), moving: s.u < 3.95, fade: 1 }
  }

  update(night: Night, env: Env, dt: number, snap: boolean): void {
    const s = this.ship
    const tgt = this.target(night, dt)
    if (!tgt) {
      if (this.placed) this.setVisible(false)
      this.placed = false
      this.wake.reset()
      return
    }
    if (!this.placed) {
      this.setVisible(true)
      snap = true
    }
    this.placed = true
    const root = this.model.root
    const a = snap ? 1 : 1 - Math.exp(-dt / 0.35)
    this.pos.x += (tgt.x - this.pos.x) * a
    this.pos.z += (tgt.z - this.pos.z) * a
    let dh = tgt.h - this.heading
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    this.heading += dh * (snap ? 1 : 1 - Math.exp(-dt / 0.6))
    const t = env.time
    const L = this.model.length * this.scale * 0.45
    const B = this.model.beam * this.scale * 0.5
    const hx = Math.cos(this.heading), hz = -Math.sin(this.heading)
    const damp = 1 / (1 + this.model.length / 30)
    const h0 = waveHeight(this.pos.x, this.pos.z, t, env.waveAmp)
    const hb = waveHeight(this.pos.x + hx * L, this.pos.z + hz * L, t, env.waveAmp)
    const hs = waveHeight(this.pos.x - hx * L, this.pos.z - hz * L, t, env.waveAmp)
    const hp = waveHeight(this.pos.x - hz * B, this.pos.z + hx * B, t, env.waveAmp)
    const hq = waveHeight(this.pos.x + hz * B, this.pos.z - hx * B, t, env.waveAmp)
    root.position.set(this.pos.x, h0 * (0.5 + 0.5 * damp), this.pos.z)
    root.rotation.y = this.heading
    const body = this.model.body
    let pitch = Math.atan2(hb - hs, 2 * L) * (0.6 + 0.6 * damp)
    let roll = Math.atan2(hp - hq, 2 * B) * (0.5 + 0.5 * damp) + Math.sin(t * 0.9 + s.id) * 0.02 * env.waveAmp
    // on the rocks: shudder and heel; aground: listing, bow up
    const wantList = s.state === 'aground' || s.state === 'towed' ? 1 : 0
    this.listing += (wantList - this.listing) * Math.min(1, dt * (wantList ? 2 : 0.3))
    if (s.onRocks && s.state !== 'aground') {
      roll += Math.sin(t * 38) * 0.02 + s.plan.side * 0.05
      pitch += Math.sin(t * 29) * 0.01
    }
    roll += -s.plan.side * this.listing * 0.16
    pitch += this.listing * 0.06
    body.rotation.set(-roll, 0, pitch)
    body.position.y = this.listing * 0.8 - (1 - tgt.fade) * this.model.length * 0.4

    // the hail lamp flashes · — · while the ship waits for an answer, and blinks fast when answered
    const hail = s.hail
    let signal = false
    if (hail && !hail.missed) {
      const since = night.time - hail.opened
      if (!hail.answered) signal = MORSE[Math.floor(t * 4) % MORSE.length] === 1
      else if (since < Config.HAIL_WINDOW + 4) signal = Math.floor(t * 10) % 2 === 0
    }
    this.model.signal.setEnabled(signal && s.watching)
    if (hail && hail.answered) this.model.signalMat.emissiveColor.set(0.6, 1, 0.7)

    const moving = tgt.moving
    const sternX = this.pos.x + hx * this.model.stern * this.scale
    const sternZ = this.pos.z + hz * this.model.stern * this.scale
    this.wake.update(sternX, sternZ, hx, hz, night.time, moving, env)
    if (this.smoke) {
      const f = this.model.funnels[Math.floor(t * 7) % this.model.funnels.length]!
      const world = Vector3.TransformCoordinates(f, body.computeWorldMatrix(true))
      ;(this.smoke.emitter as Vector3).copyFrom(world)
      this.smoke.emitRate = (moving ? 7 : 2) * this.model.funnels.length * (s.state === 'aground' ? 0.3 : 1)
    }
    if (s.state === 'leaving' && tgt.fade <= 0.01) this.setVisible(false)
  }

  /** The bow's world position (for the tow line). */
  bow(): Vector3 {
    const hx = Math.cos(this.heading), hz = -Math.sin(this.heading)
    const L = this.model.length * this.scale * 0.5
    return new Vector3(this.pos.x + hx * L, 1.5, this.pos.z + hz * L)
  }

  get speedNow(): number { return this.speed }
}

export interface ShipTag {
  id: number
  x: number
  y: number
  visible: boolean
  dist: number
}

export class FleetView {
  private readonly views = new Map<number, ShipView>()
  private readonly tug: ShipModel
  private readonly towLine: Mesh
  private readonly tugWake: Wake
  readonly tags: ShipTag[] = []
  private readonly scene: Scene

  constructor(scene: Scene, night: Night, dot: Texture) {
    this.scene = scene
    const wakeMat = new StandardMaterial('wakeMat', scene)
    wakeMat.disableLighting = true
    wakeMat.emissiveColor = new Color3(1, 1, 1)
    wakeMat.diffuseColor = new Color3(0, 0, 0)
    wakeMat.backFaceCulling = false
    wakeMat.disableDepthWrite = true
    wakeMat.zOffset = -1
    for (const s of night.ships) this.views.set(s.id, new ShipView(scene, s, wakeMat, dot))
    this.tug = buildShip(scene, 'packet', 9999)
    this.tug.root.scaling.setAll(SHIP_SCALE * 0.9)
    this.tug.root.setEnabled(false)
    this.towLine = this.makeLine()
    this.tugWake = new Wake(scene, wakeMat, 5)
  }

  private makeLine(): Mesh {
    const m = new Mesh('towLine', this.scene)
    const vd = VertexData.CreateCylinder({ height: 1, diameter: 0.5, tessellation: 5 })
    vd.applyToMesh(m)
    const mat = new StandardMaterial('towLineMat', this.scene)
    mat.diffuseColor = new Color3(0.85, 0.8, 0.6)
    m.material = mat
    m.setEnabled(false)
    return m
  }

  view(id: number): ShipView | undefined { return this.views.get(id) }

  /** A ship's position (for the camera and effects). */
  positionOf(id: number): Vector3 | null {
    const v = this.views.get(id)
    return v ? v.pos : null
  }

  update(night: Night, env: Env, dt: number, snap: boolean, camera: Camera, engine: Engine): void {
    let towed: ShipView | null = null
    for (const v of this.views.values()) {
      v.update(night, env, dt, snap)
      if (v.ship.state === 'towed') towed = v
    }
    // the tug leads the towed ship in
    if (towed) {
      const bow = towed.bow()
      const hx = Math.cos(towed.heading), hz = -Math.sin(towed.heading)
      const tx = bow.x + hx * 26, tz = bow.z + hz * 26
      this.tug.root.setEnabled(true)
      this.tug.root.position.set(tx, waveHeight(tx, tz, env.time, env.waveAmp) * 0.7, tz)
      this.tug.root.rotation.y = towed.heading
      const stern = new Vector3(tx - hx * 9, 2.2, tz - hz * 9)
      const mid = bow.add(stern).scale(0.5)
      const len = bow.subtract(stern).length()
      this.towLine.setEnabled(true)
      this.towLine.position.copyFrom(mid)
      this.towLine.scaling.set(1, len, 1)
      const d = stern.subtract(bow).normalize()
      this.towLine.rotation.set(Math.PI / 2, Math.atan2(d.x, d.z), 0)
      this.tugWake.update(stern.x, stern.z, hx, hz, night.time, true, env)
      this.tugWake.mesh.setEnabled(true)
    } else {
      this.tug.root.setEnabled(false)
      this.towLine.setEnabled(false)
      this.tugWake.mesh.setEnabled(false)
    }

    // name tags for ships on the board (inbound, on watch, aground)
    this.tags.length = 0
    const w = engine.getRenderWidth(), h = engine.getRenderHeight()
    const canvas = engine.getRenderingCanvas()!
    const sx = canvas.clientWidth / w, sy = canvas.clientHeight / h
    const transform = camera.getTransformationMatrix()
    const vp = camera.viewport.toGlobal(w, h)
    const fwd = camera.getDirection(Vector3.Forward())
    for (const v of this.views.values()) {
      const st = v.ship.state
      if (!(st === 'inbound' || st === 'approach' || st === 'channel' || st === 'aground' || st === 'harbor')) continue
      const top = new Vector3(v.pos.x, v.model.length * v.scale * 0.35 + 14, v.pos.z)
      const to = top.subtract(camera.position)
      const s = Vector3.Project(top, Matrix.IdentityReadOnly, transform, vp)
      this.tags.push({ id: v.ship.id, x: s.x * sx, y: s.y * sy, visible: Vector3.Dot(to, fwd) > 0 && s.z > 0 && s.z < 1, dist: to.length() })
    }
  }
}
