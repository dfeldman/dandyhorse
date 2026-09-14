/**
 * Boot: load the catalog and game files, restore or create the save, then run the loop:
 * input → engine.step → events → UI → scene.
 *
 * On Dandyhorse (?session= in the URL; INTEGRATION.md) the session comes first: the start payload carries the hero,
 * the player's steady pace and the launch options, and src/platform.ts talks to the server from then on. Without it
 * the game runs standalone: a localStorage save, and effort from the developer keys. window.kingdomTrek is the
 * developer's hook either way.
 */
import './ui/style.css'
import { ApiError } from '@dandyhorse/gamekit'
import type { EndInfo } from '@dandyhorse/gamekit'
import { CONFIG } from './config.ts'
import type { GameFile, GameIndex, ItemCatalog } from './content/types.ts'
import { EffortSource } from './effort.ts'
import type { EffortReading } from './effort.ts'
import type { Press } from './engine/choice.ts'
import { Engine } from './engine/engine.ts'
import type { GameEvent } from './engine/engine.ts'
import { JournalMode } from './engine/modes/journal.ts'
import { sessionDeeds } from './engine/modes/menu.ts'
import { Room } from './engine/modes/room.ts'
import { listNames } from './engine/modes/throne.ts'
import * as R from './engine/rules.ts'
import { newSave, parseSave } from './engine/save.ts'
import type { SaveState } from './engine/save.ts'
import { Input } from './input.ts'
import { Platform, saveFromStart } from './platform.ts'
import { SceneRenderer } from './render/scenes.ts'
import { Stage } from './render/stage.ts'
import { DialogBox } from './ui/dialog.ts'
import { Hud } from './ui/hud.ts'
import { itemCard } from './ui/itemcard.ts'
import { JournalView } from './ui/journal.ts'
import { ChoicePanel } from './ui/panel.ts'
import { sessionCardUrl } from './ui/sessioncard.ts'
import { Toasts } from './ui/toasts.ts'

const SAVE_KEY = 'kingdomtrek.save.v1'
const TIME_SCALES = [1, 10, 60]

const $ = (id: string): HTMLElement => document.getElementById(id)!

/** Why the game could not start, with a way out when there is one. */
class BootError extends Error {
  readonly href: string | null
  readonly action: string | null

  constructor(message: string, href: string | null = null, action: string | null = null) {
    super(message)
    this.href = href
    this.action = action
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

function storedSave(index: GameIndex): SaveState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const save = parseSave(raw)
    return index.games.some((g) => g.id === save.gameId) ? save : null
  } catch {
    return null
  }
}

/** On Dandyhorse: start (or, after a reload, rejoin) the session named in the URL. Null when standalone. */
async function openPlatform(): Promise<Platform | null> {
  const sessionId = new URLSearchParams(location.search).get('session')
  if (!sessionId) return null
  $('loading').textContent = 'Starting your session…'
  try {
    return await Platform.open(sessionId)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      throw new BootError('You are not logged in.', `/login?uid=1&next=${next}`, 'Log in and come back')
    }
    if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
      throw new BootError('This session is over. Start a new one from the console.')
    }
    throw err
  }
}

async function boot(): Promise<void> {
  const platform = await openPlatform()
  const [catalog, index] = await Promise.all([getJson<ItemCatalog>('items.json'), getJson<GameIndex>('games/index.json')])
  const games = new Map<string, GameFile>()
  const loadGame = async (id: string): Promise<void> => {
    if (!games.has(id)) games.set(id, await getJson<GameFile>(`games/${id}.json`))
  }
  const stored = platform ? null : storedSave(index)
  const { save, fresh } = platform
    ? saveFromStart(platform.start, index)
    : { save: stored ?? newSave(index.games[0].id, Date.now() >>> 0), fresh: !stored }
  await loadGame(save.gameId)
  await loadGame(index.games[0].id)
  await loadGame(R.nextGameId({ ...save, completedGames: [...save.completedGames, save.gameId] }, index))

  // On Dandyhorse a hero goes straight to their town or road; a new player still meets the title and the creator.
  const engine = new Engine({ catalog, index, game: (id) => games.get(id) }, save, { showTitle: !platform || fresh })
  const stage = new Stage($('scene') as HTMLCanvasElement)
  const scenes = new SceneRenderer()
  const hud = new Hud($('hud'), $('notice'))
  const panel = new ChoicePanel($('panel'))
  const dialog = new DialogBox($('dialog'))
  const journal = new JournalView($('journal'))
  const toasts = new Toasts($('toasts'))
  const effort = new EffortSource()
  effort.energyAtStart = save.totals.energyEarned
  const input = new Input()
  const dev = $('dev')
  /** Developer keys and the dev panel: standalone, and in debug sessions. */
  const devKeys = !platform || platform.debug
  let timeScale = 1
  /** The session is over: the farewell card is up and nothing takes input. */
  let over = false

  panel.onChoose = (id) => engine.choose(id)
  panel.cardFor = (o) => {
    if (!o.itemId) return null
    const have = R.count(engine.save, o.itemId)
    return itemCard(engine.world.item(o.itemId), have ? R.haveLines(engine.save, engine.world.item(o.itemId)) : [])
  }
  // Act on the current list, never a stale one, so presses faster than frames are not lost.
  const syncPanel = (): void => panel.render(engine.choices())
  /** One button, from the keyboard, a gamepad or the phone. */
  const press = (p: Press): void => {
    if (over) return
    syncPanel()
    // A journal page can be longer than the screen: Left/Right scroll it (in the bag they page the item list).
    const reading = engine.top instanceof JournalMode && engine.top.view === 'pages'
    if ((p === 'left' || p === 'right') && reading) journal.scroll(p === 'right' ? 1 : -1)
    else panel.press(p)
    syncPanel()
  }
  input.onPress(press)

  // Set while the save is being replaced, so the unload checkpoint doesn't write the old game back.
  let frozen = false
  const storeLocal = (): void => {
    if (frozen) return
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(engine.snapshot()))
    } catch {
      // Private mode or full storage: keep playing without checkpoints.
    }
  }
  /** A developer tool changed the game: on Dandyhorse the hero is no longer saved (INTEGRATION.md §6). */
  const devTool = (): void => platform?.taint()

  window.addEventListener('keydown', (ev) => {
    if (over || ev.metaKey || ev.ctrlKey || ev.altKey) return
    if (/^[0-9]$/.test(ev.key)) {
      syncPanel()
      panel.pickIndex((Number(ev.key) + 9) % 10)
      syncPanel()
    } else if (!devKeys) return
    else if (ev.key === '[' || ev.key === ']') {
      effort.nudge(ev.key === ']' ? 1 : -1)
      devTool()
    } else if (ev.key === 'f' || ev.key === 'F') {
      timeScale = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length]
      devTool()
    } else if (ev.key === '`') dev.hidden = !dev.hidden
  })
  if (platform) window.addEventListener('pagehide', () => platform.beacon())
  else window.addEventListener('beforeunload', storeLocal)

  const onEvent = (ev: GameEvent): void => {
    if (ev.type === 'toast') toasts.push(ev.text)
    else if (ev.type === 'checkpoint' && !platform) storeLocal()
    else if (ev.type === 'exit' && !platform) {
      // Standalone: hand the checkpoint to whoever hosts the page.
      const blob = engine.snapshot()
      api.onExit?.(blob)
      window.dispatchEvent(new CustomEvent('kingdomtrek:exit', { detail: blob }))
    } else if (ev.type === 'levelUp') {
      const next = R.nextGameId({ ...engine.save, completedGames: [...engine.save.completedGames, engine.save.gameId] }, index)
      void loadGame(next)
    }
    platform?.onEvent(ev)
    scenes.onEvent(ev, engine)
  }

  /** The farewell card, once the session is over (from here or from anywhere else). */
  const showEnded = (info: EndInfo): void => {
    over = true
    const { minutes, energy, deeds } = sessionDeeds(engine)
    const card = document.createElement('div')
    card.className = 'ended-card'
    const add = (tag: 'h2' | 'p', text: string, muted = false): void => {
      const el = document.createElement(tag)
      el.textContent = text
      if (muted) el.className = 'muted'
      card.append(el)
    }
    add('h2', info.status === 'complete' ? '🏁 Session over' : '🏁 Session ended')
    add('p', `You played for ${minutes} and earned ${energy.toLocaleString()} Energy.`)
    if (deeds.length) add('p', `Today you ${listNames(deeds)}.`)
    add('p', platform?.tainted
      ? 'Developer tools were used, so this session did not save your hero.'
      : `Your adventure is saved. Next time: ${R.objective(engine.save, engine.world)}.`, true)
    add('p', 'Start your next ride from the console.', true)
    $('ended').replaceChildren(card)
    $('ended').hidden = false
    $('panel').hidden = true
    dialog.show(null, false)
  }

  /** Developer tools only standalone: on Dandyhorse the hero lives on the server. */
  const standaloneOnly = (what: string): boolean => {
    if (!platform) return true
    console.warn(`kingdomTrek.${what}() works only when the game runs standalone (no ?session=)`)
    return false
  }
  const api = {
    engine,
    platform,
    getSave: (): SaveState => engine.snapshot(),
    loadSave: (blob: unknown): void => {
      if (!standaloneOnly('loadSave')) return
      const next = parseSave(blob)
      frozen = true
      localStorage.setItem(SAVE_KEY, JSON.stringify(next))
      location.reload()
    },
    /** Forget the saved game and start over at the title screen. */
    reset: (): void => {
      if (!standaloneOnly('reset')) return
      frozen = true
      localStorage.removeItem(SAVE_KEY)
      location.reload()
    },
    setEffort: (x: number | null): void => {
      effort.set(x)
      devTool()
    },
    /** The steady pace to measure against: {power} W, {speed, incline} (m/s, %) on a treadmill, or {heartRate}. */
    setTarget: (target: EffortReading): void => {
      effort.setTarget(target)
      devTool()
    },
    /** Live readings in SI units, about once a second: effort then comes from them. */
    feed: (reading: EffortReading): void => {
      effort.feed(reading)
      devTool()
    },
    /** Set by a standalone host: called with the checkpoint when the player ends the session. */
    onExit: null as ((save: SaveState) => void) | null,
    setTimeScale: (x: number): void => {
      timeScale = x
      devTool()
    },
    /** Fast-forward the game by `seconds` at the current effort. */
    step: (seconds: number): void => {
      engine.step(seconds, effort.value())
      devTool()
    },
    press,
  }
  ;(window as unknown as { kingdomTrek: typeof api }).kingdomTrek = api

  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))])
  $('loading').remove()

  platform?.attach({
    engine,
    effort,
    press,
    pick: (id) => {
      if (over) return
      syncPanel()
      panel.pick(id)
      syncPanel()
    },
    highlighted: () => panel.highlighted,
    toast: (text) => toasts.push(text),
    ended: showEnded,
    sessionImage: () => sessionCardUrl(engine),
    log: (line) => console.log('kingdomtrek:', line),
  })

  // Game time runs on its own timer, so a slow or throttled display never slows the game down.
  let lastTick = performance.now()
  let sinceSave = 0
  setInterval(() => {
    const now = performance.now()
    // Standalone, a stall (a laptop waking up) is skipped. On Dandyhorse the game keeps up with the workout even when
    // the browser slows a hidden tab's timers to one a minute, so a gap of up to 65 s is caught up.
    const dt = Math.min(platform ? 65 : 2, (now - lastTick) / 1000)
    lastTick = now
    // On Dandyhorse game time stops while the session is paused or over; the menus keep working.
    if (!platform?.frozen()) engine.step(dt * timeScale, effort.value())
    for (const ev of engine.drain()) onEvent(ev)
    if (platform) {
      // The platform reads the highlight, so keep the panel on the current list even when no frames are drawn.
      syncPanel()
      platform.update(dt)
    } else if ((sinceSave += dt) >= CONFIG.autosaveSeconds) {
      sinceSave = 0
      storeLocal()
    }
  }, 100)

  let last = performance.now()
  let sinceDev = 0
  const frame = (now: number): void => {
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    input.poll(dt)

    const top = engine.top
    syncPanel()
    hud.update(engine, timeScale, effort, platform?.status() ?? null)
    if (top instanceof Room && !over) dialog.show(top.current, top.talking)
    else dialog.show(null, false)
    if (top instanceof JournalMode) journal.render(engine, top, panel.highlighted, effort)
    else journal.hide()

    stage.measure($('hud'), $('panel'))
    scenes.render(stage, engine, panel.highlighted, dt)

    sinceDev += dt
    if (!dev.hidden && sinceDev > 0.5) {
      sinceDev = 0
      const r = effort.readout()
      const src = r ? ` from ${r.source}${r.note ? ` (${r.note})` : ''}` : ''
      const session = platform ? ` · session ${platform.start.sessionId}${platform.tainted ? ' (not saving)' : ''}` : ''
      dev.textContent = `effort ${effort.value().toFixed(2)}${src} ([ ]) · speed ${timeScale}× (F) · mode ${engine.modes.map((m) => m.kind).join(' > ')}${session}\n\n${JSON.stringify(engine.save, null, 1)}`
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

boot().catch((err: unknown) => {
  const box = $('loading')
  if (err instanceof BootError) {
    const div = document.createElement('div')
    div.className = 'boot-msg'
    div.textContent = err.message
    if (err.href) {
      const a = document.createElement('a')
      a.href = err.href
      a.textContent = err.action ?? 'Continue'
      div.append(document.createElement('br'), a)
    }
    box.replaceChildren(div)
  } else box.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`
  console.error(err)
})
