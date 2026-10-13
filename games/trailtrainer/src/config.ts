/**
 * Every tunable in one place.
 *
 * The riding model is deliberately close to real: this is a training game, and a rider who knows what Alpe
 * d'Huez costs them outdoors should recognise what it costs them here. Nothing softens gravity — if a session
 * needs to be easier, that is the platform's difficulty scale, applied to the grade the game asks for, not a
 * number hidden in here.
 */
import type { SurfaceName } from './route/package.ts'

export const Config = {
  // --- session -------------------------------------------------------------------------------------
  /** 'bike' rides with measured power and can coast; 'treadmill' moves at the belt speed and cannot */
  deviceType: 'bike' as 'bike' | 'treadmill',
  routeId: 'alpe-dhuez',
  /** where to start along the route, in metres — a resumed session picks up where it stopped */
  startS: 0,

  // --- the rider and the machine -------------------------------------------------------------------
  riderMassKg: 72,
  bikeMassKg: 9,
  /** drag area, m²: a rider on the hoods */
  cdA: 0.35,
  /** air density at sea level, kg/m³; thinner the higher the route goes */
  rho0: 1.225,
  /** scale height of the atmosphere, m */
  rhoScaleHeight: 8500,
  /** drivetrain efficiency, chain to road */
  driveEfficiency: 0.97,
  /** rolling resistance by what the trail is made of */
  rollingResistance: { paved: 0.004, gravel: 0.008, dirt: 0.012 } as Record<SurfaceName, number>,
  /**
   * Power becomes force through P/v, which runs away as v approaches zero, so below this speed the power is
   * applied as if the rider were moving this fast. It has to be low: at 1.5 m/s, a rider putting out 180 W
   * gets 116 N, which is less than the 121 N gravity takes on a 15% ramp — so the model says they cannot
   * climb it at all, and they sit still on a road people ride up every summer.
   */
  minPropulsionSpeed: 0.5,
  /**
   * And a cap on the force that produces, because P/v at walking pace would otherwise hand a rider more push
   * than their tyres or their legs could give. Six hundred newtons is a hard standing effort.
   */
  maxPropulsionForce: 600,
  /** watts above which the cranks are turning */
  pedallingWatts: 10,
  /** hard cap on speed, m/s */
  maxSpeed: 25,
  /** lateral acceleration a rider will take through a bend, m/s² — the reason nobody descends hairpins flat out */
  corneringAccel: 3.5,
  /** how far ahead the rider looks for the next bend, m */
  cornerLookahead: 25,
  /** how hard the brakes come on when the corner cap is exceeded, 1/s */
  brakingRate: 1.6,
  /** treadmill: seconds of smoothing on the 1 Hz belt speed, for the eye only */
  beltTau: 0.5,

  // --- cranks and wheels ---------------------------------------------------------------------------
  wheelRadius: 0.35,
  /** wheel turns per crank turn, in the gear a climber would be in */
  gearRatio: 2.4,

  // --- what the game asks the machine for ----------------------------------------------------------
  /** seconds of smoothing, so a 1 Hz grade request does not chatter */
  gradeTau: 0.6,
  /** percent, the resolution of the request */
  gradeStep: 0.5,

  // --- the world ------------------------------------------------------------------------------------
  /** the detailed ground the rider is actually on: metres around them, metres square per chunk, metres per vertex */
  viewRadius: 560,
  chunkSize: 200,
  terrainStep: 5,
  /**
   * The far ring. Half of what a mountain road looks like is the other side of the valley, so the coarse ring
   * reaches as far as the route was baked. It is rebuilt only every few hundred metres, and drawn a little low
   * so the near ring wins wherever they overlap.
   */
  farRadius: 6000,
  farChunkSize: 2000,
  farStep: 50,
  farDrop: 4,
  farRebuildEvery: 240,
  /**
   * Metres around the rider where the coarse ring draws nothing, leaving the detailed ring to it. The two
   * rings disagree by up to eighteen metres on a steep hillside — a fifty-metre triangle chords across a road
   * cut the five-metre mesh follows — and that is far more than `farDrop` can sink out of sight. Has to stay
   * inside what the detailed ring really covers, which is about 600 m once its chunks are built.
   */
  farHole: 400,
  /** at most this many chunks are built in one frame, so streaming never drops a frame */
  chunksPerFrame: 3,
  /**
   * metres either side of the trail where the ground is pulled onto the trail's own profile. Narrow on
   * purpose: the profile comes from a metres-scale model and the surrounding terrain from a 30 m one, and on
   * Alpe d'Huez the two legs of a hairpin are only 30 m apart. A wide blend would heave the whole hillside.
   */
  corridor: 12,
  /** how wide the surface is, by what kind of route it is: a mountain road is not a rail trail */
  trailWidthByKind: { road: 5.0, trail: 3.0 } as Record<'road' | 'trail', number>,
  /**
   * Water (render/water.ts, render/materials/water.ts).
   *
   * `waterClarity` is the depth, in metres, at which the water has taken its full deep colour — the Missouri
   * carries silt and goes opaque in a metre, an alpine tarn is clear for five. `waterOpacity` is how much of
   * the surface is there before the sky reflection adds its own, and `waterGlint` how hard the sun's path
   * burns. `waterChop` scales the ripples; the reach is how far out water is built at all.
   */
  waterClarity: 1.6,
  waterOpacity: 0.62,
  waterGlint: 2.6,
  waterChop: 1,
  waterReach: 1100,
  /** metres square per chunk of water surface, and the spacing of its grid */
  waterChunk: 320,
  waterStep: 8,
  /**
   * The shape of the water itself.
   *
   * `waterShelve` is how fast it deepens away from the bank (one in eight, so ten metres out is a bit over a
   * metre down), `waterDeepest` the limit, and `waterLift` how far the surface is set above the level the
   * elevation model gave — a few tens of centimetres, because that model IS the water surface over a big
   * river and the two would otherwise fight for the same pixels. `waterShoreFade` is the width of the band the
   * surface fades in over, which is what hides the lift at the bank.
   */
  waterShelve: 0.13,
  waterDeepest: 3.5,
  waterLift: 0.35,
  waterShoreFade: 7,
  /**
   * How far the drawn ground may stand above the water's surface before the water is cut off there.
   *
   * It is the disagreement between two readings of the same elevation model — the surface is taken from it
   * straight, the ground has the trail carved into it and relief added over it — so it cannot be tight. Tighter
   * than the disagreement and a river dissolves into a lace of disconnected pools; looser and it climbs its own
   * bank. A metre and a half is comfortably over the relief the ground invents on a flat river bottom and well
   * under the height of any bank worth cutting the water off at.
   */
  waterBankTolerance: 1.5,

  /**
   * Dynamic resolution (render/resolution.ts), in render pixels per CSS pixel. It starts at `resolutionStart`,
   * climbs toward the device's own ratio (at most `resolutionMax`) while frames hold, and gives ground down to
   * `resolutionMin` when they do not. `resolutionProbeEvery` is how long it waits, in ms, before trying a step up.
   */
  resolutionStart: 1.5,
  resolutionMax: 2,
  resolutionMin: 0.85,
  resolutionProbeEvery: 30_000,
  /** ms after loading, or a jump along the route, before the controller judges anything */
  resolutionGrace: 12_000,

  /** set from the route when it loads */
  trailWidth: 4.5,
  /**
   * How far ahead a landmark's gate is put up (render/markers.ts). Far enough to be something to ride toward on
   * a long climb, and inside the distance at which the trail itself is still drawn.
   */
  markerReach: 700,
  /**
   * Metres right of the centre line the player keeps to, as anyone would on a road with two directions. Set
   * from the trail's width when the route loads — a quarter of the way out works on a five-metre road and on
   * a three-metre rail trail, where a fixed 1.1 m would leave nobody any room to pass.
   */
  laneOffset: 1.2,
  /** the fraction of the half-width the player rides at */
  laneFraction: 0.5,
  /** how close to the edge of the surface anyone will ride */
  laneMargin: 0.3,
  /**
   * Metres the rider drifts further over when somebody is about to pass them (see sim/companions.ts).
   *
   * Small on purpose. It is not a swerve; it is the shift anybody makes without thinking when they hear a
   * freewheel behind them, and on a three-metre trail it is the difference between a comfortable pass and two
   * people going through each other.
   */
  laneSwerve: 0.34,
  /** the trail surface sits this far above the profile, so the rider stands on it rather than in it */
  trailLift: 0.14,
  /**
   * How far the ground is cut below the trail's own profile inside the corridor. Without it, terrain posts
   * five metres apart either side of a climbing road sit at different heights along it, and the straight line
   * the mesh draws between them crosses the road — so on anything steep the ground slices up through the
   * tarmac. A shallow bed puts the surface reliably on top, and reads as the shoulder drop a real road has.
   */
  roadInset: 0.26,
  /**
   * How much relief is invented on top of the elevation model, in metres, on ground steep enough to have it.
   * The thirty-metre model is smooth between its posts, and bilinear interpolation of it reads as melted wax
   * rather than as a hillside; three octaves of deterministic noise put the ridges and gullies back. Small on
   * purpose — this is texture on a real landform, not a landform. See render/ground.ts.
   */
  reliefMetres: 2.2,
  /** the rider is moved back to the origin whenever it drifts this far, to keep float precision honest */
  originShift: 1000,
  /** metres of track drawn ahead of and behind the rider */
  ribbonAhead: 700,
  ribbonBehind: 220,

  // --- camera -----------------------------------------------------------------------------------------
  // Further back and lower than feels natural to write down, because what matters is where the rider ends up
  // ON SCREEN: the camera's height above them and its distance set how far below the view axis they sit, and
  // too far below puts them behind the route card at the bottom of the HUD.
  camBack: 8.4,
  camUp: 2.5,
  camSide: 1.9,
  camLookAhead: 18,
  /** how high above the rider the camera aims; lower brings the rider up the screen */
  camLookHeight: 0.8,
  camTau: 0.22,
  /** how quickly the camera's own heading turns to follow the road through a bend */
  camTurnTau: 0.3,
  camFov: 1.0,
  /** extra field of view at top speed, for the feel of it — small, or the rider drifts down the screen when slow */
  camFovSpeed: 0.05,
  /**
   * Giving way to trees. The boom shortens until the line from the rider to the camera is clear of trunks,
   * and comes back out more slowly than it goes in — a camera that snaps outward the instant a trunk passes
   * is worse than one that lingers, because lingering is only a closer view and snapping is a lurch.
   */
  camClearance: 0.7,
  camMinBack: 3.2,
  camDuckIn: 0.12,
  camDuckOut: 0.9,
  /** metres the camera keeps above the ground, whatever else it wants */
  camFloor: 1.1,

  // --- scenery ------------------------------------------------------------------------------------------
  /**
   * The air. `aerialDensityScale` multiplies each biome's own `fog` number, which was tuned when the air was
   * a flat blend, when the only thing distance did was wash a colour out, and they are too thin once
   * desaturation is doing that job as well: at the mountain biome's own 0.00035 the air does nothing at all
   * inside a kilometre, which is the whole of what a rider can see of a valley. The other two are what a
   * blend alone cannot do. Desaturation is the one
   * that matters most — a distant hillside loses its colour before it loses its darkness, and without this
   * the far side of a valley is the same green as the verge. See render/materials/aerial.ts.
   */
  /**
   * Measured against what the picture actually looked like: 2.4 was drowning everything past half a kilometre.
   *
   * At the prairie's own 0.0009 that scale puts 85 per cent haze on anything 800 m away, and at that strength
   * a tree line and the field behind it converge on the same pale grey — so the far trees came out lighter
   * than the grass, which is the "bright white trees" nobody could place. Real summer haze over Missouri
   * leaves a wood at a kilometre clearly darker than the field it stands in. Halving this keeps the depth
   * where the depth is wanted, across an alpine valley, and gives the middle distance its contrast back.
   */
  aerialDensityScale: 1.15,
  /** how much colour the air takes out at full distance, 0 to 1 */
  aerialDesaturation: 0.75,
  /** how much brighter and warmer the haze is looking toward the sun than away from it */
  aerialGlow: 0.55,
  /**
   * The most of a surface the air is ever allowed to take. Below one, so that a mountain on the skyline keeps a
   * little of its own colour — where the snow is, which side is in shade — instead of flattening to a
   * silhouette of sky. Ten per cent is enough: at four kilometres that is the difference between a shape and a
   * hole in the picture.
   */
  aerialKeep: 0.86,

  /**
   * The ground's own materials (render/materials/splat.ts). Rock takes over from soil by how steep the
   * shaded normal is, which is a finer test than the five-metre mesh can make per vertex: 0.34 is about one
   * in three, which is where soil stops staying put.
   */
  rockFromSlope: 0.26,
  rockToSlope: 0.62,
  /** metres per tile of the ground textures, close up and at the larger scale laid over it */
  splatTile: 2.6,
  splatMacroTile: 44,
  /** the same for the coarse ring, where a close tile would be a shimmering mess at two kilometres */
  splatFarTile: 26,
  splatFarMacroTile: 420,
  /** how hard the ground's normal maps bend the light; too much and a hillside reads as gravel */
  splatNormalStrength: 0.55,
  /**
   * How far the ground is pulled from the photograph's own colour toward the biome's. At 1 the textures
   * supply grain only and every biome is exactly the palette colour it always was; at 0 the Katy prairie and
   * the Alpe's lower slopes are the same olive as the photograph.
   */
  splatTint: 0.85,
  /**
   * Metres the ground's texture coordinates are bent by before they are tiled. A tiled photograph repeats,
   * and on flat open ground the eye picks the repeat out as straight lines along the texture's own axes; a
   * slow wave through the coordinates bends those lines into something that reads as ground. Roughly half a
   * tile is enough — much more and the grain itself starts to look like it is being stretched.
   */
  splatWarp: 1.3,
  /** how strongly rock is banded by its bedding; small, or a cliff reads as corduroy */
  splatStrata: 0.1,
  /** metres per tile of the trail's own surface, across it and along it */
  surfaceTile: 2.2,
  /** how strongly the wheels have marked the surface: tyre tracks, a polished crown, dirty edges */
  surfaceWear: 0.72,
  surfaceNormalStrength: 0.35,

  /**
   * Where a tree stops being geometry and starts being a photograph of itself (render/impostor.ts). Both are
   * drawn across the band and dissolve through each other, so this is a changeover rather than a switch.
   */
  /**
   * Where a tree stops being geometry and starts being a photograph of itself (render/impostor.ts).
   *
   * **The band between them is deliberately only three metres wide, and it used to be twelve.** Across the
   * band both are drawn and each discards a complementary half of its pixels, which is meant to be invisible
   * and is not: the two halves are of different things — a stippled half of real geometry and a stippled half
   * of a flat picture that is a good deal more compact — so instead of adding up to a tree they read as a
   * cloud of loose green specks hanging in the sky. Every tree inside the band showed it, which over twelve
   * metres meant several at a time, and it survived every explanation offered for it: it was blamed on the
   * leaf cut-out, on the atlas having no mip-maps, and on the alpha threshold, and none of those were it.
   *
   * Three metres is a third of a second of riding. What the dissolve was there to hide — a pop — is smaller
   * than what the dissolve was doing.
   */
  impostorFrom: 139,
  impostorTo: 142,
  /**
   * Where each level of detail of a tree gives way to the next, in metres, closest band first.
   *
   * A library tree carries three: an ash is 1122 triangles, then 389, then 173. The full model is only worth
   * its triangles for the trees a rider is riding past, so its band is short; beyond that, the difference
   * between the levels is a few pixels of canopy edge. The list is read from its END for a model with fewer
   * levels, so anything the generator did not decimate is simply drawn as itself.
   *
   * The changeover to the picture came in from 196 m at the same time. It could afford to be that far out
   * when every tree beyond it was drawn at full detail anyway — but the cost of the band between the last
   * geometry level and the impostor is the cost of a tree per tree, and at 148 m an eleven-metre tree is
   * about seventy pixels tall against an impostor tile of 192, so there is nothing in the picture to give it
   * away.
   */
  /**
   * Levels of detail by the ROAD (render/scatter.ts, `split`). A tree within the first figure's metres of the
   * trail is drawn at full detail, within the second at the middle level, and anything further out at the
   * coarsest. Because distance from the trail does not change as the rider passes, a tree keeps one level for
   * its whole pass; swaps happen only where they cannot be seen — at the far edge of the geometry, where the
   * impostor takes over anyway. Measured over a ride on each route: no tree in front of the rider within
   * 110 m ever changed level. Past `treeLodFar`
   * from the rider everything is coarsest regardless.
   */
  treeLodLateral: [22, 60],
  treeLodFar: 150,
  /** the same for ground cover — ferns, brambles, reeds — which only ever reaches the grass ring */
  coverLodFrom: [12, 30],
  /** grass cells whose middle is within this many metres of the trail draw their plants at full detail */
  coverFullWithin: 45,
  /** metres past which grass is drawn with the sparse tuft */
  grassLodAt: 22,
  /** metres from the rider past which no rock is placed at all (render/scatter.ts) */
  rockReach: 240,
  /**
   * How many triangles a model has to cost before it is worth photographing at all. A picture is two triangles
   * plus a draw call and an atlas, so something already cheap gains nothing by becoming one.
   */
  impostorWorthIt: 220,
  /**
   * Metres the rider travels before the instances are re-split between geometry and picture. Short, because
   * the overlap the split has to leave is twice this, and the wider that overlap the less the impostors save.
   */
  /**
   * Metres between re-splits. Smaller than it was (24): each re-split moves a band of trees across a level
   * boundary at once, and fewer at a time is less noticeable. Cheap now that the buffers are updated in place.
   */
  lodResplit: 12,
  /**
   * How many directions a thing is photographed from, as a grid over the hemisphere, and at what size.
   *
   * The atlas is `cells × tile` square, in RGBA, and every species that has one keeps one for the whole ride —
   * so this is video memory, per model, and it adds up faster than it looks. Eight by eight at 192 is a 1536²
   * texture: nine megabytes each, and with a dozen trees and a dozen rocks in a route's ecology that is two
   * hundred megabytes of atlas. Measured, that was enough to take the frame rate down by a third on its own.
   *
   * The tile only has to hold the thing at the size it is drawn, and the handover is at 136 m now rather than
   * 196: an eleven-metre tree is about seventy pixels tall there. 128 is comfortably over that and a quarter of
   * the memory. The near ones — rocks and bushes, handed over at forty-odd metres — are a couple of metres
   * across and need less again, and fewer directions with it: a lump is much the same from any angle.
   */
  impostorCells: 8,
  impostorTile: 128,

  /**
   * When a leaf card has turned far enough toward edge-on to stop being drawn (render/materials/card.ts).
   * `cardEdgeFrom` is where it has gone entirely; `cardEdgeTo` is where it is at full strength. Both are the
   * cosine of the angle between the page and the eye, so small numbers are nearly edge-on.
   */
  cardEdgeFrom: 0.05,
  cardEdgeTo: 0.34,
  /** the alpha a leaf has to keep, after that fade, to be drawn at all */
  cardCutFar: 0.06,
  cardCut: 0.45,

  /**
   * Which of the pre-generated trees to load, out of the library under `public/trees/`. A handful is enough:
   * what stops a wood looking stamped out is a few shapes at different sizes and rotations, not a different
   * tree for every tree.
   */
  treeFiles: [
    'oak_003.glb', 'oak_008.glb', 'oak_014.glb', 'oak_019.glb', 'oak_025.glb',
    'oak_030.glb', 'oak_034.glb', 'oak_037.glb',
    // the other species as the library regrows them; anything missing is skipped rather than fatal
    'maple_004.glb', 'maple_011.glb', 'birch_006.glb', 'beech_009.glb',
  ],
  /**
   * The BEST level of detail a tree is ever drawn at: 0 is the whole tree, 2 is a sketch of one.
   *
   * It used to be the ONLY one — every tree on screen, near or six hundred metres off, was drawn at this level,
   * which is why it was set to 1 rather than 0. The scatter now picks a level per tree from how far away it is
   * (`treeLodFrom`), so the full model is only ever paid for by the trees a rider is passing, and this is a
   * floor for a machine that cannot afford even those.
   */
  treeDetail: 0 as 0 | 1 | 2,
  /**
   * The tone curve at the end of every shader (render/sky.ts). Exposure above one lifts the whole image;
   * the ACES curve rolls the top off so that lifting it does not turn the sky and the road into white paper.
   */
  exposure: 1.55,
  contrast: 1.15,
  /**
   * How much light comes through a leaf from the far side (render/materials/leaf.ts). This is what makes a
   * canopy read as a canopy from underneath instead of as a dark ceiling, and it is the one lighting term
   * that could not be faked with more ambient, because it only applies where the sun is behind the surface.
   */
  leafThrough: 0.85,
  /** how tightly the glow gathers toward the sun; higher is a narrower, brighter halo */
  leafThroughSharpness: 2.0,
  /**
   * A gentle lift on the library's own materials. It used to be three and four times, which was not a
   * brightness setting at all — it was compensating for a colour-space bug that squared every one of their
   * textures (see render/treelib.ts). With that fixed, a little is all they want.
   */
  leafLift: 1.1,
  barkLift: 1.2,
  /** a trunk's radius as a fraction of the tree's height, for the camera to keep clear of */
  trunkRadius: 0.035,
  /** where a broadleaf crown starts, as a fraction of the tree's height */
  crownFrom: 0.32,
  /** how large the cloud pattern is drawn: smaller numbers give bigger clouds */
  cloudScale: 0.22,
  /** the sky is tone-mapped with everything else; this sets where it sits under that curve */
  skyBrightness: 0.82,
  /** how much of the sky is cloud, by biome: the Missouri gets more of it than the Alps */
  cloudCover: { prairie: 0.62, forest: 0.58, river: 0.64, mountain: 0.44, alpine: 0.36 } as Record<string, number>,
  /** how fast the deck drifts, in metres a second */
  cloudDrift: 2.5,
  /** how tall a library tree is planted, in metres, from smallest to largest */
  /**
   * How tall a library tree is planted, smallest to largest. A wide range on purpose: a wood of one-size
   * trees reads as a plantation, and what makes it a wood is saplings and half-grown trees under the full
   * ones. The library's own trees are all around twelve metres, so the range here is doing that work.
   */
  treeHeight: [3.5, 19] as [number, number],

  /** trees per hectare, by biome */
  /**
   * NOTE: what actually decides how thickly things grow is the per-band density in render/ecology.ts, not a
   * number here. A route's ecology knows that Missouri bottomland is not an alpine pasture, and one figure per
   * biome cannot. The old `treeDensity` and `bushDensity` knobs here were read by nothing at all and have been
   * removed rather than left to be tuned by somebody watching for a change that could never come.
   */
  /**
   * Grass, re-proportioned into a mat.
   *
   * The numbers here used to describe tussocks: a clump built 1.55 m across and up to half a metre tall, sown
   * fewer than one to the square metre. That is not what a verge or a prairie looks like from a bicycle — the
   * ground is COVERED, in something much shorter than it is wide, and what makes it read as cover is clumps
   * overlapping each other rather than each clump being large. So they are half the size, a little shorter,
   * with fewer blades each, and sown twice as thickly.
   *
   * It is cheaper as well as better, which is why the ring could come in at the same time. Grass was the
   * largest single thing in the frame and nobody had counted it: thirty-odd thousand clumps of 22 blades at
   * seven triangles each is over five million triangles, on a budget of one and a half. Nine blades, sown
   * twice as thickly over a ring two thirds as wide, is under half of that and looks more like grass.
   */
  grassDensity: { prairie: 2.3, forest: 2.0, mountain: 1.4, alpine: 0.5, river: 2.2 },
  /**
   * How much the ground's colour wanders at the hundred-metre scale (render/terrain.ts). Small: this is meant
   * to be read as ground that is not all the same, not as a pattern.
   */
  groundPatchiness: 0.10,
  /** metres tall a clump of grass is built, before each clump is scaled off it */
  grassHeight: 0.33,
  /** and how big a clump is drawn, before its own variation */
  grassClumpSize: 1.15,
  /**
   * Blades in a clump. Each is five triangles, so this is the number that sets what grass costs — and the
   * trade is a good one, because the blades are solid geometry and nothing about them is alpha-tested.
   */
  /**
   * Eleven made a fuller clump and the Katy paid for it: with the vegetation trebled the river bottom is bound
   * by geometry rather than fill, measured running no faster at a quarter of the pixels, and grass is a million
   * and a half of its triangles — each one through the wind and fade plugins in the vertex shader. Eight arched
   * blades still read as a tuft.
   */
  bladesPerTuft: 8,
  /**
   * Where the blades stand full height and where they have sunk back into the ground, in metres from the
   * rider. `grassFar` must stay inside the radius the sowing can GUARANTEE: the ring is re-sown only when the
   * rider crosses a cell, so between times they may be a cell and a half from where it was centred, and any
   * fade that reaches past that runs out of tufts and shows a bare crescent behind the rider.
   */
  grassNear: 26,
  grassFar: 50,
  /**
   * Metres around the rider that grass is drawn at all, traded against how thickly it is sown. What makes
   * ground look covered is tufts overlapping each other rather than tufts reaching further, so the density
   * comes first — but too small a ring puts the edge of the grass inside the part of the picture a rider is
   * actually looking at, and no amount of fading hides a line across the middle distance.
   */
  grassRadius: 72,
  /**
   * Metres square per cell of the grass grid. Small, because the ring is re-sown when the rider crosses a
   * cell edge, and the ring has to be sown wider than the material fades it by at least a cell and a half —
   * so the bigger the cell, the more tufts stand invisibly beyond the fade waiting for the next sowing.
   */
  grassCell: 14,
  /**
   * How far a tuft's colour is pulled toward the colour of the ground under it. This is the difference
   * between grass that belongs to a hillside and grass scattered on top of one; every stylised-grass shader
   * does some version of it, usually by rendering the terrain to a colour map first. Here the terrain's
   * colour is a function the renderer already has, so it costs a lookup.
   */
  grassGroundBlend: 0.72,
  /**
   * Brings the clump's colour up to where the splat leaves the ground it stands in. Much smaller than it was
   * when the grass was a photograph: a photograph brought its own colour and had to be dragged toward the
   * ground's, whereas a blade of geometry has only the colour it is given, so lifting it far turns a meadow
   * into spring onions.
   */
  grassLift: 1.0,
  /**
   * Metres of clearance a tuft's CENTRE keeps from the edge of the trail, to cover its own width.
   *
   * Only its own half-width, and no more. It was a metre and a half, which on both sides of a three-metre
   * trail left a three-metre strip of bare ground running the length of the route — and because the surface
   * texture beside a trail is deliberately worn and pale, that strip read as a second, brighter road either
   * side of the real one. Grass grows up to the edge of a rail trail and over it.
   */
  grassMargin: 0.62,
  /** nothing grows above this, in metres */
  treeLine: 1900,
  shadows: true,
  /**
   * How many other people are out on the route. Each one is a whole avatar-kit body, so this is the setting
   * that costs the most on a weak machine; ?others=0 turns them off.
   */
  companions: 3,

  // --- session bookkeeping --------------------------------------------------------------------------
  /** how often progress along the route is written down, seconds */
  saveEvery: 5,
}

export type ConfigShape = typeof Config

/** Query-string overrides, for developing and for debugging a specific spot on a route. */
export function applyQuery(search: string): void {
  const q = new URLSearchParams(search)
  const route = q.get('route')
  if (route) Config.routeId = route
  const device = q.get('device')
  if (device === 'bike' || device === 'treadmill') Config.deviceType = device
  const s = Number(q.get('s'))
  if (Number.isFinite(s) && s >= 0) Config.startS = s
  if (q.get('shadows') === '0') Config.shadows = false
}

/** Total moving mass: what gravity acts on and what has to be accelerated. */
export const totalMass = (): number => Config.riderMassKg + (Config.deviceType === 'bike' ? Config.bikeMassKg : 0)

/** Air density at an elevation, kg/m³. Alpe d'Huez's summit air is 12% thinner than the valley's. */
export const airDensity = (elevation: number): number => Config.rho0 * Math.exp(-Math.max(0, elevation) / Config.rhoScaleHeight)
