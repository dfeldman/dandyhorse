/**
 * The screen before the workout: pick a programme, a length and a level, and start. It is also where a
 * programme is changed mid-workout, so it takes what is already set and hands back the change.
 *
 * On Dandyhorse most of this moves into the console's launch dialog (programme, length and level become
 * launch options, the machine comes from the session), and what is left is the mid-workout picker —
 * INTEGRATION.md §4.
 */
import { Config } from '../config.ts'
import type { DeviceType } from '../physics.ts'
import { build, PROGRAM_IDS, PROGRAMS, type ProgramId } from '../program.ts'
import { createProfileView } from '../render/profile.ts'
import type { DriveWho } from '../drive.ts'
import type { Goal, GoalKind } from '../workout.ts'
import * as units from '../units.ts'
import type { UnitSystem } from '../units.ts'
import { load as loadBests } from '../bests.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

export interface Choice {
  program: ProgramId
  minutes: number
  level: number
  device: DeviceType
  who: DriveWho
  seed: number
  goal: Goal
}

/**
 * What each goal offers, in the player's own units. Times are the platform's own 15/30/45/60 plus a short
 * one; the distances are the ones people actually talk about (a 5 K, a 10 K, a half-hour's ride).
 */
export const GOALS: Record<GoalKind, { label: string; unit: (sys: UnitSystem) => string; choices: (sys: UnitSystem) => [string, number][] }> = {
  time: {
    label: 'Time',
    unit: () => 'min',
    choices: () => LENGTHS.map((n) => [String(n), n * 60]),
  },
  distance: {
    label: 'Distance',
    unit: (sys) => units.unitLabel('distance', sys),
    choices: (sys) =>
      sys === 'us'
        ? ([['1', 1609.344], ['3.1', 5000], ['5', 8046.72], ['6.2', 10000], ['10', 16093.44]] as [string, number][])
        : ([['1', 1000], ['3', 3000], ['5', 5000], ['10', 10000], ['21.1', 21097.5]] as [string, number][]),
  },
  calories: {
    label: 'Calories',
    unit: () => 'kcal',
    choices: () => [['100', 100], ['200', 200], ['300', 300], ['500', 500], ['750', 750]],
  },
}

export interface SetupOptions {
  /** Which fields to offer. On the platform the machine and the goal are already decided. */
  showMachine: boolean
  showLength: boolean
  sys: UnitSystem
  title: string
  blurb: string
  startLabel: string
  cancel?: () => void
}

export const LENGTHS = [10, 20, 30, 45, 60]

/** Show the picker. Resolves with the choice, or null if it was cancelled. */
export function showSetup(host: HTMLElement, initial: Choice, opts: SetupOptions, onDone: (c: Choice | null) => void): void {
  const choice: Choice = { ...initial }
  const card = el('div', { class: 'card' })
  host.replaceChildren(card)
  host.hidden = false

  const picker = el('div', { class: 'picker' })
  const hint = el('p', { class: 'hint' })
  const previewCanvas = el('canvas')
  const preview = el('div', { class: 'preview' }, previewCanvas)
  const levelField = el('div', { class: 'field' })
  const goalField = el('div', { class: 'field' })
  const lengthField = el('div', { class: 'field' })
  const machineField = el('div', { class: 'field' })
  const drivenField = el('div', { class: 'field' })
  const start = el('button', { type: 'button', class: 'primary big' }, opts.startLabel)

  const chart = createProfileView(previewCanvas, { labels: true })

  const rebuild = (): void => {
    const p = PROGRAMS[choice.program]
    for (const b of picker.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === choice.program)
    hint.textContent = p.blurb
    levelField.hidden = !p.levelled
    drawPreview()
    chips(levelField, 'Level', range(Config.LEVEL_RANGE[0], Config.LEVEL_RANGE[1]).map((n) => [String(n), n]), choice.level, (v) => {
      choice.level = v
      rebuild()
    })
    if (opts.showLength) {
      chips(goalField, 'Finish when', (Object.keys(GOALS) as GoalKind[]).map((k) => [GOALS[k].label, k === 'time' ? 0 : k === 'distance' ? 1 : 2]), choice.goal.kind === 'time' ? 0 : choice.goal.kind === 'distance' ? 1 : 2, (v) => {
        const kind: GoalKind = v === 0 ? 'time' : v === 1 ? 'distance' : 'calories'
        if (kind !== choice.goal.kind) {
          const list = GOALS[kind].choices(opts.sys)
          choice.goal = { kind, value: list[Math.min(2, list.length - 1)]![1] }
        }
        rebuild()
      }, '', true)
      const g = GOALS[choice.goal.kind]
      chips(lengthField, g.label, g.choices(opts.sys), choice.goal.value, (v) => {
        choice.goal = { kind: choice.goal.kind, value: v }
        if (choice.goal.kind === 'time') choice.minutes = Math.round(v / 60)
        rebuild()
      }, g.unit(opts.sys))
      if (choice.goal.kind !== 'time') {
        choice.minutes = estimateMinutes(choice, opts.sys)
        lengthField.append(el('p', { class: 'hint' }, `The programme is laid out over about ${choice.minutes} minutes; you stop when the goal is met, early or late.`))
      }
    }
    if (opts.showMachine) {
      chips(machineField, 'Machine', [['Treadmill', 0], ['Bike', 1]], choice.device === 'treadmill' ? 0 : 1, (v) => {
        choice.device = v === 0 ? 'treadmill' : 'bike'
        rebuild()
      }, '', true)
      chips(drivenField, 'Who follows the programme', [['You', 0], ['The machine', 1]], choice.who === 'you' ? 0 : 1, (v) => {
        choice.who = v === 0 ? 'you' : 'machine'
        rebuild()
      }, '', true)
      drivenField.append(
        el('p', { class: 'hint' }, choice.who === 'you'
          ? choice.device === 'treadmill'
            ? 'The console sets the incline and tells you the pace to run. The belt stays yours.'
            : 'The trainer follows the hill; the watts are yours to hold.'
          : choice.device === 'treadmill'
            ? 'The console drives the belt and the incline. Keep up.'
            : 'ERG: the trainer holds the watts whatever you do. Just turn the pedals.'),
      )
    }
  }

  const drawPreview = (): void => {
    chart.layout()
    chart.draw(build(choice.program, choice.minutes * 60, { level: choice.level, seed: choice.seed }), null)
  }

  for (const id of PROGRAM_IDS) {
    const p = PROGRAMS[id]
    const b = el('button', { type: 'button', class: 'pick' }, el('b', {}, p.name), el('span', {}, p.blurb))
    b.dataset.id = id
    b.addEventListener('click', () => {
      choice.program = id
      rebuild()
    })
    picker.append(b)
  }

  const close = (): void => {
    host.hidden = true
    window.removeEventListener('resize', drawPreview)
  }

  start.addEventListener('click', () => {
    close()
    onDone(choice)
  })

  card.append(
    el('h2', {}, opts.title),
    el('p', { class: 'muted' }, opts.blurb),
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Programme'), picker, hint),
    preview,
    goalField,
    lengthField,
    levelField,
    machineField,
    drivenField,
    el('div', { class: 'row end' }, ...(opts.cancel ? [cancelButton(close, opts.cancel, onDone)] : []), start),
  )
  if (opts.showLength) card.append(bestsLine(choice.device, opts.sys))
  rebuild()
  requestAnimationFrame(drawPreview)
  window.addEventListener('resize', drawPreview)
}

function cancelButton(close: () => void, cancel: () => void, onDone: (c: Choice | null) => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'ghost big' }, 'Cancel')
  b.addEventListener('click', () => {
    close()
    cancel()
    onDone(null)
  })
  return b
}

/**
 * How long a distance or calorie goal is likely to take, so the programme has a sensible clock to lay its
 * segments over. A brisk walk or an easy ride; it only has to be about right, and it is re-read every time
 * the goal changes.
 */
function estimateMinutes(c: Choice, sys: UnitSystem): number {
  void sys
  if (c.goal.kind === 'time') return Math.round(c.goal.value / 60)
  const pace = c.device === 'treadmill' ? 1.7 : 6.5 // m/s: a fast walk, or a steady ride
  const kcalPerMin = c.device === 'treadmill' ? 8 : 9
  const minutes = c.goal.kind === 'distance' ? c.goal.value / pace / 60 : c.goal.value / kcalPerMin
  return Math.round(Math.min(120, Math.max(5, minutes)))
}

/** What the player has done before on this machine, if anything. */
function bestsLine(device: DeviceType, sys: UnitSystem): HTMLElement {
  const b = loadBests(device)
  if (b.workouts === 0) return el('p', { class: 'bests-line' }, 'Your first workout on this machine.')
  const bits = [`${b.workouts} workout${b.workouts === 1 ? '' : 's'}`, `${units.distance(b.totalDistance, sys, 1).text} in total`]
  if (b.lap !== null) bits.push(`best lap ${units.clock(b.lap)}`)
  if (b.distance !== null) bits.push(`longest ${units.distance(b.distance, sys, 2).text}`)
  return el('p', { class: 'bests-line' }, bits.join(' · '))
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

/** A row of one-touch chips; rebuilt in place so the caller can just call it again. */
function chips(host: HTMLElement, label: string, items: [string, number][], on: number, pick: (v: number) => void, unit = '', wide = false): void {
  const row = el('div', { class: 'chips' })
  for (const [text, value] of items) {
    const b = el('button', { type: 'button', class: wide ? 'wide' : '' }, text)
    if (value === on) b.classList.add('on')
    b.addEventListener('click', () => pick(value))
    row.append(b)
  }
  if (unit) row.append(el('span', { class: 'muted' }, unit))
  host.replaceChildren(el('span', { class: 'label' }, label), row)
}
