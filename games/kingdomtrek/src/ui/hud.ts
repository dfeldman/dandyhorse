/**
 * The top bar. Energy and gold are always on screen, with the workout: session time, the steady pace and the live
 * reading as a share of it. On Dandyhorse a notice line under the bar says what the player needs to know (a pause
 * from a bridge, a machine that reads nothing).
 */
import type { EffortSource } from '../effort.ts'
import { clock } from '../effort.ts'
import type { Engine } from '../engine/engine.ts'
import { TravelMode } from '../engine/modes/travel.ts'
import * as R from '../engine/rules.ts'
import type { WorkoutStatus } from '../platform.ts'

type Slot = 'level' | 'objective' | 'session' | 'target' | 'now' | 'energy' | 'energyNote' | 'gold'

export class Hud {
  private els: Record<Slot, HTMLElement>
  private energyBox: HTMLElement
  private goldBox: HTMLElement
  private notice: HTMLElement
  private last = new Map<HTMLElement, string>()
  private lastGold = -1

  constructor(root: HTMLElement, notice: HTMLElement) {
    root.innerHTML = `
      <div class="hud-crest">⚜️ Kingdom Trek</div>
      <div class="hud-level" data-k="level"></div>
      <div class="hud-objective" data-k="objective"></div>
      <div class="hud-workout">
        <span data-k="session" title="This session"></span>
        <span data-k="target" title="Your steady pace: 100%"></span>
        <span data-k="now" title="Right now, as a share of your steady pace"></span>
      </div>
      <div class="hud-stat hud-energy" title="Energy: earned by pedaling, spent on the road">
        <span class="icon">⚡</span><span data-k="energy"></span><small data-k="energyNote"></small>
      </div>
      <div class="hud-stat hud-gold" title="Gold"><span class="icon"><i class="coin"></i></span><span data-k="gold"></span></div>`
    const q = (k: Slot): HTMLElement => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!
    const slots: Slot[] = ['level', 'objective', 'session', 'target', 'now', 'energy', 'energyNote', 'gold']
    this.els = Object.fromEntries(slots.map((k) => [k, q(k)])) as Record<Slot, HTMLElement>
    this.energyBox = root.querySelector('.hud-energy')!
    this.goldBox = root.querySelector('.hud-gold')!
    this.notice = notice
  }

  private set(el: HTMLElement, text: string): void {
    if (this.last.get(el) === text) return
    el.textContent = text
    this.last.set(el, text)
  }

  /** `status` comes from the platform; standalone it is null and the clock shows play time. */
  update(e: Engine, timeScale: number, workout: EffortSource, status: WorkoutStatus | null = null): void {
    const s = e.save
    const top = e.top
    const intro = top.kind === 'title' || top.kind === 'creator' || top.kind === 'intro' || top.kind === 'victory'
    this.set(this.els.level, `Level ${s.level}`)
    this.set(this.els.objective, intro ? '' : R.objective(s, e.world))
    this.set(this.els.energy, Math.floor(s.energy).toLocaleString())
    this.set(this.els.gold, s.gold.toLocaleString())

    let note = 'banking'
    let state = ''
    if (top.kind === 'menu') note = 'paused'
    else if (top.kind === 'battle') note = 'fighting'
    else if (top.kind === 'craft' && top.spendsEffort) note = 'crafting'
    else if (top instanceof TravelMode) {
      note = top.boosting ? 'boosting' : 'empty!'
      state = top.boosting ? 'spending' : 'empty'
    }
    this.set(this.els.energyNote, note)
    this.energyBox.classList.toggle('spending', state === 'spending')
    this.energyBox.classList.toggle('empty', state === 'empty')

    if (this.lastGold >= 0 && s.gold !== this.lastGold) {
      this.goldBox.classList.add('bump')
      setTimeout(() => this.goldBox.classList.remove('bump'), 160)
    }
    this.lastGold = s.gold

    const d = workout.describe()
    // Standalone: play time, so the clock stops while paused. On Dandyhorse: the session's countdown.
    this.set(this.els.session, status?.clock ?? `⏱ ${clock(s.totals.playSeconds - e.session.totals.playSeconds)}`)
    this.set(this.els.target, `🎯 ${d.target}`)
    this.set(this.els.now, `${status?.icon ?? '🚴'} ${d.now}${timeScale !== 1 ? ` · ⏩ ${timeScale}×` : ''}`)
    const notice = status?.notice ?? ''
    this.set(this.notice, notice)
    this.notice.hidden = !notice
  }
}
