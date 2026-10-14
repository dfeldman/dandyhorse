import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-angle=metal','--enable-gpu','--disable-gpu-vsync','--disable-frame-rate-limit'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:5196/?route=katy-trail&s=215000&others=0&go=1', { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
await p.evaluate(() => window.__shot(215000, { rider: false }))
await p.evaluate(async () => { const f = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < 300; i++) await f() })
const cdp = await p.context().newCDPSession(p)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
await p.evaluate(async () => { const f = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < 300; i++) await f() })
const { profile } = await cdp.send('Profiler.stop')
// self time per function
const self = new Map()
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const counts = new Map()
for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1)
let total = 0
for (const [id, c] of counts) {
  const n = byId.get(id); const f = n.callFrame
  if (f.functionName === '(idle)' || f.functionName === '(program)') continue
  const key = `${f.functionName || '(anon)'}  ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber}`
  self.set(key, (self.get(key) || 0) + c); total += c
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
for (const [k, c] of top) console.log(`${(100 * c / total).toFixed(1).padStart(5)}%  ${k}`)
await b.close()
