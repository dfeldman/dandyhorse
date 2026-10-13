/**
 * How fast the frame actually is: `npm run bench`.
 *
 * The screenshot harness reports frames per second, and on this machine every spot reads 60 — because the
 * browser is waiting for vsync, not because the frame takes a sixtieth of a second. A number that is pinned
 * at its ceiling cannot tell a change that saves half the frame from one that saves nothing, so it is useless
 * for performance work. This launches Chromium with the frame-rate limit and vsync off, so requestAnimationFrame
 * runs as fast as the GPU can finish frames, and reports the mean frame time in milliseconds at each spot.
 *
 *   npm run bench                  a fixed handful of spots, the heavy ones
 *   npm run bench -- --scale=0.5   render at twice the resolution, to stress the fill rate
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5196'
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const SPOTS_ALL: Array<[string, number]> = [
  ['alpe-dhuez', 3835],
  ['alpe-dhuez', 9500],
  ['katy-trail', 112000],
  ['katy-trail', 215000],
  ['katy-trail', 196800],
]
const SPOTS = only ? SPOTS_ALL.filter(([r, s]) => r.includes(only) || String(s) === only) : SPOTS_ALL
/**
 * Pixel ratios to compare, alternated so drift in the machine's state cancels between them. The default pair
 * is a Retina display at its native 2× against the 1.5× the game now starts at; the page is given a device
 * scale factor of 2 so both are what a Retina screen would actually be asked to draw.
 */
const ratioArg = process.argv.find((a) => a.startsWith('--ratios='))
const ratios = ratioArg ? ratioArg.slice(9).split(',').map(Number) : [2, 1.5]

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu',
    // the whole point: no vsync, no 60 Hz cap
    '--disable-gpu-vsync', '--disable-frame-rate-limit',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
let loaded = ''
const rows: string[] = []
const totals: number[] = []
for (const [route, s] of SPOTS) {
  if (loaded !== route) {
    await page.goto(`${BASE}/?route=${route}&s=${s}&others=0&go=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 180_000 })
    loaded = route
  }
  await page.evaluate((s) => (window as unknown as { __shot: (s: number, o: object) => Promise<void> }).__shot(s, { rider: false }), s)
  const ms = await page.evaluate(async (ratios) => {
    const g = (window as unknown as { __game: { resolution: { fix: (r: number) => void } } }).__game
    const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r))
    const window_ = async (): Promise<number> => {
      // a resize reallocates every multisampled target, and the frames after it are not representative
      for (let i = 0; i < 90; i++) await frame()
      const t0 = await frame()
      let n = 0
      let t = t0
      while (t - t0 < 1200) { t = await frame(); n++ }
      return (t - t0) / n
    }
    const sums = ratios.map(() => [] as number[])
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < ratios.length; i++) { g.resolution.fix(ratios[i]); sums[i].push(await window_()) }
    }
    g.resolution.fix(1)
    return sums.map((xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)])
  }, ratios)
  ms.forEach((v, i) => { totals[i] = (totals[i] ?? 0) + v })
  rows.push(`  ${`${route} @ ${s}`.padEnd(26)} ` + ms.map((v, i) => `${ratios[i]}×: ${v.toFixed(2).padStart(6)} ms`).join('   '))
  process.stdout.write(`${rows[rows.length - 1]}\n`)
}
process.stdout.write(`  ${'mean'.padEnd(26)} ` + totals.map((v, i) => `${ratios[i]}×: ${(v / SPOTS.length).toFixed(2).padStart(6)} ms`).join('   ') + '\n')
await browser.close()
