/**
 * A player's avatar, animated, on a canvas — and a still PNG of it for the lists (PLAN.md §18.6).
 *
 * avatarkit is Babylon plus a few hundred megabytes of MakeHuman assets, which is far too much for a page
 * of a hundred players. So: the profile page mounts one live avatar here, and everywhere else shows a small
 * PNG that the designer rendered once and uploaded (`snapshot()` → `PUT /api/profile/thumbnail`).
 *
 * Everything loads on demand, so nothing in here reaches the console's main bundle.
 */
import { api } from './api'

export interface StageOptions {
  /** The AvatarSpec from a profile (`profile.avatar`). Undefined gets avatarkit's own default look. */
  avatar?: unknown
  /** What they are doing: cycling (on a bike) or running. */
  motion?: 'cycle' | 'run' | 'walk'
  /** Slow and steady, or working: sets cadence and speed. */
  effort?: number
  /** Transparent canvas, so the page's own background shows through. */
  transparent?: boolean
}

export interface Stage {
  /** One frame as a PNG data URL, `size` pixels square. */
  snapshot: (size?: number) => Promise<string>
  dispose: () => void
}

/**
 * Mount a turning, pedalling avatar on `canvas`. Resolves once it is on screen; throws if avatarkit or its
 * assets are missing, which callers show as a quiet message rather than an error — an avatar is decoration.
 */
export async function mountAvatar(canvas: HTMLCanvasElement, opts: StageOptions = {}): Promise<Stage> {
  const [kit, babylon] = await Promise.all([import('avatarkit'), import('@babylonjs/core')])
  const { Avatar, Bike, createEngine, lightStage, setAssetBase, setStudioHdri, STUDIO_HDRI } = kit
  const { ArcRotateCamera, Color4, Scene, Tools, Vector3 } = babylon
  // The server serves ../avatarkit/public/ here (servers/api-flask/dandyhorse/static.py).
  setAssetBase('/avatars/mh/')
  setStudioHdri(`/avatars/${STUDIO_HDRI}`)

  const engine = await createEngine(canvas, { alpha: opts.transparent ?? true })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0, 0, 0, opts.transparent === false ? 1 : 0)
  const camera = new ArcRotateCamera('cam', -1.15, 1.26, 3.4, new Vector3(0, 0.95, 0), scene)
  camera.lowerRadiusLimit = 2.2
  camera.upperRadiusLimit = 6
  camera.wheelDeltaPercentage = 0.01
  lightStage(scene, camera, 'high')

  const mode = opts.motion ?? 'cycle'
  const avatar = await Avatar.create(scene, opts.avatar, { quality: 'medium' })
  let bike: InstanceType<typeof Bike> | null = null
  if (mode === 'cycle') {
    // Fitted to this body, so the feet reach the pedals (avatarkit's gallery does the same).
    bike = new Bike(scene, avatar.animator.fit, { name: `${avatar.name}.bike` })
    bike.root.parent = avatar.root
  }
  const effort = opts.effort ?? 1
  avatar.setMotion(mode === 'cycle' ? { mode: 'cycle', cadence: 72 + 16 * effort }
    : { mode, speed: mode === 'run' ? 3.2 * effort : 1.4 * effort })

  // A slow turntable, so a still look has some life in it.
  let turning = true
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000
    avatar.update(dt)
    if (turning) camera.alpha -= dt * 0.12
  })
  engine.runRenderLoop(() => scene.render())
  const onResize = (): void => engine.resize()
  window.addEventListener('resize', onResize)

  return {
    async snapshot(size = 256) {
      // Through a render target, so it works the same on WebGPU as on WebGL and does not depend on the
      // drawing buffer still being there.
      turning = false
      camera.alpha = -Math.PI / 2 + 0.35
      scene.render()
      const url = await Tools.CreateScreenshotUsingRenderTargetAsync(engine, camera, { width: size, height: size },
                                                                     'image/png', 1, true)
      turning = true
      return url
    },
    dispose() {
      window.removeEventListener('resize', onResize)
      engine.stopRenderLoop()
      bike?.dispose()
      avatar.dispose?.()
      scene.dispose()
      engine.dispose()
    },
  }
}

/**
 * Render the player's avatar off screen and store the PNG as their thumbnail, so lists and leaderboards can
 * show them without loading Babylon. Called when they save a look in the designer; failure is not worth
 * telling anybody about — the list falls back to initials.
 */
export async function uploadThumbnail(avatar: unknown, size = 256): Promise<boolean> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.style.position = 'fixed'
  canvas.style.left = '-9999px'
  document.body.appendChild(canvas)
  let stage: Stage | null = null
  try {
    stage = await mountAvatar(canvas, { avatar, motion: 'cycle', transparent: true })
    const dataUrl = await stage.snapshot(size)
    await api('/api/profile/thumbnail', 'PUT', { image: dataUrl })
    return true
  } catch (e) {
    console.warn('could not render an avatar thumbnail', e)
    return false
  } finally {
    stage?.dispose()
    canvas.remove()
  }
}
