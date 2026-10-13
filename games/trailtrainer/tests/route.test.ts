/**
 * The routes that actually ship, checked against what they are in the world.
 *
 * These read the same three files the browser fetches, so a bake that goes wrong fails here rather than
 * looking slightly odd on a hillside. The numbers are the published ones for each route; if a change to the
 * baker moves them, that is the thing to explain before shipping it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Route } from '../src/route/route.ts'
import type { RouteManifest } from '../src/route/package.ts'
import { ROUTES } from '../tools/routes.ts'

const DIR = resolve(import.meta.dirname, '..', 'public', 'routes')

function load(id: string): Route {
  const manifest = JSON.parse(readFileSync(resolve(DIR, `${id}.json`), 'utf8')) as RouteManifest
  const bin = (name: string): ArrayBuffer => {
    const b = readFileSync(resolve(DIR, name))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  return Route.fromParts(manifest, bin(`${id}.track.bin`), bin(`${id}.dem.bin`))
}

describe.each(ROUTES.map((r) => [r.id, r] as const))('%s', (id, spec) => {
  const route = load(id)

  it('is the length it is published as', () => {
    expect(Math.abs(route.length - spec.expect.length) / spec.expect.length).toBeLessThanOrEqual(spec.expect.tolerance)
  })

  it('climbs what it is published as climbing', () => {
    expect(Math.abs(route.manifest.stats.gain - spec.expect.gain) / spec.expect.gain).toBeLessThanOrEqual(spec.expect.tolerance)
  })

  it('starts and ends where the manifest says, at the height it says', () => {
    const start = route.poseAt(0)
    const end = route.poseAt(route.length)
    expect(start.x).toBeCloseTo(0, 3)
    expect(start.z).toBeCloseTo(0, 3)
    expect(start.y).toBeCloseTo(route.manifest.landmarks[0].elevation ?? start.y, 0)
    expect(end.y).toBeCloseTo(route.manifest.landmarks[route.manifest.landmarks.length - 1].elevation ?? end.y, 0)
    // an open route, not a loop: asking past the end gives the end
    expect(route.poseAt(route.length + 5000).s).toBe(route.length)
    expect(route.poseAt(-100).s).toBe(0)
  })

  it('has a heading that is a unit vector all the way along', () => {
    for (let s = 0; s <= route.length; s += route.length / 200) {
      const p = route.poseAt(s)
      expect(Math.hypot(p.hx, p.hz)).toBeCloseTo(1, 4)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('knows what it is made of and what grows beside it, everywhere', () => {
    for (let s = 0; s <= route.length; s += route.length / 100) {
      expect(['paved', 'gravel', 'dirt']).toContain(route.surfaceAt(s))
      expect(['prairie', 'forest', 'mountain', 'alpine', 'river']).toContain(route.biomeAt(s))
    }
  })

  it('has ground under the trail wherever the trail goes', () => {
    let missing = 0
    for (let s = 0; s <= route.length; s += 250) {
      const p = route.poseAt(s)
      if (!Number.isFinite(route.heightAt(p.x, p.z))) missing++
    }
    expect(missing).toBe(0)
  })

  it('finds the trail again from a point beside it, at the right height', () => {
    for (let s = 500; s < route.length; s += route.length / 20) {
      const p = route.poseAt(s)
      // 8 m to the left of the centre line
      const near = route.nearest(p.x - p.hz * 8, p.z + p.hx * 8, 40)
      expect(near).not.toBeNull()
      expect(near!.distance).toBeLessThan(9)
      // the height comes off the segment, not the nearest sample: a staircase here shows up as a broken road
      expect(Math.abs(near!.y - p.y)).toBeLessThan(1.5)
    }
  })
})

describe("Alpe d'Huez in particular", () => {
  const route = load('alpe-dhuez')

  it('runs from the valley floor to the resort', () => {
    expect(route.poseAt(0).y).toBeGreaterThan(700)
    expect(route.poseAt(0).y).toBeLessThan(740)
    expect(route.manifest.stats.maxElevation).toBeGreaterThan(1820)
    expect(route.manifest.stats.maxElevation).toBeLessThan(1880)
  })

  it('averages the gradient the climb is known for', () => {
    // 13.8 km at 8.1% for the climb proper; this route adds a flat approach and a run-in through the village
    expect(route.manifest.stats.averageGrade).toBeGreaterThan(0.07)
    expect(route.manifest.stats.averageGrade).toBeLessThan(0.085)
  })

  it('is asphalt the whole way, and has hairpins', () => {
    expect(route.surfaceAt(6000)).toBe('paved')
    let sharp = 0
    for (let s = 0; s < route.length; s += 10) if (Math.abs(route.poseAt(s).curvature) > 0.02) sharp++
    // twenty-one numbered bends, each holding a tight radius over a few tens of metres
    expect(sharp).toBeGreaterThan(40)
  })
})

describe('the Katy Trail in particular', () => {
  const route = load('katy-trail')

  it('is long enough that nobody rides it in one go', () => {
    expect(route.length).toBeGreaterThan(380000)
  })

  it('is a rail grade: nowhere near a climb', () => {
    expect(Math.abs(route.manifest.stats.averageGrade)).toBeLessThan(0.001)
  })

  it('is packed surface rather than asphalt for most of its length', () => {
    let gravel = 0
    let n = 0
    for (let s = 0; s < route.length; s += 1000) { n++; if (route.surfaceAt(s) === 'gravel') gravel++ }
    expect(gravel / n).toBeGreaterThan(0.9)
  })

  it('keeps its numbers honest three hundred kilometres in', () => {
    // where float32 would start losing centimetres, which is why the renderer carries a floating origin
    const p = route.poseAt(300000)
    expect(Math.abs(p.x)).toBeGreaterThan(200000)
    expect(Number.isFinite(p.y)).toBe(true)
    const near = route.nearest(p.x, p.z, 10)
    expect(near).not.toBeNull()
    expect(near!.distance).toBeLessThan(0.5)
  })
})
