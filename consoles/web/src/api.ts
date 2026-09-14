// Thin fetch wrapper for the console API. All paths are absolute (/api/...).

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const unauthorizedListeners = new Set<() => void>()

/** Register a callback fired whenever any API call returns 401. */
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

export async function api<T = unknown>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (method !== 'GET') {
    // Every mutating route requires application/json (CSRF rule), even with an empty body.
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body ?? {})
  }
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (e) {
    throw new ApiError(0, 'network', (e as Error).message || 'network error')
  }
  if (res.status === 401) {
    for (const fn of unauthorizedListeners) fn()
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText ?? 'request failed')
  }
  return data as T
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}
