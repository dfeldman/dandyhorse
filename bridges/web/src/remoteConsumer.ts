// The big-screen bridge (a launching bridge showing its Ready / setup screen) is driven by the user's other
// bridges' d-pads over /api/remote, exactly like the console: focus moves spatially, Select clicks, Back
// closes a [data-focus-layer] via its [data-back]. Own presses are ignored (a phone never drives itself), and
// nothing happens while the game iframe has the screen: the game gets its input through prompts instead.
import { currentLayer, moveFocus, watchLayers } from './focus'
import { startRemote, type Press } from './remote'
import { store } from './bridge'

let stop: (() => void) | null = null
let stopLayers: (() => void) | null = null

function root(): Element { return document.querySelector('main') ?? document.body }

export function handlePress(p: Press): void {
  if (store.hosting && !store.expanded) return
  const layer = currentLayer(root())
  const active = document.activeElement as HTMLElement | null
  const inLayer = !!active && layer.contains(active)
  if (p === 'select') {
    if (inLayer && active) active.click(); else moveFocus('down', layer)
    return
  }
  if (p === 'back') {
    // a dialog's close control, else back to wherever this page came from (usually the console)
    const back = layer.querySelector<HTMLElement>('[data-back]')
    if (back) back.click(); else if (window.history.length > 1) window.history.back()
    return
  }
  moveFocus(p, layer)
}

/** Start consuming the remote stream on a launching bridge; idempotent. */
export function startRemoteConsumer(): void {
  if (stop) return
  stop = startRemote({ onPress: handlePress, ignoreBridgeId: () => store.bridgeId })
  stopLayers = watchLayers(root)
}

export function stopRemoteConsumer(): void {
  stop?.()
  stop = null
  stopLayers?.()
  stopLayers = null
}
