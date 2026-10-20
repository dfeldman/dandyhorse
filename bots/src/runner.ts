/**
 * One bot, one session (PLAN.md §18.8).
 *
 * The bot plays the real game in headless Chromium — the same build a person loads — while this process
 * pedals for it through the bridge API. So the distance, the hills, the crashes and the deliveries are all
 * the game's own doing, not a made-up number. When the session ends it is moved into the past.
 *
 * The slot is chosen *before* the ride, because how strong the rider was depends on how long ago it was.
 */
import { chromium, type Browser } from 'playwright'
import { Platform, type BotDef } from './api.ts'
import { Legs, cadenceFor, makeRng, speedFor } from './sim.ts'
import type { Slot } from './schedule.ts'

export interface RunOptions {
  /** Where to put the session in the past; omitted means leave it where it is (now). */
  slot?: Slot
  /** `gameId` or `gameId:variant`; one of the bot's own games by default. */
  game?: string
  /** Report progress. */
  log?: (line: string) => void
  /** Pedal this many times a second. */
  hz?: number
  /** Give up on a session that will not end. */
  maxSeconds?: number
  browser?: Browser
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * How long past its planned end a game gets to finish by itself before the runner ends the session.
 * Generous on purpose: a game with a city to build (Cycle Dash) can take a minute to put the rider on the
 * street in a headless browser, and it counts its own session from there.
 */
const GRACE = 90

export interface RunResult {
  sessionId: string
  status: string
  distance: number | null
  duration: number | null
  startedAt: string | null
  game: string
}

/** Play one session as `def`, then move it to `slot`. */
export async function runSession(dh: Platform, def: BotDef, opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? (() => {})
  const hz = opts.hz ?? 1
  const slot = opts.slot
  const seconds = slot?.seconds ?? def.schedule.sessionMinutes * 60
  const rng = makeRng(Math.round((slot?.start ?? Date.now()) / 1000) ^ def.username.length)
  const legs = new Legs(def.fitness, slot?.monthsAgo ?? 0, Math.round(rng() * 2 ** 31))

  await dh.become(def.username)
  const pick = opts.game ?? def.games[Math.floor(rng() * def.games.length)]
  const [gameId, wanted] = pick.split(':')
  const catalog = await dh.games()
  const game = catalog.games.find((g) => g.id === gameId)
  if (!game) throw new Error(`${def.username}: this server has no game called ${gameId}`)
  const variant = game.variants.find((v) => (wanted ? v.id === wanted : v.deviceTypes.includes(def.exercise)))
  if (!variant) throw new Error(`${def.username}: ${gameId} has no ${def.exercise} variant`)

  // Any session still open from a crashed run would be superseded by the launch anyway; be explicit.
  const open = (await dh.current()).session
  if (open && open.status !== 'complete') await dh.endSession(open.sessionId, 'discarded').catch(() => {})

  const launched = await dh.launch(gameId, variant.id, def.exercise, seconds)
  const sid = launched.sessionId
  log(`${def.username}: ${gameId}/${variant.id} for ${Math.round(seconds / 60)} min → ${sid}`)

  const browser = opts.browser ?? await chromium.launch()
  const context = await browser.newContext({
    // The game is served from the platform, so the bot's login rides along as the cookie every player has.
    baseURL: dh.base,
    // A fixed window, so a game that sizes its world to the viewport is consistent between bots.
    viewport: { width: 1280, height: 720 },
  })
  await context.addCookies([{ name: 'dh_token', value: dh.loginToken, url: dh.base }])
  const page = await context.newPage()
  page.on('pageerror', (e) => log(`  page error: ${e.message}`))

  const bridgeId = `bot-${def.username}`
  let pedalling = true
  const started = Date.now()
  // Pedal from before the page loads: a game that starts fast must not see a dead trainer.
  const pedal = (async () => {
    while (pedalling) {
      const t = (Date.now() - started) / 1000
      const watts = legs.power(t)
      try {
        // Power, cadence and the wheel speed a trainer would read: a game that computes its own virtual
        // speed ignores the last of those, and one that does not needs it to go anywhere at all.
        await dh.bridge(bridgeId, {
          power: Math.round(watts),
          cadence: cadenceFor(watts, rng),
          speed: speedFor(watts),
        }, def.exercise)
      } catch (e) {
        log(`  bridge: ${(e as Error).message}`)
      }
      await sleep(1000 / hz)
    }
  })()

  let entry = (await dh.current()).session?.gameEntryUrl ?? `${game.entryUrl}?session=${sid}`
  // Cycle Dash is not served from the platform: its page frames the game from its own site (the shim in
  // games/citydash/index.html). A bot in a fresh browser has no remembered choice, so it would always get
  // the production deploy; CITYDASH_ORIGIN points it at a development build instead.
  const cityOrigin = process.env.CITYDASH_ORIGIN
  if (cityOrigin && gameId === 'citydash') {
    entry += `${entry.includes('?') ? '&' : '?'}citydash=${encodeURIComponent(cityOrigin)}`
  }
  await page.goto(entry, { waitUntil: 'domcontentloaded' }).catch((e) => log(`  goto: ${String(e)}`))

  // Wait for the game to end the session itself. Most do when their clock runs out; the ones that only end
  // from a menu are ended here once their time is up, exactly as a bridge's ■ End would.
  const limit = opts.maxSeconds ?? seconds + 120
  let status = 'active'
  let asked = false
  while ((Date.now() - started) / 1000 < limit) {
    await sleep(3000)
    const s = await dh.session(sid).catch(() => null)
    if (s && (s.status === 'complete' || s.status === 'discarded')) { status = s.status; break }
    if (!asked && (Date.now() - started) / 1000 > seconds + GRACE) {
      // Most games end themselves when their clock runs out; the ones that only end from a menu are ended
      // here, exactly as a bridge's ■ End would. Asked once — the game gets a moment to finish tidily.
      asked = true
      log(`  ${def.username}: time is up and the game has not ended — ending it`)
      await dh.endSession(sid, 'complete').catch((e) => log(`  end: ${(e as Error).message}`))
    }
  }
  pedalling = false
  await pedal
  await page.close().catch(() => {})
  await context.close().catch(() => {})
  if (!opts.browser) await browser.close().catch(() => {})

  const final = await dh.session(sid)
  let sessionId = sid
  let startedAt: string | null = null
  if (slot) {
    const moved = await dh.backdate(sid, slot.start)
    sessionId = moved.sessionId
    startedAt = moved.startedAt
    log(`  moved to ${startedAt}`)
  }
  log(`  ${final.status}: ${Math.round(final.distance ?? 0)} m in ${Math.round(final.duration ?? 0)} s`)
  return { sessionId, status: final.status ?? status, distance: final.distance,
           duration: final.duration, startedAt, game: `${gameId}/${variant.id}` }
}
