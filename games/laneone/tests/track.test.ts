import { describe, expect, it } from 'vitest'
import { KERB_RADIUS, LANE_WIDTH, lapLength, laneRadius, pointAt, samples, STRAIGHT } from '../src/track.ts'

describe('a standard 400 m track', () => {
  it('is 400.00 m in lane 1 and 407.04 m in lane 2', () => {
    expect(lapLength(1)).toBeCloseTo(400, 2)
    expect(lapLength(2)).toBeCloseTo(407.04, 2)
  })

  it('has the World Athletics measurements', () => {
    expect(KERB_RADIUS).toBe(36.5)
    expect(STRAIGHT).toBe(84.39)
    expect(LANE_WIDTH).toBe(1.22)
    expect(laneRadius(1)).toBeCloseTo(36.8, 5) // 30 cm out from the kerb
    expect(laneRadius(8)).toBeCloseTo(36.5 + 7 * 1.22 + 0.2, 5)
  })

  it('outer lanes are longer, each by 2π × the lane width', () => {
    for (let n = 3; n <= 8; n++) {
      expect(lapLength(n) - lapLength(n - 1)).toBeCloseTo(2 * Math.PI * LANE_WIDTH, 6)
    }
  })
})

describe('pointAt', () => {
  const L = lapLength(1)

  it('starts on the finish line and comes back to it', () => {
    const a = pointAt(0)
    const b = pointAt(L)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
    expect(a.x).toBeCloseTo(STRAIGHT / 2, 6)
    expect(a.y).toBeCloseTo(-laneRadius(1), 6)
  })

  it('wraps, so lap 4 is lap 0 again', () => {
    for (const d of [17, 123.4, 399]) {
      const a = pointAt(d)
      const b = pointAt(d + 4 * L)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.y).toBeCloseTo(a.y, 6)
    }
    const back = pointAt(-10)
    expect(back.x).toBeCloseTo(pointAt(L - 10).x, 6)
  })

  it('every point is on a straight or exactly on a bend radius', () => {
    const r = laneRadius(1)
    for (const p of samples(2000)) {
      if (p.bend) {
        const cx = p.x > 0 ? STRAIGHT / 2 : -STRAIGHT / 2
        expect(Math.hypot(p.x - cx, p.y)).toBeCloseTo(r, 6)
      } else {
        expect(Math.abs(p.y)).toBeCloseTo(r, 6)
        expect(Math.abs(p.x)).toBeLessThanOrEqual(STRAIGHT / 2 + 1e-6)
      }
    }
  })

  it('runs counter-clockwise at a steady metre per metre', () => {
    const step = 0.25
    let signedArea = 0
    for (let d = 0; d < L; d += step) {
      const a = pointAt(d)
      const b = pointAt(d + step)
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(step, 3) // arc length really is arc length
      signedArea += a.x * b.y - b.x * a.y
    }
    expect(signedArea).toBeGreaterThan(0) // positive shoelace area = counter-clockwise
  })

  it('heading always points the way the runner is going', () => {
    const step = 0.5
    for (let d = 0; d < L; d += 7) {
      const a = pointAt(d)
      const b = pointAt(d + step)
      const moved = Math.atan2(b.y - a.y, b.x - a.x)
      const diff = Math.atan2(Math.sin(moved - a.heading), Math.cos(moved - a.heading))
      expect(Math.abs(diff)).toBeLessThan(0.02)
    }
  })
})
