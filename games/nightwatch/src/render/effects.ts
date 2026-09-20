/**
 * One-off and ambient visuals: the horn's rings across the water, sparks and splinters on the rocks, splashes,
 * a gold sparkle when a ship comes home, fireworks over the harbour, distress flares, and the scenery that makes the
 * night feel alive (a whale that breaches, shooting stars, gulls at dawn, the aurora on some nights).
 */
import {
  Color3, Color4, Constants, Mesh, MeshBuilder, ParticleSystem, StandardMaterial, TransformNode, Vector3, type Scene, type Texture,
} from '@babylonjs/core'
import { makeRng, smoothstep, type Rng } from '../rng.ts'
import { CHANNEL, HARBOR_CENTER, LAMP, LIGHTHOUSE } from './coast.ts'
import type { Env } from './env.ts'
import { Kit } from './kit.ts'
import type { Sky } from './seaSky.ts'
import { waveHeight } from './shaders.ts'

interface Ring { mesh: Mesh; mat: StandardMaterial; age: number; life: number; size: number }
interface Rocket { at: Vector3; vel: Vector3; age: number; color: Color3; burst: boolean }

export class Effects {
  private readonly scene: Scene
  private readonly rng: Rng
  private readonly rings: Ring[] = []
  private readonly sparks: ParticleSystem
  private readonly splash: ParticleSystem
  private readonly sparkle: ParticleSystem
  private readonly fireworks: ParticleSystem
  private readonly trail: ParticleSystem
  private readonly spout: ParticleSystem
  private readonly flare: ParticleSystem
  private readonly rockets: Rocket[] = []
  private fireworkQueue = 0
  private fireworkTimer = 0
  private fireworkAt = new Vector3()
  // scenery
  private readonly whale: TransformNode
  private whaleT = -1
  private whaleAt = new Vector3()
  private whaleDir = 0
  private nextWhale = 70
  private nextShooting = 25
  private readonly gulls: { node: TransformNode; wings: Mesh[]; phase: number; r: number; h: number; speed: number }[] = []
  private readonly sky: Sky

  constructor(scene: Scene, dot: Texture, sky: Sky, seed: number) {
    this.scene = scene
    this.sky = sky
    this.rng = makeRng(seed, 'effects')
    const system = (name: string, cap: number, setup: (ps: ParticleSystem) => void): ParticleSystem => {
      const ps = new ParticleSystem(name, cap, scene)
      ps.particleTexture = dot
      ps.emitter = new Vector3()
      ps.emitRate = 0
      ps.minEmitBox = new Vector3(-1, 0, -1)
      ps.maxEmitBox = new Vector3(1, 0, 1)
      setup(ps)
      ps.start()
      return ps
    }
    this.sparks = system('sparks', 500, (ps) => {
      ps.color1 = new Color4(1, 0.85, 0.4, 1); ps.color2 = new Color4(1, 0.5, 0.15, 1); ps.colorDead = new Color4(1, 0.2, 0, 0)
      ps.minSize = 0.5; ps.maxSize = 1.2
      ps.minLifeTime = 0.3; ps.maxLifeTime = 0.8
      ps.minEmitPower = 8; ps.maxEmitPower = 18
      ps.gravity = new Vector3(0, -20, 0)
      ps.direction1 = new Vector3(-1, 0.8, -1); ps.direction2 = new Vector3(1, 2, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.splash = system('splash', 600, (ps) => {
      ps.color1 = new Color4(0.85, 0.9, 1, 0.9); ps.color2 = new Color4(0.7, 0.8, 1, 0.7); ps.colorDead = new Color4(0.6, 0.7, 0.9, 0)
      ps.minSize = 1.5; ps.maxSize = 4
      ps.minLifeTime = 0.6; ps.maxLifeTime = 1.4
      ps.minEmitPower = 6; ps.maxEmitPower = 14
      ps.gravity = new Vector3(0, -14, 0)
      ps.direction1 = new Vector3(-0.6, 1.5, -0.6); ps.direction2 = new Vector3(0.6, 2.5, 0.6)
    })
    this.sparkle = system('sparkle', 400, (ps) => {
      ps.color1 = new Color4(1, 0.9, 0.35, 1); ps.color2 = new Color4(1, 1, 0.8, 1); ps.colorDead = new Color4(1, 0.7, 0.2, 0)
      ps.minSize = 1; ps.maxSize = 2.4
      ps.minLifeTime = 0.8; ps.maxLifeTime = 1.6
      ps.minEmitPower = 3; ps.maxEmitPower = 9
      ps.gravity = new Vector3(0, 3, 0)
      ps.direction1 = new Vector3(-1, 0.5, -1); ps.direction2 = new Vector3(1, 2, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.fireworks = system('fireworks', 2400, (ps) => {
      ps.minSize = 2.4; ps.maxSize = 4.5
      ps.minLifeTime = 1.2; ps.maxLifeTime = 2.2
      ps.minEmitPower = 22; ps.maxEmitPower = 34
      ps.gravity = new Vector3(0, -9, 0)
      ps.direction1 = new Vector3(-1, -1, -1); ps.direction2 = new Vector3(1, 1, 1)
      ps.minEmitBox = new Vector3(0, 0, 0); ps.maxEmitBox = new Vector3(0, 0, 0)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.trail = system('rocketTrail', 600, (ps) => {
      ps.color1 = new Color4(1, 0.8, 0.5, 1); ps.color2 = new Color4(1, 0.6, 0.3, 1); ps.colorDead = new Color4(0.6, 0.3, 0.2, 0)
      ps.minSize = 1; ps.maxSize = 1.8
      ps.minLifeTime = 0.3; ps.maxLifeTime = 0.6
      ps.minEmitPower = 0.2; ps.maxEmitPower = 1
      ps.minEmitBox = new Vector3(0, 0, 0); ps.maxEmitBox = new Vector3(0, 0, 0)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.spout = system('spout', 300, (ps) => {
      ps.color1 = new Color4(0.85, 0.9, 1, 0.8); ps.color2 = new Color4(0.75, 0.85, 1, 0.6); ps.colorDead = new Color4(0.7, 0.8, 1, 0)
      ps.minSize = 1.5; ps.maxSize = 3.5
      ps.minLifeTime = 0.9; ps.maxLifeTime = 1.6
      ps.minEmitPower = 12; ps.maxEmitPower = 18
      ps.gravity = new Vector3(0, -9, 0)
      ps.direction1 = new Vector3(-0.2, 1, -0.2); ps.direction2 = new Vector3(0.2, 1, 0.2)
      ps.minEmitBox = new Vector3(-0.3, 0, -0.3); ps.maxEmitBox = new Vector3(0.3, 0, 0.3)
    })
    this.flare = system('flare', 200, (ps) => {
      ps.color1 = new Color4(1, 0.25, 0.2, 1); ps.color2 = new Color4(1, 0.5, 0.3, 1); ps.colorDead = new Color4(0.8, 0.1, 0.1, 0)
      ps.minSize = 2.5; ps.maxSize = 5
      ps.minLifeTime = 1.5; ps.maxLifeTime = 3
      ps.minEmitPower = 1; ps.maxEmitPower = 4
      ps.gravity = new Vector3(0, -2, 0)
      ps.direction1 = new Vector3(-1, -0.5, -1); ps.direction2 = new Vector3(1, 0.5, 1)
      ps.blendMode = ParticleSystem.BLENDMODE_ADD
    })
    this.whale = this.buildWhale()
    this.buildGulls()
  }

  private buildWhale(): TransformNode {
    const node = new TransformNode('whale', this.scene)
    const k = new Kit(this.scene, 'whale')
    k.sphere(9, [0, 0, 0], '#2d3a5c', { seg: 4, scale: [2.6, 0.8, 1] })
    k.sphere(7, [-0.6, -1.2, 0], '#c8d0e0', { seg: 3, scale: [2.4, 0.5, 0.9] })
    k.box([5, 0.5, 1.2], [-13, 0.4, 0], '#2d3a5c')
    k.box([3, 0.3, 7], [-15.2, 0.6, 0], '#2d3a5c', { rot: [0, 0, 0.2] })
    k.box([3.4, 0.3, 1.2], [2, -1.4, 4], '#2d3a5c', { rot: [0.5, 0.3, 0] })
    k.box([3.4, 0.3, 1.2], [2, -1.4, -4], '#2d3a5c', { rot: [-0.5, -0.3, 0] })
    k.sphere(0.5, [9, 1.2, 2.4], '#0a0a12', { seg: 2 })
    k.sphere(0.5, [9, 1.2, -2.4], '#0a0a12', { seg: 2 })
    k.build(node)
    node.setEnabled(false)
    return node
  }

  private buildGulls(): void {
    const mat = new StandardMaterial('gullMat', this.scene)
    mat.diffuseColor = new Color3(0.95, 0.95, 1)
    mat.emissiveColor = new Color3(0.45, 0.45, 0.5)
    for (let i = 0; i < 7; i++) {
      const node = new TransformNode('gull', this.scene)
      const body = MeshBuilder.CreateBox('gullBody', { width: 1.8, height: 0.5, depth: 0.6 }, this.scene)
      body.material = mat
      body.parent = node
      const wings: Mesh[] = []
      for (const s of [1, -1]) {
        const w = MeshBuilder.CreateBox('gullWing', { width: 1.1, height: 0.12, depth: 3.2 }, this.scene)
        w.material = mat
        w.parent = node
        w.position.z = s * 1.7
        wings.push(w)
      }
      node.setEnabled(false)
      this.gulls.push({ node, wings, phase: this.rng.range(0, 6), r: this.rng.range(25, 70), h: this.rng.range(30, 70), speed: this.rng.range(0.25, 0.45) * (this.rng() < 0.5 ? 1 : -1) })
    }
  }

  // --- triggers -----------------------------------------------------------------------------------------

  hornRings(strength: number): void {
    for (let i = 0; i < 3; i++) {
      const mesh = MeshBuilder.CreateTorus('hornRing', { diameter: 1, thickness: 0.02, tessellation: 64 }, this.scene)
      const mat = new StandardMaterial('hornRingMat', this.scene)
      mat.disableLighting = true
      mat.emissiveColor = new Color3(0.8, 0.95, 1)
      mat.alphaMode = Constants.ALPHA_ADD
      mat.disableDepthWrite = true
      mesh.material = mat
      mesh.position.set(LIGHTHOUSE.x, 1.2, LIGHTHOUSE.z)
      mesh.scaling.set(1, 0.3, 1)
      this.rings.push({ mesh, mat, age: -i * 0.35, life: 3.2, size: 700 * strength })
    }
  }

  scrape(at: Vector3, big: boolean): void {
    const p = at.clone()
    p.y = 2
    this.sparks.emitter = p
    this.sparks.manualEmitCount += big ? 40 : 18
    this.splash.emitter = p.clone()
    this.splash.manualEmitCount += big ? 30 : 12
  }

  splashAt(at: Vector3, count: number): void {
    this.splash.emitter = at.clone()
    this.splash.manualEmitCount += count
  }

  homeSparkle(at: Vector3, stars: number): void {
    const p = at.clone()
    p.y = 12
    this.sparkle.emitter = p
    this.sparkle.manualEmitCount += 20 + stars * 25
  }

  /** Rockets over the harbour. */
  celebrate(count: number, at?: Vector3): void {
    this.fireworkQueue += count
    this.fireworkAt.set(at?.x ?? HARBOR_CENTER.x + 30, 0, at?.z ?? HARBOR_CENTER.z - 60)
  }

  /** A red distress flare from a ship on the rocks. */
  distress(at: Vector3): void {
    this.rockets.push({ at: new Vector3(at.x, 8, at.z), vel: new Vector3(this.rng.range(-3, 3), 55, this.rng.range(-3, 3)), age: 0, color: new Color3(1, 0.2, 0.15), burst: false })
  }

  // --- per frame ------------------------------------------------------------------------------------------

  update(dt: number, env: Env, progress: number, calm: boolean): void {
    const t = env.time
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!
      r.age += dt
      const k = Math.max(0, r.age) / r.life
      if (k >= 1) {
        r.mesh.dispose()
        r.mat.dispose()
        this.rings.splice(i, 1)
        continue
      }
      const d = 20 + r.size * smoothstep(0, 1, Math.sqrt(k))
      r.mesh.scaling.set(d, 0.3, d)
      r.mesh.visibility = r.age < 0 ? 0 : (1 - k) * 0.9
    }

    // rockets: rise, then burst
    if (this.fireworkQueue > 0) {
      this.fireworkTimer -= dt
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = this.rng.range(0.25, 0.6)
        this.fireworkQueue--
        const c = Color3.FromHSV(this.rng.range(0, 360), 0.75, 1)
        const a = this.fireworkAt
        this.rockets.push({ at: new Vector3(a.x + this.rng.range(-70, 70), 6, a.z + this.rng.range(-40, 40)), vel: new Vector3(this.rng.range(-4, 4), this.rng.range(55, 70), this.rng.range(-4, 4)), age: 0, color: c, burst: true })
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!
      r.age += dt
      r.vel.y -= 18 * dt
      r.at.addInPlace(r.vel.scale(dt))
      this.trail.emitter = r.at.clone()
      this.trail.color1 = new Color4(r.color.r, r.color.g, r.color.b, 1)
      this.trail.manualEmitCount += 2
      if (r.vel.y < 8) {
        if (r.burst) {
          this.fireworks.color1 = new Color4(r.color.r, r.color.g, r.color.b, 1)
          this.fireworks.color2 = new Color4(1, 1, 1, 1)
          this.fireworks.colorDead = new Color4(r.color.r, r.color.g, r.color.b, 0)
          this.fireworks.emitter = r.at.clone()
          this.fireworks.manualEmitCount += 220
          env.flash = Math.max(env.flash, 0.05)
        } else {
          // a distress flare hangs and drifts down
          this.flare.emitter = r.at.clone()
          this.flare.manualEmitCount += 40
          env.flash = Math.max(env.flash, 0.03)
        }
        this.rockets.splice(i, 1)
      }
    }

    this.updateWhale(dt, t, env)
    this.updateShootingStar(dt)
    this.updateGulls(t, progress)
    void calm
  }

  private updateWhale(dt: number, t: number, env: Env): void {
    this.nextWhale -= dt
    if (this.whaleT < 0 && this.nextWhale <= 0) {
      this.nextWhale = this.rng.range(90, 200)
      this.whaleT = 0
      // somewhere in open water, clear of the channel
      const side = this.rng() < 0.5 ? -1 : 1
      this.whaleAt.set(CHANNEL.MID.x + side * this.rng.range(160, 320), 0, this.rng.range(380, 700))
      this.whaleDir = this.rng.range(0, Math.PI * 2)
      this.whale.setEnabled(true)
    }
    if (this.whaleT < 0) return
    this.whaleT += dt
    const T = 7
    const k = this.whaleT / T
    if (k >= 1) {
      this.whaleT = -1
      this.whale.setEnabled(false)
      return
    }
    // spout, then a breach: rise out in an arc and fall back with a splash
    const w = this.whale
    const hx = Math.cos(this.whaleDir), hz = -Math.sin(this.whaleDir)
    const along = (k - 0.5) * 40
    w.position.set(this.whaleAt.x + hx * along, 0, this.whaleAt.z + hz * along)
    const arc = Math.sin(Math.min(1, Math.max(0, (k - 0.25) / 0.6)) * Math.PI)
    w.position.y = -12 + arc * 22 + waveHeight(w.position.x, w.position.z, t, env.waveAmp)
    w.rotation.set(0, this.whaleDir, (0.5 - k) * 2.2 * (k > 0.25 ? 1 : 0))
    w.scaling.setAll(1.3)
    if (k < 0.2 && Math.floor(this.whaleT * 10) % 3 === 0) {
      this.spout.emitter = new Vector3(this.whaleAt.x - hx * 16, 1, this.whaleAt.z - hz * 16)
      this.spout.manualEmitCount += 4
    }
    const prev = (this.whaleT - dt) / T
    if ((prev < 0.3 && k >= 0.3) || (prev < 0.82 && k >= 0.82)) this.splashAt(w.position.add(new Vector3(0, 2, 0)), 60)
  }

  private updateShootingStar(dt: number): void {
    const s = this.sky.shooting
    if (s.t >= 0) {
      s.t += dt / 0.9
      if (s.t > 1) s.t = -1
      return
    }
    this.nextShooting -= dt
    if (this.nextShooting <= 0) {
      this.nextShooting = this.rng.range(20, 60)
      s.az = this.rng.range(-0.5, 0.7)
      s.el = this.rng.range(0.16, 0.24)
      s.len = this.rng.range(0.25, 0.5)
      s.t = 0
    }
  }

  private updateGulls(t: number, progress: number): void {
    // gulls come out at dawn and circle the lighthouse
    const on = progress > 0.93
    for (const g of this.gulls) {
      g.node.setEnabled(on)
      if (!on) continue
      const a = t * g.speed + g.phase
      g.node.position.set(LAMP.x + Math.cos(a) * g.r, g.h + Math.sin(t * 0.7 + g.phase) * 4, LAMP.z + Math.sin(a) * g.r)
      g.node.rotation.y = -a + (g.speed > 0 ? Math.PI : 0)
      const flap = Math.sin(t * 7 + g.phase) * 0.5
      g.wings[0]!.rotation.x = flap
      g.wings[0]!.position.y = Math.sin(flap) * 1.6
      g.wings[1]!.rotation.x = -flap
      g.wings[1]!.position.y = Math.sin(flap) * 1.6
    }
  }
}
