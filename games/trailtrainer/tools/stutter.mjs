/**
 * Where the hitches come from: `npm run stutter -- katy-trail 215000`.
 *
 * Rides 30 seconds from a spot in a VISIBLE browser window (the headless shell's compositor adds stalls of its
 * own that are not the game's), at about 32 km/h, and reports the mean frame, how many frames took over 24 ms,
 * how many garbage collections it saw, and for the worst frames which subsystem ran in them. The time inside
 * `scene.render` is reported as `render`; a slow frame with little attributed to it is time spent outside the
 * page — check for orphaned `chrome-headless-shell` processes before believing it.
 */
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const [route, start] = process.argv.slice(2)
await p.goto(`http://localhost:5196/?route=${route}&s=${start}&others=0&go=1`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
console.log(await p.evaluate(async (start) => {
  const g = window.__game
  const spans = {}
  const wrap = (name, obj, fn) => {
    const orig = obj[fn].bind(obj)
    obj[fn] = (...a) => { const t = performance.now(); const r = orig(...a); spans[name] = (spans[name] || 0) + performance.now() - t; return r }
  }
  wrap('scatter', g.scatter, 'update'); wrap('terrain', g.terrain, 'update'); wrap('far', g.distance, 'update')
  wrap('water', g.water, 'update'); wrap('trail', g.trail, 'update'); wrap('markers', g.markers, 'update')
  wrap('bridges', g.bridges, 'update'); wrap('companions', g.others, 'update')
  const s = g.scene
  let renderStart = 0
  s.onBeforeRenderObservable.add(() => { renderStart = performance.now() }, undefined, true)
  s.onAfterRenderObservable.add(() => { spans.render = (spans.render || 0) + performance.now() - renderStart })
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  for (let i = 0; i < 120; i++) await frame()
  let pos = Number(start)
  const log = []
  let last = await frame(); const tStart = last
  const heapStart = performance.memory ? performance.memory.usedJSHeapSize : 0
  let gcs = 0, lastHeap = heapStart
  for (let i = 0; i < 1800; i++) {
    for (const k in spans) spans[k] = 0
    pos += 9 * (1 / 60)          // about 32 km/h
    g.ride.seek(pos)
    const t = await frame()
    const dt = t - last; last = t
    const heap = performance.memory ? performance.memory.usedJSHeapSize : 0
    const dropped = heap < lastHeap - 2e6
    if (dropped) gcs++
    lastHeap = heap
    if (dt > 24) log.push({ dt: Math.round(dt), gc: dropped, ...Object.fromEntries(Object.entries(spans).filter(([, v]) => v > 1).map(([k, v]) => [k, Math.round(v)])) })
  }
  window.__meanFrame = (last - tStart) / 1800
  const slow = log.length
  const worst = log.sort((a, b) => b.dt - a.dt).slice(0, 12)
  const mean = (performance.now() - 0) ; return `mean frame ${(window.__meanFrame || 0).toFixed(1)} ms; frames over 24 ms: ${slow} of 1800 (${(100 * slow / 1800).toFixed(1)}%), heap drops (GC) seen: ${gcs}\n` + worst.map((r) => JSON.stringify(r)).join('\n')
}, start))
await b.close()
