/**
 * A player's avatar on a canvas: the live one on a profile page, and the headshots everywhere else
 * (PLAN.md §18.6).
 *
 * avatarkit is Babylon plus a few hundred megabytes of MakeHuman assets, which is far too much for a page
 * of a hundred players. So a profile page mounts one live avatar, and every list shows a small PNG that was
 * rendered once and stored on the server — see avatarPictures.ts, which makes them, and
 * `/api/profiles/<name>/thumbnail`, which serves them with no Babylon anywhere near the page.
 *
 * Everything loads on demand, so nothing in here reaches the console's main bundle.
 */

export type Framing = 'full' | 'headshot'

/** How much of a picture is transparent, 0 to 1. A blank render is 1. */
async function emptiness(dataUrl: string): Promise<number> {
  const img = new Image()
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = dataUrl })
  if (!img.width || !img.height) return 1
  // A small sample is plenty to tell a person from an empty square.
  const w = Math.min(img.width, 96)
  const h = Math.max(1, Math.round((img.height / img.width) * w))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 1
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] <= 24) clear++
  return clear / (w * h)
}

/**
 * Cut a headshot out of a picture of a whole person.
 *
 * The head is found in the image itself — the topmost part of whatever was actually drawn — rather than by
 * projecting the skeleton's head bone onto the screen. The projection needs the skeleton posed and the
 * camera where you think it is, and when either is not true you get a square of empty background with
 * nothing to say why. Transparent pixels cannot lie.
 */
async function cropToHeadshot(dataUrl: string, size: number): Promise<string> {
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('could not read the rendered picture'))
    img.src = dataUrl
  })
  const work = document.createElement('canvas')
  work.width = img.width
  work.height = img.height
  const wctx = work.getContext('2d', { willReadFrequently: true })
  if (!wctx) return dataUrl
  wctx.drawImage(img, 0, 0)
  const { data } = wctx.getImageData(0, 0, work.width, work.height)

  // What was drawn: anything not nearly transparent.
  let top = -1
  let bottom = -1
  for (let y = 0; y < work.height && top < 0; y++) {
    for (let x = 0; x < work.width; x++) if (data[(y * work.width + x) * 4 + 3] > 24) { top = y; break }
  }
  for (let y = work.height - 1; y >= 0 && bottom < 0; y--) {
    for (let x = 0; x < work.width; x++) if (data[(y * work.width + x) * 4 + 3] > 24) { bottom = y; break }
  }
  if (top < 0 || bottom <= top) return dataUrl   // nothing drawn: hand back what we have

  // The head is the top of the figure. Take a band there and find its middle, so a rider leaning forward
  // is still centred.
  const figure = bottom - top
  const band = Math.max(4, Math.round(figure * 0.16))
  let left = work.width
  let right = 0
  for (let y = top; y < Math.min(top + band, work.height); y++) {
    for (let x = 0; x < work.width; x++) {
      if (data[(y * work.width + x) * 4 + 3] > 24) {
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  const cx = right >= left ? (left + right) / 2 : work.width / 2
  // A head and a little air round it. A cycling figure is about five head-heights tall in this shot.
  const side = Math.min(Math.max(figure * 0.34, 32), Math.min(work.width, work.height))
  const sx = Math.min(Math.max(cx - side / 2, 0), work.width - side)
  const sy = Math.min(Math.max(top - side * 0.12, 0), work.height - side)

  const out = document.createElement('canvas')
  out.width = out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return out.toDataURL('image/png')
}

export interface StageOptions {
  /** The AvatarSpec from a profile (`profile.avatar`). Undefined gets avatarkit's own default look. */
  avatar?: unknown
  /** What they are doing: cycling (on a bike) or running. */
  motion?: 'cycle' | 'run' | 'walk'
  /** Slow and steady, or working: sets cadence and speed. */
  effort?: number
  /** Transparent canvas, so the page's own background shows through. */
  transparent?: boolean
  /** The whole person, or their face. A face is what reads at 40 pixels. */
  framing?: Framing
  /** Turn slowly, for a live avatar on a page. Off for a picture that is about to be captured. */
  turntable?: boolean
  /** Lower is faster to build; a 256-pixel headshot does not need the high one. */
  quality?: 'low' | 'medium' | 'high'
  /**
   * Which renderer to ask for. `auto` takes avatarkit's own choice, which prefers WebGPU and looks best —
   * right for an avatar somebody is watching. `webgl` is for a canvas off the side of the page: WebGPU
   * refuses one ("Cannot read properties of null (reading 'createDrawContext')"), and a 256-pixel picture
   * gains nothing from it anyway.
   */
  renderer?: 'auto' | 'webgl'
}

export interface Stage {
  /** One frame as a PNG data URL, `size` pixels square. */
  snapshot: (size?: number) => Promise<string>
  /** Put a different person in the same scene — far quicker than building another one. */
  replace: (avatar: unknown) => Promise<void>
  dispose: () => void
}

/** Where the camera sits: three-quarters on, from a little above. */
const SHOT = { alpha: -1.15, beta: 1.26, radius: 3.4 }

/**
 * Mount an avatar on `canvas`. Resolves once it is on screen; throws if avatarkit or its assets are
 * missing, which callers show as a quiet message rather than an error — an avatar is decoration.
 *
 * The scene it builds can be reused: `replace()` swaps the person without rebuilding the engine, the
 * lighting or the environment, which is what makes rendering a page of headshots quick rather than slow.
 */
export async function mountAvatar(canvas: HTMLCanvasElement, opts: StageOptions = {}): Promise<Stage> {
  const [kit, babylon] = await Promise.all([import('avatarkit'), import('@babylonjs/core')])
  const { Avatar, Bike, createEngine, lightStage, setAssetBase, setStudioHdri, STUDIO_HDRI } = kit
  const { ArcRotateCamera, Color4, Scene, Vector3 } = babylon
  // The server serves ../avatarkit/public/ here (servers/api-flask/dandyhorse/static.py).
  setAssetBase('/avatars/mh/')
  setStudioHdri(`/avatars/${STUDIO_HDRI}`)

  const framing = opts.framing ?? 'full'
  const shot = SHOT
  const transparent = opts.transparent ?? true
  const engine = opts.renderer === 'webgl'
    ? new babylon.Engine(canvas, true, { alpha: transparent, preserveDrawingBuffer: true, stencil: true, antialias: true })
    : await createEngine(canvas, { alpha: transparent })
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0, 0, 0, transparent ? 0 : 1)
  const camera = new ArcRotateCamera('cam', shot.alpha, shot.beta, shot.radius, new Vector3(0, 0.95, 0), scene)
  camera.lowerRadiusLimit = 2.2
  camera.upperRadiusLimit = 6
  camera.wheelDeltaPercentage = 0.01
  lightStage(scene, camera, 'high')

  const mode = opts.motion ?? 'cycle'
  const effort = opts.effort ?? 1
  const quality = opts.quality ?? (framing === 'headshot' ? 'low' : 'medium')
  let avatar = await Avatar.create(scene, opts.avatar, { quality })
  let bike: InstanceType<typeof Bike> | null = null

  const frame = (): void => camera.setTarget(new Vector3(0, 0.95, 0))

  const dress = (): void => {
    bike?.dispose()
    bike = null
    // A headshot never shows the bike, and building one costs time a page of pictures cannot spare.
    if (mode === 'cycle' && framing === 'full') {
      // Fitted to this body, so the feet reach the pedals (avatarkit's gallery does the same). A headshot
      // never shows it, and building one costs time that a page of pictures does not have to spare.
      bike = new Bike(scene, avatar.animator.fit, { name: `${avatar.name}.bike` })
      bike.root.parent = avatar.root
    }
    avatar.setMotion(mode === 'cycle' ? { mode: 'cycle', cadence: 72 + 16 * effort }
      : { mode, speed: mode === 'run' ? 3.2 * effort : 1.4 * effort })
    // One frame of the motion, so a picture is not of somebody standing in a T-pose.
    avatar.update(0.4)
    frame()
  }
  dress()

  let turning = opts.turntable ?? framing === 'full'
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000
    avatar.update(dt)
    if (turning) camera.alpha -= dt * 0.12
  })
  // Match the drawing buffer to the canvas before the first frame: a canvas Babylon met at its default
  // 300x150 renders at that size behind a CSS box of another shape, which looks like nothing rendering.
  engine.resize()
  engine.runRenderLoop(() => scene.render())
  const onResize = (): void => engine.resize()
  window.addEventListener('resize', onResize)

  return {
    async snapshot(size = 256) {
      // Through a render target, so it works the same on WebGPU as on WebGL and does not depend on the
      // drawing buffer still being there.
      const wasTurning = turning
      turning = false
      // The read below happens inside the render loop, so it has to be going.
      if (!engine.activeRenderLoops.length) engine.runRenderLoop(() => scene.render())
      camera.alpha = shot.alpha
      camera.beta = shot.beta
      camera.radius = shot.radius
      frame()
      // Wait for a body to actually exist. `Avatar.create` resolves before its geometry is finished — the
      // live avatar on a profile appears a second or so after the page settles — so capturing straight
      // afterwards gives a transparent square, the same one for everybody, which looks like it worked.
      await scene.whenReadyAsync()
      const drawn = (): boolean => scene.meshes.some(
        (m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0 && m.isReady(true))
      const until = Date.now() + 8000
      while (!drawn() && Date.now() < until) {
        scene.render()
        await new Promise((r) => setTimeout(r, 80))
      }
      if (!drawn()) console.warn('avatar picture: nothing to draw after 8 s', scene.meshes.length, 'meshes')
      // Read the canvas from inside the engine's own render, on the frame after next.
      //
      // Two things make this fiddly. Babylon's `CreateScreenshotUsingRenderTargetAsync` throws outright on
      // a WebGPU engine here ("Cannot read properties of null (reading 'createDrawContext')"). And a
      // WebGPU canvas only holds its pixels for the frame it was drawn in: read it from ordinary code and
      // the picture is empty, which is exactly what the first few versions of this quietly produced. So
      // hand the read to the render loop and let it happen in the right place.
      const grabFrame = (): Promise<string> => new Promise<string>((resolve) => {
        let frames = 0
        const grab = scene.onAfterRenderObservable.add(() => {
          // The first frame after a material is ready still shows it unshaded.
          if (++frames < 2) return
          scene.onAfterRenderObservable.remove(grab)
          resolve(canvas.toDataURL('image/png'))
        })
      })
      // Keep looking until there is actually somebody in the picture. `Avatar.create` resolves well before
      // its body is built — the avatar on a profile page appears a second or two after the page settles —
      // and a capture taken before that is a transparent square. Counting the pixels is the only check
      // that cannot be fooled: every cleverer one here passed while the picture was empty.
      let full = await grabFrame()
      const deadline = Date.now() + 25_000
      while (await emptiness(full) > 0.985 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300))
        full = await grabFrame()
      }
      turning = wasTurning
      // Still nothing after all that: say so rather than hand back a square of nothing. A stored blank is
      // worse than no picture, because initials at least tell you who somebody is.
      if (await emptiness(full) > 0.985) throw new Error('the avatar did not draw anything to make a picture from')
      return framing === 'headshot' ? cropToHeadshot(full, size) : full
    },
    async replace(spec: unknown) {
      const next = await Avatar.create(scene, spec, { quality })
      avatar.dispose?.()
      avatar = next
      dress()
      await scene.whenReadyAsync()
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
