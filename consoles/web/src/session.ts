// Auth bootstrap and shared reactive state (me, current session).
import { reactive } from 'vue'
import { api, onUnauthorized } from './api'
import type { CurrentResponse, Me, UnitSystem } from './types'

interface Store {
  me: Me | null
  needsLogin: boolean
  loginError: string | null
  current: CurrentResponse | null
  /** Date.now() when `current` was last loaded (the elapsed display ticks from it) */
  currentAt: number
  modalDismissed: boolean
  booted: boolean
}

export const store = reactive<Store>({
  me: null,
  needsLogin: false,
  loginError: null,
  current: null,
  currentAt: 0,
  modalDismissed: false,
  booted: false,
})

onUnauthorized(() => {
  store.needsLogin = true
})

export function unitSystem(): UnitSystem {
  return store.me?.unitSystem ?? 'metric'
}

export function timeZone(): string {
  return store.me?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Find `?uid=N` in the search string or inside the hash query; returns the uid and strips it from the URL. */
export function extractUid(loc: { search: string; hash: string; pathname: string }): { uid: number | null; search: string; hash: string } {
  let uid: number | null = null
  const sp = new URLSearchParams(loc.search)
  if (sp.has('uid')) {
    const n = Number(sp.get('uid'))
    if (Number.isInteger(n) && n > 0) uid = n
    sp.delete('uid')
  }
  let hash = loc.hash
  const qi = hash.indexOf('?')
  if (qi >= 0) {
    const hp = new URLSearchParams(hash.slice(qi + 1))
    if (hp.has('uid')) {
      const n = Number(hp.get('uid'))
      if (uid === null && Number.isInteger(n) && n > 0) uid = n
      hp.delete('uid')
    }
    const rest = hp.toString()
    hash = hash.slice(0, qi) + (rest ? `?${rest}` : '')
  }
  const search = sp.toString()
  return { uid, search: search ? `?${search}` : '', hash }
}

export async function login(uid: number): Promise<void> {
  store.loginError = null
  try {
    await api('/api/login', 'POST', { uid })
    store.needsLogin = false
    await loadMe()
    await loadCurrent()
  } catch (e) {
    store.loginError = (e as Error).message
    throw e
  }
}

export async function logout(): Promise<void> {
  try {
    await api('/api/logout', 'POST')
  } finally {
    store.me = null
    store.current = null
    store.needsLogin = true
  }
}

export async function loadMe(): Promise<Me | null> {
  store.me = await api<Me>('/api/me')
  return store.me
}

export async function loadCurrent(): Promise<CurrentResponse | null> {
  store.current = await api<CurrentResponse>('/api/sessions/current')
  store.currentAt = Date.now()
  return store.current
}

/** Poll /api/sessions/current every `ms` (the top-bar indicator is the single poller). Returns a stop function. */
export function pollCurrent(ms = 4000): () => void {
  let stopped = false
  let timer: number | undefined
  const tick = async () => {
    if (stopped) return
    if (!store.needsLogin && document.visibilityState !== 'hidden') {
      try { await loadCurrent() } catch { /* next tick retries; 401 flips needsLogin via the listener */ }
    }
    if (!stopped) timer = window.setTimeout(tick, ms)
  }
  timer = window.setTimeout(tick, ms)
  return () => { stopped = true; window.clearTimeout(timer) }
}

/** Called once on app start: handle ?uid=, load me and current session. */
export async function bootstrap(): Promise<void> {
  const { uid, search, hash } = extractUid(window.location)
  if (uid !== null) {
    const url = window.location.pathname + search + hash
    window.history.replaceState(null, '', url)
    try {
      await api('/api/login', 'POST', { uid })
    } catch (e) {
      store.loginError = (e as Error).message
    }
  }
  try {
    await loadMe()
    await loadCurrent()
  } catch {
    // 401 handled by the listener; other errors leave me null and the views will show what they can.
  }
  store.booted = true
}
