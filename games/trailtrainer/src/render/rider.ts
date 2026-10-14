/**
 * The person on the route: the avatar kit's body, riding or running.
 *
 * The body is built off the main thread and takes a moment, so `create` returns immediately and the rider
 * appears when it is ready. The ride runs either way — nothing here is on the critical path, and a route
 * whose terrain is streaming in should not also be waiting on a face.
 *
 * On a bike the cranks turn with the wheels through the gear, which means they stop when the rider stops
 * pedalling and the legs go still while the bike keeps rolling. That is the visual half of coasting, and the
 * reason the ride model hands over a crank angle rather than a cadence.
 */
import { type AbstractMesh, Color4, DynamicTexture, ParticleSystem, Quaternion, type Scene, TransformNode, Vector3 } from '@babylonjs/core'
import {
  Avatar,
  Bike,
  GeometryService,
  loadFromBucket,
  PRESETS,
  setAssetBase,
  setStudioHdri,
  STUDIO_HDRI,
  suggestQuality,
  normalizeSpec,
  type Preset,
  type AvatarSpec,
} from 'avatarkit'
import { Config } from '../config.ts'
import { assetSource, siblingUrl } from './assetsource.ts'
import type { Pose } from '../route/route.ts'
import type { SurfaceName } from '../route/package.ts'
import type { Frame } from './frame.ts'
import { Layer } from './layers.ts'

// Standalone the kit's assets sit next to the page (public/mh and public/env are symlinks into the kit); on
// Dandyhorse the platform serves them at /avatars/, and this is the one place that changes. The base has to be
// an absolute URL rather than './mh/': the kit builds bodies in a worker, and a relative path there resolves
// against the worker's own script rather than the page, which quietly fetches index.html instead of the index.
//
// By default the kit's assets now come from the shared asset bucket (avatarkit's assetmgr indexes, see
// render/assetsource.ts); the local folders are the fallback, and what ?assets=local asks for.
function useLocalAvatarAssets(): void {
  // avatarkit's public/ through the dev server (AVATARKIT_DIR, see vite.config.ts)
  setAssetBase(siblingUrl('avatarkit', 'public/mh/'))
  setStudioHdri(siblingUrl('avatarkit', `public/${STUDIO_HDRI}`))
}
const avatarAssets: Promise<void> = assetSource() === 'bucket'
  ? loadFromBucket(Config.assetBucket).then(() => undefined, (e: unknown) => {
    console.warn('rider: avatar assets unavailable from the bucket, using the local copy', e)
    useLocalAvatarAssets()
  })
  : Promise.resolve(useLocalAvatarAssets())

export interface RiderOptions {
  /** which of the kit's presets to wear; on the platform this is the player's own avatar */
  preset?: Preset
  /** a made-up person instead of a named preset, which is how the strangers are all different */
  spec?: AvatarSpec
  bikeColour?: string
  /** metres right of the centre line; negative for someone coming the other way */
  offset?: number
  /**
   * On a bike or on foot. Defaults to whatever machine the player is using, which is right for the player and
   * wrong for the people they pass: a rail trail has walkers on it whether or not you are riding one.
   */
  mode?: 'bike' | 'foot'
}

/** Dust off a dry trail. Only on gravel and dirt — asphalt does not make any. */
function makeDust(scene: Scene): ParticleSystem {
  const dust = new ParticleSystem('riderDust', 420, scene)
  const t = new DynamicTexture('dustTex', { width: 32, height: 32 }, scene, false)
  const c = t.getContext()
  const grad = c.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(226,203,163,0.55)')
  grad.addColorStop(1, 'rgba(226,203,163,0)')
  c.fillStyle = grad
  c.fillRect(0, 0, 32, 32)
  t.update()
  t.hasAlpha = true
  dust.particleTexture = t
  dust.emitter = new Vector3()
  dust.minEmitBox = new Vector3(-0.07, 0, -0.07)
  dust.maxEmitBox = new Vector3(0.07, 0.06, 0.07)
  dust.minSize = 0.1
  dust.maxSize = 0.22
  dust.minLifeTime = 0.35
  dust.maxLifeTime = 0.7
  dust.direction1 = new Vector3(-0.6, 0.6, -1.5)
  dust.direction2 = new Vector3(0.6, 1.4, -2.5)
  // pale and thin: a dozen half-transparent puffs stack up fast, and dust that reads at all from the saddle
  // is already far too much on screen
  dust.color1 = new Color4(0.85, 0.79, 0.68, 0.2)
  dust.color2 = new Color4(0.8, 0.74, 0.64, 0.16)
  dust.colorDead = new Color4(0.8, 0.74, 0.64, 0)
  dust.addSizeGradient(0, 0.6)
  dust.addSizeGradient(1, 2.2)
  // alpha blending, not Babylon's additive default: a dozen overlapping puffs of additive tan saturate to a
  // solid white blob, which is how dust on a gravel trail ends up looking like a small explosion
  dust.blendMode = ParticleSystem.BLENDMODE_STANDARD
  dust.updateSpeed = 0.016
  dust.emitRate = 0
  // the world is drawn in depth layers (see render/layers.ts); anything left in the default layer is drawn
  // under the ground it is standing on
  dust.renderingGroupId = Layer.near
  dust.start()
  return dust
}

export class Rider {
  readonly root: TransformNode
  private readonly body: TransformNode
  private readonly dust: ParticleSystem
  private readonly dustAt = new Vector3()
  private avatar: Avatar | null = null
  private bike: Bike | null = null
  private lean = 0
  private travelled = 0
  private readonly riding: boolean
  /** metres right of the centre line; companions move theirs to keep out of each other's way */
  private offset = Config.laneOffset

  private readonly scene: Scene
  private readonly frame: Frame

  private constructor(scene: Scene, frame: Frame, mode: 'bike' | 'foot') {
    this.scene = scene
    this.frame = frame
    this.riding = mode === 'bike'
    this.root = new TransformNode('rider', scene)
    this.root.rotationQuaternion = Quaternion.Identity()
    this.body = new TransformNode('riderBody', scene) // the lean happens here, under the heading
    this.body.parent = this.root
    this.dust = makeDust(scene)
  }

  /** Returns at once; the body turns up when it has been built. */
  static create(scene: Scene, frame: Frame, opts: RiderOptions = {}): Rider {
    const rider = new Rider(scene, frame, opts.mode ?? (Config.deviceType === 'bike' ? 'bike' : 'foot'))
    if (opts.offset !== undefined) rider.offset = opts.offset
    void rider.build(opts).catch((e: unknown) => console.warn('rider:', e instanceof Error ? e.message : String(e)))
    return rider
  }

  private async build(opts: RiderOptions): Promise<void> {
    const spec = normalizeSpec(opts.spec ?? (opts.preset ?? PRESETS[0]).spec)
    const quality = suggestQuality(this.scene.getEngine())
    await avatarAssets
    const geometry = await new GeometryService().request(spec, quality)
    if (!geometry) return
    const avatar = new Avatar(this.scene, spec, { geometry, quality, name: 'player' })
    avatar.root.parent = this.body
    if (this.riding) {
      // the kit builds the bike around this rider's own measurements, so the feet reach the pedals
      this.bike = new Bike(this.scene, avatar.animator.fit, { name: 'riderBike', color: opts.bikeColour ?? '#c8482f', accent: '#f6f3ea' })
      this.bike.root.parent = this.body
    }
    avatar.setMotion(this.riding ? { mode: 'cycle', cadence: 0, speed: 0 } : { mode: 'idle', speed: 0 })
    avatar.animator.snap()
    // held back until the skin and clothes are on, so it never appears half-painted
    avatar.root.setEnabled(false)
    await avatar.whenReady()
    avatar.root.setEnabled(true)
    this.avatar = avatar
  }

  /** Move this rider across the road. Metres right of the centre line, in the route's own direction. */
  setLane(offset: number): void { this.offset = offset }

  /**
   * Put this rider in different clothes, without rebuilding them.
   *
   * A body is expensive — MakeHuman meshes, built off the main thread — so the strangers on the road are a
   * handful of them recycled round and round rather than created and destroyed. That is fine until you notice
   * it: the same blonde in the green tank top came past three times in one ride, because nothing about a
   * recycled rider changed but where they were. The kit's `setLook` re-dresses a body from a spec without
   * touching its geometry, so only the colours are re-rolled here — clothes, hair, skin. The shape stays,
   * which nobody can pick out of a passing stranger, and the thing that made one recognisable does not.
   */
  reskin(colours: { clothes?: string[]; hair?: string; skin?: string }): void {
    const avatar = this.avatar
    if (!avatar) return
    const spec = JSON.parse(JSON.stringify(avatar.spec)) as {
      clothes?: Array<{ id?: string; color?: string }>
      hair?: { color?: string }
      skin?: { color?: string }
    }
    if (colours.clothes && spec.clothes) {
      spec.clothes.forEach((garment, i) => {
        const colour = colours.clothes?.[i % colours.clothes.length]
        // shoes carry no colour of their own and are worn as photographed
        if (colour && garment.color) garment.color = colour
      })
    }
    if (colours.hair && spec.hair?.color) spec.hair.color = colours.hair
    if (colours.skin && spec.skin?.color) spec.skin.color = colours.skin
    avatar.setLook(spec)
  }

  /** Every mesh the rider is made of, for the shadow generator. */
  meshes(): AbstractMesh[] {
    const out: AbstractMesh[] = this.avatar ? this.avatar.getMeshes() : []
    return this.bike ? out.concat(this.bike.getMeshes()) : out
  }

  /**
   * `pose` is where the trail is; `crank` comes from the ride model so the legs and the wheels agree, including
   * when neither is turning.
   */
  update(pose: Pose, speed: number, grade: number, working: boolean, crank: number, surface: SurfaceName, dt: number): void {
    /**
     * The trail's centre line is the route; a rider keeps to their own side of it — and that side is the RIGHT.
     *
     * The sign was wrong, and wrong in a way that is invisible until you go looking for the centre line: the
     * normal was taken as (−hz, hx), which in Babylon's left-handed world, with x to the right and z forward,
     * points to the rider's LEFT. Everyone on the road — the player and every stranger — rode down the left
     * side of it, and oncoming traffic passed on the wrong shoulder. The rider's right is (hz, −hx), which is
     * what `offset` has always claimed to mean.
     */
    const nx = pose.hz * this.offset
    const nz = -pose.hx * this.offset
    this.frame.place(this.root.position, pose.x + nx, pose.y + Config.trailLift, pose.z + nz)
    const yaw = Math.atan2(pose.hx, pose.hz)
    const pitch = -Math.atan(grade)
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.root.rotationQuaternion!)

    // Lean INTO the bend, by the angle that actually balances it: tan(lean) = lateral acceleration / gravity,
    // and the lateral acceleration through a bend is v²κ. A tight hairpin at 5 m/s comes out near 19°, which
    // is what it looks like from behind a real rider.
    //
    // The sign is worth spelling out, having had it backwards. With the trail's normal taken as (-hz, hx) —
    // the rider's right, which is the side they ride on — positive curvature is a turn to the right, and a
    // positive roll about the root's local Z lifts the rider's left side. So the two signs agree directly.
    const want = Math.max(-0.6, Math.min(0.6, Math.atan((pose.curvature * speed * speed) / 9.81)))
    this.lean += (want - this.lean) * (1 - Math.exp(-dt / 0.25))
    this.body.rotation.z = this.riding ? this.lean : this.lean * 0.35

    const dusty = surface !== 'paved'
    this.dustAt.set(this.root.position.x - pose.hx * 0.66, this.root.position.y + 0.05, this.root.position.z - pose.hz * 0.66)
    ;(this.dust.emitter as Vector3).copyFrom(this.dustAt)
    this.dust.direction1.set(-pose.hx * 1.5 - pose.hz * 0.6, 0.6, -pose.hz * 1.5 + pose.hx * 0.6)
    this.dust.direction2.set(-pose.hx * 2.5 + pose.hz * 0.6, 1.4, -pose.hz * 2.5 - pose.hx * 0.6)
    this.dust.emitRate = dusty && speed > 4 ? Math.min(11, (speed - 4) * 1.6) : 0

    this.travelled += speed * dt
    const avatar = this.avatar
    if (!avatar) return
    if (this.riding) {
      // crank comes from the ride model; cadence is only what the kit shows in the HUD-facing pose
      const cadence = working ? (speed / Config.wheelRadius / Config.gearRatio) * (60 / (2 * Math.PI)) : 0
      avatar.setMotion({ mode: 'cycle', cadence, crank, speed, grade, effort: working ? 0.35 + Math.min(0.6, Math.abs(grade) * 6) : 0.15 })
      this.bike?.update(avatar.animator.crank, this.travelled)
    } else {
      // the kit turns a walk into a run by itself somewhere around 2.6 m/s
      avatar.setMotion({ mode: speed > 0.2 ? 'walk' : 'idle', speed, grade, effort: 0.4 + Math.min(0.5, Math.max(0, grade) * 5) })
    }
    avatar.update(dt)
  }

  dispose(): void {
    this.avatar?.dispose()
    this.bike?.dispose()
    this.dust.dispose()
    this.root.dispose()
  }
}
