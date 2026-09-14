// One normalized stream of presses for the big screen: the bridge d-pad over GET /api/remote (long-poll)
// and the physical arrow keys. Consumers decide what a press does (see navigation.ts).
export type Press = 'up' | 'down' | 'left' | 'right' | 'select' | 'back'
export type PressSource = 'remote' | 'key'
export interface RemoteEvent { n: number; button: string; bridgeId: string; t: number }
export interface RemoteResponse { n: number; events: RemoteEvent[] }

const PRESSES: Press[] = ['up', 'down', 'left', 'right', 'select', 'back']
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'password', 'tel', 'number'])

/** Map a keydown to a press, or null when the key has a native meaning on the focused element. */
export function keyToPress(key: string, target: Element | null): Press | null {
  const tag = target?.tagName.toLowerCase() ?? ''
  const type = tag === 'input' ? ((target as HTMLInputElement).type || 'text') : ''
  const textual = tag === 'textarea' || (tag === 'input' && TEXT_INPUTS.has(type))
  switch (key) {
    case 'ArrowUp': return tag === 'select' || type === 'number' || tag === 'textarea' ? null : 'up'
    case 'ArrowDown': return tag === 'select' || type === 'number' || tag === 'textarea' ? null : 'down'
    case 'ArrowLeft': return textual ? null : 'left'
    case 'ArrowRight': return textual ? null : 'right'
    case 'Enter': return textual || tag === 'select' ? null : 'select'
    case 'Escape': return 'back'
    default: return null
  }
}

/** The next `since` cursor: normally the server's `n`; a smaller `n` means the server restarted and reset its counter. */
export function nextSince(prev: number, n: number): number {
  return n < prev ? n : Math.max(prev, n)
}

export interface RemoteOptions {
  onPress: (p: Press, source: PressSource, ev?: RemoteEvent) => void
  fetchJson?: (url: string) => Promise<RemoteResponse>
  wait?: number
  /** Skip events from this bridge (a bridge consuming the stream must not react to its own d-pad). */
  ignoreBridgeId?: () => string | null
  onAuthLost?: () => void
}

async function defaultFetch(url: string): Promise<RemoteResponse> {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (r.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as RemoteResponse
}

/** Start listening. Returns a stop function. Presses buffered before start are dropped (the cursor starts at the current n). */
export function startRemote(opts: RemoteOptions): () => void {
  const fetchJson = opts.fetchJson ?? defaultFetch
  const wait = opts.wait ?? 2
  let stopped = false
  let since = -1
  let backoff = 1000

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const p = keyToPress(e.key, document.activeElement)
    if (!p) return
    e.preventDefault()
    document.body.dataset.remote = '1'
    opts.onPress(p, 'key')
  }
  window.addEventListener('keydown', onKey)

  const loop = async () => {
    while (!stopped) {
      try {
        const url = since < 0 ? '/api/remote' : `/api/remote?since=${since}&wait=${wait}`
        const r = await fetchJson(url)
        if (stopped) return
        if (since >= 0) {
          const own = opts.ignoreBridgeId?.() ?? null
          for (const ev of r.events) {
            if (own && ev.bridgeId === own) continue
            if ((PRESSES as string[]).includes(ev.button)) {
              document.body.dataset.remote = '1'
              opts.onPress(ev.button as Press, 'remote', ev)
            }
          }
        }
        since = since < 0 ? r.n : nextSince(since, r.n)
        backoff = 1000
      } catch (e) {
        if ((e as { status?: number }).status === 401) { opts.onAuthLost?.(); return }
        await new Promise((res) => setTimeout(res, backoff))
        backoff = Math.min(5000, backoff * 2)
      }
    }
  }
  void loop()
  return () => { stopped = true; window.removeEventListener('keydown', onKey) }
}
