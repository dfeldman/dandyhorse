// The player as a person: the avatar kit's body, riding or running.
//
// Rider.create(scene, opts) -> the same handle the cartoon bike gave the game (root, update, setNight), so main.js
// treats it the same way. It is a factory on purpose: a field of other riders is the same call again, each with its
// own look, and a bike design is an option rather than a fact of the file.
//
// The body is built off the main thread and takes a moment, so create() returns at once and the rider appears when
// it is ready. Until then the ride runs with nothing drawn where the rider will be.
import * as BABYLON from '@babylonjs/core'
import { Avatar, Bike as KitBike, GeometryService, setAssetBase, setStudioHdri, STUDIO_HDRI, suggestQuality } from '@dandyhorse/avatarkit'
import { Config } from './config.js'
import { Util } from './util.js'

// where the platform serves the kit's assets (servers/api-flask/dandyhorse/static.py)
setAssetBase('/avatars/mh/')
setStudioHdri(`/avatars/${STUDIO_HDRI}`)

/** The avatar the player designed, or undefined for the kit's own default. */
async function playerAvatar() {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' })
    if (!r.ok) return undefined
    const me = await r.json()
    const avatar = me?.profile?.avatar
    return avatar && typeof avatar === 'object' ? avatar : undefined
  } catch {
    return undefined // no profile to be had: the kit's default rider turns up instead
  }
}

/** Dust kicked up off a dry trail behind the rear wheel. */
function makeDust(scene) {
  const dust = new BABYLON.ParticleSystem('riderDust', 400, scene)
  const t = new BABYLON.DynamicTexture('dustTex', { width: 32, height: 32 }, scene, false)
  const c = t.getContext(), grad = c.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(230,200,150,0.55)'); grad.addColorStop(1, 'rgba(230,200,150,0)')
  c.fillStyle = grad; c.fillRect(0, 0, 32, 32); t.update(); t.hasAlpha = true
  dust.particleTexture = t
  dust.emitter = new BABYLON.Vector3()
  dust.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1); dust.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1)
  dust.minSize = 0.18; dust.maxSize = 0.36; dust.minLifeTime = 0.45; dust.maxLifeTime = 0.8
  dust.direction1 = new BABYLON.Vector3(-0.6, 0.6, -1.5); dust.direction2 = new BABYLON.Vector3(0.6, 1.4, -2.5)
  dust.color1 = new BABYLON.Color4(0.85, 0.72, 0.5, 0.16); dust.color2 = new BABYLON.Color4(0.8, 0.68, 0.48, 0.16)
  dust.colorDead = new BABYLON.Color4(0.8, 0.68, 0.48, 0)
  dust.addSizeGradient(0, 0.5); dust.addSizeGradient(1, 1.4)
  dust.updateSpeed = 0.016; dust.emitRate = 0; dust.start()
  return dust
}

const Rider = (() => {
  /**
   * opts:
   *   spec        the avatar to wear (default: the signed-in player's)
   *   mode        'bike' or 'run' (default: whatever the player's machine is)
   *   bike        which bike to build; only 'kit' for now, fitted to this rider's own body
   *   offset      meters to the right of the trail's centre line (the player rides the middle)
   *   name        prefix for this rider's meshes
   *   service     a GeometryService to build on; shared, one body is built at a time
   *   extras      dust, headlight and blob shadow (default true; the strangers on the trail go without)
   *   onReady     called with the rider's meshes once it is built (shadow casters)
   */
  function create(scene, opts = {}) {
    const name = opts.name ?? 'player'
    const root = new BABYLON.TransformNode(name + '.rider', scene)
    root.rotationQuaternion = BABYLON.Quaternion.Identity()
    const body = new BABYLON.TransformNode(name + '.riderBody', scene) // lean happens here, as on the old bike
    body.parent = root
    const riding = (opts.mode ?? Config.DEVICE_TYPE) === 'bike'
    const offset = opts.offset ?? 0
    const extras = opts.extras ?? true
    const service = opts.service ?? new GeometryService()
    const ownService = !opts.service

    // A headlight for the dark half of the day. The cartoon bike carried lamp meshes; the kit's bike has none,
    // so this is the light alone — on a bike it reads as a bar lamp, on foot as a head torch.
    const spot = !extras ? null : new BABYLON.SpotLight(name + '.riderLight', new BABYLON.Vector3(0, 0.95, 0.4), new BABYLON.Vector3(0, -0.3, 1), 0.75, 14, scene)
    if (spot) {
      spot.parent = body
      spot.intensity = 0
      spot.diffuse = Util.hex('#fff2c0')
      spot.specular = BABYLON.Color3.Black()
      spot.range = 28
      spot.innerAngle = 0.25 // soft edge instead of a hard-cut cone
    }

    // blob shadow, the ground-contact cue when the real sun shadows are off
    const blob = BABYLON.MeshBuilder.CreateDisc(name + '.riderShadow', { radius: 0.7, tessellation: 16 }, scene)
    blob.setEnabled(!Config.SHADOWS || !extras)   // the strangers get the disc instead of real shadows
    blob.rotation.x = Math.PI / 2
    blob.position.y = 0.04
    blob.scaling.z = 1.4
    blob.parent = root
    const blobMat = new BABYLON.StandardMaterial(name + '.riderShadowMat', scene)
    blobMat.diffuseColor = BABYLON.Color3.Black()
    blobMat.specularColor = BABYLON.Color3.Black()
    blobMat.alpha = 0.28
    blobMat.disableLighting = true
    blob.material = blobMat

    const dust = riding && extras ? makeDust(scene) : null
    const dustPos = new BABYLON.Vector3()

    let avatar = null
    let bike = null
    let lean = 0
    let crankAngle = 0
    let distance = 0

    const ready = (async () => {
      const spec = opts.spec ?? (await playerAvatar())
      const quality = opts.quality ?? suggestQuality(scene.getEngine())
      const geometry = await service.request(spec ?? {}, quality)
      if (!geometry) return
      const a = new Avatar(scene, spec ?? {}, { geometry, quality, name })
      a.root.parent = body
      if (riding) {
        // the kit's bike is built around this rider's own measurements, so the feet reach the pedals. Other
        // designs go here, each fitted the same way (avatar.animator.fit gives the numbers to build to).
        bike = new KitBike(scene, a.animator.fit, { name: name + '.bike', color: opts.color ?? '#ff5a5a', accent: opts.accent ?? '#ffffff' })
        bike.root.parent = body
      }
      a.setMotion(riding ? { mode: 'cycle', cadence: 0, speed: 0 } : { mode: 'idle', speed: 0 })
      a.animator.snap()
      // hold it back until its skin and clothes are on, so it never appears half-painted
      a.root.setEnabled(false)
      await a.whenReady()
      a.root.setEnabled(true)
      avatar = a
      opts.onReady?.(meshes())
      return a
    })().catch((e) => {
      console.warn('rider:', e instanceof Error ? e.message : String(e))
    })

    function meshes() {
      const out = avatar ? avatar.getMeshes() : []
      return bike ? out.concat(bike.getMeshes()) : out
    }

    /** Same shape as the cartoon bike's: where the trail is, how fast, whether the legs are working. */
    function update(pose, speed, pedal, dt) {
      // the trail surface, not the profile under it; offset riders keep to one side of the centre line
      // (hx/hz is the trail's horizontal tangent, so the sideways direction is (-hz, hx))
      root.position.set(pose.x - pose.hz * offset, pose.y + Config.TRAIL_LIFT, pose.z + pose.hx * offset)
      const yaw = Math.atan2(pose.tx, pose.tz)
      const pitch = -Math.asin(Math.max(-1, Math.min(1, pose.ty)))
      BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, root.rotationQuaternion)
      // lean into turns (curvature * v^2 ~ lateral accel)
      const target = Util.clamp(-pose.k * speed * speed * 0.28, -0.45, 0.45)
      lean += (target - lean) * (1 - Math.exp(-dt / 0.25))
      body.rotation.z = lean
      // dust off the back of the rear wheel (a runner kicks up too little to draw: it read as a bright smudge)
      if (dust) {
        dustPos.set(pose.x - pose.hx * 0.66, pose.y + 0.05, pose.z - pose.hz * 0.66)
        dust.emitter.copyFrom(dustPos)
        dust.direction1.set(-pose.hx * 1.5 - pose.hz * 0.6, 0.6, -pose.hz * 1.5 + pose.hx * 0.6)
        dust.direction2.set(-pose.hx * 2.5 + pose.hz * 0.6, 1.4, -pose.hz * 2.5 - pose.hx * 0.6)
        dust.emitRate = pose.bridge || speed < 3 ? 0 : Math.min(28, speed * 2)
      }
      if (!avatar) return
      if (riding) {
        // the cranks turn with the wheels through the gear, and stop when the rider stops pedalling
        const rpm = pedal > 6 ? ((speed / Config.WHEEL_RADIUS) / Config.GEAR_RATIO) * (60 / (2 * Math.PI)) : 0
        crankAngle += ((rpm * 2 * Math.PI) / 60) * dt
        distance += speed * dt
        avatar.setMotion({ mode: 'cycle', cadence: rpm, speed, grade: pose.grade, effort: pedal > 6 ? 0.6 : 0.2 })
        bike?.update(avatar.animator.crank, distance)
      } else {
        // walking turns into running by itself, around 2.6 m/s
        avatar.setMotion({ mode: speed > 0.2 ? 'walk' : 'idle', speed, grade: pose.grade, effort: 0.5 })
      }
      avatar.update(dt)
    }

    /** night: 0..1 from Daylight */
    function setNight(n) {
      if (spot) spot.intensity = 15 * n
      // sunlit dust is tan; after dark it would glow against a black road, so let it fade out
      if (dust) { const a = 0.16 * (1 - 0.8 * n); dust.color1.a = a; dust.color2.a = a }
    }

    function dispose() {
      avatar?.dispose()
      bike?.dispose()
      dust?.dispose()
      spot?.dispose()
      if (ownService) service.dispose()
      root.dispose()
    }

    /** Off means not drawn and not posed: for riders the player cannot see. */
    function setEnabled(on) { root.setEnabled(on) }

    return { root, body, update, setNight, setEnabled, dispose, meshes, ready, get lean() { return lean } }
  }

  return { create }
})()

export { Rider }
