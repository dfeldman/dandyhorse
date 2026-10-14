import { describe, expect, it } from 'vitest'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { randomSpec } from '../src/spec.ts'
import { buildBody } from '../src/geometry/body.ts'
import { ackermann, groundPose, PoseSmoother, slopePose, steerForCurvature, toWorld, wheelDrops } from '../src/pose.ts'

const { layout } = buildBody(randomSpec('sedan', 3))
const bus = buildBody(randomSpec('bus', 3)).layout

/** Where a wheel's contact patch lands in the world, through Babylon's own matrix: the test of the convention. */
function contact(p: ReturnType<typeof groundPose>, i: number, l = layout): Vector3 {
  const w = l.wheels[i]
  const m = Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(p.yaw, p.pitch, p.roll), new Vector3(p.x, p.y, p.z))
  return Vector3.TransformCoordinates(new Vector3(w.x, w.y - w.radius - p.drops[i], w.z), m)
}

describe('groundPose', () => {
  it('is level on flat ground', () => {
    const p = groundPose(layout, 3, 4, 1.2, () => 7)
    expect(p.y).toBeCloseTo(7, 9)
    expect(Math.abs(p.pitch) + Math.abs(p.roll)).toBeLessThan(1e-12)
  })

  it.each([0, 0.7, Math.PI / 2, 2.5, -2])('puts every tyre on a 20%% hill whichever way it faces (yaw %s)', (yaw) => {
    const h = (x: number, z: number): number => 0.2 * z + 0.05 * x + 3
    for (const l of [layout, bus]) {
      const p = groundPose(l, 10, -4, yaw, h)
      for (let i = 0; i < l.wheels.length; i++) {
        const c = contact(p, i, l)
        expect(Math.abs(c.y - h(c.x, c.z))).toBeLessThan(0.02 * l.wheelbase / 2.7)
      }
    }
  })

  it('climbing pitches the nose up (negative pitch), and the right side up rolls positive', () => {
    expect(groundPose(layout, 0, 0, 0, (_x, z) => 0.2 * z).pitch).toBeLessThan(-0.15)
    expect(groundPose(layout, 0, 0, 0, (x) => 0.1 * x).roll).toBeGreaterThan(0.05)
  })

  it('hands the twist to the suspension, within its travel', () => {
    const bumpX = layout.wheels[0].x, bumpZ = layout.wheels[0].z
    const p = groundPose(layout, 0, 0, 0, (x, z) => (Math.hypot(x - bumpX, z - bumpZ) < 0.1 ? 0.06 : 0))
    expect(p.drops[0]).toBeLessThan(0)          // pushed up by the bump
    expect(p.drops[3]).toBeLessThan(0)          // its diagonal partner too
    expect(p.drops[1]).toBeGreaterThan(0)       // the other two hang
    for (let i = 0; i < 4; i++) expect(Math.abs(contact(p, i).y - (i === 0 ? 0.06 : 0))).toBeLessThan(1e-3)
    const big = groundPose(layout, 0, 0, 0, (x, z) => (Math.hypot(x - bumpX, z - bumpZ) < 0.1 ? 1 : 0))
    expect(Math.max(...big.drops.map(Math.abs))).toBeLessThanOrEqual(0.08 + 1e-12)
  })

  it('slopePose agrees with groundPose on a plane', () => {
    const g = groundPose(layout, 0, 0, 0, (_x, z) => 0.15 * z)
    expect(slopePose(0, 0, 0, 0, 0.15).pitch).toBeCloseTo(g.pitch, 9)
  })

  it('toWorld turns +z forward to +x at yaw π/2', () => {
    const [x, z] = toWorld(0, 0, Math.PI / 2, 0, 1)
    expect(x).toBeCloseTo(1, 9)
    expect(z).toBeCloseTo(0, 9)
  })
})

describe('smoothing', () => {
  it('a lagging body still has its wheels on the road', () => {
    // halfway onto a 20% ramp: the body is level (smoothed), the ground is not
    const h = (_x: number, z: number): number => 0.2 * Math.max(0, z)
    const level = { x: 0, y: 0.1, z: 0, yaw: 0, pitch: 0, roll: 0 }
    const drops = wheelDrops(layout, level, h, 1)
    for (let i = 0; i < 4; i++) {
      const c = contact({ ...level, drops }, i)
      expect(Math.abs(c.y - h(c.x, c.z))).toBeLessThan(1e-6)
    }
  })

  it('settles towards the target and starts on it', () => {
    const s = new PoseSmoother(0.1)
    const a = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }
    expect(s.update(a, 1 / 60).pitch).toBe(0)
    const half = s.update({ ...a, pitch: -0.2 }, 0.1 * Math.LN2)
    expect(half.pitch).toBeCloseTo(-0.1, 6)
  })
})

describe('steering', () => {
  it('turns the inside wheel more, and both wheels share one turn centre', () => {
    for (const steer of [0.2, -0.35, 0.6]) {
      const [l, r] = ackermann(layout, steer)
      const inner = steer > 0 ? r : l, outer = steer > 0 ? l : r
      expect(Math.abs(inner)).toBeGreaterThan(Math.abs(outer))
      expect(Math.sign(l)).toBe(Math.sign(steer))
      // the front wheels' axles meet on the rear axle's line at the same point
      const xl = layout.wheels[0].x + layout.wheelbase / Math.tan(l)
      const xr = layout.wheels[1].x + layout.wheelbase / Math.tan(r)
      expect(xl).toBeCloseTo(xr, 6)
    }
    expect(ackermann(layout, 0)).toEqual([0, 0])
    expect(Math.abs(ackermann(layout, 5)[1])).toBeLessThan(1.2)
  })

  it('follows a circle with the bicycle-model angle', () => {
    expect(steerForCurvature(layout, 1 / 10)).toBeCloseTo(Math.atan(layout.wheelbase / 10), 9)
  })
})
