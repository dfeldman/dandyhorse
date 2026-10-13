/**
 * Elevation, from the public terrain tiles on AWS's Open Data registry (the set Mapzen built and Nextzen
 * kept going). Each tile is a 256x256 PNG whose pixels are metres:
 *
 *     elevation = (R * 256 + G + B / 256) - 32768
 *
 * The data underneath is the usual public collection — SRTM and NASADEM worldwide, the USGS 3DEP national
 * elevation dataset over the United States, EU-DEM over Europe, and national models elsewhere — all of it
 * public domain or openly licensed. Zoom 12 is ~38 m per pixel at the equator and ~27 m at 45° north, which
 * is the native resolution of the models themselves; asking for more zoom only interpolates.
 *
 * Tiles are cached under tools/cache/ (gitignored), so a route rebakes offline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import type { LatLon } from '../src/route/geo.ts'

const BASE = process.env.TERRAIN_TILES_URL ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const CACHE = resolve(import.meta.dirname, 'cache', 'tiles')
const SIZE = 256

export const ATTRIBUTION =
  'Elevation from the AWS Terrain Tiles open dataset (terrarium): SRTM and NASADEM (NASA/USGS, public domain), ' +
  'USGS 3DEP (public domain) in the United States, EU-DEM (European Union) in Europe.'

/** Fractional tile coordinates: the whole-number part is the tile, the fraction is the pixel in it. */
export function tileXY(p: LatLon, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const lat = Math.min(85.0511, Math.max(-85.0511, p.lat)) * (Math.PI / 180)
  return {
    x: ((p.lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n,
  }
}

/** Ground resolution of a tile pixel at this latitude and zoom, in metres. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(lat * (Math.PI / 180))) / 2 ** zoom / 1
}

export class Elevation {
  private readonly tiles = new Map<string, Float32Array>()
  private fetched = 0
  private cached = 0
  readonly zoom: number

  constructor(zoom = 12) { this.zoom = zoom }

  get stats(): { fetched: number; cached: number; tiles: number } {
    return { fetched: this.fetched, cached: this.cached, tiles: this.tiles.size }
  }

  private readonly pending = new Set<string>()

  /**
   * Note that a lat/lon box will be sampled later. A long route's bounding box is mostly empty — the Katy
   * Trail's is 300 km by 70 km around a corridor under 3 km wide — so the baker declares the boxes it will
   * actually touch and `load()` fetches only those tiles, once each.
   */
  require(box: { minLat: number; maxLat: number; minLon: number; maxLon: number }): void {
    // one post beyond each edge, because sampling interpolates between posts
    const a = tileXY({ lat: box.maxLat, lon: box.minLon }, this.zoom)
    const b = tileXY({ lat: box.minLat, lon: box.maxLon }, this.zoom)
    for (let ty = Math.floor(a.y) - 1; ty <= Math.floor(b.y) + 1; ty++) {
      for (let tx = Math.floor(a.x) - 1; tx <= Math.floor(b.x) + 1; tx++) {
        const key = `${this.zoom}/${tx}/${ty}`
        if (!this.tiles.has(key)) this.pending.add(key)
      }
    }
  }

  /** Fetch everything `require` asked for. */
  async load(): Promise<void> {
    const queue = [...this.pending]
    this.pending.clear()
    if (!queue.length) return
    process.stderr.write(`  elevation: ${queue.length} tile(s) at zoom ${this.zoom}\n`)
    let done = 0
    // four at a time: enough to keep the link busy, gentle enough to be a good neighbour
    const worker = async (): Promise<void> => {
      for (;;) {
        const key = queue.shift()
        if (!key) return
        const [, tx, ty] = key.split('/')
        await this.tile(Number(tx), Number(ty))
        if (++done % 25 === 0) process.stderr.write(`  elevation: ${done} tile(s) ready\n`)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  private async tile(tx: number, ty: number): Promise<Float32Array> {
    const key = `${this.zoom}/${tx}/${ty}`
    const held = this.tiles.get(key)
    if (held) return held
    const dir = resolve(CACHE, String(this.zoom), String(tx))
    const file = resolve(dir, `${ty}.png`)
    let buf: Buffer
    if (existsSync(file)) {
      buf = readFileSync(file)
      this.cached++
    } else {
      const res = await fetch(`${BASE}/${key}.png`)
      if (!res.ok) throw new Error(`terrain tile ${key}: ${res.status} ${res.statusText}`)
      buf = Buffer.from(await res.arrayBuffer())
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, buf)
      this.fetched++
    }
    const png = PNG.sync.read(buf)
    const out = new Float32Array(SIZE * SIZE)
    for (let i = 0; i < SIZE * SIZE; i++) {
      const o = i * 4
      out[i] = (png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256) - 32768
    }
    this.tiles.set(key, out)
    return out
  }

  /** Bilinear elevation in metres. Every tile it needs must be preloaded first. */
  at(p: LatLon): number {
    const t = tileXY(p, this.zoom)
    // pixel centres sit half a pixel in, so the sample point is offset before interpolating
    const px = t.x * SIZE - 0.5
    const py = t.y * SIZE - 0.5
    const x0 = Math.floor(px)
    const y0 = Math.floor(py)
    const fx = px - x0
    const fy = py - y0
    const g = (x: number, y: number): number => {
      const tx = Math.floor(x / SIZE)
      const ty = Math.floor(y / SIZE)
      const tile = this.tiles.get(`${this.zoom}/${tx}/${ty}`)
      if (!tile) throw new Error(`elevation: tile ${this.zoom}/${tx}/${ty} was not preloaded (asked for ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`)
      return tile[(y - ty * SIZE) * SIZE + (x - tx * SIZE)]
    }
    return (
      g(x0, y0) * (1 - fx) * (1 - fy) +
      g(x0 + 1, y0) * fx * (1 - fy) +
      g(x0, y0 + 1) * (1 - fx) * fy +
      g(x0 + 1, y0 + 1) * fx * fy
    )
  }
}
