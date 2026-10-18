/**
 * TRAIL TRAINER ON DANDYHORSE, END TO END. Needs the platform server running locally in its development login mode
 * (`make serve`, port 8080) and this game built (`npm run build`: the server serves dist/). Three runs, each opening
 * the URL a bridge opens and playing the bridge itself (a simulated machine reporting every 500 ms):
 *
 *   bike, a real session    200 W up Alpe d'Huez from the start of the route. Checks the ride moves on the power,
 *                           the trainer is asked for the route's grade (never ERG watts), the bridge's Pause
 *                           freezes the ride and Play lifts it, the bridge's End leaves a completed session with a
 *                           History picture, and the place on the route is in the save state.
 *   bike, again             the next session picks the route up where the last one stopped, with nobody touching
 *                           anything (trainer mode is hands-off).
 *   treadmill, 75 seconds   the belt speed moves the runner, the treadmill is asked for an incline and never a
 *                           speed, and the game ends the session itself, complete, when the time is up.
 *
 * Logs in as its own test user (E2E_UID, default 7701) so it never ends somebody's real session; its save state
 * for Trail Trainer is reset at the start.
 *   [DH=http://localhost:8080] [E2E_UID=7701] node --experimental-strip-types tools/platform-e2e.ts
 */
import { chromium, type Page } from 'playwright'

const DH = process.env.DH ?? 'http://localhost:8080'
const UID = Number(process.env.E2E_UID ?? 7701)
const BRIDGE = 'e2e-trailtrainer'
const ROUTE = 'alpe-dhuez'

const login = await fetch(`${DH}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID }) })
const token = ((await login.json()) as { token: string }).token
const cookie = `dh_token=${token}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const api = async (method: string, path: string, body?: unknown): Promise<Any> => {
  const r = await fetch(`${DH}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { status: r.status, text: t.slice(0, 200) } }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (ok: boolean, what: string, detail: unknown = ''): void => {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

const browser = await chromium.launch({
  // as tools/shots.ts: headless Chromium gives WebGPU only when asked
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
})

interface Bridge { set: (a: Record<string, number>) => void; last: () => Any }

async function run(device: 'treadmill' | 'bike', opts: { debug: boolean; duration: number }, body: (page: Page, sid: string, bridge: Bridge) => Promise<void>): Promise<void> {
  console.log(`\n== ${device}${opts.debug ? ' (debug)' : ''}, ${opts.duration} s`)
  const cur = await api('GET', '/api/sessions/current')
  if (cur?.session?.sessionId) await api('POST', `/api/sessions/${cur.session.sessionId}/end`, { status: 'discarded' })
  const launched = await api('POST', '/api/sessions/launch', { gameId: 'trailtrainer', variant: device, deviceType: device, debug: opts.debug, duration: opts.duration, options: { route: ROUTE, others: 'none' } })
  const sid: string = launched.sessionId
  check(typeof sid === 'string', 'launched from the console API', launched.session?.status ?? launched)
  if (typeof sid !== 'string') return

  let actual: Record<string, number> = device === 'treadmill' ? { speed: 3, incline: 0 } : { power: 200, cadence: 85 }
  let last: Any = null
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      await api('POST', '/bridgeapi/putstate', {
        bridgeId: BRIDGE, timestamp: Date.now(),
        // simulators only count in debug sessions, so the real-session runs report as a connected FTMS machine
        devices: [opts.debug
          ? { role: 'fitness', type: device, name: `Simulated ${device}`, address: `sim:${BRIDGE}`, protocol: 'sim', status: 'simulated' }
          : { role: 'fitness', type: device, name: `E2E ${device}`, address: `ble:${BRIDGE}`, protocol: 'ftms', status: 'connected' }],
        actual,
      })
      last = await api('GET', `/bridgeapi/getstate?bridgeId=${BRIDGE}`)
      if (device === 'treadmill' && typeof last?.requested?.incline === 'number') actual = { ...actual, incline: last.requested.incline }
      await sleep(500)
    }
  })()

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.context().addCookies([{ name: 'dh_token', value: token, url: DH }])
  page.on('console', (m) => { const t = m.text(); if (/trailtrainer|rror/.test(t)) console.log('    [page]', t.slice(0, 200)) })
  page.on('pageerror', (e) => console.log('    [page error]', e.message))
  const t0 = Date.now()
  await page.goto(`${DH}/games/trailtrainer/index.html?session=${sid}&variant=${device}&seed=1&debug=${opts.debug ? 1 : 0}`)
  await page.waitForFunction(() => (window as Any).gameReady === true, null, { timeout: 180000 }).catch(() => {})
  check(await page.evaluate(() => (window as Any).gameReady === true), `the ride started from the session, no start screen (${Math.round((Date.now() - t0) / 1000)} s to load)`,
    await page.evaluate(() => ({ startHidden: document.getElementById('start')?.classList.contains('off') ?? null })))

  try {
    await body(page, sid, { set: (a) => { actual = { ...actual, ...a } }, last: () => last })
  } finally {
    stopped = true
    await loop
    await page.close()
  }
}

const at = (page: Page): Promise<number> => page.evaluate(() => (window as Any).__game?.ride?.position as number)
const imageOf = async (sid: string): Promise<number> => {
  let status = 0
  for (let k = 0; k < 8 && status !== 200; k++) {
    await sleep(2000)
    status = (await fetch(`${DH}/api/sessions/${sid}/image`, { headers: { Cookie: cookie } })).status
  }
  return status
}

// a fresh start on the route
await api('PUT', '/gameapi/putsave', { game: 'trailtrainer', variant: 'bike', saveState: null })

let saved = 0
await run('bike', { debug: false, duration: 900 }, async (page, sid, bridge) => {
  const s0 = await at(page)
  check(s0 < 50, 'a fresh save starts at the bottom of the route', Math.round(s0))
  await sleep(10000)
  const s1 = await at(page)
  const req = bridge.last()?.requested ?? {}
  check(s1 > s0 + 10, 'the ride moves on the trainer\'s power', { from: Math.round(s0), to: Math.round(s1) })
  check(typeof req.grade === 'number', 'the trainer is asked for the route\'s grade', req.grade)
  // a bike reports its virtual speed (GAME_AUTHORING.md: for the server's distance); a trainer in simulation mode
  // takes only the grade, so what matters is that no ERG power is asked for
  check(req.power === undefined || req.power === null, 'simulation mode: the trainer is never asked for ERG watts', req.power)

  await api('POST', '/bridgeapi/pause', { bridgeId: BRIDGE })
  await sleep(3000)
  const p1 = await at(page)
  await sleep(3000)
  const p2 = await at(page)
  check(Math.abs(p2 - p1) < 0.5, 'Pause on the bridge stops the ride', { a: p1.toFixed(1), b: p2.toFixed(1) })
  await api('POST', '/bridgeapi/resume', { bridgeId: BRIDGE })
  await sleep(5000)
  const r1 = await at(page)
  check(r1 > p2 + 3, 'Play on the bridge starts it again', { from: p2.toFixed(1), to: r1.toFixed(1) })

  const end = await api('POST', '/bridgeapi/end', { bridgeId: BRIDGE, status: 'complete' })
  check(end.status === 'complete', 'the bridge ended it complete', end.status)
  check(await imageOf(sid) === 200, 'History has the session picture')
  const rec = await api('GET', `/api/sessions/${sid}`)
  const r = rec.session ?? rec
  check(r.route === ROUTE && r.score > 0, 'the record carries the route and the metres along it', { route: r.route, score: r.score, distance: r.distance })
  check(r.distance > 0 && Math.abs(r.distance - r.score) < Math.max(20, r.score * 0.3), 'History\'s distance follows the ride (the bike reports its virtual speed)', { distance: Math.round(r.distance), score: r.score })
  await sleep(1500)
  const save = await api('GET', `/gameapi/getsave?game=trailtrainer&variant=bike`)
  saved = save?.saveState?.routes?.[ROUTE]?.s ?? 0
  check(saved > 10, 'the place on the route is in the save state', save?.saveState?.routes?.[ROUTE])
})

await run('bike', { debug: false, duration: 900 }, async (page) => {
  const s0 = await at(page)
  check(Math.abs(s0 - saved) < 30, 'the next session picks the route up where the last stopped, hands-free', { saved: Math.round(saved), startedAt: Math.round(s0) })
  await sleep(4000)
  await api('POST', '/bridgeapi/end', { bridgeId: BRIDGE, status: 'discarded' })
})

await run('treadmill', { debug: true, duration: 75 }, async (page, sid, bridge) => {
  const s0 = await at(page)
  await sleep(8000)
  const s1 = await at(page)
  const req = bridge.last()?.requested ?? {}
  check(s1 > s0 + 10, 'the runner moves at the belt speed', { from: Math.round(s0), to: Math.round(s1) })
  check(typeof req.incline === 'number', 'the treadmill is asked for an incline', req.incline)
  check(req.speed === undefined || req.speed === null, 'the treadmill is never asked for a belt speed', req.speed)
  let r: Any = null
  for (let k = 0; k < 45; k++) {
    await sleep(2000)
    const rec = await api('GET', `/api/sessions/${sid}`)
    r = rec.session ?? rec
    if (r.status === 'complete') break
  }
  check(r?.status === 'complete', 'when the time is up the game ends the session complete', { status: r?.status, endReason: r?.endReason, duration: r?.duration })
  check(await imageOf(sid) === 200, 'History has the session picture')
})

await browser.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
