/**
 * The lighthouse: a red-and-white tower with a gallery and lantern, the lamp, a rotating lens, two sweeping beams
 * (glowing cones plus real spotlights), a flare that blazes when a beam swings toward the camera, and the keeper's
 * cottage with a smoking chimney.
 */
import {
  Color3, Color4, Constants, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, PointLight, SpotLight, StandardMaterial,
  TransformNode, Vector3, type Scene, type ShaderMaterial, type Texture,
} from '@babylonjs/core'
import { clamp } from '../rng.ts'
import { LAMP, LIGHTHOUSE, TOWER_HEIGHT } from './coast.ts'
import type { Env } from './env.ts'
import { Kit, c3 } from './kit.ts'
import { beamMaterial } from './shaders.ts'

export function dotTexture(scene: Scene, name = 'dot', soft = 0.35): Texture {
  const t = new DynamicTexture(name, { width: 64, height: 64 }, scene, false)
  const ctx = t.getContext() as CanvasRenderingContext2D
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(soft, 'rgba(255,255,255,0.75)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  t.hasAlpha = true
  t.update()
  return t
}

const WHITE = '#f3efe6'
const RED = '#d9333b'
const DARK = '#2a2d3a'
const STONE = '#8d8a92'

export class Lighthouse {
  readonly root: TransformNode
  readonly pivot: TransformNode
  readonly beams: Mesh[] = []
  readonly beamMat: ShaderMaterial
  readonly lampMesh: Mesh
  readonly lampMat: StandardMaterial
  readonly glassMat: StandardMaterial
  readonly flare: Mesh
  readonly flareMat: StandardMaterial
  readonly lampLight: PointLight
  readonly spots: SpotLight[] = []
  readonly lens: TransformNode
  readonly whistle: Vector3
  readonly steam: ParticleSystem
  readonly chimney: ParticleSystem
  readonly excluded: Mesh[] = []
  angle = 0
  private readonly tilt = 0.05

  constructor(scene: Scene) {
    const { x, z, ground } = LIGHTHOUSE
    this.root = new TransformNode('lighthouse', scene)
    this.root.position.set(x, ground, z)
    const H = TOWER_HEIGHT - 4
    const kit = new Kit(scene, 'tower')
    // plinth and the tower's bands, narrowing as they rise
    kit.cyl(2.6, 15, 16.5, [0, 1.3, 0], STONE, { tess: 12 })
    const bands = 6
    const dBot = 12, dTop = 7.6
    for (let i = 0; i < bands; i++) {
      const y0 = 2.6 + (H - 2.6) * (i / bands)
      const y1 = 2.6 + (H - 2.6) * ((i + 1) / bands)
      const d0 = dBot + (dTop - dBot) * (i / bands)
      const d1 = dBot + (dTop - dBot) * ((i + 1) / bands)
      kit.cyl(y1 - y0, d1, d0, [0, (y0 + y1) / 2, 0], i % 2 === 0 ? WHITE : RED, { tess: 16 })
    }
    // a door and little windows spiralling up
    kit.box([2.2, 3.4, 0.6], [0, 4.3, -5.6], '#5a3a2a')
    kit.box([1.2, 0.3, 1.2], [0, 6.4, -5.6], DARK)
    kit.sphere(0.7, [0, 6.9, -5.9], '#ffd98a', { glow: true })
    for (let i = 0; i < 5; i++) {
      const y = 9 + i * 5.2
      const a = -Math.PI / 2 + (i % 2 === 0 ? 0.5 : -0.6) + i * 0.9
      const d = (dBot + (dTop - dBot) * (y / H)) / 2 - 0.05
      kit.box([1.1, 1.8, 0.5], [Math.cos(a) * d, y, Math.sin(a) * d], '#ffcf7a', { glow: true, rot: [0, -a + Math.PI / 2, 0] })
    }
    // gallery, railing, lantern base, roof
    const gy = H
    kit.cyl(0.8, 11.5, 9.5, [0, gy + 0.4, 0], DARK, { tess: 16 })
    kit.cyl(0.18, 11.2, 11.2, [0, gy + 1.9, 0], DARK, { tess: 20 })
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      kit.cyl(1.2, 0.16, 0.16, [Math.cos(a) * 5.5, gy + 1.3, Math.sin(a) * 5.5], DARK, { tess: 4 })
    }
    kit.cyl(1.1, 7.2, 7.6, [0, gy + 1.35, 0], RED, { tess: 12 })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      kit.box([0.25, 4.6, 0.25], [Math.cos(a) * 3.2, gy + 4.2, Math.sin(a) * 3.2], DARK)
    }
    kit.cyl(0.4, 7.4, 7.4, [0, gy + 6.6, 0], DARK, { tess: 12 })
    kit.cyl(3.2, 0.5, 8.2, [0, gy + 8.4, 0], RED, { tess: 12 })
    kit.sphere(1.1, [0, gy + 10.4, 0], DARK, { seg: 3 })
    kit.cyl(2.6, 0.12, 0.12, [0, gy + 11.8, 0], DARK, { tess: 4 })
    kit.box([2.2, 0.4, 0.08], [0.5, gy + 12.5, 0], DARK)
    // the steam whistle on the gallery
    kit.cyl(1.6, 0.5, 0.7, [4.1, gy + 1.6, -1.6], '#c9a23a', { tess: 8 })
    this.whistle = new Vector3(x + 4.1, ground + gy + 2.6, z - 1.6)

    this.buildCottage(kit)
    kit.build(this.root)

    // lantern glass and the lamp
    this.glassMat = new StandardMaterial('glass', scene)
    this.glassMat.disableLighting = true
    this.glassMat.alpha = 0.55
    this.glassMat.emissiveColor = new Color3(1, 0.85, 0.5)
    const glass = MeshBuilder.CreateCylinder('glass', { height: 4.5, diameter: 6.4, tessellation: 16, cap: Mesh.NO_CAP }, scene)
    glass.position.set(0, gy + 4.2, 0)
    glass.parent = this.root
    glass.material = this.glassMat
    this.lampMat = new StandardMaterial('lampCore', scene)
    this.lampMat.disableLighting = true
    this.lampMat.emissiveColor = new Color3(1, 0.95, 0.8)
    this.lampMesh = MeshBuilder.CreateSphere('lamp', { diameter: 2.4, segments: 8 }, scene)
    this.lampMesh.position.set(0, gy + 4.2, 0)
    this.lampMesh.parent = this.root
    this.lampMesh.material = this.lampMat

    // the lens turns with the beams
    this.pivot = new TransformNode('beamPivot', scene)
    this.pivot.position.set(LAMP.x, LAMP.y, LAMP.z)
    this.lens = new TransformNode('lens', scene)
    this.lens.parent = this.pivot
    const lensKit = new Kit(scene, 'lens')
    for (const s of [1, -1]) {
      lensKit.cyl(0.35, 2.8, 2.8, [0, 0, s * 1.5], '#fff3c8', { rot: [Math.PI / 2, 0, 0], glow: true, tess: 12 })
      lensKit.cyl(0.2, 1.4, 1.4, [0, 0, s * 1.75], '#ffffff', { rot: [Math.PI / 2, 0, 0], glow: true, tess: 10 })
    }
    lensKit.box([0.3, 3.2, 0.3], [0, 0, 0], DARK)
    lensKit.build(this.lens)

    this.beamMat = beamMaterial(scene)
    for (const s of [0, Math.PI]) {
      const cone = MeshBuilder.CreateCylinder('beam', { height: 1, diameterTop: 2, diameterBottom: 0.04, tessellation: 28, cap: Mesh.NO_CAP }, scene)
      cone.position.y = 0.5
      cone.bakeCurrentTransformIntoVertices()
      cone.rotation.x = Math.PI / 2
      cone.bakeCurrentTransformIntoVertices()
      cone.parent = this.pivot
      cone.rotation.set(this.tilt, s, 0)
      cone.material = this.beamMat
      cone.isPickable = false
      cone.alwaysSelectAsActiveMesh = true
      this.beams.push(cone)
      this.excluded.push(cone)
      const spot = new SpotLight('beamSpot', new Vector3(LAMP.x, LAMP.y, LAMP.z), new Vector3(1, -0.05, 0), 0.22, 3, scene)
      spot.diffuse = new Color3(1, 0.9, 0.65)
      spot.specular = new Color3(0.6, 0.55, 0.4)
      this.spots.push(spot)
    }

    this.lampLight = new PointLight('lampLight', new Vector3(LAMP.x, LAMP.y, LAMP.z), scene)
    this.lampLight.diffuse = new Color3(1, 0.82, 0.55)
    this.lampLight.range = 110

    const tex = dotTexture(scene, 'flareDot', 0.18)
    this.flareMat = new StandardMaterial('flare', scene)
    this.flareMat.disableLighting = true
    this.flareMat.emissiveTexture = tex
    this.flareMat.opacityTexture = tex
    this.flareMat.emissiveColor = new Color3(1, 0.9, 0.7)
    this.flareMat.alphaMode = Constants.ALPHA_ADD
    this.flareMat.disableDepthWrite = true
    this.flare = MeshBuilder.CreatePlane('flare', { size: 1 }, scene)
    this.flare.billboardMode = Mesh.BILLBOARDMODE_ALL
    this.flare.position.set(LAMP.x, LAMP.y, LAMP.z)
    this.flare.material = this.flareMat
    this.flare.isPickable = false
    this.flare.renderingGroupId = 1
    this.excluded.push(this.flare, glass)

    const dot = dotTexture(scene, 'steamDot', 0.5)
    this.steam = new ParticleSystem('steam', 300, scene)
    this.steam.particleTexture = dot
    this.steam.emitter = this.whistle.clone()
    this.steam.emitRate = 0
    this.steam.color1 = new Color4(0.95, 0.95, 1, 0.8)
    this.steam.color2 = new Color4(0.8, 0.85, 0.95, 0.6)
    this.steam.colorDead = new Color4(0.7, 0.75, 0.9, 0)
    this.steam.minSize = 1.5; this.steam.maxSize = 4
    this.steam.minLifeTime = 0.8; this.steam.maxLifeTime = 1.8
    this.steam.minEmitPower = 6; this.steam.maxEmitPower = 12
    this.steam.direction1 = new Vector3(0.2, 1, -0.2); this.steam.direction2 = new Vector3(0.6, 1.4, 0.2)
    this.steam.gravity = new Vector3(2, 1, 0)
    this.steam.minAngularSpeed = -1; this.steam.maxAngularSpeed = 1
    this.steam.start()

    this.chimney = new ParticleSystem('chimney', 120, scene)
    this.chimney.particleTexture = dot
    this.chimney.emitter = new Vector3(x + 21.5, ground + 10.5, z - 14)
    this.chimney.emitRate = 3
    this.chimney.color1 = new Color4(0.6, 0.6, 0.7, 0.35)
    this.chimney.color2 = new Color4(0.5, 0.5, 0.6, 0.25)
    this.chimney.colorDead = new Color4(0.4, 0.4, 0.5, 0)
    this.chimney.minSize = 1.5; this.chimney.maxSize = 3.5
    this.chimney.minLifeTime = 3; this.chimney.maxLifeTime = 6
    this.chimney.minEmitPower = 0.8; this.chimney.maxEmitPower = 1.6
    this.chimney.direction1 = new Vector3(-0.2, 1, 0); this.chimney.direction2 = new Vector3(0.6, 1, 0.3)
    this.chimney.gravity = new Vector3(0.8, 0.3, 0.2)
    this.chimney.start()
  }

  private buildCottage(kit: Kit): void {
    const cx = 20, cz = -14
    kit.box([13, 6, 9], [cx, 3, cz], '#ece6da')
    // pitched roof: two slabs
    for (const s of [1, -1]) kit.box([14, 0.6, 5.8], [cx, 7.2, cz + s * 2.3], '#3b4a78', { rot: [s * 0.62, 0, 0] })
    kit.box([13.2, 2.4, 0.4], [cx, 7.0, cz], '#ece6da')
    kit.box([1.8, 4, 1.8], [cx + 1.5, 8.5, cz], '#9a5a44')
    kit.box([1.8, 3.2, 0.4], [cx - 2.5, 1.6, cz - 4.6], '#5a3a2a')
    for (const wx of [-5.2, 1.6, 4.6]) kit.box([1.8, 1.8, 0.3], [cx + wx, 3.6, cz - 4.55], '#ffc86a', { glow: true })
    kit.box([1.8, 1.8, 0.3], [cx - 6.55, 3.6, cz], '#ffc86a', { glow: true, rot: [0, Math.PI / 2, 0] })
    // a picket fence and a garden
    for (let i = 0; i < 9; i++) kit.box([0.25, 1.2, 0.25], [cx - 8 + i * 2, 0.6, cz - 8], '#e8e2d4')
    kit.box([16.5, 0.18, 0.12], [cx, 0.9, cz - 8], '#e8e2d4')
    for (const [bx, bz, r] of [[cx - 9, cz + 3, 2.6], [cx + 8.5, cz + 4, 2], [-8, 8, 2.4], [7, 9, 1.8], [cx + 7, cz - 6, 1.6]] as const) {
      kit.sphere(r * 1.6, [bx, r * 0.5, bz], '#2f6b45', { seg: 2 })
    }
    // a washing line and a dinghy pulled up on the grass
    kit.box([0.2, 3, 0.2], [cx - 7, 1.5, cz + 7], '#8a6a4a')
    kit.box([0.2, 3, 0.2], [cx + 3, 1.5, cz + 9], '#8a6a4a')
    kit.box([3.6, 1.2, 0.2], [cx - 4.5, 2, cz + 7.6], '#e45a6a', { rot: [0, -0.2, 0] })
    kit.box([1.6, 1.4, 0.2], [cx - 0.8, 2, cz + 8.4], '#5aa0e4', { rot: [0, -0.2, 0] })
  }

  /** Advance the lens and set every light from the lamp's brightness (0–1) and power surplus. */
  update(dt: number, env: Env, bright: number, surplus: number, lit: boolean): void {
    // the clockwork turns faster with a brighter lamp: a full turn in ~11 s at full, stalling when dark
    const speed = lit ? (0.12 + 0.46 * bright + 0.12 * clamp(surplus, 0, 1)) : 0.02
    this.angle = (this.angle + speed * dt) % (Math.PI * 2)
    this.pivot.rotation.y = Math.PI / 2 - this.angle
    const fog = env.fogAmt
    const reach = (380 + 520 * bright) * (1 - 0.45 * fog)
    for (const b of this.beams) {
      const spread = reach * (0.075 + 0.03 * fog)
      b.scaling.set(spread, spread, reach)
    }
    const flicker = 0.96 + 0.04 * Math.sin(env.time * 23) * Math.sin(env.time * 7.3)
    const on = bright * flicker
    this.beamMat.setVector3('cameraPos', env.cameraPos)
    this.beamMat.setColor3('beamColor', env.lampColor)
    this.beamMat.setFloat('intensity', on * (0.34 + 0.5 * fog + 0.15 * (1 - env.look.hemi)))
    this.beamMat.setFloat('time', env.time)
    this.lampMat.emissiveColor.set(1, 0.92 + 0.08 * on, 0.7 + 0.3 * on).scaleInPlace(0.25 + 0.75 * on)
    this.lampMesh.scaling.setAll(0.6 + 0.5 * on)
    this.glassMat.emissiveColor = env.lampColor.scale(0.2 + 0.9 * on)
    this.lampLight.intensity = 0.4 + 1.8 * on
    for (let i = 0; i < 2; i++) {
      const a = this.angle + i * Math.PI
      this.spots[i]!.direction.set(Math.cos(a), -Math.sin(this.tilt) * 1.2, Math.sin(a))
      this.spots[i]!.intensity = 3.2 * on
      this.spots[i]!.range = reach * 1.1
    }
    // the flare: bright when a beam swings toward the camera
    const toCam = env.cameraPos.subtract(this.flare.position)
    const cam = Math.atan2(toCam.z, toCam.x)
    let facing = 0
    for (let i = 0; i < 2; i++) facing = Math.max(facing, Math.cos(cam - (this.angle + i * Math.PI)))
    const flash = Math.pow(Math.max(0, facing), 18)
    this.flare.scaling.setAll((8 + 22 * on + 90 * flash * on) * (1 + fog * 0.6))
    this.flareMat.alpha = 0.35 + 0.65 * on
    env.flash = Math.max(env.flash, flash * on * 0.05)
    env.lampBright = on
    env.beamAngle = this.angle
    env.beamReach = reach
  }

  blow(strength: number): void {
    this.steam.manualEmitCount = Math.round(60 * strength)
  }
}
