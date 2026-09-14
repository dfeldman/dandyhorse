// Thin fetch wrapper. Absolute paths, same-origin cookies, JSON in/out.

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', signal: opts.signal, credentials: 'same-origin', headers: {} }
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch(path, init)
  let data: unknown = null
  const text = await res.text()
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `${res.status} ${res.statusText}`)
  }
  return data as T
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
