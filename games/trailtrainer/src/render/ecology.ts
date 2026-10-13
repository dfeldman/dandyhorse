/**
 * What grows where, per route.
 *
 * A biome name is not enough to decide what a place looks like. The Katy Trail's "forest" is oak and hickory
 * bottomland in Missouri; Alpe d'Huez's is beech giving way to spruce as the road climbs. Both would be told
 * "forest" and handed the same trees, and they would both be wrong. So a route names its own ecology, and an
 * ecology is a list of bands: what grows, how thickly, and — the part a biome name cannot carry at all —
 * between which heights and on what steepness.
 *
 * **Elevation is what makes a mountain road read as one.** Riding Alpe d'Huez you leave broadleaf woods
 * behind at around a thousand metres, climb through spruce and larch, and come out onto turf and scree above
 * the tree line. That is a real thing about the real road, the elevation model knows every metre of it, and
 * before this the game drew the same wood from bottom to top.
 *
 * Bands are additive and may overlap: two of them covering 900–1200 m give a belt where broadleaf and conifer
 * are mixed, which is what the edge of a tree line actually looks like rather than a line ruled across the
 * hillside.
 */
import type { BiomeName } from '../route/package.ts'

/** Which library a band draws from. Each is a folder under `public/` with its own index. */
export type Library = 'trees' | 'plants' | 'rocks'

/** The library grows each tree in several seasons; `any` is for things that do not have one, like rock. */
export type Season = 'summer' | 'autumn' | 'gold' | 'copper' | 'winter'

export interface Band {
  from: Library
  /** species names as the library's index gives them; one is picked per plant by hash */
  species: string[]
  /**
   * How thickly it grows. Trees and rocks are per hectare, because there are a few of them over a wide area;
   * plants are per square metre, because there are thousands.
   */
  density: number
  /** metres above sea level between which this grows; omitted means anywhere */
  elevation?: [number, number]
  /** rise over run of the ground it will take; omitted means any */
  slope?: [number, number]
  /** biomes it belongs to; omitted means all of them */
  biomes?: BiomeName[]
  /**
   * Which season's models to take, overriding the route's own. This is how a route gets a stand of gold
   * birches among green ones, or a snow line: the library grows every tree five ways and the difference is
   * in the leaf page and the bark, so it costs nothing to ask for a different one.
   */
  season?: Season
  /** metres tall it is planted, smallest to largest; omitted leaves it the size it was grown */
  height?: [number, number]
  /**
   * How far out it is drawn. `far` is the standing scenery, out to the detailed ring's edge; `near` is the
   * ground cover ring, which is much smaller and much more thickly sown.
   */
  reach: 'near' | 'far'
}

export interface Ecology {
  /** how many separate models of each species to load; more is more variety and more to download */
  variants: number
  /** what time of year this route is ridden in; a band may override it */
  season: Season
  bands: Band[]
}

/**
 * Alpe d'Huez: 718 m in the Romanche valley to 1849 m at the ski station, through four biomes and a tree
 * line. The bands below are the mountain in cross-section.
 */
const ALPE: Ecology = {
  variants: 3,
  season: 'summer',
  bands: [
    // the valley floor and the lower hairpins: broadleaf woods, thinning as the road climbs out of them
    { from: 'trees', species: ['ash', 'beech', 'maple', 'oak'], density: 34, elevation: [600, 1150], height: [6, 17], reach: 'far' },
    { from: 'trees', species: ['birch', 'aspen'], density: 16, elevation: [900, 1500], height: [5, 13], reach: 'far' },
    // the conifer belt, overlapping the broadleaf below it so the change is a belt and not a line
    { from: 'trees', species: ['spruce', 'fir', 'larch'], density: 30, elevation: [1000, 1750], height: [7, 19], reach: 'far' },
    { from: 'trees', species: ['scots_pine'], density: 10, elevation: [1200, 1800], height: [6, 14], reach: 'far' },
    // and the last stunted things at the tree line
    { from: 'trees', species: ['conifer_sapling'], density: 14, elevation: [1650, 2000], height: [1.2, 3.4], reach: 'far' },

    // rock: on anything steep at any height, and scree once the soil has gone
    { from: 'rocks', species: ['grey', 'lichen', 'cracked'], density: 22, slope: [0.35, 4], reach: 'far' },
    { from: 'rocks', species: ['scree', 'bare'], density: 40, elevation: [1500, 2200], reach: 'far' },
    { from: 'rocks', species: ['mossy'], density: 10, elevation: [600, 1200], reach: 'far' },

    // Ground cover, changing with height the way the trees do — and every band gives a height, because the
    // library grows a plant at its own full size and a meadow of two-metre mulleins is not a meadow.
    { from: 'plants', species: ['meadow_full', 'meadow_grass'], density: 0.26, height: [0.3, 0.7], elevation: [600, 1300], reach: 'near' },
    { from: 'plants', species: ['fern', 'bracken'], density: 0.14, height: [0.35, 0.8], elevation: [700, 1400], reach: 'near' },
    { from: 'plants', species: ['meadow_short', 'meadow_tussock'], density: 0.30, height: [0.2, 0.55], elevation: [1150, 2000], reach: 'near' },
    { from: 'plants', species: ['heather'], density: 0.12, height: [0.2, 0.45], elevation: [1350, 2000], reach: 'near' },
    { from: 'plants', species: ['cow_parsley', 'lupine'], density: 0.035, height: [0.5, 1.0], elevation: [700, 1500], reach: 'near' },
    { from: 'plants', species: ['buttercup', 'daisy'], density: 0.05, height: [0.12, 0.3], elevation: [900, 1900], reach: 'near' },
    { from: 'plants', species: ['bush_green', 'bramble'], density: 0.02, height: [0.7, 1.6], elevation: [600, 1400], reach: 'near' },
  ],
}

/**
 * The Katy Trail: 132 m to 290 m across Missouri, so almost no elevation to work with — here it is the biome
 * bands from the route package that do the separating, prairie giving way to bottomland forest and then the
 * Missouri river corridor.
 */
const KATY: Ecology = {
  /**
   * Two models per species, not three.
   *
   * The Katy's bottomland is bound by the CPU, not the GPU: the frame is Babylon walking its meshes, and every
   * variant of every species is six of them (three levels of detail, bark and leaves) plus a shadow pass and
   * an impostor. With nine tree species that was over a hundred and fifty draws for the woods alone, and the
   * densest stretch of river bottom ran at forty-odd frames a second whatever the resolution. A wood of two
   * shapes per species at different sizes and rotations does not read as repeated; the third was paid for
   * every frame and nobody could see it.
   */
  variants: 2,
  season: 'summer',
  bands: [
    /**
     * Missouri is WET, and it grows accordingly.
     *
     * These numbers were the Alps' numbers, and drawn with them the Katy came out as parkland: big trees dotted
     * about a lawn, with sky between every one of them. Bottomland hardwood on a humid floodplain is nothing
     * like that — it is closed canopy with an understory under it and a wall of second growth wherever the
     * light gets in, and the trail through it is a green tunnel. Trebling the canopy and filling in beneath it
     * with saplings is most of the difference, and it costs triangles rather than fill, which is the cheap side
     * of this renderer's budget.
     */
    { from: 'trees', species: ['oak', 'elm', 'maple'], density: 105, biomes: ['forest'], height: [7, 19], reach: 'far' },
    /**
     * No willows, for all that the Missouri bottoms are full of them.
     *
     * The library's willow is pale-barked and its leaves are thin drooping strands, and at any distance the
     * strands disappear against the grass while the trunk does not — so a stand of them reads as a field of
     * bare pale snags among the leafy trees. It was reported as "further trunks drawing over closer ones",
     * which is what a bald tree standing behind a leafy one looks like, and it survived every explanation
     * offered for it: the leaf cut-out, the alpha threshold, the level-of-detail dissolve, the impostors, even
     * drawing the leaves fully opaque. What identified it in the end was taking species out of this line one
     * at a time. Ash and poplar carry the bottomland until the generator grows a willow that reads as one.
     */
    { from: 'trees', species: ['ash', 'poplar'], density: 82, biomes: ['river'], height: [7, 18], reach: 'far' },
    // the understory: young trees crowding up under the canopy and along the trail's own edge
    { from: 'trees', species: ['sapling', 'birch', 'elm'], density: 30, biomes: ['forest', 'river'], height: [2.5, 7], reach: 'far' },
    // a scattering of turning trees through the bottomland, which is what the Katy is photographed for
    { from: 'trees', species: ['maple', 'oak'], density: 14, biomes: ['forest', 'river'], height: [7, 16], season: 'autumn', reach: 'far' },
    { from: 'trees', species: ['oak', 'sapling'], density: 5, biomes: ['prairie'], height: [4, 12], reach: 'far' },
    // a few conifers, as windbreaks and field edges have in Missouri, but nothing like a conifer belt
    { from: 'trees', species: ['scots_pine'], density: 4, biomes: ['forest', 'river'], height: [8, 16], reach: 'far' },

    /**
     * Missouri stone is small stone.
     *
     * These bands had no height range, so every rock was drawn at whatever size the library grew it — which
     * for the pale and grey boulders is two or three metres. Scattered through a flat wooded floodplain that
     * reads as a field of standing stones, and at a glance it reads as something worse: a pale conical shape
     * behind a dark trunk looks exactly like a tree drawn in the wrong order, which is how it was reported.
     * A river bottom has cobbles and the odd boulder, so that is what these are now, and fewer of them.
     */
    { from: 'rocks', species: ['river', 'mossy'], density: 5, height: [0.25, 0.8], biomes: ['river'], reach: 'far' },
    { from: 'rocks', species: ['pale', 'grey'], density: 9, height: [0.3, 1.2], slope: [0.35, 4], reach: 'far' },

    { from: 'plants', species: ['prairie_grass', 'meadow_full'], density: 0.30, height: [0.35, 0.85], biomes: ['prairie'], reach: 'near' },
    { from: 'plants', species: ['goldenrod', 'thistle'], density: 0.05, height: [0.4, 0.8], biomes: ['prairie'], reach: 'near' },
    { from: 'plants', species: ['wildflower', 'daisy'], density: 0.07, height: [0.12, 0.3], biomes: ['prairie'], reach: 'near' },
    // Sunflowers are two and a half metres in the library and unmistakable, which is exactly why there must
    // be very few of them: at any density that reads as ground cover they become the entire prairie.
    { from: 'plants', species: ['sunflower'], density: 0.008, height: [1.1, 1.9], biomes: ['prairie'], reach: 'near' },
    { from: 'plants', species: ['meadow_grass', 'fern', 'bracken'], density: 0.42, height: [0.3, 0.8], biomes: ['forest'], reach: 'near' },
    { from: 'plants', species: ['reeds', 'cattail'], density: 0.14, height: [0.6, 1.4], biomes: ['river'], reach: 'near' },
    { from: 'plants', species: ['meadow_tussock', 'meadow_full'], density: 0.34, height: [0.3, 0.8], biomes: ['river'], reach: 'near' },
    // brambles and nettles, thick: this is the stuff that makes the edge of a Missouri trail a wall
    { from: 'plants', species: ['bush_green', 'bramble', 'nettle'], density: 0.06, height: [0.7, 1.8], biomes: ['forest', 'river'], reach: 'near' },
  ],
}

/** Anything without an ecology of its own gets a plain temperate one rather than nothing. */
const DEFAULT: Ecology = {
  variants: 2,
  season: 'summer',
  bands: [
    { from: 'trees', species: ['oak', 'birch', 'maple'], density: 20, height: [6, 16], reach: 'far' },
    { from: 'trees', species: ['spruce', 'fir'], density: 10, elevation: [900, 2200], height: [7, 17], reach: 'far' },
    { from: 'rocks', species: ['grey', 'mossy'], density: 12, slope: [0.3, 4], reach: 'far' },
    { from: 'plants', species: ['meadow_grass', 'meadow_full'], density: 0.26, height: [0.3, 0.7], reach: 'near' },
    { from: 'plants', species: ['wildflower', 'daisy'], density: 0.05, height: [0.12, 0.3], reach: 'near' },
  ],
}

export const ECOLOGIES: Record<string, Ecology> = {
  'alpe-dhuez': ALPE,
  'katy-trail': KATY,
}

export const ecologyFor = (routeId: string): Ecology => ECOLOGIES[routeId] ?? DEFAULT

/**
 * Which files a band wants, as the library's index names them.
 *
 * The index is the only thing that knows what was actually generated — the libraries are regrown from time to
 * time and the seeds change with them — so the files are chosen from it rather than written down here. Spread
 * across the seeds rather than taking the first few, because consecutive seeds of one species tend to be
 * consecutive sizes.
 */
export function pickFiles(
  index: Array<{ species: string; file: string; season?: string }>,
  species: string[],
  variants: number,
  season: Season,
): string[] {
  const out: string[] = []
  for (const want of species) {
    // `any` is rock and anything else the library does not grow seasonally
    let all = index.filter((e) => e.species === want && (e.season === season || e.season === 'any' || !e.season))
    if (!all.length) all = index.filter((e) => e.species === want)
    if (!all.length) continue
    const step = Math.max(1, Math.floor(all.length / variants))
    for (let i = 0; i < variants && i * step < all.length; i++) out.push(all[i * step].file)
  }
  return out
}
