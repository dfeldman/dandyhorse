/** Short notices that fade by themselves: found an item, a stat rose, a hint noted. */
export class Toasts {
  private root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
  }

  push(text: string): void {
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = text
    this.root.append(el)
    while (this.root.children.length > 4) this.root.firstElementChild?.remove()
    setTimeout(() => el.remove(), 4300)
  }
}
