/**
 * LANE ONE ON DANDYHORSE, END TO END. Needs the platform server running locally in its development login mode
 * (`make serve`, port 8080) and this game built (`npm run build`: the server serves dist/). Two runs:
 *
 *   treadmill, drive "you"     a simulated treadmill at 9 km/h that follows the incline it is asked for. Checks the
 *                              console asks for the incline and NEVER a belt speed, that the phone's Incline + and
 *                              Speed + move the base, that the bridge's Pause freezes the workout and Play lifts it,
 *                              and that the bridge's End leaves a completed session with a History picture.
 *   bike, drive "the machine"  a simulated trainer: checks ERG (power on the wire, no grade) and an End.
 *   a 20-second programme      the game ends the session itself, complete, when the clock runs out.
 *
 * Logs in as its own test user (E2E_UID, default 7701) so it never ends somebody's real session.
 *   [DH=http://localhost:8080] [E2E_UID=7701] node --experimental-strip-types tools/platform-e2e.ts
 */
import { chromium, type Page } from 'playwright'

const DH = process.env.DH ?? 'http://localhost:8080'
const UID = Number(process.env.E2E_UID ?? 7701)
const BRIDGE = 'e2e-laneone'

const login = await fetch(`${DH}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID }) })
const token = ((await login.json()) as { token: string }).token
const cookie = `dh_token=${token}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
// window.gameReady and window.__lane are declared by src/main.ts
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

const browser = await chromium.launch()

async function run(device: 'treadmill' | 'bike', options: Record<string, string>, duration: number, body: (page: Page, sid: string, bridge: { set: (a: Record<string, number>) => void; last: () => Any }) => Promise<void>): Promise<void> {
  console.log(`\n== ${device} ${JSON.stringify(options)}`)
  const cur = await api('GET', '/api/sessions/current')
  if (cur?.session?.sessionId) await api('POST', `/api/sessions/${cur.session.sessionId}/end`, { status: 'discarded' })
  const launched = await api('POST', '/api/sessions/launch', { gameId: 'laneone', variant: device, deviceType: device, debug: true, duration, options })
  const sid: string = launched.sessionId
  check(typeof sid === 'string', 'launched from the console API', launched.session?.status ?? launched)
  if (typeof sid !== 'string') return

  // the bridge: a simulated machine reporting every 500 ms, and reading back what it is asked for
  let actual: Record<string, number> = device === 'treadmill' ? { speed: 2.5, incline: 0 } : { power: 180, cadence: 85 }
  let last: Any = null
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      await api('POST', '/bridgeapi/putstate', {
        bridgeId: BRIDGE, timestamp: Date.now(),
        devices: [{ role: 'fitness', type: device, name: `Simulated ${device}`, address: `sim:${BRIDGE}`, protocol: 'sim', status: 'simulated' }],
        actual,
      })
      last = await api('GET', `/bridgeapi/getstate?bridgeId=${BRIDGE}`)
      // a treadmill that follows its incline motor
      if (device === 'treadmill' && typeof last?.requested?.incline === 'number') actual = { ...actual, incline: last.requested.incline }
      await sleep(500)
    }
  })()

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.context().addCookies([{ name: 'dh_token', value: token, url: DH }])
  page.on('console', (m) => { const t = m.text(); if (/laneone|rror/.test(t)) console.log('    [page]', t.slice(0, 200)) })
  page.on('pageerror', (e) => console.log('    [page error]', e.message))
  // the URL the bridge opens (lifecycle.py gameEntryUrl)
  await page.goto(`${DH}/games/laneone/index.html?session=${sid}&variant=${device}&seed=1&debug=1`)
  await page.waitForFunction(() => window.gameReady === true, null, { timeout: 30000 }).catch(() => {})
  check(await page.evaluate(() => window.gameReady === true), 'the game started from the session, with no setup screen',
    await page.evaluate(() => ({ setupHidden: document.getElementById('setup')?.hidden })))

  try {
    await body(page, sid, { set: (a) => { actual = { ...actual, ...a } }, last: () => last })
  } finally {
    stopped = true
    await loop
    await page.close()
  }
}

const state = (page: Page): Promise<Any> => page.evaluate(() => window.__lane?.state() as Any)

await run('treadmill', { programme: 'hills', drive: 'you' }, 600, async (page, sid, bridge) => {
  await sleep(8000)
  const s1 = await state(page)
  const req = bridge.last()?.requested ?? {}
  check(s1.phase === 'running' && s1.distance > 5, 'the workout moves on the belt the bridge reports', { phase: s1.phase, distance: Math.round(s1.distance), speed: s1.speed })
  check(typeof req.incline === 'number', 'the bridge is asked for an incline', req.incline)
  check(req.speed === undefined || req.speed === null, 'drive "you": the bridge is never asked for a belt speed', req.speed)

  // the phone's buttons: one Incline + and one Speed + (a speed the console only shows; it is not sent)
  const before = s1.base
  console.log('   ', JSON.stringify(await api('POST', '/bridgeapi/sendinput', { bridgeId: BRIDGE, promptId: 'console', choice: 'Incline +' })))
  await api('POST', '/bridgeapi/sendinput', { bridgeId: BRIDGE, promptId: 'console', choice: 'Speed +' })
  await sleep(3000)
  const s2 = await state(page)
  check(Math.abs(s2.base.incline - before.incline - 0.5) < 1e-6, 'the phone\'s Incline + moved the incline by 0.5 %', { before: before.incline, after: s2.base.incline })
  check(s2.base.speed > before.speed, 'the phone\'s Speed + moved the target pace', { before: before.speed, after: s2.base.speed })
  const prompt = bridge.last()?.requestedInput
  check(Array.isArray(prompt?.choices) && prompt.choices.includes('Speed +'), 'the bridge shows the console buttons', prompt?.choices)

  // the bridge's Pause, then Play
  console.log('   ', JSON.stringify(await api('POST', '/bridgeapi/pause', { bridgeId: BRIDGE })).slice(0, 120))
  await sleep(3000)
  const p1 = await state(page)
  await sleep(3000)
  const p2 = await state(page)
  check(p1.phase === 'paused' && Math.abs(p2.elapsed - p1.elapsed) < 0.01 && Math.abs(p2.distance - p1.distance) < 0.01,
    'Pause on the bridge freezes the clock and the distance', { phase: p1.phase, elapsed: [p1.elapsed.toFixed(2), p2.elapsed.toFixed(2)] })
  console.log('   ', JSON.stringify(await api('POST', '/bridgeapi/resume', { bridgeId: BRIDGE })).slice(0, 120))
  await sleep(4000)
  const r1 = await state(page)
  check(r1.phase === 'running' && r1.elapsed > p2.elapsed + 1, 'Play on the bridge starts it again', { phase: r1.phase, elapsed: r1.elapsed.toFixed(1) })

  // the bridge's ■ End: complete, and History gets its picture
  const end = await api('POST', '/bridgeapi/end', { bridgeId: BRIDGE, status: 'complete' })
  check(end.status === 'complete', 'the bridge ended it complete', end.status)
  let img = 0
  for (let k = 0; k < 6 && img !== 200; k++) {
    await sleep(2000)
    img = (await fetch(`${DH}/api/sessions/${sid}/image`, { headers: { Cookie: cookie } })).status
  }
  check(img === 200, 'History has the session picture', img)
  const sum = await page.evaluate(() => ({ shown: !document.getElementById('summary')?.hidden, text: document.getElementById('summary')?.textContent?.slice(0, 80) }))
  check(sum.shown, 'the summary is on screen', sum.text)
  const rec = await api('GET', `/api/sessions/${sid}`)
  const r = rec.session ?? rec
  check(r.route === 'hills' && r.score > 0, 'the record carries the programme as its route and metres as its score', { route: r.route, score: r.score, distance: r.distance })
})

await run('bike', { programme: 'steady', drive: 'the machine' }, 600, async (page, sid, bridge) => {
  await sleep(8000)
  const s = await state(page)
  const req = bridge.last()?.requested ?? {}
  check(s.phase === 'running' && s.distance > 5, 'the workout moves on the trainer\'s power', { distance: Math.round(s.distance), speed: s.speed })
  check(typeof req.power === 'number' && (req.grade === undefined || req.grade === null), 'drive "the machine" on a bike: ERG watts, no grade', { power: req.power, grade: req.grade })
  const end = await api('POST', '/bridgeapi/end', { bridgeId: BRIDGE, status: 'complete' })
  check(end.status === 'complete', 'the bridge ended it complete', end.status)
  await sleep(3000)
  check((await fetch(`${DH}/api/sessions/${sid}/image`, { headers: { Cookie: cookie } })).status === 200, 'History has the session picture')
})

// the clock runs out: the game itself ends the session complete (the server never ends one on time)
await run('treadmill', { programme: 'manual' }, 20, async (page, sid) => {
  let rec: Any = null
  for (let k = 0; k < 15; k++) {
    await sleep(2000)
    rec = await api('GET', `/api/sessions/${sid}`)
    if ((rec.session ?? rec).status === 'complete') break
  }
  const r = rec.session ?? rec
  check(r.status === 'complete', 'at the end of the programme the game ends the session complete', { status: r.status, endReason: r.endReason, duration: r.duration })
  check((await fetch(`${DH}/api/sessions/${sid}/image`, { headers: { Cookie: cookie } })).status === 200, 'History has the session picture')
  check(await page.evaluate(() => !document.getElementById('summary')?.hidden), 'the summary is on screen')
})

await browser.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)

