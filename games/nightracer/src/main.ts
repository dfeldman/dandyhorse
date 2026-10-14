/**
 * Night Racer: boot and the frame loop.
 *
 * On Dandyhorse the session starts first (?session= from the bridge, or an ad-hoc debug one), and `Platform`
 * supplies the pedal, the buttons, the clock and the pauses (INTEGRATION.md). Opened on its own, the game runs
 * from the URL with the keyboard and the slider.
 *
 * URL options (all optional): ?seed=123 (same tracks every time), ?minutes=30 (workout length), ?laps=1 (force laps),
 * ?difficulty=easy|normal|hard, ?pedal=55 (hold the pedal; hides the slider), ?practice (skip the session choice).
 * window.__game is a debug handle: __game.step(dt, n) fast-forwards the simulation (the in-app browser pane draws at
 * ~1 fps), __game.snapshot() is what the platform reads each second.
 */
import {
  Color3, DirectionalLight, Engine, GlowLayer, HemisphericLight, Matrix, PointLight, Scene, Vector3,
} from '@babylonjs/core'
import { ApiError, startSession, units, type StartPayload, type StartSessionAdHoc, type StartSessionBySession } from '@dandyhorse/gamekit'
import { Config, type Difficulty } from './config.ts'
import { LocalControls, type Controls } from './controls.ts'
import { GAME_ID, Platform } from './platform.ts'
import { ChaseCamera } from './render/camera.ts'
import { CarView } from './render/carView.ts'
import { Effects } from './render/effects.ts'
import { PipView } from './render/pip.ts'
import { themeFor } from './render/theme.ts'
import { MOON_DIR, World } from './render/world.ts'
import type { ButtonId } from './sim/car.ts'
import { PLAYER_ID, type Race, type RaceEvent } from './sim/race.ts'
import { Series } from './sim/series.ts'
import { Hud, type TagPoint } from './ui/hud.ts'
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
const pedalHold = num('pedal') ?? null
const forcedLaps = num('laps')

async function boot(platform: Platform | null): Promise<void> {
  // the signs and banners are drawn with the page font; give it a moment to arrive
  await Promise.race([document.fonts.load('800 40px "Baloo 2"'), new Promise((r) => setTimeout(r, 1500))])

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement
  // preserveDrawingBuffer: the platform's session picture is read back from the last frame
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.skipPointerMovePicking = true
  scene.autoClear = true

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.62
  hemi.diffuse = new Color3(0.6, 0.65, 1)
  hemi.groundColor = new Color3(0.16, 0.1, 0.26)
  hemi.specular = new Color3(0.25, 0.25, 0.35)
  const moon = new DirectionalLight('moon', MOON_DIR.scale(-1), scene)
  moon.intensity = 0.75
  moon.diffuse = new Color3(0.78, 0.84, 1)
  const fill = new PointLight('fill', Vector3.Zero(), scene)
  fill.intensity = 0.9
  fill.range = 45
  fill.diffuse = new Color3(1, 0.86, 0.72)
  const glow = new GlowLayer('glow', scene, { mainTextureSamples: 2, blurKernelSize: 32 })
  glow.intensity = 0.85

  const controls: Controls & { set?: (v: number) => void } = platform ?? new LocalControls({ pedal: pedalHold })
  const diff = platform ? platform.difficulty : difficulty
  const series = new Series({
    seed: platform ? platform.seed : seed,
    duration: platform ? platform.duration : minutes * 60,
    difficulty: Config.DIFFICULTY[diff] ?? 1,
    laps: forcedLaps,
  })
  // The platform keeps the clock, so a pause doesn't eat into the workout (INTEGRATION.md §6).
  if (platform) series.useClock(() => platform.activeSeconds())
  const cam = new ChaseCamera(scene)
  const views = new Map<string, CarView>()
  for (const id of [PLAYER_ID, ...Config.RIVALS.map((r) => r.id)]) {
    const v = new CarView(scene, id)
    views.set(id, v)
    glow.addExcludedMesh(v.model.beams)
  }
  const effects = new Effects(scene)
  const pip = new PipView(scene, cam.camera)
  const hud = new Hud({
    harness: controls.harness,
    pedal: controls.pedal() ?? 50,
    onButton: (b: ButtonId) => controls.press(b),
    onResume: () => { if (controls.paused()) controls.togglePause() },
    onPedal: (v) => (controls as LocalControls).set(v),
    ...(platform
      ? {
          onEnd: () => platform.finishEarly(),
          // the car's speed isn't a real speed, but an mph reader still expects mph (INTEGRATION.md §8)
          speed: (ms: number) => {
            const q = units.speed(ms, platform.start.unitSystem, 0)
            return { value: q.value === null ? '–' : q.value.toFixed(0), unit: q.unit }
          },
        }
      : {}),
  })
  if (controls instanceof LocalControls) {
    const slider = document.getElementById('pedal') as HTMLInputElement
    controls.onChange((v) => { slider.value = String(Math.round(v)) })
  }

  let world: World | null = null
  let worldVersion = 0
  const buildWorld = (): void => {
    hud.setSyncing(true)
    world?.dispose()
    effects.clearSlicks()
    pip.clear()
    const race = series.race
    world = new World(scene, race.track, themeFor(series.raceNumber), race.cars.map((c) => c.homeLane))
    for (const m of world.getGlowExcluded()) glow.addExcludedMesh(m)
    worldVersion = series.version
    cam.snap()
    setTimeout(() => hud.setSyncing(false), 80)
  }

  /** The platform's pause message is written for the player; standalone says what the keys are. */
  const pauseMessage = (): string =>
    platform?.pauseMessage() ?? 'Take a breather. Press P or tap Keep racing.'

  let goFlash = 0
  const onEvent = (e: RaceEvent, race: Race): void => {
    hud.event(e, race)
    platform?.event(e)
    const pv = views.get(PLAYER_ID)!
    switch (e.type) {
      case 'go': goFlash = 2; break
      case 'turbo':
      case 'rocket': {
        const v = views.get(e.car)
        if (v) effects.fireAt(v.point(Config.CAR_LENGTH / 2 + 0.8, 0.4), 14)
        if (e.car === PLAYER_ID) cam.kick(e.type === 'rocket' ? 1 : 0.6)
        break
      }
      case 'spin': {
        const v = views.get(e.car)
        if (v) { effects.smokeAt(v.point(0, 0.6), 10); effects.sparksAt(v.point(0, 0.3), 20) }
        if (e.car === PLAYER_ID) cam.kick(0.8)
        if (e.by === PLAYER_ID) pip.spun(e.car, race.car(e.car)?.name ?? e.car)
        break
      }
      case 'bump': {
        const a = views.get(e.a), b = views.get(e.b)
        if (a && b) {
          const mid = a.pos.add(b.pos).scale(0.5)
          mid.y += 0.5
          effects.sparksAt(mid, e.hard ? 40 : 16)
          a.thump(e.hard ? 0.5 : 0.25)
          b.thump(e.hard ? 0.5 : 0.25)
        }
        if (e.a === PLAYER_ID || e.b === PLAYER_ID) cam.kick(e.hard ? 0.8 : 0.4)
        break
      }
      case 'land': {
        const v = views.get(e.car)
        if (v) { v.thump(Math.min(1, e.air / 6)); effects.dustAt(v.point(0, 0.1), 10) }
        if (e.car === PLAYER_ID) cam.kick(Math.min(0.7, e.air / 8))
        break
      }
      case 'finish':
        if (e.place <= 3) effects.celebrate(pv.pos, e.place === 1 ? 10 : 5)
        break
      default:
        break
    }
  }

  const drain = (): void => {
    const race = series.race
    for (const e of race.takeEvents()) onEvent(e, race)
  }

  /** Run the simulation for dt seconds of wall-clock time, in substeps. */
  const advance = (dt: number): void => {
    const presses = controls.takePresses()
    let remaining = dt
    let first = true
    while (remaining > 1e-6) {
      const h = Math.min(Config.MAX_STEP, remaining)
      series.step(h, { pedal: controls.pedal(), presses: first ? presses : [] })
      first = false
      remaining -= h
      drain()
      if (series.version !== worldVersion) break
    }
  }

  buildWorld()
  hud.hideLoading()
  platform?.attach({ series, sessionImage: () => sessionCardUrl(canvas, series) })

  let last = performance.now()
  let simTime = 0
  /** Debug: hold the simulation still but keep drawing (camera and effects settle), for screenshots. */
  let hold = false
  const tagPoints: TagPoint[] = []
  const viewport = cam.camera.viewport
  const frame = (): void => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, Config.MAX_CATCH_UP)
    last = now
    controls.update(dt)
    const paused = controls.paused()
    if (!paused && !hold) {
      advance(dt)
      simTime += dt
    }
    if (series.version !== worldVersion) buildWorld()
    const race = series.race
    const fdt = paused ? 0 : hold ? 0.05 : Math.min(dt, 0.1)
    for (const car of race.cars) views.get(car.id)!.update(car, race.track, fdt, simTime)
    const pv = views.get(PLAYER_ID)!
    cam.update(Math.max(fdt, 1e-4), race, pv, simTime, series.phase !== 'race')
    fill.position.copyFrom(pv.point(3, 4))

    // start lights
    if (race.phase === 'countdown') world!.setStartLights(Math.min(5, Math.ceil((race.phaseTime / Config.COUNTDOWN_TIME) * 5)))
    else if (race.phase === 'racing' && goFlash > 0) { goFlash -= fdt; world!.setStartLights(goFlash > 0 ? 'go' : null) }
    else world!.setStartLights(null)

    world!.update(simTime, cam.camera.position, race.cars.map((c) => views.get(c.id)!.light()))
    effects.update(fdt, race, views)
    pip.update(fdt, race, views, pv)

    // rival name tags
    tagPoints.length = 0
    const w = engine.getRenderWidth(), h = engine.getRenderHeight()
    const scaleX = canvas.clientWidth / w, scaleY = canvas.clientHeight / h
    const transform = cam.camera.getTransformationMatrix()
    const vp = viewport.toGlobal(w, h)
    const camFwd = cam.camera.getDirection(Vector3.Forward())
    for (const car of race.cars) {
      if (car.id === PLAYER_ID) continue
      const v = views.get(car.id)!
      const pt = v.point(0, 2.3 + car.air)
      const toCar = pt.subtract(cam.camera.position)
      const dist = toCar.length()
      const front = Vector3.Dot(toCar, camFwd) > 0
      const s = Vector3.Project(pt, Matrix.IdentityReadOnly, transform, vp)
      tagPoints.push({ id: car.id, x: s.x * scaleX, y: s.y * scaleY, visible: front && s.z > 0 && s.z < 1, dist })
    }
    hud.update(series, controls.pedal() ?? 0, tagPoints, { on: paused, message: pauseMessage() })
    scene.render()

    if (platform) {
      platform.sync()
      // the session ended from a bridge or the console: show the standings as they stand and stop
      if (platform.ended() && series.phase !== 'over') platform.finishEarly()
      if (series.phase === 'over') platform.finish()
    }
  }
  engine.runRenderLoop(frame)
  window.addEventListener('resize', () => engine.resize())

  /** What the platform adapter will send each second. */
  const snapshot = () => {
    const race = series.race
    const p = race.player
    const pos = race.track.pointAt(p.dist, p.x, 0)
    return {
      phase: race.phase, series: series.phase, race: series.raceNumber, track: series.trackName,
      lap: race.playerLap, laps: race.laps, place: p.place, speed: p.speed,
      grade: race.track.poseAt(p.dist).grade, gradeAhead: race.track.gradeAhead(p.dist, 150),
      points: series.playerPoints, remaining: series.remaining, pos,
      turbo: p.turbo, oil: p.oil, boost: p.boost, oilTarget: race.oilTarget()?.id ?? null,
    }
  }
  window.__game = {
    series, controls, scene, engine, snapshot,
    /** Fast-forward: n steps of dt seconds (the next frame draws the result). */
    step(dt = 0.05, n = 1) {
      for (let i = 0; i < n; i++) {
        advance(dt)
        simTime += dt
        if (series.version !== worldVersion) buildWorld()
      }
      return snapshot()
    },
    press: (b: ButtonId) => controls.press(b),
    hold: (v = true) => { hold = v },
    /** Settle the camera and effects on the current state (with hold on), n frames of 50 ms. */
    settle(n = 40) {
      const race = series.race
      for (let i = 0; i < n; i++) {
        for (const car of race.cars) views.get(car.id)!.update(car, race.track, 0.05, simTime)
        cam.update(0.05, race, views.get(PLAYER_ID)!, simTime, series.phase !== 'race')
      }
    },
    setPedal: (v: number) => (controls as LocalControls).set(v),
  }
}

// --- the entry point ----------------------------------------------------------------------------
// On the platform the session starts before anything is built: the seed, the length and the difficulty
// all come from startsession (docs/GAME_DEVELOPER_GUIDE.md §10).

const bootEl = document.getElementById('boot') as HTMLDivElement
const bootMsg = document.getElementById('boot-msg') as HTMLParagraphElement
const bootActions = document.getElementById('boot-actions') as HTMLDivElement

const log = (line: string): void => console.log('nightracer:', line)

function say(msg: string): void {
  bootMsg.textContent = msg
  bootActions.replaceChildren()
}

function fail(msg: string, detail?: string): void {
  bootMsg.textContent = msg
  const pre = document.createElement('pre')
  pre.textContent = detail ?? ''
  bootActions.replaceChildren(detail ? pre : '')
  console.error('nightracer:', msg, detail ?? '')
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = onClick
  return b
}

async function race(platform: Platform | null): Promise<void> {
  say(platform ? 'Building the track…' : 'Warming up the engines…')
  // the world builds synchronously; give the browser one frame to paint the message
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
  await race(new Platform(start, log))
}

async function main(): Promise<void> {
  const sessionParam = params.get('session')
  if (sessionParam) {
    await begin({ sessionId: sessionParam })
    return
  }
  // ?practice skips the choice (screenshots, tests, and the keyboard game)
  if (params.has('practice')) {
    await race(null)
    return
  }
  bootMsg.textContent = 'No session in the URL. Race a debug session with your machine, or practise with the keyboard:'
  const adHoc: StartSessionAdHoc = { gameId: GAME_ID, variant: 'bike', debug: true, options: {} }
  bootActions.replaceChildren(
    button('Debug session', () => void begin(adHoc)),
    button('Practise (↑ ↓ keys)', () => void race(null)),
  )
}

void main()
