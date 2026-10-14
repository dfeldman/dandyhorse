/**
 * Drawing the other people on the road. One avatar-kit body each, wearing a different preset, placed from the
 * companion simulation in sim/companions.ts.
 *
 * Bodies are not cheap — each one is built from MakeHuman's meshes off the main thread — so there are a few of
 * them and they are recycled rather than created and destroyed. Someone coming the other way is drawn against
 * the route's own direction: the pose is handed over with its heading, grade and curvature reversed, which is
 * the whole of what "riding the other way down the same road" means.
 */
import type { Scene } from '@babylonjs/core'
import { randomSpec } from '@dandyhorse/avatarkit'
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'
import type { Companions } from '../sim/companions.ts'
import type { Frame } from './frame.ts'
import { Rider } from './rider.ts'

/** Something to tell them apart by, from across a valley. */
const JERSEYS = ['#2d6cb5', '#e0a21c', '#3f9e6a', '#b5432d', '#7b5ea8', '#20808d']

export class CompanionRiders {
  private readonly riders: Rider[] = []
  private readonly sim: Companions
  private readonly route: Route

  constructor(scene: Scene, frame: Frame, route: Route, sim: Companions) {
    this.sim = sim
    this.route = route
    sim.all.forEach((c, i) => {
      this.riders.push(
        Rider.create(scene, frame, {
          /**
           * A made-up person each, not a preset.
           *
           * The kit ships ten named presets and this used to take them in order, which had two consequences
           * on the road: with more bodies than presets two identical people were out at once, and because a
           * body is expensive and these are recycled rather than rebuilt, the same handful of faces came past
           * again and again for the whole ride. `randomSpec` draws a fresh one from a seed, so every stranger
           * is somebody different and the seed keeps them that way between sessions.
           */
          spec: randomSpec(0x5bd1 + i * 7919 + (c.mode === 'bike' ? 0 : 104729)),
          bikeColour: JERSEYS[i % JERSEYS.length],
          // their own right, in their own frame — see the note on setLane in `update` below
          offset: c.offset,
          mode: c.mode === 'bike' ? 'bike' : 'foot',
        }),
      )
    })
  }

  meshes(): ReturnType<Rider['meshes']> {
    return this.riders.flatMap((r) => r.meshes())
  }

  update(dt: number): void {
    this.sim.all.forEach((c, i) => {
      const rider = this.riders[i]
      if (!rider) return
      const pose = this.route.poseAt(c.s)
      // against the route: the same place on the road, facing the other way, and the hill reversed with them
      const facing = c.direction > 0
        ? pose
        : { ...pose, hx: -pose.hx, hz: -pose.hz, grade: -pose.grade, curvature: -pose.curvature }
      /**
       * A recycled stranger is a different stranger.
       *
       * They are moved round to the other end of the field rather than rebuilt, so without this the same few
       * people pass again and again for a whole ride and the eye learns them. Re-dressing costs nothing —
       * `reskin` keeps the body and changes only its colours — and the seed is the metre they reappeared at, so
       * it is still the same world every session rather than random noise.
       */
      if (c.recycled) {
        const fresh = randomSpec(Math.round(c.s) * 2654435761 + i * 7919) as {
          clothes?: Array<{ color?: string }>
          hair?: { color?: string }
          skin?: { color?: string }
        }
        rider.reskin({
          clothes: (fresh.clothes ?? []).map((g) => g.color).filter((c2): c2 is string => !!c2),
          hair: fresh.hair?.color,
          skin: fresh.skin?.color,
        })
      }
      /**
       * The lane is handed over in the COMPANION's frame, not the route's — and getting this wrong is what
       * put strangers through the rider.
       *
       * `Rider.update` takes the heading it is given and puts the body `offset` metres to the right of it. For
       * somebody coming the other way that heading is already reversed, so their right is the route's left and
       * the number to hand over is simply their own offset. Multiplying by `direction` first negates it a
       * second time, which lands them back on the route's right — the same side as the player.
       *
       * The result was a road where the simulation and the picture disagreed about which side everyone was on.
       * The avoidance worked perfectly, in a mirror: the sim saw an oncoming rider safely over on the left, and
       * the screen showed them coming head-on down the right, straight through the player, who was never in the
       * lane the sim was steering them out of.
       */
      rider.setLane(c.offset)
      const grade = pose.grade * c.direction
      const working = c.mode !== 'bike' ? c.speed > 0.2 : c.speed > 0.5 && grade > -0.045
      rider.update(facing, c.speed, grade, working, c.crank, this.route.surfaceAt(c.s), c.recycled ? 0 : dt)
    })
  }

  dispose(): void {
    for (const r of this.riders) r.dispose()
  }
}

/** Who is out on this route today, and how many. */
export function companionPlan(route: Route): { count: number; modes: Array<'bike' | 'run' | 'walk'>; againstShare: number } {
  // Number(null) is 0, so the absence of ?others= has to be checked before the number is
  const asked = new URLSearchParams(location.search).get('others')
  const count = asked !== null && Number.isFinite(Number(asked)) && Number(asked) >= 0 ? Number(asked) : Config.companions
  return route.manifest.kind === 'road'
    // a famous climb is cyclists, going up and coming back down
    ? { count, modes: ['bike'], againstShare: 0.3 }
    // a rail trail is a mix, and most of it is people out for the afternoon in both directions
    : { count, modes: ['bike', 'bike', 'run', 'walk'], againstShare: 0.45 }
}
