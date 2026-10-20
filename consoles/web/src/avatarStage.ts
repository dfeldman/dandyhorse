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

/**
 * How much of a rendered picture is actually a person, 0 to 1.
 *
 * Measured at full size. Measuring a shrunken copy smears a half-built figure's few pixels across the
 * sample and reports a healthy number for a picture with almost nothing in it — which is how several
 * versions of this came to save a near-empty square believing all was well.
 */
async function drawnFraction(dataUrl: string): Promise<number> {
  const img = new Image()
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = dataUrl })
  if (!img.width || !img.height) return 0
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  let drawn = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) drawn++
  return drawn / (c.width * c.height)
}

/** A cycling figure covers about 4% of this canvas and a close portrait far more; a blank one, 0.1%. */
const ENOUGH_DRAWN = 0.02

/**
 * Cut a headshot out of a picture of a whole person.
 *
 * The head is found in the image itself — the topmost part of whatever was actually drawn — rather than by
 * projecting the skeleton's head bone onto the screen. The projection needs the skeleton posed and the
 * camera where you think it is, and when either is not true you get a square of empty background with
 * nothing to say why. Transparent pixels cannot lie.
 */
/** The middle square of a picture, scaled to `size`. */
async function centreSquare(dataUrl: string, size: number): Promise<string> {
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('could not read the rendered picture'))
    img.src = dataUrl
  })
  const side = Math.min(img.width, img.height)
  const out = document.createElement('canvas')
  out.width = out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
  return out.toDataURL('image/png')
}


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
  /**
   * One frame as a PNG data URL, `size` pixels square.
   *
   * `framing` overrides the stage's own. A profile page shows the whole person but wants a face for the
   * small picture, and building a second scene to get one costs seconds for no gain.
   */
  snapshot: (size?: number, framing?: Framing) => Promise<string>
  /** Put a different person in the same scene — far quicker than building another one. */
  replace: (avatar: unknown) => Promise<void>
  dispose: () => void
}

/** Where the camera sits: three-quarters on, from a little above. */
const SHOT = { alpha: -1.15, beta: 1.26, radius: 3.4 }

/**
 * How far from the head the portrait camera sits, in metres.
 *
 * At Babylon's default vertical field of view this frames a head and the top of the shoulders, which is
 * what a 40-pixel picture wants: any more and the face is a smudge in the middle of a jersey.
 */
const PORTRAIT_RADIUS = 0.62

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
  // `readable` asks avatarkit for WebGL2, which keeps what it drew so the canvas can be read back. A
  // WebGPU canvas is configured to be presented, not copied from, and reading one gives a transparent
  // square with no error to say why.
  const engine = await createEngine(canvas, { alpha: transparent, readable: opts.renderer === 'webgl' })
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

  /**
   * Point the camera at this person's face, close enough for a head-and-shoulders picture.
   *
   * Where the face is cannot be assumed, because it moves: an avatar faces +Z standing still, but riding a
   * bike it is turned along the frame with its chin down to watch the road, and photographing it from the
   * stage's own angle gives the back of its head. So the head bone is asked where it is and which way it
   * is looking, and the camera is put on that line in front of it. `nodes` holds a node per bone, posed by
   * the last `update()`, and the bones' own frames are axis-aligned with the avatar's root — so the head's
   * world matrix turns +Z into the direction of its gaze.
   *
   * Returns false when there is no head bone to go by, and the caller falls back to the stage's angle.
   */
  function faceOn(): boolean {
    const head = (avatar as { nodes?: Map<string, { computeWorldMatrix: (f: boolean) => unknown;
      getWorldMatrix: () => unknown; getAbsolutePosition: () => InstanceType<typeof Vector3> }> })
      .nodes?.get('head')
    if (!head) return false
    head.computeWorldMatrix(true)
    const at = head.getAbsolutePosition().clone()
    const gaze = Vector3.TransformNormal(new Vector3(0, 0, 1), head.getWorldMatrix() as never)
    if (!Number.isFinite(gaze.x) || gaze.lengthSquared() < 1e-6) return false
    gaze.normalize()
    // The spherical angles of the gaze, which is where the camera goes to meet it. Beta is kept off the
    // poles: a rider looking hard down would otherwise put the camera on the floor pointing straight up.
    camera.lowerRadiusLimit = 0.1
    // And bring the near plane in with it. Babylon's default is 1 metre, so a camera this close to a face
    // clips the whole person away and photographs an empty square — which is exactly what it did.
    camera.minZ = 0.05
    camera.setTarget(at)
    camera.alpha = Math.atan2(gaze.z, gaze.x)
    camera.beta = Math.min(Math.max(Math.acos(Math.min(Math.max(gaze.y, -1), 1)), 1.0), 1.95)
    camera.radius = PORTRAIT_RADIUS
    console.debug('avatar portrait: head at', at.x.toFixed(2), at.y.toFixed(2), at.z.toFixed(2),
      'gaze', gaze.x.toFixed(2), gaze.y.toFixed(2), gaze.z.toFixed(2),
      'camera', camera.alpha.toFixed(2), camera.beta.toFixed(2))
    return true
  }

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
    async snapshot(size = 256, want?: Framing) {
      const wanted = want ?? framing
      // Through a render target, so it works the same on WebGPU as on WebGL and does not depend on the
      // drawing buffer still being there.
      const wasTurning = turning
      turning = false
      // The read below happens inside the render loop, so it has to be going.
      if (!engine.activeRenderLoops.length) engine.runRenderLoop(() => scene.render())
      const was = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius,
                    near: camera.lowerRadiusLimit, minZ: camera.minZ, target: camera.target.clone() }
      let aimed = false
      if (wanted === 'headshot') aimed = faceOn()
      if (!aimed) {
        camera.alpha = shot.alpha
        camera.beta = shot.beta
        camera.radius = shot.radius
        frame()
      }
      // Wait for a body to actually exist. `Avatar.create` resolves before its geometry is finished — the
      // live avatar on a profile appears a second or so after the page settles — so capturing straight
      // afterwards gives a transparent square, the same one for everybody, which looks like it worked.
      await scene.whenReadyAsync()
      const meshesReady = (): boolean => scene.meshes.some(
        (m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0 && m.isReady(true))
      const until = Date.now() + 8000
      while (!meshesReady() && Date.now() < until) {
        scene.render()
        await new Promise((r) => setTimeout(r, 80))
      }
      if (!meshesReady()) {
        console.warn('avatar picture: nothing to draw after 8 s', scene.meshes.length, 'meshes')
      }
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
      // and a capture taken before that has a sliver of a figure in it, or nothing. Counting the pixels is
      // the only check that cannot be fooled: every cleverer one here passed while the picture was empty.
      let full = await grabFrame()
      const deadline = Date.now() + 40_000
      // Give the aimed camera a few seconds to show a face. If it is looking at nothing — the head bone
      // not where this expects, or inside the geometry — go back to the angle the stage itself uses and
      // find the head in the picture instead. A worse picture beats no picture.
      const giveUpAiming = Date.now() + 6000
      while (await drawnFraction(full) < ENOUGH_DRAWN && Date.now() < deadline) {
        if (aimed && Date.now() > giveUpAiming) {
          console.warn('avatar portrait: aimed at the head and saw nothing; using the stage angle')
          aimed = false
          camera.lowerRadiusLimit = was.near
          camera.minZ = was.minZ
          camera.alpha = shot.alpha
          camera.beta = shot.beta
          camera.radius = shot.radius
          frame()
        }
        await new Promise((r) => setTimeout(r, 400))
        full = await grabFrame()
      }
      camera.lowerRadiusLimit = was.near
      camera.minZ = was.minZ
      camera.setTarget(was.target)
      camera.alpha = was.alpha
      camera.beta = was.beta
      camera.radius = was.radius
      turning = wasTurning
      // Still nothing after all that: say so rather than hand back a square of nothing. A stored blank is
      // worse than no picture, because initials at least tell you who somebody is.
      const drawn = await drawnFraction(full)
      if (drawn < ENOUGH_DRAWN) {
        throw new Error(`the avatar had only ${(drawn * 100).toFixed(1)}% of the canvas drawn, too little `
          + 'to make a picture from')
      }
      if (wanted !== 'headshot') return full
      // Aimed at the head, the head is in the middle: a centre square is the picture. Only when there was
      // no head to aim at does this have to go looking for one in the pixels.
      return aimed ? centreSquare(full, size) : cropToHeadshot(full, size)
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
