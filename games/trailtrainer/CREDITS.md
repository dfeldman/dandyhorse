# Credits and licensing

Trail Trainer's routes are derived from open data. Nothing in `public/routes/` was drawn by hand, and nothing
was traced from a proprietary source — no Strava segments, no Ride with GPS or Komoot exports, no aerial
imagery. The scenery is generated from the same elevation data as the profile, so there are no photographs or
video in the game either.

Every route's `attribution` block carries these lines, and the start screen shows them.

## Route geometry and water — OpenStreetMap

The line each route follows comes from OpenStreetMap, fetched through the Overpass API. So does the water:
`tools/water.ts` asks the same API for `natural=water`, `waterway=riverbank` and the river, stream and canal
ways near the route, and writes them to `public/routes/<id>.water.json` — the Missouri's banks, the sloughs
along the Katy, the Romanche in its valley. That file is a derived database under the ODbL exactly as the
track is, and the same terms below apply to it.

One thing in it is NOT from OpenStreetMap and should not be read as a claim about the world: with `--invent`,
the same tool adds tarns and torrents to a mountain route by looking for hollows and gullies in the elevation
model (see the note in `tools/water.ts`). Those are the game's own invention. They are placed where water
could plausibly be rather than where it is, and Alpe d'Huez is baked with them.

> © OpenStreetMap contributors. Data available under the [Open Database Licence](https://opendatacommons.org/licenses/odbl/) (ODbL).

**This matters for redistribution.** The baked files in `public/routes/` are a *derived database* under the
ODbL: they contain a resampled copy of OSM way geometry, plus surface tags and place names taken from OSM. If
these files are distributed — which shipping the game does — the ODbL's attribution and share-alike terms
apply to them. In practice that means:

- the attribution above must be visible to anyone using the game (it is, on the start screen and in every
  manifest);
- if the baked route files are changed and distributed, those changes are offered under the ODbL as well;
- `tools/bake.ts` and `tools/routes.ts` are the full recipe, so anyone can reproduce or correct a route.

The produced *work* — the rendered scenery, the game itself — is not itself a database and is not encumbered
by the share-alike clause; the ODbL's "produced work" notice is what the start screen provides.

## Elevation profiles

The height of the trail under the rider, which is what the trainer's resistance is set from, is sampled per
route from whichever open national model covers it best.

| Route | Model | Resolution | Terms |
|---|---|---|---|
| Alpe d'Huez | **IGN RGE ALTI®**, via the Géoplateforme altimetry service | 1–5 m lidar | © IGN — [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) |
| Katy Trail | **USGS 3DEP National Elevation Dataset**, via [OpenTopoData](https://www.opentopodata.org/) | 10 m | Public domain (US Government work) |

Also wired up in `tools/profiles.ts` and available for future routes:

- **Copernicus EU-DEM v1.1**, 25 m, Europe — produced using Copernicus data and information funded by the
  European Union. Free full open access.
- **NASA SRTM**, 30 m, near-global — public domain.

OpenTopoData is a free public API run as a courtesy. The baker batches a hundred points per call, waits between
calls and caches every answer under `tools/cache/`, so a rebuild asks for nothing it has asked for before.
Please keep it that way if you add routes.

## Surrounding terrain

The hillsides, bluffs and valleys either side of the trail come from the **AWS Terrain Tiles** open dataset
(the "terrarium" encoding Mapzen built and Nextzen kept going), hosted on the
[AWS Open Data registry](https://registry.opendata.aws/terrain-tiles/).

> Elevation data from the AWS Terrain Tiles open dataset. Sources include NASA/USGS SRTM and NASADEM (public
> domain), the USGS 3DEP National Elevation Dataset over the United States (public domain), and EU-DEM over
> Europe (© European Union).

The full per-region source list is at <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.

## Ground and trail textures

The four surfaces the ground is painted from, and the three the trail itself is made of, come from [Poly Haven](https://polyhaven.com), which releases
everything under CC0. They are fetched once by `npm run textures` and checked in under `public/textures/`, so
the game still asks nothing of the network while it runs.

| Layer | Asset | Licence |
|---|---|---|
| grass — flat, low ground | [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) | CC0 |
| dry — worn ground, and the strip beside the trail | [brown_mud_leaves_01](https://polyhaven.com/a/brown_mud_leaves_01) | CC0 |
| rock — too steep to hold anything | [rocky_terrain_02](https://polyhaven.com/a/rocky_terrain_02) | CC0 |
| snow — above the snow line | [snow_02](https://polyhaven.com/a/snow_02) | CC0 |
| paved — asphalt, as on a mountain road | [asphalt_02](https://polyhaven.com/a/asphalt_02) | CC0 |
| gravel — packed limestone, as on a rail trail | [gravel_floor](https://polyhaven.com/a/gravel_floor) | CC0 |
| dirt — bare earth | [dirt_floor](https://polyhaven.com/a/dirt_floor) | CC0 |
| bark | [pine_tree_01](https://polyhaven.com/a/pine_tree_01) | CC0 |

The leaves are cut out of two of Poly Haven's CC0 tree *models* rather than its texture library, because what a
card canopy needs is a page of foliage and that is what those models carry. `npm run canopies` finds the
individual leaves and needle sprigs in them and composites each into a cluster (`tools/canopies.ts`); the
composited pages are checked in as `canopy_*.png`.

| Foliage | Asset | Licence |
|---|---|---|
| broadleaf | [island_tree_01](https://polyhaven.com/a/island_tree_01) | CC0 |
| conifer | [fir_tree_01](https://polyhaven.com/a/fir_tree_01) | CC0 |

CC0 means no attribution is required. It is here anyway, because knowing where a file came from is what makes
it safe to ship, and because the next person adding a texture should see the standard being kept: CC0, or
CC-BY with the attribution written down.

The studio environment map the avatar kit lights bodies with is also Poly Haven's — see `public/env/README.md`.

## Avatars

The people on the road are built by [`@dandyhorse/avatarkit`](../dandyhorse/libs/avatarkit), which carries its
own credits for the MakeHuman assets, garments, hair and motion clips it uses — see that project's
`CREDITS.md`. Nothing avatar-related is licensed here.

## Code

Babylon.js (Apache-2.0), Vite and Vitest (MIT), pngjs (MIT). Everything else in this repository is ours.

## Adding a route

If you add one, add its sources here too. The things to check before shipping it:

1. The Overpass query returns a connected set of ways between the two end points, and `npm run bake <id>`
   reports a length and a climb within tolerance of published figures for the route.
2. The elevation model you chose actually covers the area — `tools/bake.ts` reports how many points fell
   outside it and had to be filled from the terrain tiles. A route with more than a handful is using the wrong
   model.
3. The licence of that model permits redistribution of derived elevation profiles. All four wired up here do;
   many national models do not.

## Tree library — Poly Haven

The trees in `public/trees/` are generated by `tools/deciduousgen/`. Their bark maps are Poly Haven textures
and their leaves are cut out of Poly Haven tree models, all CC0:

| use | asset | licence |
|---|---|---|
| oak bark | [jolcham_oak_bark_01](https://polyhaven.com/a/jolcham_oak_bark_01) | CC0 |
| ash, elm, poplar, sapling bark | [bark_brown_02](https://polyhaven.com/a/bark_brown_02) | CC0 |
| willow bark | [bark_willow_02](https://polyhaven.com/a/bark_willow_02) | CC0 |
| birch, aspen, beech bark | [bark_platanus](https://polyhaven.com/a/bark_platanus) | CC0 |
| maple bark | [trident_maple_bark](https://polyhaven.com/a/trident_maple_bark) | CC0 |
| broadleaf leaves (and their light/dark grades) | [island_tree_01](https://polyhaven.com/a/island_tree_01) | CC0 |
| compound leaves | [jacaranda_tree](https://polyhaven.com/a/jacaranda_tree) | CC0 |
| (downloaded, unused) | [tree_small_02](https://polyhaven.com/a/tree_small_02) | CC0 |

The conifers (`tools/conifergen/`) use these, also CC0:

| use | asset | licence |
|---|---|---|
| Scots pine, larch bark | [pine_bark](https://polyhaven.com/a/pine_bark) | CC0 |
| black pine bark | [knotted_pine_bark](https://polyhaven.com/a/knotted_pine_bark) | CC0 |
| spruce, cypress bark | [japanese_cedar_bark](https://polyhaven.com/a/japanese_cedar_bark) | CC0 |
| fir bark | [chinese_cedar_bark](https://polyhaven.com/a/chinese_cedar_bark) | CC0 |
| pine needle sprigs | [pine_tree_01](https://polyhaven.com/a/pine_tree_01) | CC0 |
| fir/spruce/larch/cypress sprays | [fir_tree_01](https://polyhaven.com/a/fir_tree_01) | CC0 |

The rocks (`tools/rockgen/`) use these surfaces, also CC0:

| use | asset | licence |
|---|---|---|
| grey boulder, groups | [rock_boulder_dry](https://polyhaven.com/a/rock_boulder_dry) | CC0 |
| slab | [rock_08](https://polyhaven.com/a/rock_08) | CC0 |
| angular block | [dark_rock_02](https://polyhaven.com/a/dark_rock_02) | CC0 |
| spire | [rock_boulder_cracked](https://polyhaven.com/a/rock_boulder_cracked) | CC0 |
| pale group | [marble_rock_01](https://polyhaven.com/a/marble_rock_01) | CC0 |
| lichen boulder | [lichen_rock](https://polyhaven.com/a/lichen_rock) | CC0 |
| mossy boulder and group | [mossy_rock](https://polyhaven.com/a/mossy_rock) | CC0 |
| pebbles | [dry_river_pebbles](https://polyhaven.com/a/dry_river_pebbles) | CC0 |
| scree | [gravel_stones](https://polyhaven.com/a/gravel_stones) | CC0 |

The plants (`tools/plantgen/`) cut their cards out of these Poly Haven models, all CC0; the sunflower,
tulip, palm frond and cactus skin are painted by `tools/plantgen/paint.py` and carry no licence:

| use | asset | licence |
|---|---|---|
| meadow and dry grass tufts | [grass_medium_01](https://polyhaven.com/a/grass_medium_01), [grass_bermuda_01](https://polyhaven.com/a/grass_bermuda_01) | CC0 |
| prairie grass blades | [grass_medium_02](https://polyhaven.com/a/grass_medium_02) | CC0 |
| fern fronds | [fern_02](https://polyhaven.com/a/fern_02) | CC0 |
| dandelion heads, clock and leaves | [dandelion_01](https://polyhaven.com/a/dandelion_01) | CC0 |
| small yellow flowers | [celandine_01](https://polyhaven.com/a/celandine_01) | CC0 |
| orange daisies and leaves | [flower_gazania](https://polyhaven.com/a/flower_gazania), [flower_ursinia](https://polyhaven.com/a/flower_ursinia) | CC0 |
| yellow star flowers, long leaves | [flower_empodium](https://polyhaven.com/a/flower_empodium) | CC0 |
| pink flowers and leaves | [periwinkle_plant](https://polyhaven.com/a/periwinkle_plant) | CC0 |
| broad leaves | [nettle_plant](https://polyhaven.com/a/nettle_plant), [shrub_01](https://polyhaven.com/a/shrub_01) | CC0 |
| palm trunk | [palm_bark](https://polyhaven.com/a/palm_bark) | CC0 |
| (downloaded, unused: bleed) | [flower_heliophila](https://polyhaven.com/a/flower_heliophila) | CC0 |
