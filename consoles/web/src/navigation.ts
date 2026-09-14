// What a press does in the console: move focus, activate, or go back. Dialogs mark their root with
// data-focus-layer (navigation stays inside) and their close control with data-back.
import type { Router } from 'vue-router'
import { currentLayer, focusFirst, moveFocus } from './focus'
import type { Press } from './remote'

/** The focus root is the whole app container (tab bar included) so Up from the content reaches the tabs. */
function mainRoot(): Element {
  return document.querySelector('.app') ?? document.body
}

/**
 * Up from the first row of content lands on the active tab (spatial nav alone would pick whichever tab-bar
 * control is horizontally nearest). Returns true when it handled the press.
 */
function upToActiveTab(root: Element): boolean {
  const main = root.querySelector('main')
  const active = document.activeElement as HTMLElement | null
  if (!main || !active || !main.contains(active)) return false
  const next = moveFocus('up', root)
  if (next && main.contains(next)) return true
  const tab = root.querySelector<HTMLElement>('.tabs .router-link-active') ?? next
  if (tab) { tab.focus({ preventScroll: true }); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  return true
}

function stepNumber(el: HTMLInputElement, dir: 1 | -1): void {
  if (dir > 0) el.stepUp(); else el.stepDown()
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function stepSelect(el: HTMLSelectElement, dir: 1 | -1): void {
  const i = el.selectedIndex + dir
  if (i < 0 || i >= el.options.length) return
  el.selectedIndex = i
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function handlePress(p: Press, router: Router): void {
  const layer = currentLayer(mainRoot())
  const active = document.activeElement as HTMLElement | null
  const tag = active?.tagName.toLowerCase() ?? ''
  const inLayer = !!active && layer.contains(active)

  // Nothing focused yet (first press after load): the cursor starts on the page content, not the tab bar.
  if (!inLayer && p !== 'back') {
    const start = layer.hasAttribute('data-focus-layer') ? layer : (layer.querySelector('main') ?? layer)
    if (focusFirst(start) || focusFirst(layer)) return
  }
  if (p === 'select') {
    if (!inLayer || !active) { moveFocus('down', layer); return }
    if (tag === 'select' || (tag === 'input' && (active as HTMLInputElement).type === 'number')) { moveFocus('down', layer); return } // left/right edit these; Select moves on
    active.click()
    return
  }
  if (p === 'back') {
    const back = layer.querySelector<HTMLElement>('[data-back]')
    if (layer.hasAttribute('data-focus-layer') && back) { back.click(); return }
    if (window.history.length > 1) router.back()
    return
  }
  // directions: native-value editing on selects and number inputs, spatial focus otherwise
  if (inLayer && tag === 'select' && (p === 'left' || p === 'right')) { stepSelect(active as HTMLSelectElement, p === 'right' ? 1 : -1); return }
  // number inputs: left/right change the value (like a select) so up/down always leave the field
  if (inLayer && tag === 'input' && (active as HTMLInputElement).type === 'number' && (p === 'left' || p === 'right')) {
    stepNumber(active as HTMLInputElement, p === 'right' ? 1 : -1)
    return
  }
  if (p === 'up' && !layer.hasAttribute('data-focus-layer') && upToActiveTab(layer)) return
  moveFocus(p, layer)
}
