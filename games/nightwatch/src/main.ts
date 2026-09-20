/**
 * Night Watch: boot and the frame loop.
 *
 * On Dandyhorse the session starts first (?session= from the bridge, or an ad-hoc debug one), and `Platform`
 * supplies the pedal, the horn and the pauses (INTEGRATION.md). Opened on its own, the game runs from the URL
 * with the keyboard and the slider.
 *
 * URL options (all optional): ?seed=123 (the same night every time), ?minutes=30 (workout length),
 * ?difficulty=easy|normal|hard, ?weather=calm|mixed|wild, ?pedal=55 (hold the pedal; hides the slider),
 * ?at=600 (start this many seconds into the night, with a keeper who follows the board; for screenshots).
 * window.__game is a debug handle: __game.step(dt, n) fast-forwards the night (the in-app browser pane draws at
 * ~1 fps), __game.snapshot() is what the platform will read each second.
 */
import { ApiError, startSession, type StartPayload, type StartSessionAdHoc, type StartSessionBySession } from '@dandyhorse/gamekit'
import { Color3, DirectionalLight, Engine, GlowLayer, HemisphericLight, Scene, Vector3 } from '@babylonjs/core'
import { Config, type Difficulty, type WeatherMode } from './config.ts'
import { LocalControls, type Controls } from './controls.ts'
import { GAME_ID, Platform } from './platform.ts'
import { makeRng } from './rng.ts'
import { ViewCamera } from './render/camera.ts'
import { LAMP } from './render/coast.ts'
import { Effects } from './render/effects.ts'
import { newEnv } from './render/env.ts'
import { FleetView } from './render/fleetView.ts'
import { Lighthouse, dotTexture } from './render/lighthouse.ts'
import { lookAt, moonDirection, sunDirection } from './render/palette.ts'
import { Sea, Sky } from './render/seaSky.ts'
import { WeatherView } from './render/weatherView.ts'
import { World } from './render/world.ts'
import { Night, type ButtonId, type NightEvent } from './sim/night.ts'
import { Hud } from './ui/hud.ts'
import { sessionCardUrl } from './ui/sessioncard.ts'

declare global {
  interface Window { __game?: unknown }
}

const params = new URLSearchParams(location.search)
const num = (k: string): number | undefined => {
  const v = params.get(k)
  return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined
}
const seed = num('seed') ?? Math.floor(Math.random() * 1e6)
const minutes = num('minutes') ?? Config.DEFAULT_MINUTES
const difficulty = (params.get('difficulty') ?? 'normal') as Difficulty
const weatherMode = (params.get('weather') ?? 'mixed') as WeatherMode
const pedalHold = num('pedal') ?? null
const startAt = num('at') ?? 0

/** A keeper who follows the board, for ?at= and __game.jump(). */
function autoPedal(night: Night): number {
  let want = 34
  for (const s of night.ships) {
    const p = s.plan
    if (night.time >= p.watchStart - 6 && night.time < p.watchEnd) want = Math.max(want, p.need + 1)
  }
  return want
}

async function boot(platform: Platform | null): Promise<void> {
  await Promise.race([document.fonts.load('800 40px "Baloo 2"'), new Promise((r) => setTimeout(r, 1500))])

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement
  // preserveDrawingBuffer: the platform's session picture is read back from the last frame
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.skipPointerMovePicking = true
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.clearColor.set(0.02, 0.04, 0.12, 1)

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  const moon = new DirectionalLight('moon', new Vector3(0, -1, 1), scene)
  moon.specular = new Color3(0.3, 0.3, 0.4)
  const glow = new GlowLayer('glow', scene, { mainTextureSamples: 2, blurKernelSize: 24 })
  glow.intensity = 0.9

  const night = platform
    ? new Night({ seed: platform.seed, duration: platform.duration, difficulty: platform.difficulty, weather: platform.weather })
    : new Night({ seed, duration: minutes * 60, difficulty, weather: weatherMode })
  const controls: Controls = platform ?? new LocalControls({ pedal: pedalHold })
  const env = newEnv()
  env.lampPos.set(LAMP.x, LAMP.y, LAMP.z)
  const dot = dotTexture(scene)

  const cam = new ViewCamera(scene)
  const sky = new Sky(scene)
  const sea = new Sea(scene)
  const world = new World(scene)
  const lighthouse = new Lighthouse(scene)
  const fleet = new FleetView(scene, night, dot)
  const effects = new Effects(scene, dot, sky, seed)
  const weather = new WeatherView(scene, dot, seed)
  // the sea stays in the glow pass as an occluder (excluding a mesh this big made it draw over everything)
  for (const m of [sky.mesh, ...lighthouse.excluded, ...world.excluded]) glow.addExcludedMesh(m)
  // some nights have the northern lights
  sky.aurora = makeRng(seed, 'aurora')() < 0.4 ? 1 : 0

  const hud = new Hud({
    harness: controls.harness,
    onHorn: () => controls.press('horn'),
    onResume: () => { if (controls.paused()) controls.togglePause() },
    onPedal: (v) => (controls as LocalControls).set(v),
    onAgain: () => {
      params.delete('seed')
      params.delete('at')
      location.search = params.toString()
    },
    ...(platform
      ? { onEnd: () => { night.finishNow(); for (const e of night.takeEvents()) onEvent(e) }, store: platform.store() }
      : {}),
  })
  if (controls instanceof LocalControls) controls.onChange((v) => hud.setPedalSlider(v))

  const onEvent = (e: NightEvent): void => {
    hud.event(e, night)
    platform?.event(e)
    const at = 'ship' in e ? fleet.positionOf(e.ship.id) : null
    switch (e.type) {
      case 'horn':
        effects.hornRings(1)
        lighthouse.blow(1)
        cam.kick(0.6)
        break
      case 'toot':
        lighthouse.blow(e.reason === 'hail' ? 0.6 : 0.25)
        if (e.reason === 'hail') effects.hornRings(0.4)
        break
      case 'scrape':
        if (at) effects.scrape(at, e.ship.hull < 0.5)
        if (e.ship.plan.need > 0) cam.kick(0.25)
        break
      case 'aground':
        if (at) { effects.scrape(at, true); effects.distress(at) }
        cam.kick(0.9)
        break
      case 'safe':
        if (at) effects.homeSparkle(at, e.stars)
        if (e.ship.plan.bigOne && e.stars >= 2) effects.celebrate(10)
        else if (e.streak > 0 && e.streak % 3 === 0) effects.celebrate(4)
        break
      case 'docked':
        world.setTownLevel(0.15 + night.shipsHome * 0.09)
        break
      case 'done':
        if (night.starsEarned >= night.starsMax * 0.6) effects.celebrate(18)
        break
      default:
        break
    }
  }

  const advance = (dt: number, pedalFn: () => number | null, presses: ButtonId[]): void => {
    let remaining = dt
    let first = true
    while (remaining > 1e-6) {
      const h = Math.min(Config.MAX_STEP, remaining)
      night.step(h, { pedal: pedalFn(), presses: first ? presses : [] })
      first = false
      remaining -= h
      for (const e of night.takeEvents()) onEvent(e)
    }
  }

  /** Jump the night forward with a board-following keeper (no events shown), for screenshots and testing. */
  const jump = (to: number): void => {
    while (night.time < to && night.phase !== 'done') {
      night.step(0.1, { pedal: autoPedal(night), presses: [] })
      night.takeEvents()
    }
    world.setTownLevel(0.15 + night.shipsHome * 0.09)
    if (controls instanceof LocalControls && controls.harness) controls.set(autoPedal(night))
  }
  if (startAt > 0) jump(startAt)

  let last = performance.now()
  let simTime = startAt
  let hold = false
  let snapNext = true
  let doneAt = -1

  const render = (dt: number): void => {
    const paused = controls.paused()
    const fdt = paused ? 0 : hold ? 0.05 : Math.min(dt, 0.1)
    env.time = simTime
    const mix = night.weather.mix(night.time)
    weather.update(fdt, mix, cam.camera)
    const look = lookAt(night.progress, mix, weather.lightning)
    env.look = look
    env.flash = weather.lightning * 0.6
    env.fogColor.set(look.fogColor[0], look.fogColor[1], look.fogColor[2])
    env.fogDensity = look.fogDensity
    env.fogAmt = Math.min(1, mix.fog + mix.mist * 0.4 + mix.rain * 0.3)
    env.waveAmp = look.waves
    const md = moonDirection(night.progress)
    env.moonDir.set(md[0], md[1], md[2])
    const sd = sunDirection(look.sun)
    env.sunDir.set(sd[0], sd[1], sd[2])

    scene.fogColor.set(look.fogColor[0], look.fogColor[1], look.fogColor[2])
    scene.fogDensity = look.fogDensity
    hemi.diffuse.set(look.hemiSky[0], look.hemiSky[1], look.hemiSky[2])
    hemi.groundColor.set(look.hemiGround[0], look.hemiGround[1], look.hemiGround[2])
    hemi.intensity = look.hemi
    moon.direction.set(-md[0], -Math.max(md[1], 0.35), -md[2])
    moon.intensity = 0.2 + 0.45 * look.moon + (look.sun > 0 ? look.sun * 1.2 : 0)
    moon.diffuse.set(0.7 + 0.3 * Math.max(0, look.sun), 0.76, 0.95 - 0.2 * Math.max(0, look.sun))

    const watching = night.watching
    const lead = watching[0]
    const interest = lead ? fleet.positionOf(lead.id) : null
    const canvasW = engine.getRenderWidth(), canvasH = engine.getRenderHeight()
    cam.update(Math.max(fdt, 1e-4), simTime, interest && lead!.u > 1.2 ? interest : null, canvasW / Math.max(1, canvasH), mix.storm, snapNext)
    env.cameraPos.copyFrom(cam.camera.position)

    const lamp = night.lamp
    // after dawn the keeper lets the lamp go out over a few seconds
    if (night.phase === 'done' && doneAt < 0) doneAt = simTime
    const lampOn = doneAt >= 0 ? lamp.brightness * Math.max(0, 1 - (simTime - doneAt) / 4) : lamp.brightness
    lighthouse.update(fdt, env, lampOn, (lamp.power - lamp.target) / 10, night.lit && night.phase !== 'done')
    sea.update(env)
    sky.update(env)
    world.update(fdt, env, night.ships)
    fleet.update(night, env, fdt, snapNext, cam.camera, engine)
    effects.update(fdt, env, night.progress, !lead)
    snapNext = false
    hud.update(night, controls.pedal() ?? 0, fleet.tags, paused)
    scene.render()
  }

  const frame = (): void => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, Config.MAX_CATCH_UP)
    last = now
    controls.update(dt)
    if (!controls.paused() && !hold) {
      advance(dt, () => controls.pedal(), controls.takePresses())
      simTime += dt
    } else if (hold && night.phase === 'done') {
      simTime += dt
    }
    render(dt)

    if (platform) {
      platform.sync()
      hud.setPauseMessage(platform.pauseMessage())
      // the session ended from a bridge or the console: show the logbook as it stands and stop
      if (platform.ended() && night.phase !== 'done') {
        night.finishNow()
        for (const e of night.takeEvents()) onEvent(e)
      }
      if (night.phase === 'done') platform.finish()
    }
  }

  hud.hideLoading()
  platform?.attach({ night, sessionImage: () => sessionCardUrl(canvas, night) })
  engine.runRenderLoop(frame)
  window.addEventListener('resize', () => engine.resize())

  window.__game = {
    night, controls, scene, engine, env, cam,
    snapshot: () => night.snapshot(),
    /** Fast-forward: n steps of dt seconds with the current pedal (events play out as usual). */
    step(dt = 0.1, n = 1) {
      for (let i = 0; i < n; i++) {
        advance(dt, () => controls.pedal(), controls.takePresses())
        simTime += dt
      }
      snapNext = true
      return night.snapshot()
    },
    /** Jump to a time in the night with a keeper who follows the board. */
    jump(t: number) {
      const from = night.time
      jump(t)
      simTime += night.time - from
      snapNext = true
      return night.snapshot()
    },
    press: (b: ButtonId) => controls.press(b),
    hold: (v = true) => { hold = v },
    /** Draw n frames of 50 ms without advancing the night (camera, waves and effects settle). */
    settle(n = 20) {
      for (let i = 0; i < n; i++) { simTime += 0.05; render(0.05) }
    },
    setPedal: (v: number) => (controls as LocalControls).set(v),
  }
}

// --- the entry point ----------------------------------------------------------------------------
// On the platform the session starts before the night is built: the seed, the length, the difficulty and the
// weather all come from startsession (docs/GAME_DEVELOPER_GUIDE.md §10).

const bootEl = document.getElementById('boot') as HTMLDivElement
const bootMsg = document.getElementById('boot-msg') as HTMLDivElement
const bootActions = document.getElementById('boot-actions') as HTMLDivElement

const log = (line: string): void => console.log('nightwatch:', line)

function say(msg: string): void {
  bootMsg.textContent = msg
  bootActions.replaceChildren()
}

function fail(msg: string, detail?: string): void {
  bootMsg.textContent = msg
  const pre = document.createElement('pre')
  pre.textContent = detail ?? ''
  bootActions.replaceChildren(detail ? pre : '')
  console.error('nightwatch:', msg, detail ?? '')
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = onClick
  return b
}

async function watch(platform: Platform | null): Promise<void> {
  say('Lighting the lamp…')
  // the night builds synchronously; give the browser one frame to paint the message
  await new Promise((r) => requestAnimationFrame(r))
  try {
    await boot(platform)
  } catch (e) {
    fail('The game could not start.', e instanceof Error ? (e.stack ?? e.message) : String(e))
    return
  }
  bootEl.classList.remove('on')
}

async function begin(body: StartSessionBySession | StartSessionAdHoc): Promise<void> {
  say('Starting your session…')
  let start: StartPayload
  try {
    start = await startSession(body)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      bootMsg.textContent = 'You are not logged in.'
      const a = document.createElement('a')
      a.className = 'btn'
      a.href = `/login?uid=1&next=${encodeURIComponent(`${location.pathname}${location.search}`)}`
      a.textContent = 'Log in and come back'
      bootActions.replaceChildren(a)
      return
    }
    fail('The session could not start.', e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e))
    return
  }
  log(`session ${start.sessionId} · ${start.variant} · ${start.deviceType} · ${start.unitSystem}${start.debug ? ' · debug' : ''}`)
  await watch(new Platform(start, log))
}

async function main(): Promise<void> {
  const sessionParam = params.get('session')
  if (sessionParam) {
    await begin({ sessionId: sessionParam })
    return
  }
  // ?practice skips the choice (screenshots, tests, and the keyboard game)
  if (params.has('practice')) {
    await watch(null)
    return
  }
  bootMsg.textContent = 'No session in the URL. Keep a debug watch with your machine, or practise with the keyboard:'
  const adHoc: StartSessionAdHoc = { gameId: GAME_ID, variant: 'bike', debug: true, options: {} }
  bootActions.replaceChildren(
    button('Debug session', () => void begin(adHoc)),
    button('Practise (↑ ↓ keys)', () => void watch(null)),
  )
}

void main()
