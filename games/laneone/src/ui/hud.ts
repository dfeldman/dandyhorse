/**
 * The console itself: the numbers, the programme banner and the buttons.
 *
 * Two rules run through it. **Nothing is rewritten unless it changed** — every readout goes through `Cell`, so
 * a screen sitting at a steady pace touches the DOM a handful of times a second, not a few hundred. And
 * **warm is you, cool is the console**: a tile shows what the machine is doing in white, what the programme
 * asked for underneath in blue, and turns the strip down its left edge green when the two agree.
 */
import { Config } from '../config.ts'
import type { Base } from '../drive.ts'
import type { Machine } from '../machine.ts'
import { acsmVo2 } from '../physics.ts'
import { PROGRAMS } from '../program.ts'
import { createProfileView, type ProfileView } from '../render/profile.ts'
import { createTrendView, type TrendView } from '../render/trend.ts'
import * as units from '../units.ts'
import type { UnitSystem } from '../units.ts'
import { avgOf, TREND_SECONDS, type GoalKind, type WorkoutState } from '../workout.ts'
import type { Workout } from '../workout.ts'
import { ZONE_CEILING, ZONE_FLOOR, ZONES, zoneColour, zoneName, zoneRange } from '../zones.ts'
import { Sound } from './sound.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** A text node that only writes to the DOM when its value changes. */
class Cell {
  private last: string | null = null
  readonly node: HTMLElement
  constructor(node: HTMLElement) {
    this.node = node
  }
  set(v: string): void {
    if (v === this.last) return
    this.last = v
    this.node.textContent = v
  }
}

/** A class that is only toggled when it changes. */
class Flag {
  private last: boolean | null = null
  readonly node: HTMLElement
  readonly name: string
  constructor(node: HTMLElement, name: string) {
    this.node = node
    this.name = name
  }
  set(on: boolean): void {
    if (on === this.last) return
    this.last = on
    this.node.classList.toggle(this.name, on)
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls }, label)
  b.addEventListener('click', onClick)
  return b
}

/** One metric tile: what the machine reads, and under it what the programme asked for. */
interface Tile {
  root: HTMLElement
  label: string
  now: Cell
  unit: Cell
  ask: Cell
  askRow: HTMLElement
  isTarget: Flag
  isHit: Flag
  dimmed: Flag
}

function makeTile(label: string, unit: string): Tile {
  const now = el('b', { class: 'now' }, '—')
  const unitEl = el('span', { class: 'unit' }, unit)
  const ask = el('b', {}, '')
  const askRow = el('div', { class: 'ask hidden' }, el('span', {}, '→'), ask)
  const root = el('div', { class: 'tile' }, el('span', { class: 'label' }, label), el('div', { class: 'row' }, now, unitEl), askRow)
  return {
    root,
    label,
    now: new Cell(now),
    unit: new Cell(unitEl),
    ask: new Cell(ask),
    askRow,
    isTarget: new Flag(root, 'is-target'),
    isHit: new Flag(root, 'is-hit'),
    dimmed: new Flag(root, 'dimmed'),
  }
}

/** A −/+ pair with a readout, and optional one-touch keys: a console's speed or incline cluster. */
interface Group {
  root: HTMLElement
  value: Cell
  unit: Cell
  quick: HTMLButtonElement[]
  quickValues: number[]
}

export interface HudOptions {
  onPause(): void
  onEnd(): void
  onResume(): void
  onOpenPicker(): void
}

/** How long before a segment changes the console says "get ready" (s). */
const READY_AT = 10
/** How long a callout or a lap toast stays up (s). */
const CALLOUT_FOR = 2.8

export class Hud {
  private readonly sys: UnitSystem
  private readonly workout: Workout
  private readonly machine: Machine
  private readonly tiles: Tile[] = []
  private readonly tileOf = new Map<string, Tile>()
  private readonly groups = new Map<keyof Base | 'level', Group>()
  readonly profile: ProfileView
  readonly trend: TrendView
  readonly sound = new Sound()
  private readonly cells: Record<string, Cell>
  private lastPhase: string | null = null
  private lastProgramme = ''
  private readonly zoneBands: HTMLElement[] = []
  private readonly zoneLegend: { row: HTMLElement; time: Cell }[] = []
  private readonly bigCells: { label: string; value: Cell; unit: Cell }[] = []
  private lastSegment = -1
  private readyFor = -1
  private lastLaps = 0
  private calloutUntil = 0
  private toastUntil = 0
  private clock = 0
  big = false

  constructor(workout: Workout, opts: HudOptions) {
    this.workout = workout
    this.machine = workout.machine
    this.sys = this.machine.unitSystem()
    this.profile = createProfileView($<HTMLCanvasElement>('profile'))
    this.trend = createTrendView($<HTMLCanvasElement>('trend'), {
      window: Math.min(TREND_SECONDS, 360),
      maxHr: this.machine.heartRateRange().max,
    })

    this.cells = {
      meta: new Cell($('bar-meta')),
      time: new Cell($('m-time')),
      elapsed: new Cell($('m-elapsed')),
      dist: new Cell($('m-dist')),
      distUnit: new Cell($('m-dist-unit')),
      kcal: new Cell($('m-kcal')),
      lap: new Cell($('lap-n')),
      segLabel: new Cell($('seg-label')),
      segLeft: new Cell($('seg-left')),
      segNext: new Cell($('seg-next')),
      pauseWhy: new Cell($('pause-why')),
      legendPacer: new Cell($('legend-pacer')),
      calloutText: new Cell($('callout-text')),
      calloutSub: new Cell($('callout-sub')),
      lapToast: new Cell($('lap-toast')),
      lapWord: new Cell($('lap-word')),
      labelTime: new Cell($('l-time')),
      labelDist: new Cell($('l-dist')),
      labelKcal: new Cell($('l-kcal')),
      kcalSub: new Cell($('m-kcal-sub')),
    }

    $('btn-pause').addEventListener('click', opts.onPause)
    $('btn-end').addEventListener('click', opts.onEnd)
    $('btn-end-2').addEventListener('click', opts.onEnd)
    $('btn-resume').addEventListener('click', opts.onResume)

    this.buildTiles()
    this.buildZones()
    this.buildBigView()
    this.buildControls(opts)
    $('btn-view').addEventListener('click', () => this.toggleBig())
    $('btn-sound').addEventListener('click', () => this.toggleSound())
    this.cells.legendPacer!.set(this.machine.device === 'treadmill' ? 'target pace' : 'target power')
  }

  // --- building ------------------------------------------------------------------------------------------

  private buildTiles(): void {
    const tread = this.machine.device === 'treadmill'
    const spec: [string, string, string][] = tread
      ? [
          ['speed', 'Speed', units.unitLabel('speed', this.sys)],
          ['incline', 'Incline', '%'],
          ['pace', 'Pace', units.unitLabel('pace', this.sys)],
          ['heartRate', 'Heart rate', 'bpm'],
          ['climb', 'Climb', units.unitLabel('length', this.sys)],
          ['mets', 'Intensity', 'METs'],
        ]
      : this.workout.mode.who === 'machine'
        ? // ERG: the trainer holds the grade at nothing, so that tile would read 0.0 all workout. Work
          // done is what a bike console shows in its place, and it is the number riders compare.
          [
            ['power', 'Power', 'W'],
            ['cadence', 'Cadence', 'rpm'],
            ['speed', 'Speed', units.unitLabel('speed', this.sys)],
            ['heartRate', 'Heart rate', 'bpm'],
            ['work', 'Work', 'kJ'],
            ['avgPower', 'Average power', 'W'],
          ]
        : [
            ['power', 'Power', 'W'],
            ['grade', 'Grade', '%'],
            ['speed', 'Speed', units.unitLabel('speed', this.sys)],
            ['heartRate', 'Heart rate', 'bpm'],
            ['cadence', 'Cadence', 'rpm'],
            ['avgPower', 'Average power', 'W'],
          ]
    const host = $('tiles')
    for (const [key, label, unit] of spec) {
      const t = makeTile(label, unit)
      this.tiles.push(t)
      this.tileOf.set(key, t)
      host.append(t.root)
    }
  }

  /**
   * The five zones as one bar, each band as wide as its share of the range the strip covers (50–106 % of
   * maximum), with a needle at the current heart rate and the minutes spent in each underneath.
   */
  private buildZones(): void {
    const bar = $('zone-bar')
    const legend = $('zone-legend')
    const span = ZONE_CEILING - ZONE_FLOOR
    const max = this.machine.heartRateRange().max
    const needle = $('zone-needle')
    bar.replaceChildren()
    legend.replaceChildren()
    for (const z of ZONES) {
      const band = el('i', { class: 'band' })
      band.style.width = `${((z.to - z.from) / span) * 100}%`
      band.style.background = z.colour
      band.title = `Zone ${z.n} · ${z.name} · ${zoneRange(z.n, max)[0]}–${zoneRange(z.n, max)[1]} bpm`
      bar.append(band)
      this.zoneBands.push(band)

      const time = el('b', {}, '0:00')
      const row = el('div', {}, el('i', {}, ''), el('span', {}, `Z${z.n}`), time)
      ;(row.firstElementChild as HTMLElement).style.background = z.colour
      legend.append(row)
      this.zoneLegend.push({ row, time: new Cell(time) })
    }
    bar.append(needle)
  }

  private updateZones(s: WorkoutState): void {
    const hr = s.readings.heartRate
    const max = this.machine.heartRateRange().max
    const needle = $('zone-needle')
    const known = hr !== null && max > 0
    needle.classList.toggle('on', known)
    if (known) {
      const f = (hr / max - ZONE_FLOOR) / (ZONE_CEILING - ZONE_FLOOR)
      needle.style.left = `${Math.min(100, Math.max(0, f * 100))}%`
    }
    for (let i = 0; i < this.zoneBands.length; i++) this.zoneBands[i]!.classList.toggle('on', s.zone === i + 1)
    for (let i = 0; i < this.zoneLegend.length; i++) {
      const row = this.zoneLegend[i]!
      row.time.set(units.clock(s.timeInZone[i] ?? 0))
      row.row.classList.toggle('on', s.zone === i + 1)
    }
    const now = $('zone-now')
    now.textContent = s.zone > 0 ? `Zone ${s.zone} · ${zoneName(s.zone)}` : known ? 'Below zone 1' : 'No heart-rate strap'
    now.style.color = s.zone > 0 ? zoneColour(s.zone) : ''
  }

  // --- big numbers ---------------------------------------------------------------------------------------

  private buildBigView(): void {
    const tread = this.machine.device === 'treadmill'
    const labels: [string, string][] = tread
      ? [['Time left', ''], ['Distance', units.unitLabel('distance', this.sys)], ['Speed', units.unitLabel('speed', this.sys)], ['Heart rate', 'bpm'], ['Calories', 'kcal'], ['Incline', '%']]
      : [['Time left', ''], ['Distance', units.unitLabel('distance', this.sys)], ['Power', 'W'], ['Heart rate', 'bpm'], ['Calories', 'kcal'], ['Cadence', 'rpm']]
    const host = $('big-grid')
    host.replaceChildren()
    for (const [label, unit] of labels) {
      const value = el('b', {}, '—')
      const unitEl = el('div', { class: 'u' }, unit)
      host.append(el('div', { class: 'big-cell' }, el('span', { class: 'label' }, label), value, unitEl))
      this.bigCells.push({ label, value: new Cell(value), unit: new Cell(unitEl) })
    }
  }

  toggleBig(): void {
    this.big = !this.big
    $('app').classList.toggle('big', this.big)
    $('big-view').hidden = !this.big
    $<HTMLButtonElement>('btn-view').textContent = this.big ? 'Track view' : 'Big numbers'
    if (!this.big) requestAnimationFrame(() => this.relayout())
  }

  toggleSound(): void {
    const on = this.sound.toggle()
    $<HTMLButtonElement>('btn-sound').textContent = on ? 'Sound on' : 'Sound off'
    if (on) this.sound.play('lap')
  }

  relayout(): void {
    this.profile.layout()
    this.trend.layout()
  }

  private updateBig(s: WorkoutState): void {
    const r = s.readings
    const v = this.bigCells
    const tread = this.machine.device === 'treadmill'
    v[0]?.value.set(units.clock(Math.max(0, s.goal.kind === 'time' ? s.progress.left : s.elapsed)))
    v[1]?.value.set(fixed(units.distance(s.distance, this.sys, 2).value ?? 0, 2))
    v[2]?.value.set(tread ? fixed(units.speed(r.speed, this.sys).value ?? 0, 1) : r.power === null ? '—' : String(r.power))
    v[3]?.value.set(r.heartRate === null ? '—' : String(r.heartRate))
    v[4]?.value.set(String(Math.round(s.energy / 4184)))
    v[5]?.value.set(tread ? fixed(r.incline ?? 0, 1) : r.cadence === null ? '—' : String(r.cadence))
  }

  // --- callouts -------------------------------------------------------------------------------------------

  /**
   * What the console says out loud: a warning ten seconds before a segment changes, the name of the new one
   * when it does, and a lap time each time round. Consoles have done this since they had a speaker, and it
   * is the difference between a programme you can follow and one that just happens to you.
   */
  private watchSegment(s: WorkoutState, dt: number): void {
    this.clock += dt
    const callout = $('callout')
    if (s.phase !== 'running') {
      callout.classList.remove('on')
      return
    }
    if (this.lastSegment === -1) this.lastSegment = s.segmentIndex

    if (s.segmentIndex !== this.lastSegment) {
      this.lastSegment = s.segmentIndex
      const kind = s.segment.kind === 'work' ? 'work' : s.segment.kind === 'recover' ? 'recover' : ''
      this.showCallout(s.segment.label, this.describe(s.segment, s), kind)
      if (s.segment.kind === 'work') this.sound.play('work')
      else if (s.segment.kind === 'recover' || s.segment.kind === 'cooldown') this.sound.play('recover')
      this.readyFor = -1
    } else if (s.next && s.segmentRemaining <= READY_AT) {
      if (this.readyFor !== s.segmentIndex) {
        this.readyFor = s.segmentIndex
        this.sound.play('ready')
      }
      this.showCallout(`Get ready · ${s.next.label}`, `${this.describe(s.next, s)} in ${Math.ceil(s.segmentRemaining)}s`, 'ready', 0.4)
    }
    if (this.clock > this.calloutUntil) callout.classList.remove('on')

    if (s.laps > this.lastLaps) {
      this.lastLaps = s.laps
      const split = s.splits[s.splits.length - 1]
      this.showToast(`Lap ${s.laps} · ${units.clock(split?.seconds ?? 0)}`)
      this.sound.play('lap')
    }
    if (this.clock > this.toastUntil) $('lap-toast').classList.remove('on')
  }

  private showCallout(text: string, sub: string, kind: string, seconds = CALLOUT_FOR): void {
    const callout = $('callout')
    this.cells.calloutText!.set(text)
    this.cells.calloutSub!.set(sub)
    callout.className = `callout on${kind ? ` ${kind}` : ''}`
    this.calloutUntil = this.clock + seconds
  }

  private showToast(text: string): void {
    this.cells.lapToast!.set(text)
    $('lap-toast').classList.add('on')
    this.toastUntil = this.clock + CALLOUT_FOR
  }

  private buildControls(opts: HudOptions): void {
    const host = $('controls')
    host.replaceChildren()
    const tread = this.machine.device === 'treadmill'
    const drives = this.workout.mode.who === 'machine'

    if (tread) {
      host.append(this.group('speed', drives ? 'Speed' : 'Target pace', units.unitLabel('speed', this.sys), Config.QUICK.speed[this.sys], (v) => units.speedToSI(v, this.sys), 1).root)
      host.append(this.group('incline', 'Incline', '%', Config.QUICK.incline, (v) => v, 1).root)
    } else {
      host.append(this.group('power', drives ? 'Power' : 'Target power', 'W', [], (v) => v, 0).root)
      if (!drives) host.append(this.group('grade', 'Grade', '%', Config.QUICK.grade, (v) => v, 1).root)
    }

    const p = PROGRAMS[this.workout.plan.program]
    if (p.levelled) host.append(this.levelGroup().root)
    host.append(el('div', { class: 'spacer' }))
    host.append(button('Programme…', opts.onOpenPicker, 'ghost'))
  }

  /** A ± cluster for one dial of the base, with one-touch keys in display units. */
  private group(
    dial: keyof Base,
    name: string,
    unit: string,
    quickValues: number[],
    toSI: (displayValue: number) => number,
    digits: number,
  ): Group {
    const step = dial === 'speed' ? units.speedToSI(Config.STEP.speed[this.sys], this.sys) : dial === 'power' ? Config.STEP.power : Config.STEP[dial]
    const value = el('span', {}, '—')
    const unitEl = el('span', { class: 'u' }, unit)
    const readout = el('div', { class: 'readout' }, value, unitEl)
    const minus = button('−', () => this.workout.adjustTarget(dial, -step), 'step')
    const plus = button('+', () => this.workout.adjustTarget(dial, step), 'step')
    minus.setAttribute('aria-label', `${name} down`)
    plus.setAttribute('aria-label', `${name} up`)
    const quick = quickValues.map((v) => button(fixed(v, digits), () => this.workout.setTarget(dial, toSI(v)), ''))
    const root = el(
      'div',
      { class: 'group' },
      el('span', { class: 'name' }, name),
      minus,
      readout,
      plus,
      ...(quick.length ? [el('div', { class: 'quick' }, ...quick)] : []),
    )
    const g: Group = { root, value: new Cell(value), unit: new Cell(unitEl), quick, quickValues: quickValues.map(toSI) }
    this.groups.set(dial, g)
    return g
  }

  private levelGroup(): Group {
    const value = el('span', {}, '5')
    const readout = el('div', { class: 'readout' }, value)
    const root = el(
      'div',
      { class: 'group' },
      el('span', { class: 'name' }, 'Level'),
      button('−', () => this.setLevel(-1), 'step'),
      readout,
      button('+', () => this.setLevel(+1), 'step'),
    )
    const g: Group = { root, value: new Cell(value), unit: new Cell(el('span')), quick: [], quickValues: [] }
    this.groups.set('level', g)
    return g
  }

  private setLevel(delta: number): void {
    this.workout.setLevel(this.workout.plan.level + delta)
  }

  /** The controls depend on the programme (only a levelled one has a Level cluster), so rebuild on a change. */
  refreshControls(opts: HudOptions): void {
    this.buildControls(opts)
  }

  // --- the update ----------------------------------------------------------------------------------------

  update(s: WorkoutState, dt = 0): void {
    const c = this.cells
    c.meta!.set(this.metaLine(s))
    c.lap!.set(String(s.laps))
    c.lapWord!.set(s.laps === 1 ? 'lap' : 'laps')

    this.updatePrimary(s)
    this.watchSegment(s, dt)
    this.updateZones(s)
    if (this.big) this.updateBig(s)
    this.updateTiles(s)
    this.updateBanner(s)
    this.updateGroups(s)

    const paused = s.phase === 'paused'
    $('paused').hidden = !paused
    if (paused) c.pauseWhy!.set(this.machine.pauseMessage() ?? 'The clock, the distance and the programme are all stopped.')
    if (this.lastPhase !== s.phase) {
      this.lastPhase = s.phase
      const btn = $<HTMLButtonElement>('btn-pause')
      btn.textContent = paused ? 'Resume' : 'Pause'
      btn.disabled = s.phase === 'setup' || s.phase === 'done'
    }
    if (this.lastProgramme !== `${s.plan.program}:${s.plan.level}`) {
      this.lastProgramme = `${s.plan.program}:${s.plan.level}`
    }
  }

  /**
   * The three headline numbers. Whichever one is the goal counts down, wears the accent and carries a
   * progress bar; the other two count up. That is how a console shows you a 5 km and a 30-minute workout
   * with the same three boxes.
   */
  private updatePrimary(s: WorkoutState): void {
    const c = this.cells
    const sys = this.sys
    const goal = s.goal.kind
    const kcal = s.energy / 4184

    const timeLeft = goal === 'time' ? Math.max(0, s.progress.left) : s.elapsed
    c.labelTime!.set(goal === 'time' ? 'Time left' : 'Time')
    c.time!.set(units.clock(timeLeft))
    c.elapsed!.set(goal === 'time' ? `${units.clock(s.elapsed)} done` : etaLine(s))

    const distLeft = goal === 'distance' ? Math.max(0, s.progress.left) : s.distance
    c.labelDist!.set(goal === 'distance' ? 'Distance left' : 'Distance')
    c.dist!.set(fixed(units.distance(distLeft, sys, 2).value ?? 0, 2))
    c.distUnit!.set(goal === 'distance' ? `of ${units.distance(s.goal.value, sys, 2).text}` : units.unitLabel('distance', sys))

    const kcalLeft = goal === 'calories' ? Math.max(0, s.progress.left) : kcal
    c.labelKcal!.set(goal === 'calories' ? 'Calories left' : 'Calories')
    c.kcal!.set(String(Math.round(kcalLeft)))
    c.kcalSub!.set(goal === 'calories' ? `of ${Math.round(s.goal.value)} kcal` : 'kcal')

    for (const [id, kind] of [['p-time', 'time'], ['p-dist', 'distance'], ['p-kcal', 'calories']] as [string, GoalKind][]) {
      const on = kind === goal
      $(id).classList.toggle('goal', on)
      $(id).classList.toggle('ending', on && s.phase === 'running' && s.progress.done > 0.97)
    }
    const fill = goal === 'time' ? 'f-time' : goal === 'distance' ? 'f-dist' : 'f-kcal'
    $(fill).style.width = `${Math.min(100, Math.max(0, s.progress.done * 100))}%`
  }

  private metaLine(s: WorkoutState): string {
    const p = PROGRAMS[s.plan.program]
    const bits = [p.name]
    if (p.levelled) bits.push(`Level ${s.plan.level}`)
    bits.push(`${Math.round(s.plan.duration / 60)} min`)
    bits.push(this.machine.device === 'treadmill' ? 'Treadmill' : 'Bike')
    bits.push(s.mode.who === 'machine' ? 'the machine follows the programme' : 'you follow the programme')
    return bits.join(' · ')
  }

  private updateTiles(s: WorkoutState): void {
    const r = s.readings
    const sys = this.sys
    const want = s.targets.want
    const set = (key: string, now: string, ask: string | null, hit: boolean, dim = false): void => {
      const t = this.tileOf.get(key)
      if (!t) return
      t.now.set(now)
      t.isTarget.set(ask !== null)
      t.isHit.set(ask !== null && hit)
      t.dimmed.set(dim)
      t.askRow.classList.toggle('hidden', ask === null)
      if (ask !== null) t.ask.set(ask)
    }
    const q = (v: units.Quantity): string => (v.value === null ? '—' : fixed(v.value, decimalsOf(v)))
    const running = s.phase === 'running'

    if (this.machine.device === 'treadmill') {
      const driven = s.mode.who === 'machine'
      const speed = units.speed(r.speed, sys)
      const askSpeed = units.speed(want.speed, sys)
      // When the machine drives, the ask is only worth showing while the belt is still catching up to it.
      const speedSettled = Math.abs((r.speed ?? 0) - (want.speed ?? 0)) <= 0.05
      set('speed', q(speed), want.speed !== null && !(driven && speedSettled) ? q(askSpeed) : null, s.onTarget, !running)
      const inclineSettled = Math.abs((r.incline ?? 0) - (want.incline ?? 0)) <= 0.1
      set('incline', r.incline === null ? '—' : fixed(r.incline, 1), want.incline === null || inclineSettled ? null : fixed(want.incline, 1), inclineSettled, !running)
      set('pace', units.pace(r.speed, sys).text.replace(/ \/.*/, ''), null, false, !running)
      set('heartRate', r.heartRate === null ? '—' : String(r.heartRate), s.heartRateTarget === null ? null : String(s.heartRateTarget), s.heartRateTarget !== null && Math.abs((r.heartRate ?? 0) - s.heartRateTarget) <= Config.HR.DEADBAND, !running)
      set('climb', q(units.length(s.elevation, sys, 0)), null, false, !running)
      const vo2 = r.speed === null ? null : acsmVo2(r.speed, r.incline)
      set('mets', vo2 === null ? '—' : fixed(vo2 / 3.5, 1), null, false, !running)
    } else {
      const settledPower = Math.abs((r.power ?? 0) - (want.power ?? 0)) <= Math.max(6, (want.power ?? 0) * 0.04)
      set('power', r.power === null ? '—' : String(r.power), want.power === null || (s.mode.who === 'machine' && settledPower) ? null : String(Math.round(want.power)), s.onTarget, !running)
      const settledGrade = Math.abs((r.grade ?? 0) - (want.grade ?? 0)) <= 0.1
      set('grade', r.grade === null ? '—' : fixed(r.grade, 1), want.grade === null || settledGrade ? null : fixed(want.grade, 1), settledGrade, !running)
      set('speed', q(units.speed(s.speed, sys)), null, false, !running)
      set('heartRate', r.heartRate === null ? '—' : String(r.heartRate), s.heartRateTarget === null ? null : String(s.heartRateTarget), s.heartRateTarget !== null && Math.abs((r.heartRate ?? 0) - s.heartRateTarget) <= Config.HR.DEADBAND, !running)
      set('cadence', r.cadence === null ? '—' : String(r.cadence), null, false, !running)
      set('work', s.work === null ? '—' : String(Math.round(s.work / 1000)), null, false, !running)
      const avg = avgOf(s.stats.power)
      set('avgPower', avg === null ? '—' : String(Math.round(avg)), null, false, !running)
    }
  }

  private updateBanner(s: WorkoutState): void {
    this.cells.segLabel!.set(s.segment.label)
    $('seg-label').style.color = s.phase === 'running' ? segColourOf(s) : ''
    this.cells.segLeft!.set(s.phase === 'setup' ? '' : `${units.clock(s.segmentRemaining)} left`)
    this.cells.segNext!.set(s.next ? `next · ${s.next.label} · ${this.describe(s.next, s)}` : 'last stretch')
  }

  /** What a segment will ask of this machine, in a few words: "9.5 km/h", "6.0 %", "180 W". */
  private describe(seg: WorkoutState['segment'], s: WorkoutState): string {
    const base = s.base
    if (this.machine.device === 'treadmill') {
      const bits: string[] = []
      if (seg.effort !== 1) bits.push(units.speed(base.speed * seg.effort, this.sys).text)
      if (seg.grade !== 0 || bits.length === 0) bits.push(`${fixed(base.incline + seg.grade, 1)} %`)
      return bits.join(' · ')
    }
    if (s.mode.who === 'machine') return `${Math.round(base.power * seg.effort * (1 + seg.grade * Config.GRADE_TO_POWER))} W`
    const bits: string[] = []
    if (seg.effort !== 1) bits.push(`${Math.round(base.power * seg.effort)} W`)
    if (seg.grade !== 0 || bits.length === 0) bits.push(`${fixed(base.grade + seg.grade, 1)} %`)
    return bits.join(' · ')
  }

  /**
   * The ± readout shows what the console is asking for *right now* — the same number as the tile above it —
   * because that is the number the player is moving. The base underneath is an implementation detail.
   */
  private updateGroups(s: WorkoutState): void {
    const show = (dial: keyof Base, live: number, text: string): void => {
      const g = this.groups.get(dial)
      if (!g) return
      g.value.set(text)
      for (let i = 0; i < g.quick.length; i++) {
        g.quick[i]!.classList.toggle('on', Math.abs((g.quickValues[i] ?? -1e9) - live) < 0.051)
      }
    }
    const want = s.targets.want
    if (this.machine.device === 'treadmill') {
      const speed = want.speed ?? s.base.speed
      show('speed', speed, fixed(units.speed(speed, this.sys).value ?? 0, 1))
      const incline = want.incline ?? s.base.incline
      show('incline', incline, fixed(incline, 1))
    } else {
      const power = want.power ?? s.base.power
      show('power', power, String(Math.round(power)))
      const grade = want.grade ?? s.base.grade
      show('grade', grade, fixed(grade, 1))
    }
    this.groups.get('level')?.value.set(String(s.plan.level))
  }
}

/** For a distance or calorie goal, how long it looks like taking at the pace of the last minute. */
function etaLine(s: WorkoutState): string {
  if (s.progress.done >= 1) return 'goal met'
  return s.progress.eta === null ? 'working out your pace…' : `about ${units.clock(s.progress.eta)} to go`
}

function segColourOf(s: WorkoutState): string {
  return s.segment.kind === 'work' ? 'var(--you)' : s.segment.kind === 'warmup' || s.segment.kind === 'cooldown' ? 'var(--dim)' : 'var(--text)'
}

function decimalsOf(q: units.Quantity): number {
  return q.unit === 'W' || q.unit === 'bpm' || q.unit === 'rpm' || q.unit === 'm' || q.unit === 'ft' || q.unit === 'kcal' ? 0 : q.unit === 'km' || q.unit === 'mi' ? 2 : 1
}

export function fixed(v: number, digits: number): string {
  return v.toFixed(digits)
}
