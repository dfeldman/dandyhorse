/**
 * Look at a baked route without starting the game: `npm run profile -- alpe-dhuez`.
 *
 * Prints the headline numbers, an elevation profile, the steepest sections and the bands and landmarks, all
 * read back out of public/routes/ exactly as the game reads them. It is the quickest way to tell whether a
 * route is worth riding and whether a change to the baker made it better or worse.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { grades } from '../src/route/geo.ts'
import type { RouteManifest } from '../src/route/package.ts'
import { ROUTES } from './routes.ts'

const DIR = resolve(import.meta.dirname, '..', 'public', 'routes')
const BARS = ' ▁▂▃▄▅▆▇█'

function show(id: string): void {
  const manifest = JSON.parse(readFileSync(resolve(DIR, `${id}.json`), 'utf8')) as RouteManifest
  const buf = readFileSync(resolve(DIR, `${id}.track.bin`))
  const track = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const n = manifest.samples
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) y[i] = track[i * 3 + 2]

  const km = (m: number): string => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
  console.log(`\n${manifest.name} — ${manifest.direction}`)
  console.log(`${manifest.region} · ${manifest.kind} · baked ${manifest.attribution.bakedAt}`)
  console.log(
    `${km(manifest.length)}  ${manifest.stats.gain} m up / ${manifest.stats.loss} m down  ` +
    `${manifest.stats.minElevation}–${manifest.stats.maxElevation} m  ` +
    `grade ${(manifest.stats.minGrade * 100).toFixed(1)}%…${(manifest.stats.maxGrade * 100).toFixed(1)}%  ` +
    `mean ${(manifest.stats.averageGrade * 100).toFixed(1)}%`,
  )

  // the profile, one column per 1/100th of the route
  const cols = 100
  const lo = manifest.stats.minElevation
  const hi = Math.max(lo + 1, manifest.stats.maxElevation)
  let line = ''
  for (let c = 0; c < cols; c++) {
    const i = Math.min(n - 1, Math.round((c / (cols - 1)) * (n - 1)))
    line += BARS[Math.max(0, Math.min(8, Math.round(((y[i] - lo) / (hi - lo)) * 8)))]
  }
  console.log(`\n${hi.toFixed(0).padStart(5)} m ┤${line}`)
  console.log(`${lo.toFixed(0).padStart(5)} m ┤${'─'.repeat(cols)}`)
  console.log(`${' '.repeat(7)}0${' '.repeat(cols - 1 - km(manifest.length).length)}${km(manifest.length)}`)

  // steepest and shallowest runs, merged so one bend does not fill the list
  const g = grades(y, manifest.step)
  const runs: Array<{ a: number; b: number; g: number }> = []
  const mark = manifest.kind === 'road' ? 0.1 : 0.03
  for (let i = 0; i < g.length; i++) {
    if (Math.abs(g[i]) < mark) continue
    const last = runs[runs.length - 1]
    if (last && i - last.b < 20 && Math.sign(g[i]) === Math.sign(last.g)) {
      last.b = i
      last.g = Math.abs(g[i]) > Math.abs(last.g) ? g[i] : last.g
    } else runs.push({ a: i, b: i, g: g[i] })
  }
  const notable = runs.filter((r) => (r.b - r.a) * manifest.step >= 80).sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 8)
  if (notable.length) {
    console.log(`\nsteepest runs over ${(mark * 100).toFixed(0)}%:`)
    for (const r of notable.sort((a, b) => a.a - b.a)) {
      console.log(`  ${km(r.a * manifest.step).padStart(8)} → ${km(r.b * manifest.step).padStart(8)}  ${(r.g * 100).toFixed(1).padStart(6)}%  ${y[r.a].toFixed(0)}→${y[r.b].toFixed(0)} m`)
    }
  }

  console.log(`\nsurfaces: ${manifest.surfaces.map((b) => `${km(b.start)} ${b.value}`).join(', ')}`)
  console.log(`biomes:   ${manifest.biomes.map((b) => `${km(b.start)} ${b.value}`).join(', ')}`)
  const marks = manifest.landmarks
  console.log(`landmarks (${marks.length}): ${marks.slice(0, 14).map((m) => `${m.name} @${km(m.s)}`).join(', ')}${marks.length > 14 ? ', …' : ''}`)
  const dem = manifest.dem
  console.log(`terrain:  ${dem.tiles.length} tiles of ${dem.tile}² posts at ${dem.step} m`)
  console.log(`sources:  ${manifest.attribution.geometry}`)
  console.log(`          ${manifest.attribution.elevation}`)
  console.log(`          ${manifest.attribution.terrain}`)
}

const ids = process.argv.slice(2)
for (const id of ids.length ? ids : ROUTES.map((r) => r.id)) show(id)
console.log()
