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
import { runSession } from './runner.ts'
import { makeRng } from './sim.ts'
import { slots } from './schedule.ts'

const log = (line: string): void => console.log(line)

export function loadBots(path = resolve(REPO, 'bots/bots.json')): BotDef[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw as { bots?: unknown }).bots
  if (!Array.isArray(list)) throw new Error(`${path} should be a list of bots, or {"bots": [...]}`)
  return list as BotDef[]
}

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help'
  const dh = new Platform()
  const bots = loadBots()
  const named = process.argv.slice(3).filter((a) => !a.startsWith('--'))
  const chosen = named.length ? bots.filter((b) => named.includes(b.username)) : bots
  if (!chosen.length) throw new Error(`no bots matched ${named.join(', ')}`)

  if (cmd === 'upsert') {
    for (const b of chosen) {
      const r = await dh.upsert(b)
      log(`${r.created ? 'made' : 'updated'} ${b.username} (uid ${r.uid})`)
    }
    return
  }

  if (cmd === 'once') {
    // `--minutes N` overrides the bot's usual length, for trying a game without waiting for a real session.
    const minutes = flag('minutes', NaN)
    for (const b of chosen) {
      await dh.upsert(b)
      const bot = Number.isFinite(minutes)
        ? { ...b, schedule: { ...b.schedule, sessionMinutes: minutes, sessionJitter: 0 } } : b
      await runSession(dh, bot, {
        log,
        game: process.argv.includes('--game') ? process.argv[process.argv.indexOf('--game') + 1] : undefined,
      })
    }
    return
  }

  if (cmd === 'backfill') {
    const weeks = flag('weeks', 12)
    const perBot = flag('max', Infinity)
    // `--minutes N` shortens every session, for checking the whole path without waiting for real rides.
    const minutes = flag('minutes', NaN)
    // One browser for the whole run: starting Chromium is the slow part, not the riding.
    const browser = await chromium.launch()
    try {
      // Oldest first, so each bot's fitness visibly improves as the history comes forward, and so a
      // streak that builds up reads correctly on the profile.
      const work: { bot: BotDef; slot: ReturnType<typeof slots>[number] }[] = []
      for (const b of chosen) {
        const rng = makeRng(b.username.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0)
        for (const slot of slots(b.schedule, weeks, rng).slice(0, perBot)) {
          work.push({ bot: b, slot: Number.isFinite(minutes) ? { ...slot, seconds: minutes * 60 } : slot })
        }
        await dh.upsert(b)
      }
      work.sort((a, z) => a.slot.start - z.slot.start)
      const totalMinutes = Math.round(work.reduce((n, w) => n + w.slot.seconds, 0) / 60)
      log(`${work.length} sessions over ${weeks} weeks for ${chosen.length} bots — about ${totalMinutes} `
        + `minutes of riding, in real time. Leave it running.`)
      let n = 0
      for (const w of work) {
        n += 1
        log(`[${n}/${work.length}] ${new Date(w.slot.start).toISOString().slice(0, 16)} ${w.bot.username}`)
        try {
          await runSession(dh, w.bot, { slot: w.slot, log, browser })
        } catch (e) {
          log(`  failed: ${(e as Error).message}`)
        }
      }
    } finally {
      await browser.close()
    }
    return
  }

  log(`usage: cli.ts upsert|once|backfill [username…] [--weeks N] [--max N] [--minutes N] [--game id[:variant]]`)
  process.exitCode = 1
}

await main()
