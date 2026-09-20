/** Rain around the camera, and lightning in storms (a flash across everything, and a bolt out at sea). */
import {
  Color3, Color4, Mesh, ParticleSystem, StandardMaterial, Vector3, VertexData, type Camera, type Scene, type Texture,
} from '@babylonjs/core'
import { makeRng, type Rng } from '../rng.ts'
import type { WeatherMix } from '../sim/weather.ts'

export class WeatherView {
  private readonly rain: ParticleSystem
  private readonly rng: Rng
  private readonly bolt: Mesh
  private nextStrike = 6
  private flashT = -1
  private flashPattern: number[] = []
  /** 0–1 lightning brightness this frame. */
  lightning = 0

  constructor(scene: Scene, dot: Texture, seed: number) {
    this.rng = makeRng(seed, 'weatherView')
    const ps = new ParticleSystem('rain', 3000, scene)
    ps.particleTexture = dot
    ps.emitter = new Vector3()
    // rain falls in a slab in front of the camera, not on top of it
    ps.minEmitBox = new Vector3(-160, 30, 60)
    ps.maxEmitBox = new Vector3(160, 70, 320)
    ps.color1 = new Color4(0.7, 0.78, 1, 0.3)
    ps.color2 = new Color4(0.6, 0.7, 0.95, 0.22)
    ps.colorDead = new Color4(0.6, 0.7, 0.95, 0)
    ps.minSize = 0.25; ps.maxSize = 0.4
    ps.minScaleY = 6; ps.maxScaleY = 9
    ps.minLifeTime = 1; ps.maxLifeTime = 1.3
    ps.minEmitPower = 60; ps.maxEmitPower = 80
    ps.direction1 = new Vector3(-0.15, -1, 0.05); ps.direction2 = new Vector3(-0.05, -1, 0.15)
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED
    ps.emitRate = 0
    ps.start()
    this.rain = ps

    this.bolt = new Mesh('bolt', scene)
    const mat = new StandardMaterial('boltMat', scene)
    mat.disableLighting = true
    mat.emissiveColor = new Color3(0.85, 0.9, 1)
    mat.backFaceCulling = false
    this.bolt.material = mat
    this.bolt.setEnabled(false)
    this.makeBolt()
  }

  private makeBolt(): void {
    const positions: number[] = []
    const indices: number[] = []
    let x = 0, y = 260
    const segs = 12
    for (let i = 0; i <= segs; i++) {
      const w = 2.6 * (1 - i / segs) + 0.8
      positions.push(x - w, y, 0, x + w, y, 0)
      if (i < segs) {
        const b = i * 2
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
      }
      x += this.rng.range(-18, 18)
      y -= 260 / segs
    }
    const vd = new VertexData()
    vd.positions = positions
    vd.indices = indices
    vd.applyToMesh(this.bolt, true)
  }

  update(dt: number, mix: WeatherMix, camera: Camera): void {
    const rain = mix.rain
    ;(this.rain.emitter as Vector3).set(camera.position.x, camera.position.y - 40, camera.position.z)
    this.rain.emitRate = rain * 2400
    this.lightning = 0
    if (mix.storm > 0.4) {
      this.nextStrike -= dt
      if (this.nextStrike <= 0 && this.flashT < 0) {
        this.nextStrike = this.rng.range(5, 14) / mix.storm
        this.flashT = 0
        this.flashPattern = [0, 0.08, 0.16, 0.3 + this.rng.range(0, 0.2)]
        this.makeBolt()
        const a = this.rng.range(-0.9, 0.9)
        const d = this.rng.range(900, 1500)
        this.bolt.position.set(Math.sin(a) * d, 0, Math.cos(a) * d)
        this.bolt.rotation.y = this.rng.range(-0.3, 0.3)
        this.bolt.scaling.setAll(this.rng.range(1.2, 2))
      }
    }
    if (this.flashT >= 0) {
      this.flashT += dt
      const p = this.flashPattern
      const on = (this.flashT < p[1]! ? 1 : this.flashT < p[2]! ? 0.3 : this.flashT < p[3]! ? 0.8 : 0)
      this.lightning = on * Math.max(0.5, mix.storm)
      this.bolt.setEnabled(on > 0.5)
      if (this.flashT > p[3]!) {
        this.flashT = -1
        this.bolt.setEnabled(false)
      }
    }
  }
}
