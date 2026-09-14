/** Title screen, the throne room at the start of an adventure, and the victory at its end. */
import { KINGDOM } from '../../config.ts'
import type { ChoiceOption, ChoiceSpec } from '../choice.ts'
import type { Engine, Mode } from '../engine.ts'
import * as R from '../rules.ts'
import { Room } from './room.ts'
import type { Speaker } from './room.ts'

export const QUEEN: Speaker = { name: KINGDOM.monarch.name, emoji: KINGDOM.monarch.emoji, avatar: KINGDOM.monarch.avatar }

export class TitleMode implements Mode {
  readonly kind = 'title' as const
  private engine: Engine
  private confirming = false

  constructor(engine: Engine) {
    this.engine = engine
  }

  /** Nothing has happened yet, not even the character creator: offer Begin only. */
  get fresh(): boolean {
    const s = this.engine.save
    return s.level === 1 && s.where.kind === 'intro' && s.visited.length === 0 && s.completedGames.length === 0 && !s.heroClass
  }

  choices(): ChoiceSpec {
    if (this.confirming) {
      return {
        title: 'Start a new adventure?',
        options: [{ id: 'yes', label: '✨ Yes, a brand-new hero' }, { id: 'no', label: '↩ No, keep my hero' }],
        backId: 'no',
      }
    }
    if (this.fresh) return { title: 'Kingdom Trek', options: [{ id: 'begin', label: '▶ Begin your adventure' }] }
    const s = this.engine.save
    return {
      title: 'Kingdom Trek',
      options: [
        { id: 'continue', label: `▶ Continue (Level ${s.level})`, hint: R.whereText(s, this.engine.world) },
        { id: 'new', label: '✨ New adventure', hint: 'Start over with a new hero' },
      ],
    }
  }

  choose(id: string): void {
    if (id === 'begin') {
      this.engine.pop()
      this.engine.openCreator()
    } else if (id === 'continue') this.engine.pop()
    else if (id === 'new') this.confirming = true
    else if (id === 'no') this.confirming = false
    else if (id === 'yes') this.engine.newGame()
  }
}

export class IntroMode extends Room {
  readonly kind = 'intro' as const

  constructor(engine: Engine) {
    super(engine)
    const s = engine.save
    if (s.level > 1) {
      this.say(QUEEN, `Welcome back, ${s.heroName}! Level ${s.level}, and stronger every day.`, `I wish I had better news. A new peril threatens ${KINGDOM.name}.`)
    }
    this.say(QUEEN, ...engine.world.game.challenge.summons)
  }

  title(): string {
    return 'The Throne Room'
  }

  menu(): ChoiceOption[] {
    const start = this.engine.world.town(this.engine.world.game.startTown)
    return [{ id: 'setout', label: `🐎 Set out for ${start.name}` }]
  }

  onMenu(id: string): void {
    if (id === 'setout') this.engine.setOut()
  }
}

export interface VictorySummary {
  level: number
  gold: number
  /** Names of the challenge's items, handed to the royal armory. */
  relics: string[]
}

export const listNames = (names: string[]): string =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

export class VictoryMode extends Room {
  readonly kind = 'victory' as const
  readonly summary: VictorySummary

  constructor(engine: Engine, summary: VictorySummary, victoryLines: string[]) {
    super(engine)
    this.summary = summary
    const s = engine.save
    this.say(null, ...victoryLines)
    this.say(
      QUEEN,
      `${s.heroName}, you have saved ${engine.world.game.region.name}! All of ${KINGDOM.name} owes you its thanks.`,
      `By my word you are now Level ${summary.level}. Every one of your skills has grown, and the treasury adds ${summary.gold} gold to your purse.`,
      ...(summary.relics.length ? [`My armorers will keep the ${listNames(summary.relics)} safe until the kingdom needs them again.`] : []),
      'Rest a little. I fear this will not be the last peril.',
    )
  }

  title(): string {
    return 'Victory!'
  }

  menu(): ChoiceOption[] {
    return [{ id: 'next', label: '👑 Begin the next adventure' }]
  }

  onMenu(id: string): void {
    if (id === 'next') this.engine.nextAdventure()
  }
}
