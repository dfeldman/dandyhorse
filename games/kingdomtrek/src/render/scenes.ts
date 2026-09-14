/**
 * Picks what to draw from the mode stack: the topmost mode that has a scene of its own. The journal, dialogs,
 * the menu and the farewell have none, so the scene beneath shows through, dimmed.
 */
import type { Engine, GameEvent } from '../engine/engine.ts'
import type { BattleMode } from '../engine/modes/battle.ts'
import type { CraftMode } from '../engine/modes/craft.ts'
import type { CreatorMode } from '../engine/modes/creator.ts'
import type { MayorMode, NpcMode } from '../engine/modes/people.ts'
import type { ShopMode } from '../engine/modes/shop.ts'
import type { GateMode, TownMode } from '../engine/modes/town.ts'
import type { TravelMode } from '../engine/modes/travel.ts'
import { BattleView } from './battle.ts'
import { CraftView } from './craft.ts'
import { RoomView } from './room.ts'
import type { Stage } from './stage.ts'
import { clamp, label } from './stage.ts'
import { TownView } from './town.ts'
import { TravelView } from './travel.ts'

export class SceneRenderer {
  private town = new TownView()
  private travel = new TravelView()
  private battle = new BattleView()
  private rooms = new RoomView()
  private craft = new CraftView()
  private t = 0
  private stage: Stage | null = null
  /** The mode whose scene the last frame drew. */
  private drawn: string | null = null

  /** The place in town under (x, y) on the canvas, when the town is what's on screen. */
  placeAt(x: number, y: number): string | null {
    return this.drawn === 'town' ? this.town.placeAt(x, y) : null
  }

  /** The hero stands at the door of `id` in town. */
  arrivedAt(id: string): boolean {
    return this.drawn === 'town' && this.town.arrivedAt(id)
  }

  onEvent(ev: GameEvent, e: Engine): void {
    if (ev.type === 'battle') this.battle.onEvent(ev.event)
    else if (ev.type === 'craft') this.craft.made(e.world.item(ev.item))
    else if (ev.type === 'arrive') this.town.arrive()
    else if (ev.type === 'levelUp' && this.stage) this.rooms.celebrate(this.stage)
  }

  render(stage: Stage, e: Engine, highlight: string | null, dt: number): void {
    this.stage = stage
    this.t += dt
    const c = stage.begin()
    const modes = e.modes
    let dim = 0
    this.drawn = null
    for (let i = modes.length - 1; i >= 0; i--) {
      const m = modes[i]
      const onTop = i === modes.length - 1
      if (m.kind === 'journal' || m.kind === 'dialog' || m.kind === 'menu' || m.kind === 'farewell') {
        dim = Math.max(dim, m.kind === 'journal' || m.kind === 'farewell' || m.kind === 'menu' ? 0.5 : 0.25)
        continue
      }
      switch (m.kind) {
        case 'title': this.rooms.title(stage, this.t); break
        case 'creator': this.rooms.creator(stage, m as CreatorMode, onTop ? highlight : null, this.t); break
        case 'intro': this.rooms.throne(stage, e, this.t, dt, false); break
        case 'victory': this.rooms.throne(stage, e, this.t, dt, true); break
        case 'battle': this.battle.draw(stage, e, m as BattleMode, this.t, dt); break
        case 'shop': this.rooms.shop(stage, e, m as ShopMode, onTop ? highlight : null, this.t); break
        case 'craft': this.craft.draw(stage, e, m as CraftMode, onTop ? highlight : null, this.t, dt); break
        case 'mayor': this.rooms.hall(stage, e, m as MayorMode, this.t); break
        case 'npc': this.rooms.portrait(stage, e, m as NpcMode, this.t); break
        case 'travel': this.travel.draw(stage, e, m as TravelMode, this.t, dt); break
        case 'gate': {
          const gate = m as GateMode
          const route = onTop && highlight?.startsWith('travel:') ? highlight.slice(7) : null
          this.town.draw(stage, e, gate.town, 'gate', this.t, dt, route)
          break
        }
        case 'town': this.town.draw(stage, e, (m as TownMode).town, onTop ? highlight : null, this.t, dt); break
      }
      this.drawn = m.kind
      break
    }
    if (dim) {
      c.fillStyle = `rgba(10,8,20,${dim})`
      c.fillRect(0, 0, stage.w, stage.h)
    }
    if (e.top.kind === 'menu') {
      const V = stage.view
      label(c, '⏸ Paused', V.x + V.w / 2, V.y + V.h * 0.42, { size: clamp(V.w * 0.07, 26, 72), font: 'title', color: '#ffd42a', stroke: '#2a1400', weight: 900 })
    }
  }
}
