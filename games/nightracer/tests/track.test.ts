import { describe, expect, it } from 'vitest'
import { Config, ROAD_HALF } from '../src/config.ts'
import { Track } from '../src/sim/track.ts'

describe('track generation', () => {
  const seeds = Array.from({ length: 16 }, (_, i) => i * 7919 + 3)

  it.each(seeds)('seed %i: a closed loop that meets the shape rules', (seed) => {
    const t = new Track(seed)
    expect(t.valid).toBe(true)
    expect(t.length).toBeGreaterThan(2000)
    expect(t.length).toBeLessThan(3600)
    // one metre per sample, including across the seam
    for (let i = 0; i < t.length; i++) {
      const j = (i + 1) % t.length
      const d = Math.hypot(t.X[j]! - t.X[i]!, t.Z[j]! - t.Z[i]!)
      expect(d).toBeGreaterThan(0.9)
      expect(d).toBeLessThan(1.1)
    }
    let maxRise = 0
    for (let i = 0; i < t.length; i++) maxRise = Math.max(maxRise, Math.abs(t.Y[(i + 1) % t.length]! - t.Y[i]!))
    expect(maxRise).toBeLessThanOrEqual(Config.MAX_GRADE + 0.005)
  })

  it('has real hills', () => {
    const reliefs = seeds.map((s) => {
      const t = new Track(s)
      return Math.max(...t.Y) - Math.min(...t.Y)
    })
    expect(Math.min(...reliefs)).toBeGreaterThan(15)
  })

  it('keeps the grid and the start line nearly level and straight', () => {
    for (const seed of seeds) {
      const t = new Track(seed)
      for (let d = -100; d <= 40; d += 10) {
        expect(Math.abs(t.poseAt(d).grade)).toBeLessThan(0.03)
        expect(Math.abs(t.curvatureAt(d))).toBeLessThan(1 / 120)
      }
    }
  })

  it('poses have an orthonormal frame with right pointing to the right of travel', () => {
    const t = new Track(11)
    for (let s = 0; s < t.length; s += 97) {
      const p = t.poseAt(s)
      expect(Math.hypot(p.tx, p.ty, p.tz)).toBeCloseTo(1, 5)
      expect(Math.hypot(p.rx, p.ry, p.rz)).toBeCloseTo(1, 5)
      expect(Math.hypot(p.ux, p.uy, p.uz)).toBeCloseTo(1, 5)
      expect(p.tx * p.rx + p.ty * p.ry + p.tz * p.rz).toBeCloseTo(0, 5)
      expect(p.uy).toBeGreaterThan(0.9)
      // right of heading (hx, hz) is (hz, -hx) in this left-handed world
      const hl = Math.hypot(p.tx, p.tz)
      expect(p.rx * (p.tz / hl) + p.rz * (-p.tx / hl)).toBeGreaterThan(0.9)
      // banking lowers the inside of a bend
      if (Math.abs(p.k) > 0.012) expect(Math.sign(-p.ry)).toBe(Math.sign(p.k))
    }
  })

  it('pulls the ground under the road', () => {
    const t = new Track(5)
    for (let s = 0; s < t.length; s += 50) {
      const p = t.poseAt(s)
      for (const lat of [-ROAD_HALF, 0, ROAD_HALF]) {
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat
        const roadY = p.y + p.ry * lat
        expect(t.heightAt(x, z)).toBeLessThan(roadY + 0.05)
      }
    }
  })

  it('is the same track for the same seed', () => {
    const a = new Track(77), b = new Track(77)
    expect(a.length).toBe(b.length)
    expect(Array.from(a.Y.slice(0, 50))).toEqual(Array.from(b.Y.slice(0, 50)))
  })
})
