// Spatial focus navigation for the remote / arrow keys (PLAN.md §10). The picker is pure geometry so it
// can be unit-tested with rectangles; the DOM helpers around it are thin.
export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Rect { x: number; y: number; w: number; h: number }

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]'

/**
 * Index of the best candidate in direction `dir` from `from`, or -1. A candidate must lie past `from`'s
 * centre on the axis of travel; the nearest edge distance wins, with sideways offset penalised (lightly
 * when the two overlap on the cross axis, heavily when they do not) so a column stays a column.
 */
export function pickNext(from: Rect, candidates: Rect[], dir: Dir): number {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  let best = -1
  let bestScore = Infinity
  candidates.forEach((c, i) => {
    const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 }
    let primary: number
    let cross: number
    let overlap: boolean
    if (dir === 'down' || dir === 'up') {
      if (dir === 'down' ? cc.y <= fc.y + 1 : cc.y >= fc.y - 1) return
      primary = dir === 'down' ? Math.max(0, c.y - (from.y + from.h)) : Math.max(0, from.y - (c.y + c.h))
      cross = Math.abs(cc.x - fc.x)
      overlap = c.x < from.x + from.w && c.x + c.w > from.x
    } else {
      if (dir === 'right' ? cc.x <= fc.x + 1 : cc.x >= fc.x - 1) return
      primary = dir === 'right' ? Math.max(0, c.x - (from.x + from.w)) : Math.max(0, from.x - (c.x + c.w))
      cross = Math.abs(cc.y - fc.y)
      overlap = c.y < from.y + from.h && c.y + c.h > from.y
    }
    const score = primary + cross * (overlap ? 0.5 : 3)
    if (score < bestScore) { bestScore = score; best = i }
  })
  return best
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

function visible(el: Element): boolean {
  if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return false
  if ((el as HTMLButtonElement).disabled) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}

/** The element that scopes navigation: the topmost open dialog layer, else the given fallback. */
export function currentLayer(fallback: Element = document.body): Element {
  const layers = document.querySelectorAll('[data-focus-layer]')
  return layers.length ? layers[layers.length - 1]! : fallback
}

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
}

/** Move focus in `dir` within `root`. With nothing focused inside `root`, focus the first candidate. Returns the new element. */
export function moveFocus(dir: Dir, root: Element): HTMLElement | null {
  const items = focusables(root)
  if (items.length === 0) return null
  const active = document.activeElement as HTMLElement | null
  const cur = active && root.contains(active) && items.includes(active) ? active : null
  let next: HTMLElement | null = null
  if (!cur) {
    next = items[0]!
  } else {
    const others = items.filter((e) => e !== cur)
    const i = pickNext(rectOf(cur), others.map(rectOf), dir)
    next = i >= 0 ? others[i]! : null
  }
  if (next) {
    next.focus({ preventScroll: true })
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return next
}

export function focusFirst(root: Element): HTMLElement | null {
  const first = focusables(root)[0] ?? null
  if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'nearest' }) }
  return first
}

/**
 * When a dialog layer appears while the remote is in use, move the cursor into it; when the top layer goes
 * away, put the cursor back on the first control of what is left. Returns a stop function.
 */
export function watchLayers(fallback: () => Element): () => void {
  let last: Element | null = null
  const check = () => {
    if (!document.body.dataset.remote) return
    const layer = currentLayer(fallback())
    if (layer === last) return
    last = layer
    const active = document.activeElement
    if (!active || !layer.contains(active)) focusFirst(layer)
  }
  const mo = new MutationObserver(check)
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}
