/**
 * Entry point: read the URL, build a machine and a workout, and run the frame loop.
 *
 * Standalone the machine is the simulator; on Dandyhorse this file keeps its shape and swaps `SimMachine`
 * for the platform adapter once `?session=` is in the URL (INTEGRATION.md §2). Everything below the machine
 * — the workout, the console, the track — is the same code either way.
 */
import './ui/style.css'
import { record as recordBests } from './bests.ts'
import { Config } from './config.ts'
import type { DriveWho } from './drive.ts'
import type { DeviceType } from './physics.ts'
import { PROGRAM_IDS, PROGRAMS, type ProgramId } from './program.ts'
import { RecoveryTest } from './recovery.ts'
import { createTrackView } from './render/track.ts'
import { SimMachine } from './sim/machine.ts'
import { lapLength } from './track.ts'
import type { UnitSystem } from './units.ts'
import { Hud, type HudOptions } from './ui/hud.ts'
import { GOALS, showSetup, type Choice } from './ui/setup.ts'
import { showRecovery } from './ui/recoveryScreen.ts'
import { showSummary } from './ui/summary.ts'
import { Workout, type GoalKind } from './workout.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const params = new URLSearchParams(location.search)

const num = (k: string, d: number): number => {
  const v = Number(params.get(k))
  return params.get(k) !== null && Number.isFinite(v) ? v : d
}
const one = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
  const v = params.get(k) as T | null
  return v !== null && allowed.includes(v) ? v : d
}

const unitSystem = one<UnitSystem>('units', ['metric', 'us'], 'metric')
const goalKind = one<GoalKind>('goal', ['time', 'distance', 'calories'], 'time')
const minutes = num('minutes', Config.DEFAULT_MINUTES)

const choice: Choice = {
  program: one('program', PROGRAM_IDS, 'hills'),
  minutes,
  level: num('level', Config.LEVEL_DEFAULT),
  device: one<DeviceType>('device', ['treadmill', 'bike'], 'treadmill'),
  who: one<DriveWho>('drive', ['you', 'machine'], 'you'),
  seed: num('seed', (Math.random() * 0xffffffff) >>> 0) >>> 0,
  goal: {
    kind: goalKind,
    value: goalKind === 'time' ? minutes * 60 : num('target', GOALS[goalKind].choices(unitSystem)[2]![1]),
  },
}
const fixedInput = params.has('speed') ? num('speed', 0) : params.has('power') ? num('power', 0) : null
const steadyWatts = num('steady', Config.BASE_POWER)
const startAt = num('at', 0)

const track = createTrackView($<HTMLCanvasElement>('track'))

let workout: Workout | null = null
let hud: Hud | null = null
let machine: SimMachine | null = null
let recovery: RecoveryTest | null = null

// --- starting and stopping -----------------------------------------------------------------------------

function begin(c: Choice): void {
  machine = new SimMachine({
    device: c.device,
    steadyWatts,
    unitSystem,
    auto: params.get('auto') !== '0',
    fixed: fixedInput,
    noHeartRate: params.get('nohr') === '1',
  })
  workout = new Workout({
    machine,
    program: c.program,
    duration: c.minutes * 60,
    level: c.level,
    seed: c.seed,
    who: c.who,
    goal: c.goal,
  })
  hud = new Hud(workout, hudOptions())
  wireHarness(machine)
  workout.start()
  if (startAt > 0) fastForward(startAt)
  layout()
}

function hudOptions(): HudOptions {
  return {
    onPause: () => workout?.togglePause(),
    onEnd: () => finish(true),
    onResume: () => workout?.resume(),
    onOpenPicker: () => openPicker(),
  }
}

/** Run the simulation forward with nothing drawn: `?at=600` opens on a workout already under way. */
function fastForward(seconds: number): void {
  const step = 0.25
  for (let t = 0; t < seconds && workout && !workout.ended; t += step) {
    machine?.update(step)
    workout.tick(step)
  }
}

function openPicker(): void {
  if (!workout) return
  const wasRunning = workout.state().phase === 'running'
  workout.pause()
  showSetup(
    $('setup'),
    { ...choice, program: workout.plan.program, level: workout.plan.level },
    {
      showMachine: false,
      showLength: false,
      sys: unitSystem,
      title: 'Change the programme',
      blurb: 'The clock and everything you have done so far stay as they are.',
      startLabel: 'Use this programme',
      cancel: () => {
        if (wasRunning) workout?.resume()
      },
    },
    (c) => {
      if (!c || !workout) return
      workout.setProgram(c.program, c.level)
      hud?.refreshControls(hudOptions())
      if (wasRunning) workout.resume()
    },
  )
}

/** End the workout: the recovery test first if there is a strap, then the summary. */
function finish(early: boolean): void {
  if (!workout || !machine || recovery) return
  workout.stop()
  $('paused').hidden = true
  hud?.sound.play('done')
  if (RecoveryTest.available(machine) && !early) {
    recovery = new RecoveryTest(machine)
    showRecovery($('recovery'), recovery, {
      onDone: () => {
        $('recovery').hidden = true
        summarise(early)
      },
    })
    return
  }
  summarise(early)
}

function summarise(early: boolean): void {
  if (!workout || !machine) return
  workout.earnAtEnd({ early, recoveryDrop: recovery?.result()?.drop ?? null })
  const s = workout.summary()
  const fastestLap = s.splits.length > 0 ? Math.min(...s.splits.filter((x) => x.lap <= s.laps).map((x) => x.seconds)) : null
  const { bests, beaten } = recordBests(machine.device, {
    fastestLap: s.laps > 0 ? fastestLap : null,
    distance: s.distance,
    calories: s.energy / 4184,
    climb: s.elevation,
  })
  const test = recovery
  recovery = null
  showSummary($('summary'), s, {
    device: machine.device,
    sys: unitSystem,
    early,
    maxHr: machine.heartRateRange().max,
    recovery: test?.result() ?? null,
    bests,
    beaten,
    onAgain: () => location.reload(),
    onChange: () => {
      $('summary').hidden = true
      askAndStart()
    },
  })
}

function askAndStart(): void {
  showSetup(
    $('setup'),
    choice,
    {
      showMachine: true,
      showLength: true,
      sys: unitSystem,
      title: 'Lane One',
      blurb: 'A treadmill and bike console, and a track to go round.',
      startLabel: 'Start',
    },
    (c) => {
      if (!c) return
      Object.assign(choice, c)
      begin(choice)
    },
  )
}

// --- the harness ------------------------------------------------------------------------------------

function wireHarness(m: SimMachine): void {
  const host = $('harness')
  host.hidden = !m.harness
  if (!m.harness) return
  const slider = $<HTMLInputElement>('harness-slider')
  const out = $('harness-value')
  const auto = $<HTMLButtonElement>('harness-auto')
  const [lo, hi] = m.range()
  slider.min = String(lo)
  slider.max = String(hi)
  slider.step = m.device === 'treadmill' ? '0.05' : '1'
  // When the console drives the machine, what the simulated player would have chosen is not used, so the
  // slider is shown greyed rather than left there looking as if it did something.
  const driven = choice.who === 'machine'
  slider.disabled = driven
  auto.disabled = driven
  $('harness-label').textContent = driven
    ? m.device === 'treadmill'
      ? 'The console is driving the belt'
      : 'The trainer is holding the watts'
    : m.device === 'treadmill'
      ? 'Your belt'
      : 'Your effort'
  const show = (v: number): void => {
    if (driven) {
      const r = m.read()
      slider.value = String(m.device === 'treadmill' ? (r.speed ?? 0) : (r.power ?? 0))
      out.textContent = m.device === 'treadmill' ? `${((r.speed ?? 0) * 3.6).toFixed(1)} km/h` : `${Math.round(r.power ?? 0)} W`
      return
    }
    slider.value = String(v)
    out.textContent = m.device === 'treadmill' ? `${(v * 3.6).toFixed(1)} km/h` : `${Math.round(v)} W`
    auto.classList.toggle('on', m.auto)
  }
  if (driven) setInterval(() => show(0), 400)
  m.onChange(show)
  slider.addEventListener('input', () => m.set(Number(slider.value)))
  auto.addEventListener('click', () => {
    m.auto = !m.auto
    show(m.setting())
  })
  show(m.setting())
}

// --- keys -------------------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
  const k = e.key.toLowerCase()
  if (k === 'v') {
    hud?.toggleBig()
    e.preventDefault()
    return
  }
  if (k === 's') {
    hud?.toggleSound()
    e.preventDefault()
    return
  }
  if (!workout || !machine) return
  const tread = machine.device === 'treadmill'
  const dial = tread ? 'speed' : 'power'
  const step = tread ? 0.1 / 3.6 : Config.STEP.power
  if (k === 'arrowup') workout.adjustTarget(dial, step)
  else if (k === 'arrowdown') workout.adjustTarget(dial, -step)
  else if (k === 'arrowright') workout.adjustTarget(tread ? 'incline' : 'grade', Config.STEP.incline)
  else if (k === 'arrowleft') workout.adjustTarget(tread ? 'incline' : 'grade', -Config.STEP.incline)
  else if (k === 'p' || k === 'escape') workout.togglePause()
  else return
  e.preventDefault()
})

// --- the loop ---------------------------------------------------------------------------------------

let last = performance.now()
let readoutDue = 0

function frame(now: number): void {
  const dt = Math.min(Config.MAX_CATCH_UP, Math.max(0, (now - last) / 1000))
  last = now
  if (workout && machine) {
    machine.update(dt)
    // The workout ticks every frame, finished or not: its done-branch is what asks the machine to stand
    // still. Skipping it during the recovery minute would leave the belt running under somebody who has
    // just been told to stand still and breathe.
    workout.tick(dt)
    recovery?.tick(dt)
    const s = workout.state()
    track.draw({
      you: s.distance,
      pacer: s.phase === 'setup' ? null : s.targetDistance,
      zone: s.zone,
      progress: s.progress.done,
      dim: s.phase !== 'running',
    })
    readoutDue -= dt
    if (readoutDue <= 0) {
      const step = 1 / Config.READOUT_HZ
      readoutDue += step
      hud?.update(s, step)
      hud?.profile.draw(s.plan, s.elapsed)
      hud?.trend.draw(workout.trend(), s.elapsed)
    }
    if (s.phase === 'done' && $('summary').hidden && $('recovery').hidden && !recovery) finish(s.progress.done < 1)
  }
  requestAnimationFrame(frame)
}

function layout(): void {
  track.layout()
  hud?.relayout()
}

window.addEventListener('resize', layout)
requestAnimationFrame(frame)

if (params.get('start') === '1' || startAt > 0) begin(choice)
else askAndStart()

/**
 * One handle for the console and for anything driving this page from outside — the same shape the other
 * games expose. `state()` is exactly what the platform adapter will send each second.
 */
declare global {
  interface Window {
    __lane?: { state: () => unknown; trend: () => unknown; machine: () => unknown; workout: () => Workout | null }
  }
}
window.__lane = {
  state: () => workout?.state() ?? null,
  trend: () => workout?.trend() ?? null,
  machine: () => machine?.read() ?? null,
  workout: () => workout,
}

console.info(`Lane One · ${lapLength(1).toFixed(2)} m to the lap · programmes: ${PROGRAM_IDS.map((p) => PROGRAMS[p].name).join(', ')}`)
