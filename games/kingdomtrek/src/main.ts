/**
 * Boot: load the catalog and game files, restore or create the save, then run the loop:
 * input → engine.step → events → UI → scene. Checkpoints go to localStorage; window.kingdomTrek is the
 * hook the exercise platform (and developers) will use.
 */
import './ui/style.css'
import { CONFIG } from './config.ts'
import type { GameFile, GameIndex, ItemCatalog } from './content/types.ts'
import { EffortSource } from './effort.ts'
import type { EffortReading } from './effort.ts'
import { Engine } from './engine/engine.ts'
import type { GameEvent } from './engine/engine.ts'
import { JournalMode } from './engine/modes/journal.ts'
import { Room } from './engine/modes/room.ts'
import * as R from './engine/rules.ts'
import { newSave, parseSave } from './engine/save.ts'
import type { SaveState } from './engine/save.ts'
import { Input } from './input.ts'
import { SceneRenderer } from './render/scenes.ts'
import { Stage } from './render/stage.ts'
import { DialogBox } from './ui/dialog.ts'
import { Hud } from './ui/hud.ts'
import { itemCard } from './ui/itemcard.ts'
import { JournalView } from './ui/journal.ts'
import { ChoicePanel } from './ui/panel.ts'
import { Toasts } from './ui/toasts.ts'

const SAVE_KEY = 'kingdomtrek.save.v1'
const TIME_SCALES = [1, 10, 60]

const $ = (id: string): HTMLElement => document.getElementById(id)!

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

async function boot(): Promise<void> {
  const [catalog, index] = await Promise.all([getJson<ItemCatalog>('items.json'), getJson<GameIndex>('games/index.json')])
  const games = new Map<string, GameFile>()
  const loadGame = async (id: string): Promise<void> => {
    if (!games.has(id)) games.set(id, await getJson<GameFile>(`games/${id}.json`))
  }
  const save = storedSave(index) ?? newSave(index.games[0].id, Date.now() >>> 0)
  await loadGame(save.gameId)
  await loadGame(index.games[0].id)
  await loadGame(R.nextGameId({ ...save, completedGames: [...save.completedGames, save.gameId] }, index))

  const engine = new Engine({ catalog, index, game: (id) => games.get(id) }, save)
  const stage = new Stage($('scene') as HTMLCanvasElement)
  const scenes = new SceneRenderer()
  const hud = new Hud($('hud'))
  const panel = new ChoicePanel($('panel'))
  const dialog = new DialogBox($('dialog'))
  const journal = new JournalView($('journal'))
  const toasts = new Toasts($('toasts'))
  const effort = new EffortSource()
  effort.energyAtStart = save.totals.energyEarned
  const input = new Input()
  const dev = $('dev')
  let timeScale = 1

  panel.onChoose = (id) => engine.choose(id)
  panel.cardFor = (o) => {
    if (!o.itemId) return null
    const have = R.count(engine.save, o.itemId)
    return itemCard(engine.world.item(o.itemId), have ? R.haveLines(engine.save, engine.world.item(o.itemId)) : [])
  }
  // Act on the current list, never a stale one, so presses faster than frames are not lost.
  const syncPanel = (): void => panel.render(engine.choices())
  input.onPress((p) => {
    syncPanel()
    // A journal page can be longer than the screen: Left/Right scroll it (in the bag they page the item list).
    const reading = engine.top instanceof JournalMode && engine.top.view === 'pages'
    if ((p === 'left' || p === 'right') && reading) journal.scroll(p === 'right' ? 1 : -1)
    else panel.press(p)
    syncPanel()
  })

  // Set while the save is being replaced, so the unload checkpoint doesn't write the old game back.
  let frozen = false
  const store = (): void => {
    if (frozen) return
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(engine.snapshot()))
    } catch {
      // Private mode or full storage: keep playing without checkpoints.
    }
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return
    if (/^[0-9]$/.test(ev.key)) {
      syncPanel()
      panel.pickIndex((Number(ev.key) + 9) % 10)
      syncPanel()
    }
    else if (ev.key === '[') effort.nudge(-1)
    else if (ev.key === ']') effort.nudge(1)
    else if (ev.key === 'f' || ev.key === 'F') timeScale = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length]
    else if (ev.key === '`') dev.hidden = !dev.hidden
  })
  window.addEventListener('beforeunload', store)

  const onEvent = (ev: GameEvent): void => {
    if (ev.type === 'toast') toasts.push(ev.text)
    else if (ev.type === 'checkpoint') store()
    else if (ev.type === 'exit') {
      // Done for today: hand the checkpoint to the host (the exercise platform's console).
      const blob = engine.snapshot()
      api.onExit?.(blob)
      window.dispatchEvent(new CustomEvent('kingdomtrek:exit', { detail: blob }))
    } else if (ev.type === 'levelUp') {
      const next = R.nextGameId({ ...engine.save, completedGames: [...engine.save.completedGames, engine.save.gameId] }, index)
      void loadGame(next)
    }
    scenes.onEvent(ev, engine)
  }

  const api = {
    engine,
    getSave: (): SaveState => engine.snapshot(),
    loadSave: (blob: unknown): void => {
      const next = parseSave(blob)
      frozen = true
      localStorage.setItem(SAVE_KEY, JSON.stringify(next))
      location.reload()
    },
    /** Forget the saved game and start over at the title screen. */
    reset: (): void => {
      frozen = true
      localStorage.removeItem(SAVE_KEY)
      location.reload()
    },
    setEffort: (x: number | null): void => effort.set(x),
    /** The player's target from the platform (speed, power or heart rate), shown in the HUD. */
    setTarget: (target: EffortReading): void => effort.setTarget(target),
    /** Live device readings, shown in the HUD (mapping them to effort is future work). */
    feed: (reading: EffortReading): void => effort.feed(reading),
    /** Set by the host: called with the checkpoint when the player ends the session. */
    onExit: null as ((save: SaveState) => void) | null,
    setTimeScale: (x: number): void => {
      timeScale = x
    },
    /** Fast-forward the game by `seconds` at the current effort. */
    step: (seconds: number): void => engine.step(seconds, effort.value()),
    press: (p: Parameters<ChoicePanel['press']>[0]): void => panel.press(p),
  }
  ;(window as unknown as { kingdomTrek: typeof api }).kingdomTrek = api

  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))])
  $('loading').remove()

  // Game time runs on its own timer, so a slow or throttled display never slows the game down.
  let lastTick = performance.now()
  let sinceSave = 0
  setInterval(() => {
    const now = performance.now()
    const dt = Math.min(2, (now - lastTick) / 1000)
    lastTick = now
    engine.step(dt * timeScale, effort.value())
    for (const ev of engine.drain()) onEvent(ev)
    sinceSave += dt
    if (sinceSave >= CONFIG.autosaveSeconds) {
      sinceSave = 0
      store()
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
    hud.update(engine, timeScale, effort)
    if (top instanceof Room) dialog.show(top.current, top.talking)
    else dialog.show(null, false)
    if (top instanceof JournalMode) journal.render(engine, top, panel.highlighted, effort)
    else journal.hide()

    stage.measure($('hud'), $('panel'))
    scenes.render(stage, engine, panel.highlighted, dt)

    sinceDev += dt
    if (!dev.hidden && sinceDev > 0.5) {
      sinceDev = 0
      dev.textContent = `effort ${effort.value()} ([ ]) · speed ${timeScale}× (F) · mode ${engine.modes.map((m) => m.kind).join(' > ')}\n\n${JSON.stringify(engine.save, null, 1)}`
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

boot().catch((err: unknown) => {
  $('loading').textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`
  console.error(err)
})
