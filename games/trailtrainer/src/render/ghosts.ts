/**
 * Ghost riders: other players' past sessions, on the road where they were at this point in their ride.
 *
 * Owner, 2026-10-20: *"we should be able to show the position of your competitors at the same time since
 * start as NPCs (basically ghosts)... Also since many players look alike, they should have some kind of
 * an indication that they're ghosts — probably just showing their name over their heads is fine."*
 *
 * The companions in `companions.ts` are invented: a simulation of traffic, to make the road feel used.
 * These are real people's real rides, replayed. The difference matters on screen — a companion may be
 * overtaken and forgotten, a ghost is somebody you are actually racing — so they are a separate class
 * rather than another flavour of companion, and they carry their name.
 *
 * The platform decides who they are and hands over a 1 Hz timeline each (gamekit's `loadGhosts`); all
 * this does is ask "how far had they got by now" every frame and put a body there.
 *
 * Three behaviours worth knowing:
 *
 * - **there may be none.** A quiet game, or a route nobody else has ridden. The road is simply the road.
 * - **a ghost finishes.** Their ride was as long as it was, and past that they are taken off rather than
 *   left pedalling for ever: a ghost riding past the end of its own ride is a lie about what happened.
 * - **they do not collide, steer or react.** They are a recording. Nothing they do depends on the player.
 */
import { Matrix, Vector3, type Scene } from '@babylonjs/core'
import { normalizeSpec, randomSpec } from 'avatarkit'
import { ghostLabel, type Ghost, type GhostLabel } from '@dandyhorse/gamekit'
import { Config } from '../config.ts'
import type { Frame } from './frame.ts'
import type { Route } from '../route/route.ts'
import { Rider } from './rider.ts'

/** Jersey colours, so two ghosts are not the same shape in the same shirt. */
const JERSEYS = ['#e5484d', '#2f7ae5', '#f5a524', '#30a46c', '#8e4ec6', '#0c8599']

/** Metres right of the centre line. Ghosts ride wide of the player's lane, not through it. */
const LANE = Config.laneOffset + 1.1
/** Where the tag floats, in metres above the root (the feet). Clear of a head on a bike. */
const HEAD_HEIGHT = 2.0
/** Past this many metres a name tag is clutter rather than information. */
const NAME_RANGE = 220

interface Mounted {
  ghost: Ghost
  rider: Rider
  label: GhostLabel
  gone: boolean
}

export class GhostRiders {
  private readonly mounted: Mounted[] = []
  private readonly route: Route
  private readonly scene: Scene

  constructor(scene: Scene, frame: Frame, route: Route, ghosts: Ghost[], mode: 'bike' | 'foot') {
    this.scene = scene
    this.route = route
    ghosts.forEach((ghost, i) => {
      /*
       * A ghost is the person, not a stand-in.
       *
       * Owner, 2026-10-20: *"In Trail Trainer only, the ghost should be the avatar of that competitor."*
       * So the platform sends each ghost's own AvatarSpec and this builds it — which is better than the
       * name tag alone, because you recognise somebody up the road before you can read it.
       *
       * Anybody who has never made an avatar still gets a body seeded from their account number, so the
       * same person at least looks the same every time you ride against them.
       */
      const seed = (ghost.player.uid ?? i + 1) * 2654435761
      const rider = Rider.create(scene, frame, {
        spec: ghost.avatar ? normalizeSpec(ghost.avatar) : randomSpec(seed),
        bikeColour: JERSEYS[i % JERSEYS.length],
        offset: LANE + (i % 2 === 0 ? 0 : 0.9),
        mode,
      })
      console.debug(`ghost ${ghost.name}: ${ghost.avatar ? 'their own avatar' : 'a seeded body (no avatar saved)'}`)
      this.mounted.push({ ghost, rider, label: ghostLabel(ghost), gone: false })
    })
  }

  meshes(): ReturnType<Rider['meshes']> {
    return this.mounted.flatMap((m) => m.rider.meshes())
  }

  /** How many are still on the road. */
  get riding(): number {
    return this.mounted.filter((m) => !m.gone).length
  }

  /**
   * Put each ghost where they were `elapsed` seconds into their own ride.
   *
   * `elapsed` is the player's elapsed time, which is the whole idea: at four minutes you see where they
   * were at four minutes.
   */
  update(dt: number, elapsed: number): void {
    for (const m of this.mounted) {
      if (m.gone) continue
      if (m.ghost.done(elapsed)) {
        // Their ride ended. Take them off rather than leave them pedalling past their own finish.
        m.rider.dispose()
        m.label.dispose()
        m.gone = true
        continue
      }
      const sample = m.ghost.at(elapsed)
      const s = Math.max(0, Math.min(sample.distance, this.route.length))
      const pose = this.route.poseAt(s)
      // Working when they are moving: it only decides whether the body is out of the saddle.
      m.rider.update(pose, sample.speed, pose.grade, sample.speed > 0.5, 0,
                     this.route.surfaceAt(s), dt)
      this.nameTag(m)
    }
  }

  /** Float their name over their head, or hide it when there is nothing to point at. */
  private nameTag(m: Mounted): void {
    const cam = this.scene.activeCamera
    if (!cam) { m.label.hide(); return }
    const engine = this.scene.getEngine()
    const head = m.rider.root.getAbsolutePosition().add(new Vector3(0, HEAD_HEIGHT, 0))
    const p = Vector3.Project(
      head, Matrix.Identity(), this.scene.getTransformMatrix(),
      cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    )
    // Behind the camera, or far enough off that a name tag is clutter rather than information.
    if (p.z < 0 || p.z > 1 || Vector3.Distance(head, cam.position) > NAME_RANGE) {
      m.label.hide()
      return
    }
    m.label.move(p.x / engine.getHardwareScalingLevel(), p.y / engine.getHardwareScalingLevel())
  }

  dispose(): void {
    for (const m of this.mounted) {
      if (!m.gone) { m.rider.dispose(); m.label.dispose() }
    }
    this.mounted.length = 0
  }
}
