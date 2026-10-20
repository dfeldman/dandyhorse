/**
 * The bot runner's command line (PLAN.md §18.8).
 *
 *   npm run upsert                    make or update every bot on the server
 *   npm run once -- marta             one session now, not backdated (for trying a game)
 *   npm run backfill -- --weeks 12    months of history: every bot, every slot, oldest first
 *
 * `DH` points at the server (default http://localhost:8080). The bot token comes from the repo's .env.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { Platform, REPO, type BotDef } from './api.ts'
import { CHROMIUM_ARGS, runSession } from './runner.ts'
import { makeRng } from './sim.ts'
import { slots } from './schedule.ts'
import { namedBots, numberFlag, stringFlag } from './args.ts'

const log = (line: string): void => console.log(line)

export function loadBots(path = resolve(REPO, 'bots/bots.json')): BotDef[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw as { bots?: unknown }).bots
  if (!Array.isArray(list)) throw new Error(`${path} should be a list of bots, or {"bots": [...]}`)
  return list as BotDef[]
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help'
  const dh = new Platform()
  const bots = loadBots()
  const named = namedBots(process.argv.slice(3))
  const chosen = named.length ? bots.filter((b) => named.includes(b.username)) : bots
  if (!chosen.length) throw new Error(`no bots matched ${named.join(', ')}`)

  if (cmd === 'upsert') {
    for (const b of chosen) {
      const r = await dh.upsert(b)
      log(`${r.created ? 'made' : 'updated'} ${b.username} (uid ${r.uid})`
        + (b.avatarSeed ? `, avatar from seed ${b.avatarSeed}` : ''))
    }
    log('')
    log('To give them faces and pictures: open the console as an admin and press "Give everyone a face".')
    return
  }

  if (cmd === 'once') {
    // `--minutes N` overrides the bot's usual length, for trying a game without waiting for a real session.
    const minutes = numberFlag(process.argv, 'minutes', NaN)
    for (const b of chosen) {
      await dh.upsert(b)
      const bot = Number.isFinite(minutes)
        ? { ...b, schedule: { ...b.schedule, sessionMinutes: minutes, sessionJitter: 0 } } : b
      await runSession(dh, bot, {
        log,
        game: stringFlag(process.argv, 'game'),
      })
    }
    return
  }

  if (cmd === 'backfill') {
    const weeks = numberFlag(process.argv, 'weeks', 12)
    const perBot = numberFlag(process.argv, 'max', Infinity)
    // `--minutes N` shortens every session, for checking the whole path without waiting for real rides.
    const minutes = numberFlag(process.argv, 'minutes', NaN)
    // Bots ride at the same time as each other: each is its own player with its own session and its own
    // bridge, so nothing is shared and the wall clock is divided by however many are going at once. One
    // bot still rides its own sessions in order, oldest first, so its fitness improves across its history
    // and its streak builds up the right way round. `--at-once 1` puts it back to one at a time.
    const atOnce = Math.max(1, Math.min(numberFlag(process.argv, 'at-once', chosen.length), chosen.length))
    const browser = await chromium.launch({ args: CHROMIUM_ARGS })
    try {
      const queues: { bot: BotDef; slots: ReturnType<typeof slots> }[] = []
      for (const b of chosen) {
        const rng = makeRng(b.username.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0)
        const mine = slots(b.schedule, weeks, rng).slice(0, perBot)
          .map((slot) => (Number.isFinite(minutes) ? { ...slot, seconds: minutes * 60 } : slot))
          .sort((a, z) => a.start - z.start)
        if (mine.length) queues.push({ bot: b, slots: mine })
        await dh.upsert(b)
      }
      const total = queues.reduce((n, q) => n + q.slots.length, 0)
      const rideMinutes = Math.round(
        queues.reduce((n, q) => n + q.slots.reduce((m, s) => m + s.seconds, 0), 0) / 60)
      log(`${total} sessions over ${weeks} weeks for ${queues.length} bots: about `
        + `${Math.round(rideMinutes / atOnce)} minutes with ${atOnce} riding at once `
        + `(${rideMinutes} minutes of riding in all). This runs in real time — leave it going.`)

      let done = 0
      const ride = async (q: { bot: BotDef; slots: ReturnType<typeof slots> }): Promise<void> => {
        for (const slot of q.slots) {
          done += 1
          log(`[${done}/${total}] ${new Date(slot.start).toISOString().slice(0, 16)} ${q.bot.username}`)
          try {
            await runSession(dh, q.bot, { slot, log, browser })
          } catch (e) {
            log(`  ${q.bot.username} failed: ${(e as Error).message}`)
          }
        }
      }
      // A small pool, so `--at-once` means what it says even with more bots than that.
      const pending = [...queues]
      const workers = Array.from({ length: atOnce }, async () => {
        for (;;) {
          const q = pending.shift()
          if (!q) return
          await ride(q)
        }
      })
      await Promise.all(workers)
      log(`done: ${done} sessions`)
    } finally {
      await browser.close()
    }
    return
  }

  log('usage: cli.ts upsert|once|backfill [username…]')
  log('  --weeks N     how far back a backfill goes (default 12)')
  log('  --max N       at most this many sessions per bot')
  log('  --at-once N   how many bots ride at the same time (default: all of them)')
  log('  --minutes N   override the session length, for trying things out')
  log('  --game id[:variant]   one game rather than the bot own choice')
  process.exitCode = 1
}

await main()
