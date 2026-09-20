/**
 * Particles and one-off visuals: turbo sparks, drift sparks, bump sparks, spin smoke, landing dust, oil slicks,
 * fireworks at the flag.
 */
import {
  Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, StandardMaterial, Vector3, type Scene, type Texture,
} from '@babylonjs/core'
import { Config } from '../config.ts'
import type { Race, Slick } from '../sim/race.ts'
import type { Track } from '../sim/track.ts'
import { newPose } from '../sim/track.ts'
import type { CarView } from './carView.ts'

function dotTexture(scene: Scene): Texture {
  const t = new DynamicTexture('dot', { width: 64, height: 64 }, scene, false)
  const ctx = t.getContext() as CanvasRenderingContext2D
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  t.hasAlpha = true
  t.update()
  return t
}

function slickTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture('slick', { width: 256, height: 256 }, scene, true)
  const ctx = t.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, 256, 256)
  // a blobby puddle with a rainbow sheen
  ctx.fillStyle = 'rgba(8,6,14,0.95)'
  ctx.beginPath()
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const r = 100 + 18 * Math.sin(a * 3) + 10 * Math.cos(a * 5)
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.fill()
  const colors = ['#ff3df0', '#3dfcff', '#ffe14d', '#7dff9a']
  colors.forEach((c, i) => {
    ctx.strokeStyle = c
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.ellipse(128 + i * 6 - 10, 120 + i * 4, 70 - i * 12, 44 - i * 7, 0.4, 0, Math.PI * 2)
    ctx.stroke()
  })
  ctx.globalAlpha = 1
  t.hasAlpha = true
  t.update()
  return t
}

interface SlickView { id: number; mesh: Mesh; age: number }

export class Effects {
  private readonly scene: Scene
  private readonly tex: Texture
  private readonly slickMat: StandardMaterial
  private readonly slickTex: DynamicTexture
  private readonly slicks = new Map<number, SlickView>()
  private readonly sparks: ParticleSystem
  private readonly smoke: ParticleSystem
  private readonly dust: ParticleSystem
  private readonly fire: ParticleSystem
  private readonly fireworks: ParticleSystem
  private readonly drift: ParticleSystem
  private readonly pose = newPose()
  private fireworkTimer = 0
  private fireworksLeft = 0
  private fireworkAt = new Vector3()

  constructor(scene: Scene) {
    this.scene = scene
    this.tex = dotTexture(scene)
    this.slickTex = slickTexture(scene)
    this.slickMat = new StandardMaterial('slickMat', scene)
    this.slickMat.diffuseTexture = this.slickTex
    this.slickMat.useAlphaFromDiffuseTexture = true
    this.slickMat.specularColor = new Color3(0.9, 0.9, 1)
    this.slickMat.specularPower = 12
    this.slickMat.emissiveColor = new Color3(0.25, 0.25, 0.3)
    this.slickMat.zOffset = -2

    this.sparks = this.system('sparks', 400, (ps) => {
      ps.color1 = new Color4(1, 0.9, 0.4, 1)
      ps.color2 = new Color4(1, 0.5, 0.1, 1)
      ps.colorDead = new Color4(1, 0.2, 0, 0)
      ps.minSize = 0.12; ps.maxSize = 0.3
      ps.minLifeTime = 0.2; ps.maxLifeTime = 0.5
      ps.minEmitPower = 4; ps.maxEmitPower = 10
      ps.gravity = new Vector3(0, -12, 0)
      ps.direction1 = new Vector3(-1, 0.6, -1); ps.direction2 = new Vector3(1, 1.6, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.drift = this.system('drift', 400, (ps) => {
      ps.color1 = new Color4(0.4, 0.8, 1, 1)
      ps.color2 = new Color4(1, 0.9, 0.3, 1)
      ps.colorDead = new Color4(1, 0.4, 0.1, 0)
      ps.minSize = 0.08; ps.maxSize = 0.2
      ps.minLifeTime = 0.15; ps.maxLifeTime = 0.35
      ps.minEmitPower = 2; ps.maxEmitPower = 5
      ps.gravity = new Vector3(0, -6, 0)
      ps.direction1 = new Vector3(-1, 0.5, -1); ps.direction2 = new Vector3(1, 1.2, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.smoke = this.system('smoke', 300, (ps) => {
      ps.color1 = new Color4(0.75, 0.75, 0.85, 0.5)
      ps.color2 = new Color4(0.5, 0.5, 0.6, 0.4)
      ps.colorDead = new Color4(0.3, 0.3, 0.4, 0)
      ps.minSize = 1.2; ps.maxSize = 2.6
      ps.minLifeTime = 0.6; ps.maxLifeTime = 1.2
      ps.minEmitPower = 1; ps.maxEmitPower = 3
      ps.gravity = new Vector3(0, 2, 0)
      ps.direction1 = new Vector3(-1, 0.2, -1); ps.direction2 = new Vector3(1, 1, 1)
      ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    })
    this.dust = this.system('dust', 200, (ps) => {
      ps.color1 = new Color4(0.7, 0.7, 0.8, 0.45)
      ps.color2 = new Color4(0.5, 0.5, 0.6, 0.3)
      ps.colorDead = new Color4(0.4, 0.4, 0.5, 0)
      ps.minSize = 0.8; ps.maxSize = 1.8
      ps.minLifeTime = 0.3; ps.maxLifeTime = 0.7
      ps.minEmitPower = 2; ps.maxEmitPower = 5
      ps.direction1 = new Vector3(-1, 0.1, -1); ps.direction2 = new Vector3(1, 0.5, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    })
    this.fire = this.system('fire', 400, (ps) => {
      ps.color1 = new Color4(1, 0.7, 0.2, 1)
      ps.color2 = new Color4(0.4, 0.6, 1, 1)
      ps.colorDead = new Color4(0.6, 0.1, 0.4, 0)
      ps.minSize = 0.25; ps.maxSize = 0.6
      ps.minLifeTime = 0.1; ps.maxLifeTime = 0.3
      ps.minEmitPower = 1; ps.maxEmitPower = 3
      ps.direction1 = new Vector3(-0.3, 0.2, -1); ps.direction2 = new Vector3(0.3, 0.6, -1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.fireworks = this.system('fireworks', 1200, (ps) => {
      ps.minSize = 0.8; ps.maxSize = 1.8
      ps.minLifeTime = 0.9; ps.maxLifeTime = 1.6
      ps.minEmitPower = 14; ps.maxEmitPower = 24
      ps.gravity = new Vector3(0, -9, 0)
      ps.direction1 = new Vector3(-1, -1, -1); ps.direction2 = new Vector3(1, 1, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
  }

  private system(name: string, capacity: number, setup: (ps: ParticleSystem) => void): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene)
    ps.particleTexture = this.tex
    ps.emitter = new Vector3()
    ps.emitRate = 0
    ps.minEmitBox = new Vector3(-0.2, 0, -0.2)
    ps.maxEmitBox = new Vector3(0.2, 0, 0.2)
    ps.updateSpeed = 0.016
    setup(ps)
    ps.start()
    return ps
  }

  private burst(ps: ParticleSystem, at: Vector3, count: number): void {
    ps.emitter = at.clone()
    ps.manualEmitCount = (ps.manualEmitCount > 0 ? ps.manualEmitCount : 0) + count
  }

  sparksAt(at: Vector3, count = 30): void { this.burst(this.sparks, at, count) }
  smokeAt(at: Vector3, count = 6): void { this.burst(this.smoke, at, count) }
  dustAt(at: Vector3, count = 14): void { this.burst(this.dust, at, count) }
  fireAt(at: Vector3, count = 8): void { this.burst(this.fire, at, count) }

  celebrate(at: Vector3, bursts = 6): void {
    this.fireworksLeft = bursts
    this.fireworkTimer = 0
    this.fireworkAt.copyFrom(at)
  }

  /** Per frame: continuous effects from car state, and the slicks on the road. */
  update(dt: number, race: Race, views: Map<string, CarView>): void {
    for (const car of race.cars) {
      const v = views.get(car.id)
      if (!v) continue
      if (car.boost > 0 && Math.random() < dt * 40) this.fireAt(v.point(Config.CAR_LENGTH / 2 + 1.2, 0.4), 2)
      if (car.spin > 0 && Math.random() < dt * 12) this.smokeAt(v.point(0, 0.5), 1)
      const tight = Math.abs(race.track.curvatureAt(car.dist)) * car.speed * car.speed
      if (tight > 55 && car.onGround && Math.random() < dt * 30) {
        this.drift.color1 = tight > 80 ? new Color4(1, 0.6, 0.2, 1) : new Color4(0.4, 0.8, 1, 1)
        for (const side of [-0.95, 0.95]) this.burst(this.drift, v.point(1.4, 0.1, side), 1)
      }
    }
    this.syncSlicks(dt, race.slicks, race.track)
    if (this.fireworksLeft > 0) {
      this.fireworkTimer -= dt
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = 0.35
        this.fireworksLeft--
        const hue = Math.random()
        const c = Color3.FromHSV(hue * 360, 0.8, 1)
        this.fireworks.color1 = new Color4(c.r, c.g, c.b, 1)
        this.fireworks.color2 = new Color4(1, 1, 1, 1)
        this.fireworks.colorDead = new Color4(c.r, c.g, c.b, 0)
        const at = this.fireworkAt.add(new Vector3((Math.random() - 0.5) * 60, 35 + Math.random() * 25, (Math.random() - 0.5) * 60))
        this.burst(this.fireworks, at, 160)
      }
    }
  }

  private syncSlicks(dt: number, slicks: Slick[], track: Track): void {
    const live = new Set(slicks.map((s) => s.id))
    for (const [id, v] of this.slicks) {
      if (!live.has(id)) { v.mesh.dispose(); this.slicks.delete(id) }
    }
    for (const s of slicks) {
      let v = this.slicks.get(s.id)
      if (!v) {
        const mesh = MeshBuilder.CreateGround(`slick${s.id}`, { width: Config.OIL_HALF_WIDTH * 2 + 1, height: Config.OIL_LENGTH + 1 }, this.scene)
        mesh.material = this.slickMat
        mesh.isPickable = false
        const p = track.poseAt(s.s, this.pose)
        mesh.position.set(p.x + p.rx * s.x + p.ux * 0.05, p.y + p.ry * s.x + p.uy * 0.05, p.z + p.rz * s.x + p.uz * 0.05)
        const hl = Math.hypot(p.tx, p.tz) || 1
        mesh.rotation.y = Math.atan2(p.tx / hl, p.tz / hl) + Math.random() * 0.6 - 0.3
        mesh.rotation.z = -p.bank
        v = { id: s.id, mesh, age: 0 }
        this.slicks.set(s.id, v)
        this.burst(this.smoke, mesh.position, 4)
      }
      v.age += dt
      const grow = Math.min(1, v.age / 0.35)
      const fade = Math.min(1, (Config.OIL_LIFETIME - s.age) / 2)
      const sc = (0.3 + 0.7 * grow) * Math.max(0.05, fade)
      v.mesh.scaling.set(sc, 1, sc)
    }
  }

  clearSlicks(): void {
    for (const v of this.slicks.values()) v.mesh.dispose()
    this.slicks.clear()
  }
}
