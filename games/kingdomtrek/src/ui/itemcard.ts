import type { ItemDef } from '../content/types.ts'
import { TYPE_INFO, effectText } from '../engine/text.ts'

/** The parchment card describing one item. */
export function itemCard(item: ItemDef, extra: string[] = []): HTMLElement {
  const el = document.createElement('div')
  el.className = 'card'
  el.innerHTML = `
    <div class="card-head"><div class="card-emoji"></div><div><div class="card-name"></div><div class="card-type"></div></div></div>
    <div class="card-effect"></div><div class="card-desc"></div><div class="card-meta"></div>`
  const q = (c: string): HTMLElement => el.querySelector<HTMLElement>(c)!
  q('.card-emoji').textContent = item.emoji
  q('.card-name').textContent = item.name
  q('.card-type').textContent = TYPE_INFO[item.type].name + (item.tags?.includes('treasure') ? ' · treasure' : '')
  const effect = effectText(item)
  q('.card-effect').textContent = effect
  q('.card-effect').hidden = !effect
  q('.card-desc').textContent = item.description
  const meta = [`⚖️ ${item.weight}`, ...extra].map((m) => `<span>${escapeHtml(m)}</span>`)
  if (item.value) meta.unshift(`<span><i class="coin"></i> ${item.value}</span>`)
  q('.card-meta').innerHTML = meta.join('')
  return el
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
