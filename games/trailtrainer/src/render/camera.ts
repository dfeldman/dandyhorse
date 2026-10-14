/**
 * The chase camera: behind and a little to one side, looking up the road. It lags the rider on purpose, so a
 * hairpin swings the view through the bend rather than snapping to it, and it widens a touch with speed.
 *
 * Everything here is in scene metres — the floating origin has already been applied to whatever it is given.
 */
import { FreeCamera, type Scene, Vector3 } from '@babylonjs/core'
import { Config } from '../config.ts'

export class Chase {
  readonly camera: FreeCamera
  private readonly want = new Vector3()
  private readonly look = new Vector3()
  private started = false
  /** the heading the camera is using, which lags the road's own through a bend */
  private hx = 0
  private hz = 1
  /** seconds, for the slow drift that keeps the view from being one fixed shot for an hour */
  private clock = 0
  /** how far in the boom is currently pulled, 0 none and 1 all the way to the rider */
  private pulled = 0
  /**
   * Where the rider is looking, as radians away from straight up the road: yaw round, pitch up and down, and
   * a boom multiplier. Nothing in the ride touches these — they are for dragging the view round to see what
   * is actually being drawn, which is the only way to check the far hillside, the horizon or anything behind.
   */
  private yaw = 0
  private pitch = 0
  private zoom = 1
  /** true while the view is turned away from the road, so the drift and the auto-framing stand aside */
  get freeLooking(): boolean { return this.yaw !== 0 || this.pitch !== 0 || this.zoom !== 1 }

  /**
   * Drag to look around, wheel to pull the camera in and out, and a click of the right button or the Home key
   * to put it back. Attached to the canvas by `main.ts`.
   */
  attachLook(canvas: HTMLElement): void {
    let dragging = false
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      dragging = true
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture?.(e.pointerId) })
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return
      this.yaw += e.movementX * 0.005
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + e.movementY * 0.004))
    })
    canvas.addEventListener('wheel', (e) => {
      this.zoom = Math.max(0.25, Math.min(6, this.zoom * (1 + Math.sign(e.deltaY) * 0.12)))
      e.preventDefault()
    }, { passive: false })
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.resetLook() })
    addEventListener('keydown', (e) => { if (e.code === 'Home' || e.code === 'Digit0') this.resetLook() })
  }

  resetLook(): void { this.yaw = 0; this.pitch = 0; this.zoom = 1 }

  /**
   * Asked, in world metres, how far a line from the rider toward where the camera wants to be gets before it
   * runs into something solid. One means clear. Left unset, the camera never gives way to anything.
   */
  clearance: ((ax: number, ay: number, az: number, bx: number, by: number, bz: number, margin: number) => number) | null = null
  /** the ground under a world point, so the camera can stay above it */
  groundAt: ((x: number, z: number) => number) | null = null
  /** world metres to scene metres, since the two queries above speak world and the camera speaks scene */
  origin = { x: 0, z: 0 }

  constructor(scene: Scene) {
    this.camera = new FreeCamera('chase', new Vector3(0, 3, -6), scene)
    this.camera.fov = Config.camFov
    this.camera.minZ = 0.3
    /**
     * Far enough to see the far ring, which is the horizon.
     *
     * This was 4200 while `Config.farRadius` is 6000, so the last two kilometres of distant hillside were
     * clipped away and a mountain skyline ended in mid-air at a fixed distance from the rider. Depth
     * precision is not the usual worry it would be at this range: the rings are separated by rendering group
     * and the depth buffer is cleared between them, so nothing far is ever asked to resolve against
     * anything near.
     */
    this.camera.maxZ = Config.farRadius * 1.15
    scene.activeCamera = this.camera
  }

  /**
   * `pos` is where the rider is, `hx`/`hz` the way they face, `speed` how fast in m/s and `grade` the slope
   * under them — the camera drops a little on a climb so the road ahead stays in frame.
   */
  update(pos: Vector3, hx: number, hz: number, speed: number, grade: number, dt: number): void {
    this.clock += dt
    // The camera's own heading follows the road's rather than being it. Through a hairpin the road turns
    // seven degrees a metre; taken raw that whips the view round, and lagging it a third of a second lets the
    // bend swing through frame the way it does over a handlebar.
    const turn = this.started ? 1 - Math.exp(-dt / Config.camTurnTau) : 1
    this.hx += (hx - this.hx) * turn
    this.hz += (hz - this.hz) * turn
    const len = Math.hypot(this.hx, this.hz) || 1
    this.hx /= len
    this.hz /= len

    /**
     * A slow drift, so an hour on a road is not one fixed shot of the back of a rider's head.
     *
     * Two waves of different lengths on each of the side offset and the height, neither of them a whole
     * number multiple of the other, so the pattern does not repeat in any time anyone would notice. It is
     * deliberately small: this is meant to read as a camera operator breathing, not as a drone.
     */
    const swingSide = Math.sin(this.clock * 0.081) * 0.62 + Math.sin(this.clock * 0.213 + 1.7) * 0.24
    const swingUp = Math.sin(this.clock * 0.063 + 0.9) * 0.28 + Math.sin(this.clock * 0.147) * 0.12

    // sideways offset, so the rider reads in three-quarter view rather than as a back
    const side = Config.camSide + swingSide
    const sx = -this.hz * side
    const sz = this.hx * side
    this.want.set(
      pos.x - this.hx * Config.camBack + sx,
      pos.y + Config.camUp + swingUp + Math.max(-0.8, Math.min(1.2, grade * 6)),
      pos.z - this.hz * Config.camBack + sz,
    )

    /**
     * Free look: swing the boom round the rider and lengthen or shorten it.
     *
     * Applied to the wanted position rather than to the camera's own rotation, so everything downstream —
     * the obstacle clearance, the ground floor, the easing — keeps working on the place the camera is
     * actually going. With the view left alone this is the identity and costs nothing.
     */
    if (this.freeLooking) {
      const dx = (this.want.x - pos.x) * this.zoom
      const dz = (this.want.z - pos.z) * this.zoom
      const dy = (this.want.y - pos.y) * this.zoom
      const c = Math.cos(this.yaw)
      const sn = Math.sin(this.yaw)
      const reach = Math.hypot(dx, dz)
      this.want.set(
        pos.x + dx * c - dz * sn,
        pos.y + dy + reach * Math.sin(this.pitch),
        pos.z + dx * sn + dz * c,
      )
    }

    /**
     * Give way to anything solid between the rider and where the camera wants to be.
     *
     * The boom is shortened until it is clear, which is what every third-person camera does and is much
     * steadier than trying to slide around an obstacle. Coming back out is slow and going in is quick: a
     * camera that snaps outward the instant a trunk passes is worse than one that lingers, because the
     * lingering is only ever a slightly closer view while the snapping is a lurch.
     */
    if (this.clearance) {
      const ax = pos.x + this.origin.x
      const az = pos.z + this.origin.z
      const bx = this.want.x + this.origin.x
      const bz = this.want.z + this.origin.z
      // from about the rider's head, since the line has to be clear where the view actually runs
      const free = this.clearance(ax, pos.y + 1.4, az, bx, this.want.y, bz, Config.camClearance)
      const wanted = 1 - Math.max(0, Math.min(1, free * 0.94))
      const rate = wanted > this.pulled ? Config.camDuckIn : Config.camDuckOut
      this.pulled += (wanted - this.pulled) * (1 - Math.exp(-dt / rate))
      if (this.pulled > 0.001) {
        // pulled along the boom toward the rider, never past them
        const keep = Math.max(Config.camMinBack / Config.camBack, 1 - this.pulled)
        this.want.set(
          pos.x + (this.want.x - pos.x) * keep,
          pos.y + (this.want.y - pos.y) * keep + Config.camUp * (1 - keep) * 0.6,
          pos.z + (this.want.z - pos.z) * keep,
        )
      }
    }

    const k = this.started ? 1 - Math.exp(-dt / Config.camTau) : 1
    this.started = true
    Vector3.LerpToRef(this.camera.position, this.want, k, this.camera.position)

    // and never underground: on a road cut into a hillside the boom swings into the slope behind
    if (this.groundAt) {
      const g = this.groundAt(this.camera.position.x + this.origin.x, this.camera.position.z + this.origin.z)
      if (Number.isFinite(g)) this.camera.position.y = Math.max(this.camera.position.y, g + Config.camFloor)
    }

    // where the view points: up the road, or wherever the view has been dragged round to
    const lc = Math.cos(this.yaw)
    const ls = Math.sin(this.yaw)
    const lx = this.hx * lc - this.hz * ls
    const lz = this.hx * ls + this.hz * lc
    this.look.set(
      pos.x + lx * Config.camLookAhead,
      pos.y + Config.camLookHeight + (this.freeLooking ? -Math.sin(this.pitch) * Config.camLookAhead : grade * Config.camLookAhead * 0.6),
      pos.z + lz * Config.camLookAhead,
    )
    this.camera.setTarget(this.look)
    this.camera.fov = Config.camFov + (Config.camFovSpeed * Math.min(1, speed / 16))
  }

  /**
   * Put the camera exactly where it would settle, instead of letting it lag its way there.
   *
   * The chase camera is deliberately springy — it eases toward its wanted position and its heading trails the
   * road's through a bend — which means two frames of the same stretch of route are never framed the same
   * way. That is right for riding and useless for comparing a change to the scenery against the frame before
   * it, so the screenshot harness snaps the camera first (see tools/shots.ts).
   */
  snap(pos: Vector3, hx: number, hz: number, grade: number): void {
    this.hx = hx
    this.hz = hz
    this.started = false
    this.update(pos, hx, hz, 0, grade, 1)
  }

  /** A floating-origin shift slides the camera with everything else. */
  shift(dx: number, dz: number): void {
    this.camera.position.x -= dx
    this.camera.position.z -= dz
    this.want.x -= dx
    this.want.z -= dz
  }
}
