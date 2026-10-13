/**
 * The elevation profile the rider actually feels — the one number the game asks the trainer for — sampled
 * from the best open elevation model covering the route. Bake time only: the game reads the baked result and
 * never calls any of this.
 *
 * Why not the terrain tiles in terrarium.ts: those are ~30 m posts, right for hillsides in the distance and
 * far too coarse for a road cut into one. Sampled along Alpe d'Huez, a 30 m model puts a 15 m bump on every
 * hairpin — the apex is where the road is cut deepest into the slope, so the model reads the uncut hillside
 * above it — and the climb comes out with a 24% ramp and a 7% descent, neither of which exists. Smoothing
 * hard enough to bury that also buries the real ramps between the bends. A model that can see the road is
 * the honest fix.
 *
 *   ign-rgealti  IGN RGE ALTI, 1–5 m lidar, France. Licence Ouverte / Etalab 2.0.
 *   ned10m       USGS 3DEP National Elevation Dataset, 10 m, United States. Public domain.
 *   eudem25m     Copernicus EU-DEM v1.1, 25 m, Europe. Free full open access.
 *   srtm30m      NASA SRTM, 30 m, near-global. Public domain.
 *
 * Everything is cached under tools/cache/ (gitignored), so a rebake asks for nothing it has asked before.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LatLon } from '../src/route/geo.ts'

const CACHE = resolve(import.meta.dirname, 'cache', 'profile')
const UA = 'trailtrainer/0.1 (Dandyhorse exergame route baker)'

export type ProfileSource = 'ign-rgealti' | 'ned10m' | 'eudem25m' | 'srtm30m'

export const ATTRIBUTION: Record<ProfileSource, string> = {
  'ign-rgealti': 'Elevation profile from IGN RGE ALTI® (1–5 m lidar), © IGN — Licence Ouverte / Open Licence 2.0, via the Géoplateforme altimetry service.',
  ned10m: 'Elevation profile from the USGS 3DEP National Elevation Dataset (10 m), public domain, via OpenTopoData.',
  eudem25m: 'Elevation profile from Copernicus EU-DEM v1.1 (25 m) — produced using Copernicus data and information funded by the European Union — via OpenTopoData.',
  srtm30m: 'Elevation profile from NASA SRTM (30 m), public domain, via OpenTopoData.',
}

/** Roughly what each model can resolve, in metres; the baker smooths to about this scale and no further. */
export const RESOLUTION: Record<ProfileSource, number> = { 'ign-rgealti': 5, ned10m: 10, eudem25m: 25, srtm30m: 30 }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Provider {
  batch: number
  gapMs: number
  fetch: (points: LatLon[]) => Promise<Array<number | null>>
}

/** France's Géoplateforme. 200 points a call, no key, and it answers in well under a second. */
const ign: Provider = {
  batch: 200,
  gapMs: 250,
  fetch: async (points) => {
    const q = new URLSearchParams({
      lon: points.map((p) => p.lon.toFixed(6)).join('|'),
      lat: points.map((p) => p.lat.toFixed(6)).join('|'),
      resource: 'ign_rge_alti_wld',
      delimiter: '|',
      indent: 'false',
      zonly: 'true',
    })
    const res = await fetch(`https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?${q}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`ign rge alti: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as { elevations?: number[] }
    if (!body.elevations) throw new Error('ign rge alti: no elevations in the answer')
    // outside its coverage the service answers with a large negative sentinel
    return body.elevations.map((z) => (z < -1000 ? null : z))
  },
}

/** OpenTopoData's free public API: 100 points a call, one call a second, a thousand a day. */
const openTopo = (dataset: string): Provider => ({
  batch: 100,
  gapMs: 1100,
  fetch: async (points) => {
    const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|')
    const res = await fetch(`https://api.opentopodata.org/v1/${dataset}?locations=${encodeURIComponent(locations)}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`opentopodata ${dataset}: ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as { status: string; error?: string; results?: Array<{ elevation: number | null }> }
    if (body.status !== 'OK' || !body.results) throw new Error(`opentopodata ${dataset}: ${body.error ?? body.status}`)
    return body.results.map((r) => r.elevation)
  },
})

const PROVIDERS: Record<ProfileSource, Provider> = {
  'ign-rgealti': ign,
  ned10m: openTopo('ned10m'),
  eudem25m: openTopo('eudem25m'),
  srtm30m: openTopo('srtm30m'),
}

/**
 * Elevations in metres, one per point, in order. `null` where the model has no coverage — the baker fills
 * those from the terrain tiles rather than leaving a hole.
 */
export async function sampleProfile(source: ProfileSource, points: LatLon[]): Promise<Array<number | null>> {
  mkdirSync(CACHE, { recursive: true })
  const digest = createHash('sha1').update(`${source}|${points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(';')}`).digest('hex').slice(0, 16)
  const file = resolve(CACHE, `${source}-${digest}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Array<number | null>

  const provider = PROVIDERS[source]
  const out: Array<number | null> = []
  const calls = Math.ceil(points.length / provider.batch)
  process.stderr.write(`  profile: ${points.length} points from ${source} in ${calls} call(s)\n`)
  for (let i = 0; i < points.length; i += provider.batch) {
    const chunk = points.slice(i, i + provider.batch)
    let got: Array<number | null> | null = null
    for (let attempt = 0; attempt < 3 && !got; attempt++) {
      try {
        got = await provider.fetch(chunk)
      } catch (e) {
        if (attempt === 2) throw e
        process.stderr.write(`  profile: retrying after ${String(e).slice(0, 120)}\n`)
        await sleep(3000 * (attempt + 1))
      }
    }
    if (!got || got.length !== chunk.length) throw new Error(`${source}: asked for ${chunk.length} points and got ${got?.length ?? 0}`)
    out.push(...got)
    const done = Math.floor(i / provider.batch) + 1
    if (done % 25 === 0 || done === calls) process.stderr.write(`  profile: ${done}/${calls} calls\n`)
    if (i + provider.batch < points.length) await sleep(provider.gapMs)
  }
  writeFileSync(file, JSON.stringify(out))
  return out
}
