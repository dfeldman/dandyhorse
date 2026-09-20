/** The sea (a polar grid, dense near the harbour) and the sky dome. */
import { Mesh, MeshBuilder, Vector2, Vector4, VertexData, type Scene, type ShaderMaterial } from '@babylonjs/core'
import { applyFog, applyLamp, col3, type Env } from './env.ts'
import { HARBOR_CENTER } from './coast.ts'
import { WAVE_CENTER, seaMaterial, skyMaterial } from './shaders.ts'

export class Sea {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial

  constructor(scene: Scene) {
    const rings = 150
    const segs = 220
    const positions: number[] = [0, 0, 0]
    const indices: number[] = []
    let r = 2.5
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2
        positions.push(Math.cos(a) * r, 0, Math.sin(a) * r)
      }
      r = Math.min(r * 1.046 + 1.2, 6500)
    }
    const at = (i: number, j: number): number => 1 + i * segs + (j % segs)
    for (let j = 0; j < segs; j++) indices.push(0, at(0, j + 1), at(0, j))
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        indices.push(at(i, j), at(i, j + 1), at(i + 1, j))
        indices.push(at(i, j + 1), at(i + 1, j + 1), at(i + 1, j))
      }
    }
    const vd = new VertexData()
    vd.positions = positions
    vd.indices = indices
    this.mesh = new Mesh('sea', scene)
    vd.applyToMesh(this.mesh)
    this.mesh.position.set(WAVE_CENTER.x, 0, WAVE_CENTER.z)
    this.mesh.isPickable = false
    this.mesh.alwaysSelectAsActiveMesh = true
    this.mat = seaMaterial(scene)
    this.mat.backFaceCulling = false
    this.mesh.material = this.mat
    this.mat.setVector2('waveCenter', new Vector2(WAVE_CENTER.x, WAVE_CENTER.z))
    this.mat.setVector2('harbor', new Vector2(HARBOR_CENTER.x, HARBOR_CENTER.z))
  }

  update(env: Env): void {
    const m = this.mat
    const L = env.look
    applyFog(m, env)
    applyLamp(m, env)
    m.setFloat('waveAmp', env.waveAmp)
    m.setColor3('seaDeep', col3(L.seaDeep))
    m.setColor3('skyTop', col3(L.skyTop))
    m.setColor3('skyHorizon', col3(L.skyHorizon))
    m.setVector3('moonDir', env.moonDir)
    m.setFloat('moonAmt', L.moon)
    m.setColor3('glowColor', col3(L.glow))
    m.setFloat('glowAmt', L.glowAmt)
    m.setVector3('sunDir', env.sunDir)
    m.setFloat('flash', env.flash)
    m.setFloat('harborGlow', env.harborGlow)
  }
}

export class Sky {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial
  aurora = 0
  /** A shooting star: azimuth, elevation, progress (−1 = none), length. */
  shooting = { az: 0, el: 0, t: -1, len: 0.5 }
  private readonly shoot = new Vector4()

  constructor(scene: Scene) {
    this.mesh = MeshBuilder.CreateSphere('sky', { diameter: 9000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene)
    this.mesh.infiniteDistance = true
    this.mesh.isPickable = false
    this.mesh.applyFog = false
    this.mat = skyMaterial(scene)
    this.mesh.material = this.mat
    this.mesh.renderingGroupId = 0
  }

  update(env: Env): void {
    const m = this.mat
    const L = env.look
    m.setFloat('time', env.time)
    m.setColor3('skyTop', col3(L.skyTop))
    m.setColor3('skyHorizon', col3(L.skyHorizon))
    m.setColor3('glowColor', col3(L.glow))
    m.setFloat('glowAmt', L.glowAmt)
    m.setVector3('sunDir', env.sunDir)
    m.setFloat('sunUp', L.sun)
    m.setVector3('moonDir', env.moonDir)
    m.setFloat('moonAmt', L.moon)
    m.setFloat('starAmt', L.stars)
    m.setFloat('cloudAmt', L.clouds)
    m.setColor3('cloudColor', col3(L.cloudColor))
    m.setFloat('aurora', this.aurora * L.stars)
    m.setFloat('flash', env.flash)
    m.setColor3('fogColor', env.fogColor)
    m.setFloat('fogAmt', Math.min(1, env.fogAmt))
    const s = this.shooting
    m.setVector4('shooting', this.shoot.set(s.az, s.el, s.t, s.len))
  }
}
