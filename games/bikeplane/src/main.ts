/**
 * Entry point. The session starts before the game scripts load (docs/GAME_DEVELOPER_GUIDE.md §10):
 *   1. startsession (by ?session= from the bridge, or ad-hoc for developers), or practice without one
 *   2. load public/js/*.js in order (they define window.FlightCycle)
 *   3. FlightCycle.boot(platform) builds the island and returns the handle; the tick loop starts
 */
import { ApiError, startSession, type StartPayload, type StartSessionAdHoc, type StartSessionBySession } from '@dandyhorse/gamekit'
import { GAME_ID, Platform } from './platform.ts'
import { GAME_SCRIPTS, loadScripts } from './scripts.ts'

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
  console.error('flightcycle:', msg, detail ?? '')
}
const log = (line: string): void => console.log('flightcycle:', line)

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = onClick
  return b
}

async function main(): Promise<void> {
  const sessionParam = params.get('session')
  if (sessionParam) {
    await begin({ sessionId: sessionParam })
    return
  }
  // ?practice skips the choice; ?pedal=60 also holds the pedal there, harness hidden (screenshots, tests)
  if (params.has('practice')) {
    await fly(null)
    const pedal = Number(params.get('pedal'))
    if (params.has('pedal') && Number.isFinite(pedal)) {
      window.setPedalInput?.(pedal)
      document.getElementById('pedal-wrap')?.style.setProperty('display', 'none')
    }
    return
  }
  // Opened directly: a debug session with a trainer (or the bridge's simulated one), or practice with the
  // keyboard, which records nothing.
  bootMsg.textContent = 'No session in the URL. Fly a debug session with your trainer, or practise with the keyboard:'
  const adHoc: StartSessionAdHoc = { gameId: GAME_ID, variant: 'bike', debug: true, options: {} }
  bootActions.replaceChildren(
    button('Debug session', () => void begin(adHoc)),
    button('Practise (↑ ↓ keys)', () => void fly(null)),
  )
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
  log(`session ${start.sessionId} · ${start.variant} · ${start.deviceType} · ${start.unitSystem}${start.debug ? ' · debug' : ''}`)
  await fly(new Platform(start, log))
}

async function fly(platform: Platform | null): Promise<void> {
  if (!window.BABYLON) {
    fail('The 3D engine did not load.', 'Babylon.js comes from cdn.babylonjs.com; this screen needs internet access for it.')
    return
  }
  say('Building the island…')
  try {
    await loadScripts(GAME_SCRIPTS.map((p) => `${import.meta.env.BASE_URL}${p}`))
  } catch (e) {
    fail('The game files did not load.', String(e))
    return
  }
  const game = window.FlightCycle
  if (!game) { fail('The game did not initialise.'); return }
  // the island builds synchronously in boot(); give the browser one frame to paint the message
  await new Promise((r) => requestAnimationFrame(r))
  let handle
  try {
    handle = game.boot(platform)
  } catch (e) {
    fail('The island could not be built.', e instanceof Error ? (e.stack ?? e.message) : String(e))
    return
  }
  platform?.attach(handle)
  bootEl.hidden = true
}

void main()
