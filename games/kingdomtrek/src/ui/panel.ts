/**
 * The in-game choice list: the same options a phone would mirror. Up/Down move the highlight (wrapping),
 * Left/Right jump a page, Select picks, Back picks the list's back option. Mouse and number keys work too.
 */
import type { ChoiceList, ChoiceOption, Press } from '../engine/choice.ts'

export class ChoicePanel {
  highlighted: string | null = null
  onChoose: (id: string) => void = () => {}
  /** Card to show for the highlighted option's item. */
  cardFor: (option: ChoiceOption) => HTMLElement | null = () => null

  private titleEl: HTMLElement
  private timerEl: HTMLElement
  private listEl: HTMLUListElement
  private hintEl: HTMLElement
  private cardEl: HTMLElement
  private list: ChoiceList | null = null
  /** Last highlight per list, so coming back to the town list keeps your place. */
  private memory = new Map<string, string>()
  private countdownTotal = 0
  private cardKey = ''
  /** The player closed the item card (on a short screen it leaves the list little room); ℹ️ brings it back. */
  private cardsHidden = false

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="panel-title"></div>
      <div class="panel-timer"><i></i></div>
      <ul class="panel-list"></ul>
      <div class="panel-hint"></div>
      <div class="panel-card"></div>
      <div class="panel-foot"><span>↑ ↓ choose</span><span>⏎ select</span><span>Esc back</span></div>`
    this.titleEl = root.querySelector('.panel-title')!
    this.timerEl = root.querySelector('.panel-timer i')!
    this.listEl = root.querySelector('.panel-list')!
    this.hintEl = root.querySelector('.panel-hint')!
    this.cardEl = root.querySelector('.panel-card')!
    this.listEl.addEventListener('click', (ev) => {
      const li = (ev.target as HTMLElement).closest('li')
      if (!li?.dataset.id) return
      this.setHighlight(li.dataset.id)
      this.select()
    })
    this.listEl.addEventListener('mousemove', (ev) => {
      const li = (ev.target as HTMLElement).closest('li')
      if (li?.dataset.id && li.dataset.id !== this.highlighted) this.setHighlight(li.dataset.id)
    })
    this.cardEl.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-card]')
      if (!b) return
      this.cardsHidden = b.dataset.card === 'hide'
      this.cardKey = ''
      this.paint()
    })
  }

  private get scope(): string {
    return this.list ? `${this.list.key.split('|')[0]}|${this.list.title}` : ''
  }

  render(list: ChoiceList): void {
    if (list.key !== this.list?.key) {
      const prevScope = this.scope
      this.list = list
      const has = (id: string | null | undefined): id is string => !!id && list.options.some((o) => o.id === id)
      const remembered = this.memory.get(this.scope)
      if (this.scope !== prevScope || !has(this.highlighted)) {
        this.highlighted = has(remembered) ? remembered : (list.options.find((o) => !o.disabled) ?? list.options[0])?.id ?? null
      }
      this.titleEl.textContent = list.title
      this.listEl.innerHTML = ''
      list.options.forEach((o, i) => {
        const li = document.createElement('li')
        li.className = `opt${o.disabled ? ' disabled' : ''}`
        li.dataset.id = o.id
        const label = document.createElement('span')
        label.className = 'opt-label'
        label.textContent = o.label
        li.append(label)
        if (i < 10) {
          const key = document.createElement('span')
          key.className = 'opt-key'
          key.textContent = String((i + 1) % 10)
          li.append(key)
        }
        this.listEl.append(li)
      })
      this.countdownTotal = list.countdown ?? 0
      this.paint()
    }
    const total = Math.max(this.countdownTotal, list.countdown ?? 0)
    this.timerEl.style.width = list.countdown != null && total > 0 ? `${(100 * list.countdown) / total}%` : '0'
  }

  private setHighlight(id: string): void {
    this.highlighted = id
    this.memory.set(this.scope, id)
    this.paint()
  }

  private paint(): void {
    for (const li of this.listEl.children) {
      const on = (li as HTMLElement).dataset.id === this.highlighted
      li.classList.toggle('hl', on)
      if (on) li.scrollIntoView({ block: 'nearest' })
    }
    const opt = this.current()
    this.hintEl.textContent = opt?.hint ?? ''
    const key = `${this.list?.key}|${opt?.id}`
    if (key !== this.cardKey) {
      this.cardKey = key
      const card = opt ? this.cardFor(opt) : null
      const toggle = (what: 'hide' | 'show'): HTMLElement => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = `card-toggle ${what}`
        b.dataset.card = what
        b.textContent = what === 'hide' ? '✕' : 'ℹ️ Show details'
        b.title = what === 'hide' ? 'Hide the details' : 'Show the details'
        return b
      }
      if (!card) this.cardEl.replaceChildren()
      else if (this.cardsHidden) this.cardEl.replaceChildren(toggle('show'))
      else this.cardEl.replaceChildren(card, toggle('hide'))
    }
  }

  /** Highlight an option without choosing it (a place tapped in the town scene). False if it can't be chosen. */
  focus(id: string): boolean {
    const o = this.list?.options.find((x) => x.id === id)
    if (!o || o.disabled) return false
    this.setHighlight(id)
    return true
  }

  private current(): ChoiceOption | undefined {
    return this.list?.options.find((o) => o.id === this.highlighted)
  }

  private visibleRows(): number {
    const row = (this.listEl.firstElementChild as HTMLElement | null)?.offsetHeight ?? 40
    return Math.max(2, Math.floor(this.listEl.clientHeight / (row + 6)))
  }

  press(p: Press): void {
    const opts = this.list?.options ?? []
    if (!opts.length) return
    const i = Math.max(0, opts.findIndex((o) => o.id === this.highlighted))
    const page = this.visibleRows() - 1
    if (p === 'up') this.setHighlight(opts[(i - 1 + opts.length) % opts.length].id)
    else if (p === 'down') this.setHighlight(opts[(i + 1) % opts.length].id)
    else if (p === 'left') this.setHighlight(opts[Math.max(0, i - page)].id)
    else if (p === 'right') this.setHighlight(opts[Math.min(opts.length - 1, i + page)].id)
    else if (p === 'select') this.select()
    else if (p === 'back' && this.list?.backId) this.onChoose(this.list.backId)
  }

  /** A phone tapped this option: highlight it first (the town scene walks the hero there), then select it. */
  pick(id: string): void {
    if (!this.list?.options.some((o) => o.id === id)) return
    this.setHighlight(id)
    this.select()
  }

  /** Number keys 1–9, 0 pick directly. */
  pickIndex(n: number): void {
    const o = this.list?.options[n]
    if (!o) return
    this.setHighlight(o.id)
    this.select()
  }

  select(): void {
    const o = this.current()
    if (!o) return
    const li = [...this.listEl.children].find((x) => (x as HTMLElement).dataset.id === o.id)
    li?.classList.remove('flash', 'nope')
    void (li as HTMLElement | undefined)?.offsetWidth
    li?.classList.add(o.disabled ? 'nope' : 'flash')
    if (!o.disabled) this.onChoose(o.id)
  }
}
