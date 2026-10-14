/**
 * The route picker, and the question this game exists to ask: pick up where you left off, or start again?
 *
 * Every route shows how far through it the rider is and how long they have spent on it, because on a route
 * that takes a day that is the only score that means anything. The manifests are small; they are all loaded up
 * front so the picker can show real numbers rather than promises.
 */
import type { RouteManifest } from '../route/package.ts'
import type { ProgressStore, RouteProgress } from '../sim/progress.ts'
import { clock, km } from './hud.ts'

export interface Chosen {
  routeId: string
  deviceType: 'bike' | 'treadmill'
  startAt: number
  previous: RouteProgress | null
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

export class StartScreen {
  private device: 'bike' | 'treadmill' = 'bike'

  private readonly manifests: RouteManifest[]
  private readonly progress: ProgressStore

  constructor(manifests: RouteManifest[], progress: ProgressStore) {
    this.manifests = manifests
    this.progress = progress
  }

  /** Draws the picker and settles once the rider has chosen a route and how to start it. */
  choose(initialDevice: 'bike' | 'treadmill'): Promise<Chosen> {
    this.device = initialDevice
    this.paintDevice()
    for (const b of el('deviceSeg').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        this.device = (b.dataset.device as 'bike' | 'treadmill') ?? 'bike'
        this.paintDevice()
      })
    }
    el('credit').innerHTML = this.credits()

    const list = el('routeList')
    list.textContent = ''
    return new Promise<Chosen>((resolve) => {
      for (const m of this.manifests) {
        const done = this.progress.get(m.id)
        const fraction = done ? Math.min(1, done.s / m.length) : 0
        const card = document.createElement('button')
        card.className = 'route'
        card.innerHTML = `
          <div>
            <h2>${m.name}</h2>
            <div class="where">${m.direction} · ${m.region}</div>
          </div>
          <div class="nums">${km(m.length)} · ${m.stats.gain} m up<br>${(m.stats.averageGrade * 100).toFixed(1)}% average</div>
          <p class="blurb">${m.blurb}</p>
          <div class="bar"><i style="width:${(fraction * 100).toFixed(1)}%"></i></div>
          ${done && done.s > 50 ? `<div class="resume">${done.completed ? 'Ridden end to end' : `${km(done.s)} in`} · ${clock(done.elapsed)} on this route</div>` : ''}
        `
        card.addEventListener('click', () => {
          void this.start(m, resolve)
        })
        list.appendChild(card)
      }
    })
  }

  private paintDevice(): void {
    for (const b of el('deviceSeg').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.device === this.device))
    }
  }

  /** Asks the resume question, but only when there is something to resume. */
  private async start(m: RouteManifest, resolve: (c: Chosen) => void): Promise<void> {
    const previous = this.progress.get(m.id)
    const partway = previous && previous.s > 50 && previous.s < m.length - 50
    let startAt = 0
    if (partway && previous) {
      startAt = await this.askResume(m, previous)
    }
    el('start').classList.add('off')
    resolve({ routeId: m.id, deviceType: this.device, startAt, previous })
  }

  private askResume(m: RouteManifest, previous: RouteProgress): Promise<number> {
    const box = el('choice')
    const pose = previous.s
    el('cTitle').textContent = `Pick ${m.name} up again?`
    el('cBody').textContent =
      `You stopped ${km(pose)} in, with ${km(m.length - pose)} to go — ${clock(previous.elapsed)} on this route ` +
      `across ${previous.sessions} session${previous.sessions === 1 ? '' : 's'}.`
    box.classList.add('on')
    return new Promise<number>((resolve) => {
      const done = (value: number) => {
        box.classList.remove('on')
        resolve(value)
      }
      el('cResume').onclick = () => done(pose)
      el('cRestart').onclick = () => done(0)
    })
  }

  private credits(): string {
    const lines = new Set<string>()
    for (const m of this.manifests) {
      lines.add(m.attribution.geometry)
      lines.add(m.attribution.elevation)
      lines.add(m.attribution.terrain)
    }
    return `Routes are baked from open data. ${[...lines].join(' ')} Scenery is drawn from that data, not photographed.`
  }
}
