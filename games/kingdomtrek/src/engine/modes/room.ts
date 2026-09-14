import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode, ModeKind } from '../engine.ts'

/** Anyone who talks. People from the game file fit as-is. */
export interface Speaker {
  name: string
  emoji: string
  avatar?: string
}

/** `who: null` is the narrator. */
export interface Line {
  who: Speaker | null
  text: string
}

/**
 * A mode where someone talks: lines are shown one at a time with Continue, then the menu appears with the
 * last line still on screen (so a one-line reply costs no extra press).
 */
export abstract class Room implements Mode {
  abstract readonly kind: ModeKind
  protected readonly engine: Engine
  lines: Line[] = []
  index = 0

  constructor(engine: Engine) {
    this.engine = engine
  }

  get current(): Line | null {
    return this.lines[this.index] ?? null
  }

  /** More lines to show before the menu. */
  get talking(): boolean {
    return this.index < this.lines.length - 1
  }

  say(who: Speaker | null, ...texts: string[]): void {
    this.lines.push(...texts.map((text) => ({ who, text })))
  }

  abstract title(): string
  abstract menu(): ChoiceOption[]
  abstract onMenu(id: string): void

  backId(): string | undefined {
    return undefined
  }

  choices(): ChoiceSpec {
    if (this.talking) {
      return { title: this.current?.who?.name ?? this.title(), options: [{ id: 'continue', label: 'Continue ▶' }], backId: 'continue' }
    }
    return { title: this.title(), options: this.menu(), backId: this.backId() }
  }

  choose(id: string): void {
    if (this.talking) {
      if (id === 'continue') this.index++
      return
    }
    // A menu pick starts a new exchange; if nothing new is said, the last line stays up.
    const keep = this.current
    this.lines = []
    this.index = 0
    this.onMenu(id)
    if (!this.lines.length && keep) this.lines = [keep]
  }
}

/** Text with Continue, or with a few final options; `then` runs after the dialog has closed. */
export class DialogMode extends Room {
  readonly kind = 'dialog' as const
  private heading: string
  private options: ChoiceOption[]
  private then: (id: string) => void

  constructor(engine: Engine, heading: string, lines: Line[], options?: ChoiceOption[], then?: (id: string) => void) {
    super(engine)
    this.heading = heading
    this.lines = [...lines]
    this.options = options ?? [{ id: 'ok', label: 'Continue ▶' }]
    this.then = then ?? (() => {})
  }

  title(): string {
    return this.heading
  }

  menu(): ChoiceOption[] {
    return this.options
  }

  backId(): string | undefined {
    return this.options.find((o) => o.id === 'no' || o.id === 'back')?.id ?? (this.options.length === 1 ? this.options[0].id : undefined)
  }

  onMenu(id: string): void {
    this.engine.pop()
    this.then(id)
  }
}
