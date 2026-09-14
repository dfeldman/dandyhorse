import { describe, expect, test } from 'vitest'
import * as c from '../charts'
import type { Metric, TimelineRow } from '../types'

const m = (o: Partial<Metric> = {}): Metric => ({ requested: null, commanded: null, actual: null, ...o })

function row(elapsed: number, over: Partial<TimelineRow> = {}): TimelineRow {
  return {
    t: 1000 + elapsed,
    elapsed,
    position: null,
    speed: m(),
    incline: m(),
    cadence: m(),
    power: m(),
    grade: m(),
    wind: m(),
    crr: m(),
    cw: m(),
    heartRate: m(),
    distance: elapsed * 10,
    energy: null,
    work: null,
    ...over,
  }
}

const box = { w: 200, h: 100, pad: 10 }

describe('polyline', () => {
  test('empty and all-null', () => {
    expect(c.polyline([])).toBe('')
    expect(c.polyline([null, null])).toBe('')
  })
  test('single point', () => expect(c.polyline([{ x: 1, y: 2 }])).toBe('M1.0 2.0'))
  test('continuous', () => {
    expect(c.polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])).toBe('M0.0 0.0 L1.0 1.0 L2.0 0.0')
  })
  test('leading nulls and interior gap start new subpaths', () => {
    expect(c.polyline([null, { x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBe(
      'M0.0 0.0 L1.0 1.0 M2.0 2.0 L3.0 3.0',
    )
  })
  test('non-finite treated as gap', () => {
    expect(c.polyline([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 2, y: 2 }])).toBe('M0.0 0.0 M2.0 2.0')
  })
})

describe('extent, scale, ticks', () => {
  test('extent ignores nulls', () => expect(c.extent([null, 3, -1, null, 7])).toEqual({ min: -1, max: 7 }))
  test('extent all null', () => expect(c.extent([null])).toBeNull())
  test('scale maps domain to range', () => {
    const s = c.scale({ min: 0, max: 10 }, 100, 0)
    expect(s(0)).toBe(100)
    expect(s(10)).toBe(0)
    expect(s(5)).toBe(50)
  })
  test('degenerate scale maps to middle', () => expect(c.scale({ min: 5, max: 5 }, 0, 100)(5)).toBe(50))
  test('ticks nice steps', () => {
    expect(c.ticks({ min: 0, max: 100 })).toEqual([0, 20, 40, 60, 80, 100])
    expect(c.ticks({ min: 0, max: 13 })).toEqual([0, 2, 4, 6, 8, 10, 12])
    expect(c.ticks({ min: 3, max: 3 })).toEqual([3])
  })
})

describe('minimap', () => {
  test('null without positions', () => expect(c.minimap([row(0), row(1)], box)).toBeNull())
  test('equal aspect, centered, z up', () => {
    const rows = [
      row(0, { position: { x: 0, y: 0, z: 0 } }),
      row(1, { position: { x: 100, y: 0, z: 0 } }),
      row(2, { position: { x: 100, y: 0, z: 20 } }),
    ]
    const mm = c.minimap(rows, box)!
    expect(mm).not.toBeNull()
    // x spans 100 m into 180 px inner width → 1.8 px/m; z spans 20 m → 36 px (fits in 80).
    expect(mm.start).toEqual({ x: 10, y: 68 })
    expect(mm.end).toEqual({ x: 190, y: 32 })
    expect(mm.path).toBe('M10.0 68.0 L190.0 68.0 L190.0 32.0')
    expect(mm.xExtent).toEqual({ min: 0, max: 100 })
  })
  test('gaps in position break the path', () => {
    const rows = [
      row(0, { position: { x: 0, y: 0, z: 0 } }),
      row(1),
      row(2, { position: { x: 10, y: 0, z: 10 } }),
    ]
    const mm = c.minimap(rows, box)!
    expect(mm.path.split('M').length - 1).toBe(2)
    expect(mm.end).not.toBeNull()
  })
  test('single point has start but no end', () => {
    const mm = c.minimap([row(0, { position: { x: 5, y: 0, z: 5 } })], box)!
    expect(mm.start).toEqual({ x: 100, y: 50 })
    expect(mm.end).toBeNull()
  })
})

describe('series and profile', () => {
  test('series null when all y null', () => expect(c.series([0, 1], [null, null], box)).toBeNull())
  test('series maps ends of range', () => {
    const s = c.series([0, 10], [0, 100], box)!
    expect(s.path).toBe('M10.0 90.0 L190.0 10.0')
    expect(s.count).toBe(2)
  })
  test('zeroBase includes zero', () => {
    const s = c.series([0, 1], [50, 100], box, { zeroBase: true })!
    expect(s.yDomain).toEqual({ min: 0, max: 100 })
  })
  test('flat series gets a padded domain', () => {
    const s = c.series([0, 1], [5, 5], box)!
    expect(s.yDomain).toEqual({ min: 4, max: 6 })
  })
  test('profile uses distance and position.y', () => {
    const rows = [
      row(0, { distance: 0, position: { x: 0, y: 0, z: 0 } }),
      row(1, { distance: 50, position: { x: 0, y: 10, z: 0 } }),
      row(2, { distance: 100, position: null }),
    ]
    const p = c.profile(rows, box)!
    expect(p.xDomain).toEqual({ min: 0, max: 100 })
    expect(p.yDomain).toEqual({ min: 0, max: 10 })
    expect(p.path).toBe('M10.0 90.0 L100.0 10.0')
  })
})

describe('graphSpecs and graph', () => {
  test('skips graphs with no data', () => {
    expect(c.graphSpecs([row(0), row(1)])).toEqual([])
  })
  test('bike: speed from requested, grade from grade.commanded', () => {
    const rows = [
      row(0, { speed: m({ requested: 8 }), power: m({ actual: 150 }), grade: m({ commanded: 2 }) }),
      row(1, { speed: m({ requested: 9 }), power: m({ actual: 160 }), grade: m({ commanded: 3 }) }),
    ]
    const specs = c.graphSpecs(rows)
    expect(specs.map((s) => s.key)).toEqual(['speed', 'power', 'grade'])
    expect(specs[2]!.label).toMatch(/Grade/)
    const g = c.graph(rows, specs[0]!, box, (v) => v * 3.6)!
    expect(g.yDomain.max).toBeCloseTo(32.4, 6)
    expect(g.yDomain.min).toBe(0)
  })
  test('treadmill: speed actual wins, incline preferred over grade', () => {
    const rows = [
      row(0, { speed: m({ actual: 2, requested: 3 }), incline: m({ commanded: 1 }), heartRate: m({ actual: 120 }) }),
      row(1, { speed: m({ actual: 2.5, requested: 3 }), incline: m({ commanded: null }), heartRate: m({ actual: null }) }),
    ]
    const specs = c.graphSpecs(rows)
    expect(specs.map((s) => s.key)).toEqual(['speed', 'heartRate', 'grade'])
    expect(specs[2]!.label).toMatch(/Incline/)
    expect(specs[0]!.pick(rows[0]!)).toBe(2)
    const hr = c.graph(rows, specs[1]!, box)!
    expect(hr.count).toBe(1)
  })
})
