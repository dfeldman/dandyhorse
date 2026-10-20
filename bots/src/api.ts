/**
 * Talking to the platform as a bot (PLAN.md §18.8).
 *
 * `/botapi/*` takes the one shared bot token and gives back an ordinary login token, after which a bot uses
 * exactly the APIs a person's console and bridge use. The token comes from the repo's git-ignored `.env`
 * (`DANDYHORSE_BOT_TOKEN`) and never goes anywhere near a committed file.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '../..')

/** KEY=value from the repo's .env, for the one key we need. Never prints it. */
export function botToken(): string {
  const fromEnv = process.env.DANDYHORSE_BOT_TOKEN
  if (fromEnv) return fromEnv
  let text = ''
  try {
    text = readFileSync(resolve(REPO, '.env'), 'utf8')
  } catch {
    throw new Error('no DANDYHORSE_BOT_TOKEN, and no .env at the repo root (see .env.example)')
  }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?DANDYHORSE_BOT_TOKEN\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const v = m[1].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (v) return v
  }
  throw new Error('DANDYHORSE_BOT_TOKEN is not set in .env (see .env.example)')
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export interface BotDef {
  username: string
  displayName?: string
  firstName: string
  lastName: string
  country: string
  timeZone?: string
  bio?: string
  streakGoal?: number
  body: { height: number; weight: number; sex: string; age: number }
  exercise: 'bike' | 'treadmill'
  schedule: import('./schedule.ts').Schedule
  fitness: import('./sim.ts').FitnessModel
  /** Games this bot plays, as `gameId` or `gameId:variant`. */
  games: string[]
  profile?: { bio?: string; avatar?: Record<string, unknown> }
}

/** The platform, as one bot or as the bot runner itself. */
export class Platform {
  readonly base: string
  private readonly token: string
  private login: string | null = null

  constructor(base = process.env.DH ?? 'http://localhost:8080', token = botToken()) {
    this.base = base.replace(/\/$/, '')
    this.token = token
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = this.token): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error
      throw new ApiError(res.status, `${method} ${path}: ${err?.code ?? res.status} ${err?.message ?? text.slice(0, 160)}`)
    }
    return data as T
  }

  // --- the bot token's own endpoints ---

  /**
   * Make or update a bot from its `bots.json` entry.
   *
   * Only the fields `bots.json` actually names are sent, so an admin's edit in the console survives the next
   * upsert unless `bots.json` has an opinion about that field. A bio or an avatar pasted into the Admin page
   * stays until somebody puts one in `bots.json`.
   */
  upsert(def: BotDef): Promise<{ uid: number; created: boolean }> {
    const body: Record<string, unknown> = {
      username: def.username,
      displayName: def.displayName ?? def.firstName,
      firstName: def.firstName,
      lastName: def.lastName,
      country: def.country,
      bodyData: def.body,
      // A bot's declared fitness matches its legs, so it is matched sensibly before it has any history.
      preferences: { steadyWatts: Math.round(def.fitness.watts) },
    }
    if (def.timeZone) body.timeZone = def.timeZone
    if (def.streakGoal !== undefined) body.streakGoal = def.streakGoal
    const bio = def.profile?.bio ?? def.bio
    if (bio !== undefined) body.bio = bio
    if (def.profile?.avatar !== undefined) body.avatar = def.profile.avatar
    return this.call('POST', '/botapi/upsert', body)
  }

  backdate(sessionId: string, startedAt: number): Promise<{ sessionId: string; startedAt: string }> {
    return this.call('POST', '/botapi/backdate', { sessionId, startedAt: startedAt / 1000 })
  }

  /** Become one bot: every call after this is that bot's own. */
  async become(username: string): Promise<number> {
    const r = await this.call<{ uid: number; token: string }>('POST', '/botapi/token', { username })
    this.login = r.token
    return r.uid
  }

  // --- the ordinary APIs, as that bot ---
  private as<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.login) throw new Error('call become() first')
    return this.call<T>(method, path, body, this.login)
  }

  get loginToken(): string {
    if (!this.login) throw new Error('call become() first')
    return this.login
  }

  launch(gameId: string, variant: string, deviceType: string, duration: number): Promise<{ sessionId: string; gameEntryUrl?: string }> {
    return this.as('POST', '/api/sessions/launch', { gameId, variant, deviceType, duration, debug: false })
  }

  current(): Promise<{ session: { sessionId: string; status: string; gameEntryUrl: string } | null }> {
    return this.as('GET', '/api/sessions/current')
  }

  /** `GET /api/sessions/<id>` returns the summary itself, not wrapped. */
  session(sid: string): Promise<{ sessionId: string; status: string; distance: number | null; duration: number | null; startedAt: string | null; stats?: Record<string, unknown> }> {
    return this.as('GET', `/api/sessions/${sid}`)
  }

  endSession(sid: string, status: 'complete' | 'discarded' = 'complete'): Promise<unknown> {
    return this.as('POST', `/api/sessions/${sid}/end`, { status })
  }

  /** One bridge report: the simulated trainer this bot is pedalling. */
  bridge(bridgeId: string, actual: Record<string, number>, deviceType: 'bike' | 'treadmill'): Promise<unknown> {
    const name = deviceType === 'bike' ? 'Bot trainer' : 'Bot treadmill'
    return this.as('POST', '/bridgeapi/putstate', {
      bridgeId, label: 'bot',
      devices: [{ role: 'fitness', type: deviceType, name, address: `bot:${bridgeId}`,
                  protocol: 'ftms', status: 'connected' }],
      actual,
    })
  }

  games(): Promise<{ games: { id: string; entryUrl: string; variants: { id: string; deviceTypes: string[]; defaultDuration?: number }[] }[] }> {
    return this.as('GET', '/api/games')
  }
}
