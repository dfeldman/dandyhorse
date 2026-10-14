import { describe, expect, it } from 'vitest'
import { ARCHETYPES, LIVERIES, PRESETS, randomSpec, shapeKey } from '../src/spec.ts'
import { buildBody } from '../src/geometry/body.ts'
import { buildWheel } from '../src/geometry/wheel.ts'
import { Role, type Builder } from '../src/geometry/builder.ts'

/** Signed volume by the divergence theorem: positive only if every face is wound outward. */
function volume(b: Builder): number {
  const p = b.positions
  let v = 0
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(i, i + 9)
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return v / 6
}

function extent(b: Builder): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < b.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.positions[i + k])
      max[k] = Math.max(max[k], b.positions[i + k])
    }
  }
  return { min, max }
}

const cases = ARCHETYPES.flatMap((a) => [1, 2, 3, 4, 5].map((seed) => randomSpec(a, seed)))

describe('bodies', () => {
  it.each(cases.map((s) => [`${s.archetype} #${s.seed}`, s] as const))('%s is closed, outward and the right size', (_, spec) => {
    const { body, layout } = buildBody(spec)
    const box = spec.length * spec.width * spec.height
    const v = volume(body)
    // a body fills a good part of its bounding box and never more than all of it
    expect(v).toBeGreaterThan(box * 0.3)
    expect(v).toBeLessThan(box * 1.1)
    const { min, max } = extent(body)
    expect(max[2] - min[2]).toBeCloseTo(spec.length, 0)
    expect(Math.abs(max[2] - min[2] - spec.length)).toBeLessThan(0.2)
    expect(max[1]).toBeGreaterThan(spec.height - 0.01)
    expect(max[1]).toBeLessThan(layout.max[1] + 0.01)
    expect(min[1]).toBeGreaterThan(spec.clearance - 0.05)
    // wheels touch the road, and sit inside the body's width
    for (const w of layout.wheels) {
      expect(w.y - w.radius).toBeCloseTo(0, 6)
      // inside the body's width, fender flares included
      expect(Math.abs(w.x) + w.width / 2).toBeLessThan(spec.width / 2 + 0.045)
    }
  })

  it('every vehicle has head, tail and both indicator lamps', () => {
    for (const spec of cases) {
      const roles = new Set(buildBody(spec).body.roles)
      for (const r of [Role.HEAD, Role.TAIL, Role.IND_L, Role.IND_R, Role.REVERSE, Role.GLASS, Role.PAINT]) {
        expect(roles.has(r), `${spec.archetype} #${spec.seed} role ${r}`).toBe(true)
      }
    }
  })

  it('left indicators are on the left, right on the right', () => {
    for (const spec of cases) {
      const b = buildBody(spec).body
      for (let i = 0; i < b.roles.length; i++) {
        if (b.roles[i] === Role.IND_L) expect(b.positions[i * 3]).toBeLessThan(0)
        if (b.roles[i] === Role.IND_R) expect(b.positions[i * 3]).toBeGreaterThan(0)
      }
    }
  })

  it('liveries add their lamps', () => {
    const roles = (name: string): Set<number> => new Set(buildBody(PRESETS[name]()).body.roles)
    expect(roles('taxi').has(Role.SIGN)).toBe(true)
    expect(roles('police').has(Role.BEACON_A) && roles('police').has(Role.BEACON_B)).toBe(true)
    expect(roles('ambulance').has(Role.BEACON_A)).toBe(true)
    expect(roles('city-bus').has(Role.SIGN)).toBe(true)
    for (const l of LIVERIES) expect(volume(buildBody(randomSpec('sedan', 9, l)).body)).toBeGreaterThan(0)
  })

  it('is deterministic by seed, and seeds differ', () => {
    expect(shapeKey(randomSpec('suv', 7))).toBe(shapeKey(randomSpec('suv', 7)))
    expect(shapeKey(randomSpec('suv', 7))).not.toBe(shapeKey(randomSpec('suv', 8)))
    expect(buildBody(randomSpec('bus', 3)).body.triangles).toBe(buildBody(randomSpec('bus', 3)).body.triangles)
  })

  it('stays low-poly', () => {
    for (const spec of cases) expect(buildBody(spec).body.triangles).toBeLessThan(2500)
  })
})

describe('the wheel', () => {
  it('is closed and outward, radius 1 and width 1', () => {
    const w = buildWheel()
    expect(volume(w)).toBeGreaterThan(Math.PI * 0.8)
    const { min, max } = extent(w)
    expect(max[1]).toBeCloseTo(1, 3)
    expect(max[0] - min[0]).toBeCloseTo(1, 3)
  })
})
