import type { Line } from '../engine/modes/room.ts'

/** Who is speaking and what they say. The narrator gets a scroll instead of a face. */
export class DialogBox {
  private root: HTMLElement
  private portrait: HTMLElement
  private name: HTMLElement
  private text: HTMLElement
  private more: HTMLElement
  private shown: Line | null = null

  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = `<div class="dlg-portrait"></div><div class="dlg-body"><div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-more">▼ Continue</div></div>`
    this.portrait = root.querySelector('.dlg-portrait')!
    this.name = root.querySelector('.dlg-name')!
    this.text = root.querySelector('.dlg-text')!
    this.more = root.querySelector('.dlg-more')!
  }

  show(line: Line | null, more: boolean): void {
    this.root.hidden = !line
    if (!line) {
      this.shown = null
      return
    }
    this.more.hidden = !more
    if (line === this.shown) return
    this.shown = line
    this.root.classList.toggle('narrator', !line.who)
    this.portrait.textContent = line.who?.emoji ?? '📜'
    this.name.textContent = line.who?.name ?? ''
    this.name.hidden = !line.who
    this.text.textContent = line.text
    // Restart the rise animation for the new line.
    this.text.style.animation = 'none'
    void this.text.offsetWidth
    this.text.style.animation = ''
  }
}
