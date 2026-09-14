/** The pause menu (Esc or B in a town or on the road; the clock stops while it is open) and the end-of-session farewell. */
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { Room } from './room.ts'
import { listNames } from './throne.ts'

export class MenuMode implements Mode {
  readonly kind = 'menu' as const
  /** Opened because the session's planned time is up: End session comes first. */
  readonly timeUp: boolean
  private engine: Engine

  constructor(engine: Engine, timeUp = false) {
    this.engine = engine
    this.timeUp = timeUp
  }

  choices(): ChoiceSpec {
    const end: ChoiceOption = { id: 'end', label: '🏁 End session', hint: 'See how you did, save, and exit' }
    if (this.timeUp) {
      return { title: "⏱ Time's up", options: [end, { id: 'resume', label: '▶ Keep going', hint: 'Carry on; end whenever you like' }], backId: 'resume' }
    }
    return {
      title: '⏸ Paused',
      options: [{ id: 'resume', label: '▶ Resume', hint: 'Back to your adventure' }, end],
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

/** What this session (this page load) amounted to, for the farewell and the platform's session picture. */
export function sessionDeeds(engine: Engine): { minutes: string; energy: number; deeds: string[] } {
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
  return { minutes: duration(t.playSeconds - was.playSeconds), energy: Math.round(t.energyEarned - was.energyEarned), deeds }
}

/** How this session went; then save and hand back to the console, or keep playing. No time passes here. */
export class FarewellMode extends Room {
  readonly kind = 'farewell' as const
  private saved = false

  constructor(engine: Engine) {
    super(engine)
    const { minutes, energy, deeds } = sessionDeeds(engine)
    this.say(null, `Well ridden! You pedaled for ${minutes} and earned ${energy.toLocaleString()} Energy.`)
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
