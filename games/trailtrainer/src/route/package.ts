/**
 * The shape of a baked route: what tools/bake.ts writes and what the game reads. One route is three files
 * in public/routes/:
 *
 *   <id>.json       this manifest — names, attribution, bands, landmarks, DEM header
 *   <id>.track.bin  Float32 [x, z, y] per sample, `step` metres apart along the ground
 *   <id>.dem.bin    Int16 half-metres, sparse 64x64 tiles of a regular grid (see DemHeader)
 *
 * The split is about size. The Katy Trail is 386 km: its track is half a megabyte of floats and its terrain
 * would be gigabytes as a dense grid, so the elevation model keeps only the tiles the corridor touches and
 * the game streams them. Alpe d'Huez is 14 km and would fit in a single JSON, but one format is enough.
 *
 * Nothing in here is generated at runtime. The route the rider climbs is the route OpenStreetMap describes,
 * at the elevations the public elevation models give, and the bake is reproducible from tools/routes.ts.
 */

/** Biomes the renderer knows how to dress: what grows, what colour the ground is, what stands beside it. */
export type BiomeName = 'prairie' | 'forest' | 'mountain' | 'alpine' | 'river'

/** What the rider is rolling on. Sets the trail's colour and texture, the dust, and rolling resistance. */
export type SurfaceName = 'paved' | 'gravel' | 'dirt'

/** A run of the route that shares a biome or a surface. Bands are contiguous and cover [0, length). */
export interface Band<T> {
  /** metres along the route where this band starts */
  start: number
  value: T
}

/** Something real beside the route, worth a sign or a silhouette. */
export interface Landmark {
  /** metres along the route */
  s: number
  name: string
  kind: 'town' | 'summit' | 'hairpin' | 'water' | 'viewpoint' | 'start' | 'finish'
  /** metres above sea level, when it is worth showing */
  elevation?: number
}

export interface DemHeader {
  /** metres between grid posts (the elevation models are ~30 m, so 30 m keeps every post they have) */
  step: number
  /** grid posts per tile side */
  tile: number
  /** grid coordinates of the whole model's origin, in posts from the route origin (may be negative) */
  minCol: number
  minRow: number
  /** tiles present, in (col, row) tile coordinates, in the order they appear in <id>.dem.bin */
  tiles: Array<{ col: number; row: number }>
  /** samples are Int16 half-metres: elevation = value / 2 */
  scale: number
  /** the value standing in for "no data here" */
  noData: number
}

export interface RouteManifest {
  schemaVersion: 1
  id: string
  /** what the route is called where it is */
  name: string
  /** the direction actually ridden, e.g. "Bourg-d'Oisans → Alpe d'Huez" */
  direction: string
  region: string
  /** a couple of sentences for the route picker */
  blurb: string
  /** 'bike' routes are roads; 'trail' routes suit running too. Both variants can ride either. */
  kind: 'road' | 'trail'

  /** the local frame's origin; every x/z in the package is metres from here */
  origin: { lat: number; lon: number }
  /** metres between track samples */
  step: number
  /** the route's true ground length in metres */
  length: number
  /** samples in <id>.track.bin (= floor(length / step) + 1) */
  samples: number

  /** headline numbers, from the smoothed profile the game actually rides */
  stats: {
    gain: number
    loss: number
    minElevation: number
    maxElevation: number
    maxGrade: number
    minGrade: number
    averageGrade: number
  }

  biomes: Array<Band<BiomeName>>
  surfaces: Array<Band<SurfaceName>>
  landmarks: Landmark[]
  dem: DemHeader

  /** where the data came from; shown in game and in CREDITS.md. Kept as separate lines so routes sharing a
   *  source do not repeat it on the start screen. */
  attribution: {
    geometry: string
    /** the model the ridden profile was sampled from */
    elevation: string
    /** the model the surrounding hillsides came from */
    terrain: string
    bakedAt: string
    /** the Overpass query and the smoothing window, so a bake can be reproduced or argued with */
    recipe: string
  }
}
