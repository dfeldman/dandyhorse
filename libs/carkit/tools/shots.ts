/**
 * Contact sheets of the demo, captured headless, for judging the models without the app's Browser pane
 * (which stops rendering while hidden, so its screenshots of a WebGL scene can't be trusted).
 *
 *   npm run dev            (in another terminal; or the `carkit` launch config)
 *   npm run shots          every view below, into shots/
 *   npm run shots -- --only=bus
 *
 * Each view is a page URL plus a script run against `window.__carkit` before capture: choose a mode, a
 * vehicle, a camera, a light state, then `step` the simulation a fixed number of frames so the picture is the
 * same every run.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5204'
const OUT = resolve(import.meta.dirname, '..', 'shots')
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)

interface View { name: string; mode: string; preset?: string; js?: string; frames?: number; w?: number; h?: number }

const bench = (alpha: number, beta: number, radius: number, extra = ''): string =>
  `k.bench.turntable=false; k.bench.yaw=-0.6; k.camera.alpha=${alpha}; k.camera.beta=${beta}; k.camera.radius=${radius}; ${extra}`

const VIEWS: View[] = [
  { name: 'showroom', mode: 'showroom', w: 1600, h: 900 },
  ...['hatchback', 'sedan', 'coupe', 'suv', 'pickup', 'minivan', 'van', 'boxtruck', 'city-bus', 'school-bus', 'taxi', 'police', 'ambulance']
    .flatMap((p) => [
      // the bench car faces yaw −0.6: alpha 2.16 looks at its nose, 0.59 at its right side, −0.98 at its tail
      { name: `${p}-front`, mode: 'inspect', preset: p, js: bench(1.45, 1.25, 0) },
      { name: `${p}-side`, mode: 'inspect', preset: p, js: bench(0.59, 1.5, 0) },
      { name: `${p}-rear`, mode: 'inspect', preset: p, js: bench(-0.3, 1.25, 0) },
    ]),
  { name: 'sedan-steer-lights', mode: 'inspect', preset: 'sedan',
    js: bench(1.5, 1.0, 0, "k.bench.steer=0.55; k.lights.brake=true; k.lights.indicator='left'; k.lights.headlights=true; k.select(k.fleet.cars[0].spec);") },
  // phase 0 and 27 frames: the fleet clock sits at 0.45 s, in the lit half of the 1.5 Hz flash
  { name: 'sedan-rear-lamps', mode: 'inspect', preset: 'sedan', frames: 25,
    js: bench(-0.3, 1.3, 0, "k.lights.brake=true; k.lights.indicator='hazard'; k.lights.reverse=true; k.fleet.cars[0].phase=0;") },
  { name: 'school-bus-lamps', mode: 'inspect', preset: 'school-bus', frames: 25,
    js: bench(1.45, 1.25, 0, 'k.lights.beacon=true; k.fleet.cars[0].phase=0;') },
  { name: 'suv-grade', mode: 'inspect', preset: 'suv', js: bench(0.59, 1.45, 14, 'k.bench.grade=0.25; k.bench.bump=true;') },
  { name: 'bus-night', mode: 'inspect', preset: 'city-bus', js: bench(1.45, 1.2, 0, 'k.setNight(true); k.lights.headlights=true; k.lights.brake=true;') },
  { name: 'drive', mode: 'drive', preset: 'taxi', frames: 400 },
  { name: 'traffic', mode: 'traffic', frames: 300, w: 1600, h: 900 },
  { name: 'traffic-close', mode: 'traffic', frames: 300, js: 'k.camera.radius=45; k.camera.beta=1.1; k.camera.setTarget(new k.camera.target.constructor(-40,0,-40));' },
]

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
await mkdir(OUT, { recursive: true })
for (const v of VIEWS) {
  if (only && !v.name.includes(only)) continue
  const page = await browser.newPage({ viewport: { width: v.w ?? 1000, height: v.h ?? 700 } })
  page.on('pageerror', (e) => console.error(`[${v.name}] ${e.message}`))
  await page.goto(`${BASE}/?mode=${v.mode}${v.preset ? `&preset=${v.preset}` : ''}`)
  await page.waitForFunction(() => (window as unknown as { __carkit?: unknown }).__carkit !== undefined)
  // hide the panel so the canvas fills the page
  await page.addStyleTag({ content: '#panel{display:none} #app{grid-template-columns:1fr !important}' })
  const url: string = await page.evaluate(async ({ js, frames }) => {
    const k = (window as unknown as { __carkit: any }).__carkit
    k.engine.resize()
    if (js) {
      // a radius of 0 means "fit the vehicle"
      new Function('k', js)(k)
      if (k.camera.radius === 0 || k.camera.radius < 1) k.camera.radius = Math.max(6.5, k.fleet.cars[0].spec.length * 1.45)
    }
    k.step(1 / 60, 2)
    await k.ready()
    k.step(1 / 60, frames ?? 30)
    await k.ready()
    await new Promise((r) => setTimeout(r, 200))
    return k.shot()
  }, { js: v.js, frames: v.frames })
  await writeFile(resolve(OUT, `${v.name}.png`), Buffer.from(url.split(',')[1], 'base64'))
  console.log(`${v.name}.png`)
  await page.close()
}
await browser.close()
