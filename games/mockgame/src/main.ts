/**
 * Entry point: read the launch URL (PLAN.md §7.2), start the session, wire the game to the UI.
 */
import './style.css'
import * as api from './api.ts'
import { GAME_ID, Game, ROUTE_NAME, type Variant } from './game.ts'
import { GameUi, showAdHocStart, showError, showLoginRequired } from './ui.ts'

const rootEl = document.querySelector<HTMLDivElement>('#app')
if (!rootEl) throw new Error('#app not found')
const root: HTMLElement = rootEl

const params = new URLSearchParams(location.search)
const sessionParam = params.get('session')
const variantParam = params.get('variant')
const seedParam = params.get('seed')
const debugParam = params.get('debug')

async function boot(): Promise<void> {
  if (sessionParam) {
    // Launched by the bridge: everything else comes back in the start payload.
    await begin({ sessionId: sessionParam, route: ROUTE_NAME })
  } else {
    // Developer opened the game directly.
    showAdHocStart(root, (variant) => {
      const body: api.StartSessionAdHoc = { gameId: GAME_ID, variant, debug: true, route: ROUTE_NAME }
      if (seedParam && /^\d+$/.test(seedParam)) body.seed = Number(seedParam) >>> 0
      void begin(body)
    })
  }
}

async function begin(body: api.StartSessionBySession | api.StartSessionAdHoc): Promise<void> {
  let start: api.StartPayload
  try {
    start = await api.startSession(body)
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) {
      showLoginRequired(root, `${location.pathname}${location.search}`)
      return
    }
    showError(root, e instanceof api.ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e))
    return
  }

  let ui: GameUi | null = null
  const game = new Game(start, {
    onState: (s) => ui?.updateState(s),
    onModel: (m) => ui?.updateModel(m),
    onLog: (line) => ui?.log(line),
    onEnded: (info) => ui?.showEnded(info),
    onImage: () => ui?.sessionImage() ?? null,
  })
  ui = new GameUi(root, start, game)

  const variant: Variant = start.deviceType === 'bike' ? 'bike' : 'treadmill'
  if (variantParam && variantParam !== start.variant) ui.log(`URL variant "${variantParam}" differs from the session's "${start.variant}"; using the session's`)
  if (seedParam && Number(seedParam) !== start.seed) ui.log(`URL seed ${seedParam} differs from the session's ${start.seed}; using the session's`)
  if (debugParam !== null && (debugParam === '1') !== start.debug) ui.log(`URL debug=${debugParam} differs from the session's debug=${start.debug}`)
  ui.log(`variant ${variant}, route "${ROUTE_NAME}", previous laps ${game.model.previousLaps}`)
  game.run()
}

void boot()
