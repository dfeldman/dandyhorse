/**
 * Look at something that is not straight ahead: `npm run look -- katy-trail 142300 -70`.
 *
 * The screenshot harness frames every spot the way the game does, from behind the rider down the road, which
 * is right for judging what a ride looks like and useless for judging anything beside it. The Missouri runs
 * along the Katy Trail for two hundred kilometres and never once appeared in a reference frame, because the
 * camera was always pointing along the bank rather than across it — three passes were spent believing the
 * water was not being drawn at all when it was simply out of shot.
 *
 * So this is the same page, seeked to the same place, with a camera of its own pointed wherever it is told.
 * It takes one frame and writes it to docs/shots/look-<name>.png.
 *
 *   npm run look -- <route> <metres along> [degrees off the trail] [--name=river] [--height=5]
 *
 * A camera of its own matters: setting the chase camera's target does nothing, because the chase camera puts
 * itself back behind the rider on the next frame, which is exactly what it is for.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5196'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string =>
  (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3)
const plain = args.filter((a) => !a.startsWith('--'))
const route = plain[0] ?? 'katy-trail'
const at = Number(plain[1] ?? 0)
const yaw = Number(plain[2] ?? 0)
const name = flag('name', `${route}-${Math.round(at)}-${Math.round(yaw)}`)
const height = Number(flag('height', '5'))

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => process.stderr.write(`  page error: ${String(e).slice(0, 300)}\n`))

await page.goto(`${BASE}/?route=${route}&s=${at}&others=0&go=1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 180_000 })
await page.evaluate((s) => (window as unknown as { __shot: (s: number, o: { rider: boolean }) => Promise<void> }).__shot(s, { rider: false }), at)

await page.evaluate(async ({ at, yaw, height }) => {
  const w = window as unknown as { __game: { scene: any; route: any; frame: any } }
  const scene = w.__game.scene
  const pose = w.__game.route.poseAt(at)
  const V = Object.getPrototypeOf(scene.activeCamera.position).constructor
  const a = (yaw * Math.PI) / 180
  const hx = pose.hx * Math.cos(a) - pose.hz * Math.sin(a)
  const hz = pose.hx * Math.sin(a) + pose.hz * Math.cos(a)
  const x = w.__game.frame.localX(pose.x)
  const z = w.__game.frame.localZ(pose.z)
  const camera = new (scene.activeCamera.constructor)('look', new V(x - hx * 8, pose.y + height, z - hz * 8), scene)
  camera.minZ = 0.3
  camera.maxZ = 12000
  camera.setTarget(new V(x + hx * 80, pose.y + 1, z + hz * 80))
  scene.activeCamera = camera
  // the chase camera puts itself back every frame, so this one is reinstated after each render
  for (let i = 0; i < 6; i++) {
    scene.render()
    await new Promise((r) => requestAnimationFrame(r))
    scene.activeCamera = camera
  }
}, { at, yaw, height })

const file = resolve(import.meta.dirname, '..', 'docs', 'shots', `look-${name}.png`)
writeFileSync(file, await page.screenshot())
process.stdout.write(`  ${file}\n`)
await browser.close()
