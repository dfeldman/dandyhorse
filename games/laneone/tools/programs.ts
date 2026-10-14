/**
 * `npm run programs` — every programme's shape, in the terminal.
 *
 * A programme is a few numbers in `program.ts`, and a few numbers are hard to judge. This prints each one as
 * a chart with the figures that decide whether it is a good workout: how much of it is above the pace you
 * set, how hard the hardest bit is, and how the segments divide up. Change a FUN KNOB in `config.ts`, run
 * this, and see what it did before opening a browser.
 *
 *   npm run programs                 every programme at 30 minutes, level 5
 *   npm run programs -- 45 8         45 minutes, level 8
 *   npm run programs -- 30 5 hills   one programme
 */
import { intensity } from '../src/drive.ts'
import { build, PROGRAM_IDS, PROGRAMS, type ProgramId, type Segment } from '../src/program.ts'

const args = process.argv.slice(2)
const minutes = Number(args[0]) || 30
const level = Number(args[1]) || 5
const only = args[2] as ProgramId | undefined

const WIDTH = 78
const HEIGHT = 9
const BLOCKS = ' ▁▂▃▄▅▆▇█'

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function chart(segments: Segment[], duration: number): string[] {
  const peak = Math.max(1.3, ...segments.map(intensity))
  const floor = 0.5
  const rows: string[] = []
  const column = (i: number): number => {
    const t = ((i + 0.5) / WIDTH) * duration
    const seg = segments.find((s) => t < s.t1) ?? segments[segments.length - 1]!
    return (intensity(seg) - floor) / (peak - floor)
  }
  for (let r = HEIGHT - 1; r >= 0; r--) {
    let line = ''
    for (let i = 0; i < WIDTH; i++) {
      const h = column(i) * HEIGHT
      const here = Math.max(0, Math.min(8, Math.round((h - r) * 8)))
      line += r < h ? BLOCKS[here] ?? '█' : ' '
    }
    rows.push(line)
  }
  return rows
}

function report(id: ProgramId): void {
  const p = PROGRAMS[id]
  const w = build(id, minutes * 60, { level, seed: 1 })
  const segs = w.segments
  const above = segs.filter((s) => intensity(s) > 1.001).reduce((a, s) => a + (s.t1 - s.t0), 0)
  const hard = segs.filter((s) => s.kind === 'work').reduce((a, s) => a + (s.t1 - s.t0), 0)
  const peak = Math.max(...segs.map(intensity))
  const peakGrade = Math.max(...segs.map((s) => s.grade))
  const peakEffort = Math.max(...segs.map((s) => s.effort))

  console.log(`\n\x1b[1m${p.name}\x1b[0m — ${p.blurb}`)
  for (const row of chart(segs, w.duration)) console.log(`  \x1b[38;5;209m${row}\x1b[0m`)
  const axis = `0${' '.repeat(WIDTH - String(minutes).length - 5)}${minutes} min`
  console.log(`  \x1b[2m${axis}\x1b[0m`)
  console.log(
    `  ${segs.length} segments · ${Math.round((above / w.duration) * 100)}% of the time above the pace you set` +
      ` · ${Math.round((hard / w.duration) * 100)}% marked hard`,
  )
  if (p.heartRate) {
    const hold = Math.max(...segs.map((x) => x.hrr ?? 0))
    console.log(`  holds ${Math.round(hold * 100)}% of heart-rate reserve · the console moves the pace itself, so the bars are the zone, not a pace`)
    const kindsHr = new Map<string, number>()
    for (const x of segs) kindsHr.set(x.kind, (kindsHr.get(x.kind) ?? 0) + (x.t1 - x.t0))
    console.log(`  ${[...kindsHr].map(([k, v]) => `${k} ${clock(v)}`).join(' · ')}`)
    return
  }
  console.log(
    `  peak ${peak.toFixed(2)}× the base` +
      (peakEffort > 1.001 ? ` (pace ×${peakEffort.toFixed(2)}` : ' (pace unchanged') +
      (peakGrade > 0.001 ? `, hill +${peakGrade.toFixed(1)} %)` : ')') +
      (p.levelled ? ` · level ${level}` : ' · no level'),
  )
  const kinds = new Map<string, number>()
  for (const s of segs) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + (s.t1 - s.t0))
  console.log(`  ${[...kinds].map(([k, v]) => `${k} ${clock(v)}`).join(' · ')}`)
}

console.log(`\x1b[1mLane One programmes\x1b[0m — ${minutes} minutes, level ${level}`)
console.log('Height is how hard, where the line the bars sit on is the pace you dialled in (1.00×).')
for (const id of only ? [only] : PROGRAM_IDS) report(id)
console.log('')
