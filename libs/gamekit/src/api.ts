/**
 * Typed wrappers for every `/gameapi/*` endpoint (PLAN.md §6). Paths are absolute because games are served
 * same-origin by the API server and the auth cookie rides along. Errors throw `ApiError`.
 */
import type {
  GameState, Json, SessionStatus, SessionSummary, SetStateBody, SetStateResponse, StartPayload,
  StartSessionAdHoc, StartSessionBySession, TimelineRow, UnitSystem,
} from './types.ts'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export type Fetch = typeof fetch

let fetchImpl: Fetch = (...args) => fetch(...args)
/** Tests or non-browser hosts can swap the transport. */
export function setFetch(f: Fetch): void { fetchImpl = f }

export async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal: signal ?? null }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetchImpl(path, init)
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `${method} ${path} failed with ${res.status}`)
  }
  return data as T
}

export const query = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((kv): kv is [string, string | number] => kv[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

/** `POST /gameapi/startsession` — either form. Flips the session to `active` (idempotent while running). */
export const startSession = (body: StartSessionBySession | StartSessionAdHoc) =>
  request<StartPayload>('POST', '/gameapi/startsession', body)

/** `GET /gameapi/getstate` — long-polls up to `wait` seconds (max 2) for `seq` to pass `since`. */
export const getState = (sessionId: string, since = -1, wait = 0, signal?: AbortSignal) =>
  request<GameState>('GET', `/gameapi/getstate?${query({ session: sessionId, since, wait })}`, undefined, signal)

/** `POST /gameapi/setstate` — the game's ~1 Hz push. Accepted while paused; 409 pending, 410 ended. */
export const setState = (body: SetStateBody) => request<SetStateResponse>('POST', '/gameapi/setstate', body)

/** `POST /gameapi/answerinput` — the game's own on-screen buttons answer a prompt. */
export const answerInput = (sessionId: string, promptId: string, choice: string) =>
  request<{ accepted: boolean }>('POST', '/gameapi/answerinput', { sessionId, promptId, choice })

/** `POST /gameapi/endsession` — idempotent; returns the session summary. */
export const endSession = (sessionId: string, status: 'complete' | 'discarded', reason?: string) =>
  request<SessionSummary>('POST', '/gameapi/endsession', { sessionId, status, reason })

/** `PUT /gameapi/sessions/<id>/image` — the picture History shows (PNG/JPEG data URL, ≤ 1 MB). PLAN.md §6.7. */
export const putSessionImage = (sessionId: string, dataUrl: string) =>
  request<{ ok: boolean; imageUrl: string; bytes: number }>('PUT', `/gameapi/sessions/${encodeURIComponent(sessionId)}/image`, { image: dataUrl })

/** `GET /gameapi/preferences?game=` — per-game preferences, shared across variants. */
export const getPreferences = (game: string) =>
  request<{ game: string; preferences: Json }>('GET', `/gameapi/preferences?${query({ game })}`)

/** `PUT /gameapi/putpreferences` — full replace (≤ 64 KB). */
export const putPreferences = (game: string, preferences: Json) =>
  request<{ game: string; preferences: Json }>('PUT', '/gameapi/putpreferences', { game, preferences })

/** `GET /gameapi/getsave?game=&variant=` — save state keyed by game + variant. */
export const getSave = (game: string, variant: string) =>
  request<{ game: string; variant: string; saveState: Json | null }>('GET', `/gameapi/getsave?${query({ game, variant })}`)

/** `PUT /gameapi/putsave` — full replace (≤ 256 KB). */
export const putSave = (game: string, variant: string, saveState: Json | null) =>
  request<{ game: string; variant: string; saveState: Json | null }>('PUT', '/gameapi/putsave', { game, variant, saveState })

/** `GET /gameapi/me` */
export const me = () =>
  request<{ uid: number; username: string; unitSystem: UnitSystem; timeZone: string; achievements: Json; preferences: Json }>('GET', '/gameapi/me')

/** `GET /gameapi/sessions?...` — session summaries for history and ghost selection. */
export const listSessions = (params: { game?: string; variant?: string; route?: string; status?: SessionStatus; scope?: 'me' | 'public'; limit?: number; before?: string } = {}) =>
  request<{ sessions: SessionSummary[] }>('GET', `/gameapi/sessions?${query(params)}`)

/** `GET /gameapi/sessions/<id>/timeline` — derived 1 Hz timeline (ghost source). */
export const sessionTimeline = (sessionId: string) =>
  request<{ sessionId: string; timeline: TimelineRow[] }>('GET', `/gameapi/sessions/${encodeURIComponent(sessionId)}/timeline`)

/** `GET /gameapi/sessions/<id>/log` — raw JSONL records (own sessions only). */
export const sessionLog = (sessionId: string) =>
  request<{ sessionId: string; records: Json[] }>('GET', `/gameapi/sessions/${encodeURIComponent(sessionId)}/log`)
