/**
 * A picture-in-picture view at the top of the screen, for the two things the chase camera can't show:
 *   mirror  while a rival is on your tail in oil range: looking back over your car, so you can time the drop
 *   replay  for a moment after your oil spins a rival: a close-up of the spin
 */
import { UniversalCamera, Vector3, Viewport, type Camera, type Scene } from '@babylonjs/core'
import type { Race } from '../sim/race.ts'
import type { CarView } from './carView.ts'

const REPLAY_TIME = 2.8

export class PipView {
  private readonly cam: UniversalCamera
  private readonly frame: HTMLDivElement
  private readonly label: HTMLDivElement
  private replay: { id: string; name: string; t: number } | null = null
  private visible = false
  private readonly pos = new Vector3()
  private readonly look = new Vector3()
  private orbit = 0
  private lastMode: string | null = null

  private readonly scene: Scene
  private readonly main: Camera

  constructor(scene: Scene, main: Camera) {
    this.scene = scene
    this.main = main
    this.cam = new UniversalCamera('pip', new Vector3(0, 5, 0), scene)
    this.cam.minZ = 0.3
    this.cam.maxZ = 3000
    this.cam.fov = 0.8
    this.cam.inputs.clear()
    this.frame = document.getElementById('pip') as HTMLDivElement
    this.label = document.getElementById('pip-label') as HTMLDivElement
    this.layout()
    window.addEventListener('resize', () => this.layout())
  }

  /** Viewport in fractions of the canvas; the DOM frame sits on top of it. */
  private layout(): void {
    const W = window.innerWidth, H = window.innerHeight
    const w = Math.min(0.34 * W, 420), h = w * 0.56
    // centred under the timer; on narrow screens below the race board instead of over it
    const x = (W - w) / 2, top = W < 1100 ? 210 : Math.max(96, H * 0.12)
    this.cam.viewport = new Viewport(x / W, 1 - (top + h) / H, w / W, h / H)
    Object.assign(this.frame.style, { left: `${x - 4}px`, top: `${top - 4}px`, width: `${w}px`, height: `${h}px` })
  }

  spun(id: string, name: string): void {
    this.replay = { id, name, t: REPLAY_TIME }
    this.orbit = 0
  }

  clear(): void {
    this.replay = null
    this.show(false)
  }

  private show(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    this.frame.classList.toggle('on', on)
    this.scene.activeCameras = on ? [this.main, this.cam] : [this.main]
    if (!on) this.scene.activeCamera = this.main
  }

  update(dt: number, race: Race, views: Map<string, CarView>, player: CarView): void {
    if (this.replay) {
      this.replay.t -= dt
      if (this.replay.t <= 0) this.replay = null
    }
    const target = race.phase === 'racing' ? race.oilTarget() : null
    const mode = this.replay ? 'replay' : target && race.player.oil > 0 ? 'mirror' : null
    this.show(mode !== null)
    if (!mode) { this.lastMode = null; return }
    let pos: Vector3, look: Vector3
    if (mode === 'replay') {
      const v = views.get(this.replay!.id)
      if (!v) { this.replay = null; return }
      this.orbit += dt * 0.8
      const side = 4.5 * Math.sin(this.orbit + 0.6)
      pos = v.pos.add(v.fwd.scale(8)).add(v.right.scale(side)).add(v.up.scale(2.6))
      look = v.pos.add(v.up.scale(0.6))
      this.label.textContent = `💫 ${this.replay!.name} spun out!`
      this.frame.classList.add('replay')
    } else {
      const p = player
      pos = p.pos.add(p.fwd.scale(0.6)).add(p.up.scale(3.3))
      look = p.pos.subtract(p.fwd.scale(28)).add(p.up.scale(0.2))
      this.label.textContent = `REAR VIEW · ${target!.name} ${Math.round(race.player.dist - target!.dist)} m`
      this.frame.classList.remove('replay')
    }
    const k = 1 - Math.exp(-dt * 12)
    if (mode !== this.lastMode) { this.pos.copyFrom(pos); this.look.copyFrom(look) }
    this.lastMode = mode
    Vector3.LerpToRef(this.pos, pos, k, this.pos)
    Vector3.LerpToRef(this.look, look, k, this.look)
    this.cam.position.copyFrom(this.pos)
    this.cam.setTarget(this.look)
  }
}
