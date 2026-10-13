/**
 * The screenshot harness: the same frames, of the same places, before and after a change to the scenery.
 *
 * Judging graphics work by riding to a spot and looking at it does not survive contact with a chase camera
 * that lags the road and ground that streams in over a second. Two frames of the same hairpin end up framed
 * differently and half-built, and the difference that matters is lost in the difference that does not. So the
 * page is asked to seek, finish streaming, compile its materials, snap the camera and hide the HUD
 * (`__shot` in src/main.ts), and only then is the frame captured.
 *
 * It also writes what the frame cost: frames per second, draw calls, active meshes and triangles, from
 * Babylon's own instrumentation. A change that makes the picture better and the frame twice as expensive is a
 * change worth knowing about before it is built on.
 *
 *   npm run shots                      every spot, into docs/shots/<date>/
 *   npm run shots -- --rider           with the rider in frame, for a sense of scale
 *   npm run shots -- --engine=webgl    force the WebGL2 fallback, to compare, and to check that the
 *                                      hand-written shader snippets compile in GLSL as well as WGSL
 *   npm run shots -- --only=alpe       only spots whose route matches
 *   npm run shots -- --out=before      a named folder rather than today's date
 *
 * It drives a dev server that is already running (`npm run dev`) rather than starting one, so it can be run
 * against whatever is on screen.
 *
 * Headless Chromium needs to be asked for WebGPU explicitly, and quietly falls back to a software renderer if
 * it is not given a GPU. The harness records which engine it actually got in stats.json instead of assuming:
 * a WebGL run is still a useful before-and-after, as long as nobody reads its frame rate as the real one.
 */
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Spot { route: string; s: number; why: string }
interface Shots { width: number; height: number; spots: Spot[] }

interface Stats {
  spot: string
  route: string
  s: number
  engine: string
  fps: number
  drawCalls: number
  activeMeshes: number
  triangles: number
  frameMs: number
}

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5196'

const arg = (name: string, fallback = ''): string => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/** Today, as the folder name a run defaults to. */
const today = (): string => new Date().toISOString().slice(0, 10)

async function capture(page: Page, spot: Spot, dir: string, index: number, withRider: boolean, loaded: { route: string }): Promise<Stats> {
  const engine = arg('engine')
  const url = `${BASE}/?route=${spot.route}&s=${spot.s}&others=0&go=1${engine ? `&engine=${engine}` : ''}`
  /**
   * `--reuse` seeks within the page that is already open rather than loading a new one.
   *
   * Every spot being a fresh load is the honest way to measure — nothing is warm that would not be warm in a
   * real ride — and it costs a minute and a half a spot, because each load fetches the tree library again and
   * rebuilds both ground rings from scratch. Fourteen spots is half an hour, which is too slow to iterate on a
   * colour with. With `--reuse` a run of spots on the same route seeks instead, and takes about a third as
   * long; the numbers it prints are warm-cache numbers and should not be compared with a cold run's.
   */
  const reuse = process.argv.includes('--reuse') && loaded.route === spot.route
  if (!reuse) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    loaded.route = spot.route
    // the game builds its scene before it exposes itself; nothing can be asked of it until then
    // Generous: a fresh page load fetches the tree library again.
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 180_000 })
  }
  await page.evaluate(
    ([s, rider]) => (window as unknown as { __shot: (s: number, o: { rider: boolean }) => Promise<void> }).__shot(s as number, { rider: rider as boolean }),
    [spot.s, withRider] as [number, boolean],
  )

  const stats = await page.evaluate(async (babylon: string) => {
    const w = window as unknown as { __game: { engine: any; scene: any } }
    const { engine, scene } = w.__game
    // the specifier is passed in rather than written here, so the node-side typechecker does not try to
    // resolve a path that only means anything inside the page
    const mod = (await import(/* @vite-ignore */ babylon)) as any
    const inst = new mod.SceneInstrumentation(scene)
    inst.captureFrameTime = true
    // a warm-up first. Each spot is a fresh page load, and the first second of it is spent compiling shaders
    // and uploading textures — measured cold, the first spot of a run reads at two frames a second and says
    // nothing about the scene.
    const warm = performance.now()
    while (performance.now() - warm < 1500) {
      scene.render()
      await new Promise((r) => requestAnimationFrame(r))
    }
    inst.dispose()
    const inst2 = new mod.SceneInstrumentation(scene)
    inst2.captureFrameTime = true
    // measure over a couple of seconds of real frames rather than one, which is mostly noise
    const t0 = performance.now()
    let frames = 0
    while (performance.now() - t0 < 2000) {
      scene.render()
      frames++
      await new Promise((r) => requestAnimationFrame(r))
    }
    const elapsed = (performance.now() - t0) / 1000
    const out = {
      engine: engine.isWebGPU ? 'WebGPU' : `WebGL${engine.webGLVersion ?? 2}`,
      fps: frames / elapsed,
      drawCalls: inst2.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length,
      triangles: scene.getActiveIndices() / 3,
      frameMs: inst2.frameTimeCounter.average,
    }
    inst2.dispose()
    return out
  }, '/node_modules/@babylonjs/core/index.js')

  const name = `${String(index + 1).padStart(2, '0')}-${spot.route}-${spot.s}`
  await page.screenshot({ path: resolve(dir, `${name}.png`) })
  return { spot: name, route: spot.route, s: spot.s, ...stats }
}

async function main(): Promise<void> {
  const config = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(import.meta.dirname, 'shots.json'), 'utf8')) as Shots
  const only = arg('only')
  const spots = only ? config.spots.filter((s) => s.route.includes(only) || String(s.s) === only) : config.spots
  if (!spots.length) throw new Error(`shots: nothing matches --only=${only}`)

  const dir = resolve(import.meta.dirname, '..', 'docs', 'shots', arg('out', today()))
  await mkdir(dir, { recursive: true })

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      args: [
        // headless Chromium will not give WebGPU without being asked, and falls back to software silently
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
      ],
    })
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error(`  page error: ${e.message}`))

    // the rider is the avatar kit's and is not what these frames are for; --rider puts them back in
    const withRider = process.argv.includes('--rider')
    const stats: Stats[] = []
    // which route the open page is showing, for --reuse
    const loaded = { route: '' }
    for (const [i, spot] of spots.entries()) {
      process.stdout.write(`  ${spot.route} @ ${spot.s} m — ${spot.why}\n`)
      stats.push(await capture(page, spot, dir, i, withRider, loaded))
    }

    await writeFile(resolve(dir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`)
    const engines = [...new Set(stats.map((s) => s.engine))].join(', ')
    console.log(`\n  ${stats.length} frames in ${dir} (${engines})`)
    console.log('  spot                          fps   draws  meshes    tris')
    for (const s of stats) {
      console.log(
        `  ${s.spot.padEnd(28)} ${s.fps.toFixed(0).padStart(4)} ${String(s.drawCalls).padStart(7)} ` +
        `${String(s.activeMeshes).padStart(7)} ${Math.round(s.triangles).toLocaleString().padStart(8)}`,
      )
    }
  } finally {
    await browser?.close()
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
