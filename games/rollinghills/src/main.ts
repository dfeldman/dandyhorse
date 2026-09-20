/**
 * Entry point. Order matters: the session must exist BEFORE the game scripts load, because they
 * generate the world from the seed and route at load time (PLAN.md §7.2; docs/GAME_DEVELOPER_GUIDE.md
 * "Porting a plain-JS game").
 *
 *   1. startsession (by ?session= from the bridge, or ad-hoc for developers)
 *   2. publish seed / route / preferences on window.RH_START
 *   3. import src/game/ (Babylon and the world come in with it, so this is where the wait is)
 *   4. RollingHills.boot(platform) builds the world and returns the handle; the tick loop starts
 *
 * The import is dynamic on purpose: src/game/config.js reads window.RH_START as it loads, so the
 * session has to be there first.
 */
import { ApiError, startSession, type DeviceType, type StartPayload, type StartSessionAdHoc, type StartSessionBySession } from '@dandyhorse/gamekit'
import { GAME_ID, Platform } from './platform.ts'
import type { RhHandle, RhPlatform } from './globals.d.ts'

const bootEl = document.getElementById('boot') as HTMLDivElement
const bootMsg = document.getElementById('boot-msg') as HTMLParagraphElement
const bootActions = document.getElementById('boot-actions') as HTMLDivElement
const params = new URLSearchParams(location.search)

function say(msg: string): void { bootMsg.textContent = msg; bootActions.replaceChildren() }
function fail(msg: string, detail?: string): void {
  bootMsg.textContent = msg
  const pre = document.createElement('pre')
  pre.textContent = detail ?? ''
  bootActions.replaceChildren(detail ? pre : '')
  console.error('rollinghills:', msg, detail ?? '')
}
const log = (line: string): void => console.log('rollinghills:', line)

async function main(): Promise<void> {
  const sessionParam = params.get('session')
  if (sessionParam) {
    await begin({ sessionId: sessionParam })
    return
  }
  // Developer opened the game directly: offer an ad-hoc debug session (PLAN.md §5.2).
  bootMsg.textContent = 'No session in the URL. Start a debug session to ride without the console:'
  const buttons = (['bike', 'treadmill'] as DeviceType[]).map((variant) => {
    const b = document.createElement('button')
    b.textContent = variant === 'bike' ? 'Ride (bike)' : 'Ride (treadmill)'
    b.onclick = () => {
      const body: StartSessionAdHoc = { gameId: GAME_ID, variant, debug: true, options: {} }
      const seed = params.get('seed')
      if (seed && /^\d+$/.test(seed)) body.seed = Number(seed) >>> 0
      for (const k of ['route', 'timeOfDay']) { const v = params.get(k); if (v) (body.options as Record<string, unknown>)[k] = v } // ?route=hilly&timeOfDay=night for developers
      void begin(body)
    }
    return b
  })
  bootActions.replaceChildren(...buttons)
}

async function begin(body: StartSessionBySession | StartSessionAdHoc): Promise<void> {
  say('Starting your session…')
  let start: StartPayload
  try {
    start = await startSession(body)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      bootMsg.textContent = 'You are not logged in.'
      const a = document.createElement('a')
      a.className = 'btn'
      a.href = `/login?uid=1&next=${encodeURIComponent(`${location.pathname}${location.search}`)}`
      a.textContent = 'Log in and come back'
      bootActions.replaceChildren(a)
      return
    }
    fail('The session could not start.', e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e))
    return
  }

  const platform = new Platform(start, log, (ended) => log(`ui: ended ${ended.status}`))
  window.RH_START = platform.startInfo
  log(`session ${start.sessionId} · ${start.variant} · ${start.deviceType} · seed ${start.seed} · route ${platform.startInfo.route} · ${start.unitSystem}${start.debug ? ' · debug' : ''}`)

  say('Building the world…')
  let game: { boot: (p: RhPlatform) => RhHandle }
  try {
    game = (await import('./game/main.js')).RollingHills
  } catch (e) {
    fail('The game did not load.', e instanceof Error ? (e.stack ?? e.message) : String(e))
    return
  }
  // the world builds synchronously in boot(); give the browser one frame to paint the message
  await new Promise((r) => requestAnimationFrame(r))
  let handle
  try {
    handle = game.boot(platform)
  } catch (e) {
    fail('The world could not be built.', e instanceof Error ? (e.stack ?? e.message) : String(e))
    return
  }
  platform.attach(handle)
  bootEl.hidden = true
}

void main()
