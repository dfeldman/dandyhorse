/** The pause menu (Esc or B in a town or on the road; the clock stops while it is open) and the end-of-session farewell. */
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { Room } from './room.ts'
import { listNames } from './throne.ts'

export class MenuMode implements Mode {
  readonly kind = 'menu' as const
  private engine: Engine

  constructor(engine: Engine) {
    this.engine = engine
  }

  choices(): ChoiceSpec {
    return {
      title: '⏸ Paused',
      options: [
        { id: 'resume', label: '▶ Resume', hint: 'Back to your adventure' },
        { id: 'end', label: '🏁 End session', hint: 'See how you did, save, and exit' },
      ],
      backId: 'resume',
    }
  }

  choose(id: string): void {
    const e = this.engine
    e.pop()
    if (id === 'end') e.endSession()
  }
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`

function duration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  if (m < 60) return plural(m, 'minute', 'minutes')
  return `${plural(Math.floor(m / 60), 'hour', 'hours')}${m % 60 ? ` ${plural(m % 60, 'minute', 'minutes')}` : ''}`
}

/** How this session went; then save and hand back to the console, or keep playing. No time passes here. */
export class FarewellMode extends Room {
  readonly kind = 'farewell' as const
  private saved = false

  constructor(engine: Engine) {
    super(engine)
    const t = engine.save.totals
    const was = engine.session.totals
    const leagues = Math.round((t.distance - was.distance) / 10)
    const won = t.battlesWon - was.battlesWon
    const made = t.itemsCrafted - was.itemsCrafted
    const deeds = [
      leagues > 0 ? `walked ${plural(leagues, 'league', 'leagues')}` : '',
      won > 0 ? `won ${plural(won, 'battle', 'battles')}` : '',
      made > 0 ? `made ${plural(made, 'thing', 'things')} at the workshop` : '',
      t.kingdomsSaved > was.kingdomsSaved ? 'saved the kingdom' : '',
    ].filter(Boolean)
    const energy = Math.round(t.energyEarned - was.energyEarned)
    this.say(null, `Well ridden! You pedaled for ${duration(t.playSeconds - was.playSeconds)} and earned ${energy.toLocaleString()} Energy.`)
    if (deeds.length) this.say(null, `Today you ${listNames(deeds)}.`)
    this.say(null, `Next time: ${R.objective(engine.save, engine.world)}.`)
  }

  title(): string {
    return this.saved ? 'Saved' : 'Session over'
  }

  menu(): ChoiceOption[] {
    if (this.saved) return [{ id: 'resume', label: '▶ Keep playing' }]
    return [
      { id: 'exit', label: '👋 Save and exit', hint: 'Your adventure will wait right here' },
      { id: 'resume', label: '↩ Keep playing' },
    ]
  }

  backId(): string {
    return 'resume'
  }

  onMenu(id: string): void {
    if (id === 'resume') this.engine.pop()
    else if (id === 'exit') {
      this.saved = true
      this.engine.exitSession()
      this.say(null, 'Your adventure is saved. See you next time!')
    }
  }
}
