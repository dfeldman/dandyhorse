/**
 * The voice that keeps a session interesting (PLAN.md §18.3).
 *
 * Exercising alone is dull, and a number in the corner is not company. This watches the session go by and
 * says something when something happens: a kilometre passed, a rival caught, a delivery made, a long lead
 * held. Games feed it what they know and show whatever comes back — `banner()` is a ready-made element that
 * animates a line in and out, or a game can draw the text itself.
 *
 *   const voice = new Encouragement({ rivalName: competitorName(rival.player) })
 *   const show = banner(document.body)
 *   // each second:
 *   const line = voice.update({ elapsed, distance, progress: { deliveries }, rival: tracker.at(elapsed) })
 *   if (line) show(line)
 *
 * Nothing here needs a competitor: on your own you still get milestones and encouragement.
 */
import type { CompetitorSample } from './competitor.ts'

export type Tone = 'good' | 'bad' | 'milestone' | 'neutral'

export interface Line {
  /** Stable per kind of event, so a game can style or ignore particular ones. */
  id: string
  text: string
  tone: Tone
  /** Session seconds when it fired. */
  at: number
}

export interface EncouragementOptions {
  /** Miles instead of kilometres. */
  imperial?: boolean
  /** Who you are riding against, if anybody. */
  rivalName?: string
  /** Nicer words than the raw keys for progress counters: `{ deliveries: 'delivery' }` (singular reads best). */
  progressWords?: Record<string, string>
  /** The session's planned length, for the halfway and home-straight lines. */
  plannedSeconds?: number | null
  /** Seconds between lines, so nothing ever stacks up (default 9). */
  cooldown?: number
  /** Say something every so often even when nothing has happened (seconds, default 150; 0 to keep quiet). */
  idleEvery?: number
  /** Deterministic choice of wording, for tests. */
  random?: () => number
}

export interface SessionMoment {
  elapsed: number
  /** Metres so far. */
  distance?: number
  /** Joules so far. */
  energy?: number
  /** Metres climbed so far. */
  elevationGain?: number
  /** The game's own counters: `{ deliveries: 4 }`. */
  progress?: Record<string, number>
  /** Where the competitor was at this moment (`tracker.at(elapsed)`). */
  rival?: CompetitorSample | null
}

const IDLE_LINES = [
  'Still going. Nice work.',
  'Settle in — this is the good part.',
  'Breathing, legs, rhythm. You have all three.',
  'That is a solid pace. Hold it.',
  'Everything after this is a bonus.',
]

const AHEAD_LINES = [
  'You are clear. Keep the pressure on.',
  'Gap is growing. Do not look back.',
  'That is how it is done.',
]

const BEHIND_LINES = [
  'Close the gap — a few watts will do it.',
  'Within reach. Lift it a little.',
  'Still in this. Keep turning.',
]

const KM = 1000
const MI = 1609.344
/** A calorie milestone every this many joules (about 200 kcal). */
const ENERGY_STEP = 200 * 4184
/** A climbing milestone every this many metres. */
const CLIMB_STEP = 250

export class Encouragement {
  private readonly o: Required<Pick<EncouragementOptions, 'cooldown' | 'idleEvery'>> & EncouragementOptions
  private last = -Infinity
  private lastIdle = 0
  private distMark = 0
  private energyMark = 0
  private climbMark = 0
  private counts: Record<string, number> = {}
  private standing: 'ahead' | 'behind' | 'level' | null = null
  private saidHalfway = false
  private saidHomeStraight = false
  private saidRivalDone = false
  private readonly rnd: () => number

  constructor(opts: EncouragementOptions = {}) {
    this.o = { cooldown: 9, idleEvery: 150, ...opts }
    this.rnd = opts.random ?? Math.random
  }

  private pick(lines: string[]): string {
    return lines[Math.min(lines.length - 1, Math.floor(this.rnd() * lines.length))]
  }

  private unit(): number { return this.o.imperial ? MI : KM }
  private unitName(n: number): string { return this.o.imperial ? `${n} mi` : `${n} km` }

  /**
   * Call about once a second. Returns a line when there is one to say, else null.
   *
   * At most one line per cooldown, with one exception: catching the rival or being caught interrupts, since
   * that is the whole point of having one. Everything else that happens during a cooldown is simply not
   * said — a kilometre post missed because you were being overtaken is a good trade.
   */
  update(m: SessionMoment): Line | null {
    const line = this.consider(m)
    if (!line) return null
    const interrupts = line.id === 'passed' || line.id === 'overtaken'
    if (!interrupts && m.elapsed - this.last < this.o.cooldown) return null
    this.last = m.elapsed
    if (line.tone === 'neutral') this.lastIdle = m.elapsed
    return line
  }

  private line(id: string, text: string, tone: Tone, at: number): Line {
    return { id, text, tone, at }
  }

  private consider(m: SessionMoment): Line | null {
    const t = m.elapsed
    const rival = m.rival
    const name = this.o.rivalName

    // 1. The rival changing hands: the most interesting thing that can happen.
    if (rival && name && m.distance != null) {
      const gap = m.distance - rival.distance
      const now = gap > 1 ? 'ahead' : gap < -1 ? 'behind' : 'level'
      if (this.standing !== null && now !== this.standing && now !== 'level') {
        this.standing = now
        return now === 'ahead'
          ? this.line('passed', `You have passed ${name}!`, 'good', t)
          : this.line('overtaken', `${name} is back in front — dig in.`, 'bad', t)
      }
      if (this.standing === null) this.standing = now
      if (!this.saidRivalDone && rival.finished) {
        this.saidRivalDone = true
        return gap > 0
          ? this.line('beat-rival', `${name} is done — and you are still going. You win this one.`, 'good', t)
          : this.line('rival-done', `${name} has finished. Ride it out your way.`, 'neutral', t)
      }
    }

    // 2. The game's own counters.
    for (const [key, value] of Object.entries(m.progress ?? {})) {
      const was = this.counts[key]
      this.counts[key] = value
      if (was !== undefined && value > was) {
        const word = this.o.progressWords?.[key] ?? key.replace(/s$/, '')
        const theirs = rival?.progress?.[key]
        if (theirs !== undefined && value > theirs) {
          return this.line(`progress-${key}-lead`,
            `${value} — that is ${value - theirs} more than ${name ?? 'your rival'}.`, 'good', t)
        }
        return this.line(`progress-${key}`, `${word.charAt(0).toUpperCase()}${word.slice(1)} ${value}. Good.`,
          'milestone', t)
      }
    }

    // 3. Distance posts, every one at first and then every five.
    if (m.distance != null) {
      const u = this.unit()
      const whole = Math.floor(m.distance / u)
      if (whole > this.distMark) {
        this.distMark = whole
        const every = whole >= 10 ? 5 : 1
        if (whole % every === 0) {
          return this.line('distance', `${this.unitName(whole)} down.`, 'milestone', t)
        }
      }
    }

    // 4. Calories and climbing.
    if (m.energy != null) {
      const step = Math.floor(m.energy / ENERGY_STEP)
      if (step > this.energyMark) {
        this.energyMark = step
        return this.line('energy', `${Math.round((step * ENERGY_STEP) / 4184)} calories burned.`, 'milestone', t)
      }
    }
    if (m.elevationGain != null) {
      const step = Math.floor(m.elevationGain / CLIMB_STEP)
      if (step > this.climbMark) {
        this.climbMark = step
        return this.line('climb', `${step * CLIMB_STEP} m of climbing. That is real hill.`, 'milestone', t)
      }
    }

    // 5. Where you are in the session.
    const planned = this.o.plannedSeconds
    if (planned && planned > 60) {
      if (!this.saidHalfway && t >= planned / 2) {
        this.saidHalfway = true
        return this.line('halfway', 'Halfway. The hard half is behind you.', 'milestone', t)
      }
      if (!this.saidHomeStraight && t >= planned * 0.9) {
        this.saidHomeStraight = true
        return this.line('home-straight', 'Last stretch — everything you have left.', 'good', t)
      }
    }

    // 6. Nothing happened, so say something anyway, now and then.
    if (this.o.idleEvery > 0 && t - this.lastIdle >= this.o.idleEvery) {
      if (rival && name && m.distance != null) {
        const gap = m.distance - rival.distance
        if (gap > 1) return this.line('idle-ahead', this.pick(AHEAD_LINES), 'neutral', t)
        if (gap < -1) return this.line('idle-behind', this.pick(BEHIND_LINES), 'neutral', t)
      }
      return this.line('idle', this.pick(IDLE_LINES), 'neutral', t)
    }
    return null
  }
}

// --- the banner --------------------------------------------------------------------------------

const CSS = `
.dh-banner { position: absolute; left: 50%; top: 10%; transform: translate(-50%, -14px); z-index: 50;
  padding: 10px 18px; border-radius: 999px; pointer-events: none; opacity: 0;
  font: 800 17px/1.2 var(--dh-banner-font, system-ui, sans-serif); letter-spacing: .01em;
  color: var(--dh-banner-fg, #0d1018); background: var(--dh-banner-bg, rgba(255,255,255,.93));
  box-shadow: 0 8px 28px rgba(0,0,0,.28); transition: opacity .22s ease, transform .22s ease; white-space: nowrap }
.dh-banner-in { opacity: 1; transform: translate(-50%, 0) }
.dh-banner-good { background: var(--dh-banner-good, #6ee7a8) }
.dh-banner-bad { background: var(--dh-banner-bad, #ff9d8a) }
.dh-banner-milestone { background: var(--dh-banner-milestone, #ffd479) }
@media (prefers-reduced-motion: reduce) { .dh-banner { transition: opacity .22s ease } }
`

let cssAdded = false

/**
 * A line that slides in near the top of the screen and fades away. Returns the function to show one:
 * `show(line)`, or `show('any text')`. Calling it again replaces whatever is up.
 */
export function banner(parent: HTMLElement, holdMs = 2600): (line: Line | string) => void {
  const doc = parent.ownerDocument
  if (!cssAdded && !doc.getElementById('dh-banner-css')) {
    const style = doc.createElement('style')
    style.id = 'dh-banner-css'
    style.textContent = CSS
    doc.head.appendChild(style)
  }
  cssAdded = true
  const el = doc.createElement('div')
  el.className = 'dh-banner'
  el.setAttribute('role', 'status')
  parent.appendChild(el)
  let timer: ReturnType<typeof setTimeout> | null = null
  return (line) => {
    const text = typeof line === 'string' ? line : line.text
    const tone = typeof line === 'string' ? 'neutral' : line.tone
    el.textContent = text
    el.className = `dh-banner dh-banner-${tone} dh-banner-in`
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { el.className = `dh-banner dh-banner-${tone}` }, holdMs)
  }
}
