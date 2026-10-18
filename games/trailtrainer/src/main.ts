/**
 * Trail Trainer: a real route, ridden as it is.
 *
 * The order of things here is the whole shape of the game. Pick a route and say where to start it — which on
 * a route that takes a day is usually somewhere in the middle. Load the three baked files. Build the world
 * around wherever that is, not around the route's beginning. Then ride, and write down where you got to.
 *
 * Standalone this reads the keyboard and localStorage. On Dandyhorse the same loop reads the session and the
 * platform's save state instead, and `Controls` and `ProgressStore` are the only two things that change —
 * see INTEGRATION.md.
 */
import { Color3, Scene, Tools } from '@babylonjs/core'
import { ApiError, startSession, type StartPayload, type StartSessionAdHoc, type StartSessionBySession } from '@dandyhorse/gamekit'
import { createEngine } from 'avatarkit'
import { applyQuery, Config } from './config.ts'
import { LocalControls, type Controls } from './controls.ts'
import { GAME_ID, OTHERS, PlatformControls, PlatformProgress, option, putSaveWriter } from './platform.ts'
import type { RouteManifest } from './route/package.ts'
import { Route } from './route/route.ts'
import { unproject } from './route/geo.ts'
import { Chase } from './render/camera.ts'
import { Frame } from './render/frame.ts'
import { groundHeight } from './render/ground.ts'
import { Layer } from './render/layers.ts'
import { Markers } from './render/markers.ts'
import { Resolution } from './render/resolution.ts'
import { Bridges } from './render/bridges.ts'
import { loadGroundTextures, loadSurfaceTextures } from './render/materials/groundTextures.ts'
import { Rider } from './render/rider.ts'
import { Scatter } from './render/scatter.ts'
import { CardEdgePlugin } from './render/materials/card.ts'
import { LeafTransmissionPlugin } from './render/materials/leaf.ts'
import { loadEcology } from './render/treelib.ts'
import { ecologyFor } from './render/ecology.ts'
import { Sky } from './render/sky.ts'
import { BIOMES } from './render/palette.ts'
import { Terrain } from './render/terrain.ts'
import { Trail } from './render/trail.ts'
import { Water } from './render/water.ts'
import { CompanionRiders, companionPlan } from './render/companions.ts'
import { Companions } from './sim/companions.ts'
import { Ride } from './sim/ride.ts'
import { LocalProgress, ProgressTracker, type ProgressStore } from './sim/progress.ts'
import { Hud, km } from './ui/hud.ts'
import { Minimap } from './ui/minimap.ts'
import { StartScreen, type Chosen } from './ui/start.ts'

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const log = (line: string): void => console.log('trailtrainer:', line)

/** The loading overlay, used for the platform's own messages before there is a world to put them over. */
function say(text: string, extra?: HTMLElement): void {
  el('loading').classList.add('on')
  el('loadingText').textContent = text
  if (extra) el('loadingText').append(document.createElement('br'), extra)
}

/**
 * startsession, with the two failures worth explaining: not logged in (a link back through the login page), and
 * anything else (the server's own words). Resolves null when the session could not start.
 */
async function begin(body: StartSessionBySession | StartSessionAdHoc): Promise<StartPayload | null> {
  el('start').classList.add('off')
  say('Starting your session…')
  try {
    const start = await startSession(body)
    log(`session ${start.sessionId} · ${start.variant} · ${start.deviceType} · ${start.unitSystem}${start.debug ? ' · debug' : ''}`)
    return start
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const a = document.createElement('a')
      a.href = `/login?uid=1&next=${encodeURIComponent(`${location.pathname}${location.search}`)}`
      a.textContent = 'Log in and come back'
      say('You are not logged in.', a)
      return null
    }
    const detail = e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e)
    console.error('trailtrainer: the session could not start', e)
    say(`The session could not start. ${detail}`)
    return null
  }
}

/**
 * A "Debug session" button in the picker's footer, for trying the platform path without a console: an ad-hoc
 * debug session for whichever machine the picker is set to. Resolves when it is pressed; the picker is unchanged.
 */
function debugSessionButton(): Promise<StartSessionAdHoc> {
  return new Promise((resolve) => {
    const b = document.createElement('button')
    b.className = 'btn'
    b.id = 'debugSession'
    b.textContent = 'Debug session'
    b.title = 'Start an ad-hoc Dandyhorse debug session (needs the server)'
    b.style.marginLeft = 'auto'
    b.onclick = () => {
      const device = el('deviceSeg').querySelector('button[aria-pressed="true"]') as HTMLButtonElement | null
      const variant = device?.dataset.device === 'treadmill' ? 'treadmill' : 'bike'
      resolve({ gameId: GAME_ID, variant, debug: true, options: {} })
    }
    document.querySelector('#start footer')?.appendChild(b)
  })
}

/** What a platform session decides before the world is built: the route, where on it, and the rider. */
function fromSession(start: StartPayload, manifests: RouteManifest[]): { chosen: Chosen; progress: PlatformProgress; manifest: RouteManifest } {
  const ids = manifests.map((m) => m.id)
  const routeId = option(start.options, 'route', ids, ids[0])
  const manifest = manifests.find((m) => m.id === routeId) as RouteManifest
  const deviceType = start.deviceType === 'treadmill' ? 'treadmill' : 'bike'
  // debug sessions do not write save state (as Night Watch); they still read it, so they resume like a real one
  const progress = new PlatformProgress(start.saveState, start.debug ? null : putSaveWriter(start.variant, log))
  const previous = progress.get(routeId)
  // the picker's resume rule, answered "resume" without asking: trainer mode must never need hands on controls
  const partway = previous !== null && previous.s > 50 && previous.s < manifest.length - 50
  const weight = start.bodyData?.weight
  if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 25 && weight <= 250) Config.riderMassKg = weight
  Config.companions = OTHERS[option(start.options, 'others', Object.keys(OTHERS), 'few')]
  return { chosen: { routeId, deviceType, startAt: partway && previous ? previous.s : 0, previous }, progress, manifest }
}

async function main(): Promise<void> {
  applyQuery(location.search)
  const query = new URLSearchParams(location.search)

  // the baker writes the index, so adding a route is one entry in tools/routes.ts and nothing here
  const ids = await fetch('./routes/index.json').then((r) => {
    if (!r.ok) throw new Error(`routes/index.json: HTTP ${r.status} — run \`make assets\` in the dandyhorse root`)
    return r.json() as Promise<string[]>
  })
  // the manifests are small, and the picker needs all of them to show how far through each route you are. A
  // route in the index whose files are missing (not restored yet) is left out rather than stopping the game.
  const manifests = (await Promise.all(
    ids.map((id) => fetch(`./routes/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RouteManifest>) : null))
      .catch(() => null)
      .then((m) => {
        if (!m || m.id !== id) console.warn(`trailtrainer: route ${id} is in the index but its manifest is missing`)
        return m && m.id === id ? m : null
      })),
  )).filter((m): m is RouteManifest => m !== null)
  if (!manifests.length) throw new Error('no routes — run `make assets` in the dandyhorse root')

  // On Dandyhorse the session starts first (?session= from a bridge, or the picker's debug button), and the
  // route, the machine and the resume point come from it; the picker and the resume question are skipped.
  let platform: PlatformControls | null = null
  let progress: ProgressStore
  let chosen: Chosen
  // ?s= or ?go skips the picker: the way to look at one spot on a route while building it
  const skip = !query.has('session') && (query.has('s') || query.has('go'))
  const sessionParam = query.get('session')
  let session: StartPayload | null = null
  if (sessionParam) {
    session = await begin({ sessionId: sessionParam })
    if (!session) return
  }
  if (!session) {
    const local = new LocalProgress()
    progress = local
    if (skip) {
      chosen = { routeId: Config.routeId, deviceType: Config.deviceType, startAt: Config.startS, previous: local.get(Config.routeId) }
      el('start').classList.add('off')
    } else {
      const picked = await Promise.race([new StartScreen(manifests, local).choose(Config.deviceType), debugSessionButton()])
      if ('gameId' in picked) {
        session = await begin(picked)
        if (!session) return
      } else {
        chosen = picked
      }
    }
  }
  if (session) {
    const s = fromSession(session, manifests)
    chosen = s.chosen
    progress = s.progress
    platform = new PlatformControls(session, { routeId: s.chosen.routeId, routeLength: s.manifest.length, startAt: s.chosen.startAt, log })
  }
  // (definitely assigned on every path above; TypeScript cannot follow the race)
  chosen = chosen!
  progress = progress!

  Config.routeId = chosen.routeId
  Config.deviceType = chosen.deviceType

  el('loading').classList.add('on')
  el('loadingText').textContent = `Loading ${manifests.find((m) => m.id === chosen.routeId)?.name ?? chosen.routeId}…`
  const route = await Route.load(chosen.routeId)
  Config.trailWidth = Config.trailWidthByKind[route.manifest.kind]
  Config.laneOffset = (Config.trailWidth / 2) * Config.laneFraction
  // ?s= is for looking at one spot while building. It must not count as a session or move the rider's real
  // place on the route — losing where you got to because someone debugged a hairpin is exactly the kind of
  // thing that makes a resume feature untrustworthy.
  const tracker = skip && !platform ? null : new ProgressTracker(progress, route.manifest.id, route.length)
  const startAt = Math.min(chosen.startAt, route.length)

  // --- the scene ------------------------------------------------------------------------------------
  const canvas = el('c') as HTMLCanvasElement
  // WebGPU where the browser has it, WebGL2 otherwise — the avatar kit's own choice, shared so that the game
  // and the bodies in it agree about what the device can do. `?engine=webgl` forces the fallback, which is how
  // the two are compared. It matters beyond speed: the kit's skin uses a pre-pass that only WebGPU affords,
  // and the terrain and sky work that follows (see GRAPHICS.md) is written for both.
  //
  // `preserveDrawingBuffer` has gone with it: it is a WebGL option and means nothing under WebGPU. Reading the
  // canvas back for the platform's session image is `Tools.CreateScreenshotAsync`, which works on both.
  const engine = await createEngine(canvas)
  // how many pixels the frame is drawn with, adjusted to hold the frame rate (render/resolution.ts)
  const resolution = new Resolution(engine)
  const scene = new Scene(engine)
  // Nothing in this game is clicked on. Without this Babylon casts a picking ray into the whole scene every
  // time the pointer moves — which, over a wood of thin instances, is not free.
  scene.skipPointerMovePicking = true

  const start = route.poseAt(startAt)
  const frame = new Frame(Config.originShift)
  frame.x = Math.round(start.x / Config.originShift) * Config.originShift
  frame.z = Math.round(start.z / Config.originShift) * Config.originShift

  const sky = new Sky(scene)
  sky.setBiome(route.biomeAt(startAt))
  // the ground's own surfaces; nothing waits for them, they appear over the plain ground as they arrive
  const ground = loadGroundTextures(scene)
  const surfaces = loadSurfaceTextures(scene)
  // the ground underfoot, and the ground on the horizon
  const terrain = new Terrain(scene, route, frame, {
    chunkSize: Config.chunkSize,
    step: Config.terrainStep,
    radius: Config.viewRadius,
    atmosphere: sky.atmosphere,
    splat: ground,
  })
  const distance = new Terrain(scene, route, frame, {
    chunkSize: Config.farChunkSize,
    step: Config.farStep,
    radius: Config.farRadius,
    drop: Config.farDrop,
    detail: 'far',
    lazyBy: Config.farRebuildEvery,
    perFrame: 2,
    // drawn in its own depth layer, so the detailed ring and everything on it is always drawn over it: at
    // fifty metres a vertex the coarse ring chords across road cuts and gullies by as much as eighteen
    // metres, and dropping it by `farDrop` only hides a disagreement smaller than the drop (render/layers.ts)
    layer: Layer.far,
    // and no coarse ground at all within four hundred metres of the rider, where the detailed ring covers it
    // and the two disagree by more than `farDrop` can hide (render/materials/nearHole.ts)
    holeRadius: Config.farHole,
    atmosphere: sky.atmosphere,
    // the same four surfaces, tiled ten times larger: a two-metre tile two kilometres away is noise
    splat: ground,
    tile: Config.splatFarTile,
    macroTile: Config.splatFarMacroTile,
  })
  const trail = new Trail(scene, route, frame, sky.atmosphere, surfaces)
  // the rivers, lakes and streams the route runs past, if this route has had its water baked (tools/water.ts)
  const water = new Water(scene, route, frame, sky.atmosphere)
  await water.load(route.manifest.id)

  // A handful of the pre-generated trees, not the whole library: a wood stops looking stamped out after a few
  // shapes at different sizes, and loading all of them would be tens of megabytes for a difference nobody
  // could see from a bicycle.
  // Everything the route's own ecology asks for: its trees, its plants and its rocks, at the heights they
  // belong at. See render/ecology.ts — a biome name alone cannot tell a Missouri bottomland from an alpine
  // conifer belt, and it certainly cannot say where a tree line is.
  const eco = ecologyFor(route.manifest.id)
  el('loadingText').textContent = 'Growing the trees…'
  const planted = await loadEcology(scene, eco, Config.treeDetail, (material, kind) => {
    material.diffuseColor = Color3.White().scale(kind === 'leaves' ? Config.leafLift : Config.barkLift)
    if (kind === 'leaves') {
      new LeafTransmissionPlugin(material)
      // a page of leaves seen edge-on is a bright sliver a pixel or two wide; against a trunk those read as
      // something showing through it, and in motion they crawl
      new CardEdgePlugin(material)
    }
    material.emissiveColor = kind === 'leaves'
      ? new Color3(0.07, 0.10, 0.05)
      : new Color3(0.05, 0.042, 0.032)
  }, (done, total) => {
    el('loadingText').textContent = `Growing the trees… ${done} of ${total}`
  })
  const scatter = new Scatter(scene, route, frame, sky.atmosphere, planted)
  // nothing grows in the river
  scatter.wet = (x, z) => water.isWater(x, z)
  // a gate over the road at every place the route knows the name of
  const markers = new Markers(scene, route, frame, sky.atmosphere)
  // and a bridge wherever it crosses water
  const bridges = new Bridges(scene, route, frame, water, sky.atmosphere)
  const rider = Rider.create(scene, frame)
  const plan = companionPlan(route)
  const others = new Companions(route, { ...plan, seed: Math.round(startAt) })
  others.place(startAt)
  const otherRiders = new CompanionRiders(scene, frame, route, others)
  const chase = new Chase(scene)
  // drag to look around, wheel to pull the boom in and out, right-click or Home to put it back
  chase.attachLook(canvas)
  frame.onShift((dx, dz) => chase.shift(dx, dz))
  // the camera keeps out of trunks and out of the ground; both are asked in world metres
  chase.clearance = (ax, ay, az, bx, by, bz, margin) => scatter.clearAlong(ax, ay, az, bx, by, bz, margin)
  chase.groundAt = (x, z) => groundHeight(route, x, z)

  // build the ground before the first frame, so the ride never starts over a hole
  terrain.setBiome(BIOMES[route.biomeAt(startAt)])
  distance.setBiome(BIOMES[route.biomeAt(startAt)])
  scatter.setBiome(BIOMES[route.biomeAt(startAt)])
  water.setBiome(BIOMES[route.biomeAt(startAt)])
  water.setSun(sky.sun.direction.x, sky.sun.direction.y, sky.sun.direction.z, sky.sun.diffuse)
  water.update(start.x, start.z)
  water.fill(start.x, start.z)
  terrain.update(start.x, start.z)
  terrain.fill(280)
  distance.setHole(frame.localX(start.x), frame.localZ(start.z))
  distance.update(start.x, start.z)
  distance.fill(2400)
  trail.update(startAt)
  scatter.update(start.x, start.z)
  /**
   * The trees near the rider cast, and nothing else does.
   *
   * The old note here said trees could not cast at all, on the grounds that a frustum sized to contain thin
   * instances spread over a kilometre gives 0.8 m per texel. That is true of a frustum FITTED to the casters
   * and this one is not fitted to anything: it is a fixed thirty-metre box that follows the rider and snaps to
   * its own texel grid (see render/sky.ts). What goes into it is only the closest level of detail, which holds
   * the handful of trees within fifty metres, so the depth pass is a few thousand triangles.
   *
   * It is worth the pass. Until now nothing in the scenery cast anything, and a wood lit from one side with no
   * shadow on the ground under it reads as trees standing on a photograph of grass. What the rider actually
   * sees is dapple moving across the trail, which is most of what riding through a wood looks like.
   */
  sky.cast(scatter.shadowCasters())
  // every level of every tree, and their shadows, compiled before the ride rather than during it
  el('loadingText').textContent = 'Preparing the scenery…'
  await scatter.prewarm()
  await sky.prewarmShadows()

  const controls: Controls = platform ?? new LocalControls(() => Config.deviceType)
  const ride = new Ride(route, startAt)
  const hud = new Hud(route, Config.deviceType, chosen.previous)
  const minimap = new Minimap(route)
  el('loading').classList.remove('on')
  const how = platform
    ? 'Picking up where you left off.'
    : Config.deviceType === 'bike' ? 'Arrows set the power, space coasts.' : 'Arrows set the belt speed.'
  hud.say(
    startAt > 50 ? `Back on ${route.manifest.name}` : route.manifest.name,
    startAt > 50
      ? `${km(startAt)} in, ${km(route.length - startAt)} to go. ${how}`
      : `${route.manifest.direction}. ${km(route.length)}, ${route.manifest.stats.gain} m of climbing.`,
    5000,
  )

  // --- the session --------------------------------------------------------------------------------
  /**
   * The picture History shows. SessionClient asks for it synchronously, so a frame is read back every so often
   * and kept, and once more just before the session ends. `CreateScreenshotAsync` rather than the canvas: under
   * WebGPU a raw toDataURL is blank. It is the rendered scene only — the HUD is DOM and is not in it.
   */
  let imageBusy = false
  const refreshImage = async (): Promise<void> => {
    if (!platform || imageBusy || document.visibilityState === 'hidden' || document.body.classList.contains('shooting')) return
    imageBusy = true
    try {
      // a hidden or throttled page may never draw the frame the screenshot waits for, so it gets a ceiling
      const url = await Promise.race([
        Tools.CreateScreenshotAsync(engine, chase.camera, { width: 640, height: 360 }, 'image/jpeg', 0.85),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ])
      platform.setImage(url)
    } catch (e) {
      log(`session image: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      imageBusy = false
    }
  }
  /** The session ends `complete`: the time is up, or the route is finished. Save, picture, then endsession. */
  let ending = false
  const endComplete = async (why: 'time' | 'finished'): Promise<void> => {
    if (!platform || ending || platform.ended()) return
    ending = true
    tracker?.save(ride.position, sessionSeconds)
    if (why === 'time') {
      hud.say('Session complete', `${km(ride.position)} in, ${km(route.length - ride.position)} to go. The next session picks up here.`, 0)
    }
    await refreshImage()
    await platform.complete(why === 'time' ? 'duration' : 'route finished')
  }
  if (platform) {
    // ended from a bridge or the console (or by endComplete): write down where the rider got to, and stop
    platform.onEnded = (info) => {
      tracker?.save(ride.position, sessionSeconds)
      if (!ending) hud.say('Session over', `${km(ride.position)} in. ${info.status === 'complete' ? 'The next session picks up here.' : ''}`.trim(), 0)
    }
    platform.attach()
    setTimeout(() => void refreshImage(), 3000)
    setInterval(() => { if (!controls.paused() && !controls.ended()) void refreshImage() }, 15_000)
  }

  // --- the loop -------------------------------------------------------------------------------------
  let castersAttached = 0
  let gameReady = false
  let wasPaused = false
  let sessionSeconds = 0
  let finished = false
  // where the rider was last frame, to notice a jump (see below)
  // where the rider was last frame, along the route, so a landmark crossing can be noticed
  // where the rider is across the trail, which moves a little to let people past
  let playerLane = Config.laneOffset
  let lastS = startAt
  let lastX = start.x
  let lastZ = start.z

  /**
   * NOTE: the scenery's materials are deliberately NOT frozen.
   *
   * Freezing them once the impostors were baked measured about a millisecond off the Katy's CPU-bound frame,
   * and it was taken out again because it is not safe here. A frozen material stops re-evaluating its defines,
   * and several things in this scene change defines after load — the shadow generator is switched on and off
   * by the screenshot harness, lights and plugins settle over the first frames — so whether it worked depended
   * on which happened first. When it lost the race every frame came out with no tone curve on it: the whole
   * world twice as bright and washed to pastel. A millisecond is not worth a race like that.
   */
  scene.onBeforeRenderObservable.add(() => {
    resolution.tick(engine.getDeltaTime())
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000)
    const active = !controls.paused() && !controls.ended() && !finished && !document.body.classList.contains('shooting')
    if (active) sessionSeconds += dt

    const state = ride.update(controls.measured(), dt, active)
    controls.request(state.request)

    const pose = route.poseAt(state.s)
    if (platform) {
      platform.report({ s: state.s, speed: state.speed, grade: state.grade, elevation: pose.y, x: pose.x, y: pose.y, z: pose.z, finished: state.finished }, dt, active)
      if (platform.timeUp()) void endComplete('time')
      // the server pauses by itself after a few seconds without data, or a bridge's Pause; say why, as it words it
      const pausedNow = platform.paused()
      if (pausedNow !== wasPaused && !platform.ended()) {
        wasPaused = pausedNow
        if (pausedNow) hud.say('Paused', platform.pauseMessage() ?? 'The session is paused.', 0)
        else hud.hideBanner()
      }
    }
    if (!gameReady) {
      gameReady = true
      Object.assign(window, { gameReady: true })
    }
    frame.follow(pose.x, pose.z)

    // A jump — [ and ] while building, or a resumed session landing mid-route — moves further in one frame
    // than the streamer builds in a second. Left alone the rider spends that second over whatever the coarse
    // ring says the ground is, which is the one place the two rings are allowed to disagree. So a jump is
    // caught and the ground under the rider is built before the frame is drawn, exactly as it is at startup.
    const jumped = Math.hypot(pose.x - lastX, pose.z - lastZ) > Config.chunkSize
    lastX = pose.x
    lastZ = pose.z

    terrain.update(pose.x, pose.z)
    // the hole follows the rider, and is in scene metres because that is the space the shader sees
    distance.setHole(frame.localX(pose.x), frame.localZ(pose.z))
    distance.update(pose.x, pose.z)
    if (jumped) {
      terrain.fill(280)
      distance.fill(2400)
    }
    trail.update(state.s)
    water.update(pose.x, pose.z)
    water.tick(dt)
    markers.update(state.s)
    bridges.update(state.s)
    scatter.riderS = state.s
    scatter.riderHx = pose.hx
    scatter.riderHz = pose.hz
    scatter.update(pose.x, pose.z)
    // the leaves move with the clock rather than with the rider, and this is also what drives the
    // trees photographing themselves for their impostors on the first frames after their leaves load
    scatter.tick(dt)
    sky.tick(dt)
    const biome = route.biomeAt(state.s)
    sky.setBiome(biome)
    terrain.setBiome(BIOMES[biome])
    distance.setBiome(BIOMES[biome])
    scatter.setBiome(BIOMES[biome])
    water.setBiome(BIOMES[biome])
    water.setSun(sky.sun.direction.x, sky.sun.direction.y, sky.sun.direction.z, sky.sun.diffuse)
    sky.follow(frame.localX(pose.x), pose.y, frame.localZ(pose.z))

    /**
     * Passing a landmark is marked by the gate over the road, and by nothing else.
     *
     * There was a card that popped up in the middle of the screen as well, and having both was confusing:
     * two announcements of one place, one in the world and one over it, a moment apart. The gate carries the
     * name, it is seen coming from a long way off, and riding under it IS the moment — so it stays and the card
     * goes. The finish still gets its banner (below), because that one also says what happens next.
     */
    lastS = state.s

    rider.update(pose, state.speed, state.grade, state.working, state.crank, route.surfaceAt(state.s), dt)
    /**
     * The rider's own line, which moves a little when somebody is about to pass.
     *
     * Eased rather than switched, and by a third of a metre at most, so it reads as a rider making room rather
     * than as the game steering for them. It is fed back into the companion simulation on the same frame, so
     * everyone is solving the same road.
     */
    if (active) {
      const want = Config.laneOffset + others.playerShouldMove
      playerLane += (want - playerLane) * (1 - Math.exp(-dt / 1.1))
      rider.setLane(playerLane)
      others.update(state.s, playerLane, state.speed, dt)
    }
    otherRiders.update(active ? dt : 0)
    chase.origin.x = frame.x
    chase.origin.z = frame.z
    chase.update(rider.root.position, pose.hx, pose.hz, state.speed, state.grade, dt)

    // Bodies appear one at a time as the avatar kit finishes them, so this keeps looking until the count
    // stops growing. Attaching once on the first frame the player exists leaves every companion shadowless.
    const bodies = rider.meshes().concat(otherRiders.meshes())
    if (bodies.length > castersAttached) {
      sky.cast(bodies)
      // and into the near depth layer with them, or they are drawn under the road (render/layers.ts)
      for (const m of bodies) m.renderingGroupId = Layer.near
      castersAttached = bodies.length
    }

    hud.update(state, sessionSeconds)
    minimap.update(state.s)
    if (!controls.ended()) tracker?.update(state.s, sessionSeconds, performance.now(), Config.saveEvery)

    if (state.finished && !finished) {
      finished = true
      tracker?.save(state.s, sessionSeconds)
      hud.say(
        `${route.manifest.name}, all of it`,
        `${km(route.length)} and ${route.manifest.stats.gain} m of climbing, finished. ${platform ? 'The next session starts a fresh lap.' : 'Reload to ride it again.'}`,
        0,
      )
      void endComplete('finished')
    }
  })

  engine.runRenderLoop(() => scene.render())
  addEventListener('resize', () => engine.resize())
  // a closed tab is a paused ride, not a lost one
  addEventListener('pagehide', () => tracker?.save(ride.position, sessionSeconds))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tracker?.save(ride.position, sessionSeconds)
  })

  // jump along the route, for looking at a particular stretch while building
  addEventListener('keydown', (e) => {
    /**
     * Getting about the route, for looking at it.
     *
     *   [ ]   back / on 500 m
     *   , .   back / on 5 km
     *   P N   to the previous / next landmark (arriving a little before it, so it is ahead)
     *
     * A jump rebuilds the world around the new spot, so the resolution controller is told to stop judging
     * for a while (render/resolution.ts) and the rider is told where they have landed.
     */
    const jump = (to: number, why: string): void => {
      const s = Math.max(0, Math.min(route.length, to))
      ride.seek(s)
      resolution.hold()
      const here = route.manifest.landmarks.filter((l) => l.s <= s).pop()
      hud.say(why, `${km(s)} in${here ? ` · past ${here.name}` : ''} · ${route.biomeAt(s)}`, 2500)
    }
    const landmarks = route.manifest.landmarks
    if (e.code === 'BracketRight') jump(ride.position + 500, 'On 500 m')
    else if (e.code === 'BracketLeft') jump(ride.position - 500, 'Back 500 m')
    else if (e.code === 'Period') jump(ride.position + 5000, 'On 5 km')
    else if (e.code === 'Comma') jump(ride.position - 5000, 'Back 5 km')
    else if (e.code === 'KeyN') {
      const next = landmarks.find((l) => l.s > ride.position + 200)
      if (next) jump(next.s - 150, next.name)
    } else if (e.code === 'KeyP') {
      const prev = [...landmarks].reverse().find((l) => l.s < ride.position - 200)
      if (prev) jump(prev.s - 150, prev.name)
    }
    // the map, which is the one piece of the interface that is not on screen all the time
    else if (e.code === 'KeyM') minimap.toggle(ride.position)
    /**
     * C copies where the rider really is, as latitude and longitude, to compare the scenery with photographs
     * of the place. Pasted into a map's search box it lands on the spot; the heading goes with it so the
     * right way along the road can be found in a street-level view.
     */
    else if (e.code === 'KeyC') {
      const pose = route.poseAt(ride.position)
      const at = unproject({ x: pose.x, z: pose.z }, route.manifest.origin)
      const text = `${at.lat.toFixed(6)}, ${at.lon.toFixed(6)}`
      const heading = ((Math.atan2(pose.hx, pose.hz) * 180) / Math.PI + 360) % 360
      navigator.clipboard.writeText(text).then(
        () => hud.say('Copied', `${text} · heading ${heading.toFixed(0)}° · ${km(ride.position)} in`, 3000),
        () => hud.say('Could not copy', text, 6000),
      )
    }
  })

  /**
   * The screenshot harness's way in (tools/shots.ts).
   *
   * Three things have to be true before a frame is worth comparing with the one taken before a change. The
   * ground has to have finished streaming, or the shot is of whatever happened to be built. The materials have
   * to be compiled, which under WebGPU happens off the main thread and means a mesh is silently skipped until
   * it is ready. And the camera has to be snapped rather than eased, because a chase camera that lags the road
   * frames the same hairpin differently every time it is asked.
   *
   * It also pauses the ride, so nothing moves between the wait and the capture, and hides the HUD, so the
   * picture is of the game rather than of the numbers over it.
   */
  const shot = async (s: number, opts: { rider?: boolean } = {}): Promise<void> => {
    // a reference frame is drawn at one fixed resolution, or no two of them are comparable
    resolution.fix(1)
    // The bodies are the avatar kit's, and this game is not where they are worked on. Headless they also come
    // out white, because their textures and environment finish loading after everything else does. So a
    // reference frame of the scenery leaves them out unless asked for.
    const withRider = opts.rider ?? false
    // The bodies are the only casters, and the shadow box is sixteen metres across so that the rider's own
    // shadow is crisp. With the bodies hidden nothing is drawn into the map, and its contents are then
    // whatever was there before — which showed up as a reference frame with the whole near ring black. There
    // is no caster to substitute: anything big enough to always be in view is far too big for that box, and
    // feeding it the road put every tree in the scene into shadow. So with no rider there is no shadow pass.
    // the scenery casts now, so the map has something in it whether or not the bodies are shown
    sky.sun.shadowEnabled = true
    rider.root.setEnabled(withRider)
    for (const m of rider.meshes().concat(otherRiders.meshes())) m.setEnabled(withRider)

    ride.seek(s)
    const pose = route.poseAt(s)
    frame.follow(pose.x, pose.z)
    sky.setBiome(route.biomeAt(s))
    terrain.setBiome(BIOMES[route.biomeAt(s)])
    distance.setBiome(BIOMES[route.biomeAt(s)])
    scatter.setBiome(BIOMES[route.biomeAt(s)])
    water.setBiome(BIOMES[route.biomeAt(s)])
    terrain.update(pose.x, pose.z)
    terrain.fill(Config.viewRadius)
    distance.setHole(frame.localX(pose.x), frame.localZ(pose.z))
    distance.update(pose.x, pose.z)
    distance.fill(Config.farRadius)
    trail.update(s)
    water.update(pose.x, pose.z)
    water.fill(start.x, start.z)
    scatter.riderS = s
    scatter.riderHx = pose.hx
    scatter.riderHz = pose.hz
    scatter.update(pose.x, pose.z)
    sky.follow(frame.localX(pose.x), pose.y, frame.localZ(pose.z))
    rider.update(pose, 0, pose.grade, false, 0, route.surfaceAt(s), 0)
    chase.snap(rider.root.position, pose.hx, pose.hz, pose.grade)
    document.body.classList.add('shooting')
    await new Promise<void>((done) => scene.executeWhenReady(() => done()))
    // `executeWhenReady` is satisfied by the meshes that exist, and the rider's body arrives later still —
    // its textures load after the scene is otherwise ready, and a frame taken too early has a white cut-out
    // where the rider is. So wait for every material in the scene to report itself ready, with a ceiling on
    // how long that is allowed to take.
    // the trees photograph themselves for their impostors on the first frames after their leaves load, and
    // `tick` is what drives that, so the harness has to run the clock while it waits
    scatter.tick(0)
    const deadline = performance.now() + 20_000
    while (performance.now() < deadline) {
      scene.render()
      scatter.tick(0.016)
      const pending = scene.meshes.filter((m) => m.isEnabled() && m.material && !m.material.isReady(m))
      if (!pending.length && scene.getWaitingItemsCount() === 0 && terrain.settled && distance.settled && water.settled && scatter.baked) break
      await new Promise((r) => requestAnimationFrame(r))
    }
    // and a few more, so anything that only just became ready is actually drawn
    for (let i = 0; i < 3; i++) scene.render()
  }

  Object.assign(window, {
    __game: { route, ride, frame, engine, scene, others, scatter, chase, water, resolution, terrain, distance, trail, markers, bridges, sky, platform, at: () => ride.position },
    __shot: shot,
    __ready: true,
  })
}

void main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  console.error(e)
  el('loading').classList.add('on')
  el('loadingText').textContent = `Could not start: ${message}`
})
