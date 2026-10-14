/**
 * The screen at the end: what the workout came to, and every lap. On Dandyhorse the same numbers go to
 * History, and `sessionImage()` here is the picture it shows (INTEGRATION.md §7).
 */
import type { DeviceType } from '../physics.ts'
import { lapLength } from '../track.ts'
import { outline } from '../render/track.ts'
import * as units from '../units.ts'
import type { UnitSystem } from '../units.ts'
import type { Summary } from '../workout.ts'
import { Config } from '../config.ts'
import type { Bests, Beaten } from '../bests.ts'
import type { RecoveryResult } from '../recovery.ts'
import { ZONES, zoneColour } from '../zones.ts'
import { ACHIEVEMENTS, nameOf } from '../achievements.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

export interface SummaryOptions {
  device: DeviceType
  sys: UnitSystem
  /** True when the player stopped early rather than meeting the goal. */
  early: boolean
  maxHr: number
  recovery: RecoveryResult | null
  bests: Bests
  beaten: Beaten
  onAgain(): void
  onChange(): void
}

export function showSummary(host: HTMLElement, s: Summary, opts: SummaryOptions): void {
  const { sys } = opts
  const totals = el('div', { class: 'totals' })
  const add = (label: string, value: string, unit = ''): void => {
    totals.append(el('div', { class: 'total' }, el('span', { class: 'label' }, label), el('b', {}, value, unit ? el('span', { class: 'u' }, unit) : '')))
  }
  const num = (q: units.Quantity, digits: number): string => (q.value === null ? '—' : q.value.toFixed(digits))

  add('Time', units.clock(s.duration))
  add('Distance', num(units.distance(s.distance, sys, 2), 2), ` ${units.unitLabel('distance', sys)}`)
  add('Calories', String(Math.round(s.energy / 4184)), ' kcal')
  add('Laps', String(s.laps))
  add('Average', num(units.speed(s.avgSpeed, sys), 1), ` ${units.unitLabel('speed', sys)}`)
  if (opts.device === 'treadmill') {
    add('Average pace', units.pace(s.avgSpeed, sys).text.replace(/ \/.*/, ''), ` ${units.unitLabel('pace', sys)}`)
    add('Climb', num(units.length(s.elevation, sys, 0), 0), ` ${units.unitLabel('length', sys)}`)
  } else {
    add('Average power', s.avgPower === null ? '—' : String(Math.round(s.avgPower)), ' W')
    add('Best power', s.maxPower === null ? '—' : String(Math.round(s.maxPower)), ' W')
    add('Work', s.work === null ? '—' : String(Math.round(s.work / 1000)), ' kJ')
  }
  if (s.avgHeartRate !== null) add('Heart rate', String(Math.round(s.avgHeartRate)), ` bpm · max ${Math.round(s.maxHeartRate ?? 0)}`)

  const card = el(
    'div',
    { class: 'card' },
    el('h2', {}, opts.early ? 'Workout ended' : el('span', {}, 'Workout ', el('span', { class: 'tag' }, 'complete'))),
    el('p', { class: 'muted' }, `${s.program}${s.level ? ` · Level ${s.level}` : ''} · ${goalLine(s, sys)} on a ${opts.device === 'treadmill' ? 'treadmill' : 'bike'}${pacedNote(s, sys)}`),
    ...(opts.bests.workouts > 1 && bestsRow(opts.beaten, sys) ? [bestsRow(opts.beaten, sys)!] : []),
    totals,
    ...(opts.recovery ? [recoveryBlock(opts.recovery)] : []),
    ...(zoneBlock(s, opts) ? [zoneBlock(s, opts)!] : []),
    ...(s.achievements.length ? [achievementBlock(s.achievements)] : []),
    s.splits.length ? splitsTable(s, sys) : el('p', { class: 'muted' }, 'No full lap this time — a lap of the track is 400 m.'),
    el('p', { class: 'bests-line' }, bestsSummary(opts.bests, sys)),
    el('div', { class: 'row end' }, ghost('Change programme', opts.onChange), primary('Again', opts.onAgain)),
  )
  host.replaceChildren(card)
  host.hidden = false
}

function goalLine(s: Summary, sys: UnitSystem): string {
  if (s.goal.kind === 'distance') return units.distance(s.goal.value, sys, 2).text
  if (s.goal.kind === 'calories') return `${Math.round(s.goal.value)} kcal`
  return `${Math.round(s.requested / 60)} minutes`
}

/** What this workout beat, as a row of little badges. Nothing shown when it beat nothing. */
function bestsRow(beaten: Beaten, sys: UnitSystem): HTMLElement | null {
  const bits: string[] = []
  if (beaten.lap !== undefined) bits.push(`Fastest lap · ${units.clock(beaten.lap)}`)
  if (beaten.distance !== undefined) bits.push(`Furthest · ${units.distance(beaten.distance, sys, 2).text}`)
  if (beaten.calories !== undefined) bits.push(`Most calories · ${Math.round(beaten.calories)}`)
  if (beaten.climb !== undefined) bits.push(`Biggest climb · ${units.length(beaten.climb, sys, 0).text}`)
  if (bits.length === 0) return null
  return el('div', { class: 'beaten' }, ...bits.map((b) => el('span', {}, `New best — ${b}`)))
}

function bestsSummary(b: Bests, sys: UnitSystem): string {
  const bits = [`${b.workouts} workout${b.workouts === 1 ? '' : 's'} on this machine`, `${units.distance(b.totalDistance, sys, 1).text} in all`]
  if (b.lap !== null) bits.push(`best lap ${units.clock(b.lap)}`)
  return bits.join(' · ')
}

function achievementBlock(ids: string[]): HTMLElement {
  const rows = ids.map((id) => {
    const a = (ACHIEVEMENTS as Record<string, { description: string } | undefined>)[id]
    return el('span', { title: a?.description ?? '' }, nameOf(id))
  })
  return el('div', { class: 'field' }, el('span', { class: 'label' }, 'Earned'), el('div', { class: 'beaten earned' }, ...rows))
}

function recoveryBlock(r: RecoveryResult): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('span', { class: 'label' }, 'Recovery'),
    el('div', { class: 'verdict' }, `${r.label} — your heart rate fell ${r.drop} bpm in a minute`),
    el('p', { class: 'muted', style: 'text-align:center;margin:0 0 4px' }, `${r.start} bpm at the finish, ${r.end} bpm a minute later. ${r.note}`),
  )
}

/** Time in each heart-rate zone as one stacked bar; nothing shown when there was no strap. */
function zoneBlock(s: Summary, opts: SummaryOptions): HTMLElement | null {
  const total = s.timeInZone.reduce((a, b) => a + b, 0)
  if (total < 30) return null
  const bar = el('div', { class: 'zone-bar', style: 'height:16px' })
  const legend = el('div', { class: 'zone-legend' })
  for (const z of ZONES) {
    const secs = s.timeInZone[z.n - 1] ?? 0
    if (secs > 0) {
      const band = el('i', { class: 'band on' })
      band.style.width = `${(secs / total) * 100}%`
      band.style.background = zoneColour(z.n)
      band.title = `Zone ${z.n} · ${units.clock(secs)}`
      bar.append(band)
    }
    const row = el('div', secs > 0 ? { class: 'on' } : {}, el('i', {}, ''), el('span', {}, `Z${z.n}`), el('b', {}, units.clock(secs)))
    ;(row.firstElementChild as HTMLElement).style.background = zoneColour(z.n)
    legend.append(row)
  }
  return el('div', { class: 'field' }, el('span', { class: 'label' }, `Time in zone (max ${opts.maxHr} bpm)`), bar, legend)
}

function pacedNote(s: Summary, sys: UnitSystem): string {
  if (s.targetDistance <= 0 || s.distance <= 0) return ''
  const diff = s.distance - s.targetDistance
  const q = units.distance(Math.abs(diff), sys, 2)
  if (q.value === null || q.value < 0.01) return ' · exactly the programme’s distance'
  return ` · ${q.text} ${diff > 0 ? 'ahead of' : 'behind'} the pace marker`
}

function splitsTable(s: Summary, sys: UnitSystem): HTMLElement {
  const full = s.splits.filter((x) => !x.partial)
  const best = full.length > 1 ? Math.min(...full.map((x) => x.seconds)) : null
  const body = el('tbody')
  for (const sp of s.splits) {
    const tr = el(
      'tr',
      {},
      el('td', {}, sp.partial ? `${sp.lap} · part` : String(sp.lap)),
      el('td', {}, units.clock(sp.seconds)),
      el('td', {}, units.speed(sp.avgSpeed, sys).text),
      el('td', {}, units.pace(sp.avgSpeed, sys).text),
      el('td', {}, sp.avgHeartRate === null ? '—' : String(Math.round(sp.avgHeartRate))),
    )
    if (!sp.partial && best !== null && sp.seconds === best) tr.classList.add('best')
    if (sp.partial) tr.classList.add('partial')
    body.append(tr)
  }
  const table = el(
    'table',
    { class: 'splits-table' },
    el('thead', {}, el('tr', {}, el('th', {}, `Lap (${Math.round(lapLength(Config.PLAYER_LANE))} m)`), el('th', {}, 'Time'), el('th', {}, 'Speed'), el('th', {}, 'Pace'), el('th', {}, 'bpm'))),
    body,
  )
  return el('div', { class: 'splits' }, table)
}

function primary(label: string, on: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'primary big' }, label)
  b.addEventListener('click', on)
  return b
}

function ghost(label: string, on: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'ghost big' }, label)
  b.addEventListener('click', on)
  return b
}

/**
 * The picture for History: the track with the lap the player finished on, and the headline numbers.
 * 640 × 360, well under the platform's 1 MB.
 */
export function sessionImage(s: Summary, opts: { device: DeviceType; sys: UnitSystem; programme: string }): string | null {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 360
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#0a0d12'
  g.fillRect(0, 0, c.width, c.height)

  // The oval, fitted to the left two-thirds.
  const box = { x: 18, y: 78, w: 350, h: 210 }
  const pts = outline(1, 240)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const k = Math.min(box.w / spanX, box.h / spanY)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const put = (p: { x: number; y: number }): [number, number] => [cx + p.x * k, cy - p.y * k]
  for (const [lane, colour, width] of [[9, '#2a3444', 1], [1, '#3a4658', 1]] as const) {
    g.beginPath()
    outline(lane === 9 ? 8 : 1, 240).forEach((p, i) => (i === 0 ? g.moveTo(...put(p)) : g.lineTo(...put(p))))
    g.closePath()
    g.strokeStyle = colour
    g.lineWidth = width
    g.stroke()
  }
  g.beginPath()
  pts.forEach((p, i) => (i === 0 ? g.moveTo(...put(p)) : g.lineTo(...put(p))))
  g.closePath()
  g.strokeStyle = '#ff6a3d'
  g.lineWidth = 2.5
  g.globalAlpha = s.laps > 0 ? 0.9 : 0.25
  g.stroke()
  g.globalAlpha = 1

  g.fillStyle = '#e9edf4'
  g.font = '700 30px system-ui, sans-serif'
  g.fillText('Lane One', 18, 46)
  g.font = '500 14px system-ui, sans-serif'
  g.fillStyle = '#8794a6'
  g.fillText(`${opts.programme} · ${opts.device === 'treadmill' ? 'treadmill' : 'bike'}`, 18, 66)

  const rows: [string, string][] = [
    ['TIME', units.clock(s.duration)],
    ['DISTANCE', units.distance(s.distance, opts.sys, 2).text],
    ['LAPS', String(s.laps)],
    ['CALORIES', `${Math.round(s.energy / 4184)} kcal`],
  ]
  rows.forEach(([label, value], i) => {
    const y = 110 + i * 58
    g.fillStyle = '#5a6675'
    g.font = '600 11px system-ui, sans-serif'
    g.fillText(label, 400, y)
    g.fillStyle = '#e9edf4'
    g.font = '600 30px ui-monospace, Menlo, monospace'
    g.fillText(value, 400, y + 30)
  })
  g.fillStyle = '#ff6a3d'
  g.fillRect(400, 330, 180, 4)
  return c.toDataURL('image/png')
}
