/**
 * The routes Trail Trainer ships, as instructions for the baker. Each one names the ways to ask
 * OpenStreetMap for and the two points the ride runs between; everything else — the shape, the profile, the
 * surface, the landmarks — comes out of the data.
 *
 * Adding a route means adding an entry here and running `npm run bake <id>`. The things worth getting right
 * are the Overpass query (wide enough to contain a connected path, narrow enough not to fetch a county) and
 * the two end points (within a few hundred metres of a way in the query).
 *
 * `expect` is the check that the bake is honest: published figures for the route. tools/bake.ts compares and
 * complains. If stitching or smoothing goes wrong, the length or the climbing is the thing that shows it.
 */
import type { BiomeName } from '../src/route/package.ts'
import type { LatLon } from '../src/route/geo.ts'
import type { ProfileSource } from './profiles.ts'

export interface RouteSpec {
  id: string
  name: string
  direction: string
  region: string
  blurb: string
  kind: 'road' | 'trail'
  /** Overpass QL; must `out body geom;` the candidate ways */
  query: string
  from: LatLon
  to: LatLon
  /** which elevation model the centreline profile is sampled from (see tools/profiles.ts) */
  profileSource: ProfileSource
  /** metres between track samples */
  step: number
  /** along-track window, in metres, that the elevation profile is smoothed over */
  smoothing: number
  /** metres either side of the route to bake terrain for */
  demHalfWidth: number
  /** metres between terrain grid posts; 30 keeps every post the elevation model has */
  demStep: number
  /** which biome dresses a point on the route, given where it is and how high */
  biome: (ctx: { s: number; fraction: number; elevation: number; length: number }) => BiomeName
  /** published figures, for the bake's own check */
  expect: { length: number; gain: number; tolerance: number }
}

/** Places worth a sign, fetched alongside the ways. */
export const PLACES_QUERY = (bbox: string): string => `[out:json][timeout:90];
(
  node["place"~"^(city|town|village|hamlet)$"](${bbox});
  node["natural"="peak"](${bbox});
  node["tourism"="viewpoint"](${bbox});
);
out tags center;`

export const ROUTES: RouteSpec[] = [
  {
    id: 'alpe-dhuez',
    name: "Alpe d'Huez",
    direction: "Bourg-d'Oisans → Alpe d'Huez",
    region: 'Isère, France',
    kind: 'road',
    blurb:
      'Twenty-one hairpins up the wall above the Romanche valley. The road tilts to double digits inside the first ' +
      'kilometre and does not properly relent until the village. An hour of climbing for a strong rider, and there ' +
      'is nowhere on it to hide.',
    // The climb is the D 211 from the valley floor. The town roads at the top carry the same ref, so the ride is
    // pinned by its two ends rather than by the tag alone.
    query: `[out:json][timeout:90];
(
  way["highway"]["ref"~"^D 211F?$"](45.050,6.020,45.100,6.080);
);
out body geom;`,
    // the foot of the D 211 where it leaves the valley road, to the Rond-Point du Tour de France at the top of
    // the finishing straight. That is a few hundred metres past the race's finish banner, which OSM does not mark.
    from: { lat: 45.05939, lon: 6.03768 },
    to: { lat: 45.09288, lon: 6.07184 },
    // France publishes a 1-5 m lidar model, and this climb needs it: at 25-30 m posts every hairpin apex reads
    // 15 m too high (the model sees the hillside the road is cut into), which invents a 24% ramp and a 7%
    // descent on a climb that has neither
    profileSource: 'ign-rgealti',
    step: 10,
    // what is left after lidar is OSM's own centreline wander against a steep hillside: a 3 m sideways error on
    // a 60% slope is 2 m of height. 80 m takes that out and leaves the ramps between the bends
    smoothing: 80,
    // 6 km: on this climb the view is mostly the other side of the valley and the Grandes Rousses behind it,
    // and terrain that stops at the edge of the road is the one thing that would give the whole game away
    demHalfWidth: 6000,
    demStep: 30,
    biome: ({ elevation }) => (elevation > 1650 ? 'alpine' : elevation > 1150 ? 'mountain' : elevation > 800 ? 'forest' : 'river'),
    // The climb proper is published as 13.8 km at 8.1%, 744 m to 1815 m, 1071 m of ascent. This route adds the
    // 700 m approach from the valley road and the run-in through the resort, so it comes to 14.7 km and 1140 m,
    // crossing 1850 m before dropping to the line. Those are the numbers to hold it to.
    expect: { length: 14700, gain: 1140, tolerance: 0.1 },
  },
  {
    id: 'katy-trail',
    name: 'Katy Trail',
    direction: 'Clinton → Machens, Missouri',
    region: 'Missouri, USA',
    kind: 'trail',
    blurb:
      "America's longest rail trail: 380-odd kilometres of packed limestone on the old MKT roadbed, out across the " +
      'prairie and then along the Missouri River under the bluffs. It is almost flat and it takes days. Ride an hour ' +
      'of it at a time and pick the trail up where you left it.',
    // the signed cycle route relation for the Missouri trail (ref KT); its ways are the trail itself
    query: `[out:json][timeout:180];
relation(3193971);
way(r);
out body geom;`,
    // the relation is one clean chain with exactly two loose ends: the trailhead at Clinton and the eastern
    // terminus at Machens on the Mississippi bottoms
    from: { lat: 38.38115, lon: -93.76333 },
    to: { lat: 38.90312, lon: -90.33203 },
    // the USGS 10 m national model; the free API allows a thousand calls a day and the trail needs about two
    // hundred of them at this step
    profileSource: 'ned10m',
    // 20 m: a rail grade curves at a radius no bicycle notices, and it halves the calls the profile costs
    step: 20,
    // a rail grade is genuinely smooth; 120 m takes out the model's noise without inventing flatness
    smoothing: 120,
    demHalfWidth: 1400,
    // 60 m posts: the relief beside a rail trail is gentle and the route is 386 km long
    demStep: 60,
    biome: ({ fraction, elevation }) =>
      // west of Boonville the trail crosses farmed prairie; from there east it runs under the river bluffs
      fraction < 0.28 ? 'prairie' : elevation > 190 ? 'forest' : 'river',
    // the trail is signed as 240 miles; the ridable surface is a little under that
    expect: { length: 386000, gain: 900, tolerance: 0.2 },
  },
]

export const routeById = (id: string): RouteSpec | undefined => ROUTES.find((r) => r.id === id)
