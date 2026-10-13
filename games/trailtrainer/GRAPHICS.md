# Graphics plan

How Trail Trainer gets from "coloured triangles on a real hillside" to a lush, serious-looking production —
without photographs of the trail, without a native engine's budget, and without touching the people on the
road (the rider and the companions come from the avatar kit and are being moved to their own codebase; nothing
in this plan changes them).

Phases 0, 1, 2 and the core of 3 are built (2026-09-20). Everything after them is still a plan. What Phase 0 changed, and the numbers it
replaced, are recorded in place below.

## 1. Where we are (2026-09-20)

Surveyed by reading `src/render/*` and by driving the running game to nine reference spots and screenshotting
each (Alpe d'Huez at s = 300, 2450, 3835, 6000, 9500, 13200; Katy Trail at s = 5000, 112000, 215000).

**What the picture is made of today.** Everything is vertex-coloured `StandardMaterial` with no textures, no
UVs, no normal maps, and no post-processing:

| Thing | How it is drawn | What it reads as |
|---|---|---|
| Ground (`terrain.ts`, `palette.ts`) | 5 m grid near, 50 m grid far; one colour per vertex from biome × slope × height, plus a sine "mottle" | Smooth green wash. Hillsides have no texture, no aerial perspective, no ridges — the 30 m model interpolated bilinearly looks melted |
| Trail (`trail.ts`) | 8-column ribbon, vertex colours, dashed line from duplicated columns | Flat grey/tan band. Good shape, no surface |
| Trees (`scatter.ts`) | 3 procedural meshes (cone, sphere-on-stick, polyhedron), thin instances, flat colour | Lollipops. The one thing that most says "placeholder" |
| Sky (`sky.ts`) | Vertex-gradient dome, exponential fog, one directional light + one hemispheric | Clean gradient, no clouds, no sun, far hills the same saturation as near ones |
| Shadows | 1536² PCF map, bodies only, 16 m box | Correct choice for the rider; nothing else casts |
| Lighting model | Blinn-Phong with specular off | No image-based light, no tonemapping |

**Two findings you cannot see in a screenshot:**

1. **The game ran on WebGL2, not WebGPU.** `main.ts` constructed `Engine` directly, while the avatar kit
   already exported `createEngine` (WebGPU first, WebGL2 fallback, `?engine=webgl` to compare). **Fixed in
   Phase 0**: the game now shares the kit's engine choice and runs on WebGPU. `preserveDrawingBuffer` went with
   it, because it is a WebGL-only option and a raw canvas read is blank under WebGPU; `INTEGRATION.md` now says
   the platform's session image has to go through `Tools.CreateScreenshotAsync`.
2. **The "road goes underground" bug is measured, and it is the far ring.** A ray-cast scan along the road,
   1.5 m either side of the centre line, comparing each ground mesh against the road's own height:

   | Alpe d'Huez, window centre | far ring above road, worst | at s | near ring above road, worst |
   |---|---|---|---|
   | 3400 | +4.4 m | 3720 | −0.19 m |
   | 4100 | +6.8 m | 3910 | −0.10 m |
   | 5500 | +6.2 m | 5330 | −0.21 m |
   | 6200 | +6.5 m | 6320 | −0.14 m |
   | 7600 | +6.2 m | 7520 | −0.16 m |
   | 9000 | +6.0 m | 9110 | −0.23 m |
   | 11100 | +4.7 m | 11310 | −0.14 m |

   The near ring is 0.1–0.25 m *below* the road everywhere sampled (the `roadInset` bed, working as designed).
   The road, the rider and the near ground all sample the same segment-projected profile, so their interpolation
   is consistent by construction — the user's hypothesis about coarse ground and limited road interpolation is
   right about the *coarse* ground and wrong about the road. Two causes, both in code we can see:
   - The far `Terrain` in `main.ts` is built with no `skipInside`, so it exists underneath the rider, and
     `groundHeight(..., 'far')` uses `nearestCoarse`, which is "good to about a hundred metres". On a hairpin the
     coarse index picks the other leg, 10–15 m higher, and `min(model, pulled) − farDrop` still lands 6 m above
     the tarmac. The 4 m drop only wins when the far ring is at most 4 m wrong.
   - Transiently, after a seek or at descending speed, near chunks stream at 3 per frame and the far ring shows
     through until they arrive.

   **Fixed in Phase 0**, and not the way this plan first proposed. Three changes, in increasing order of how
   much they mattered:

   - The coarse ring now projects onto the trail exactly, using the thinned index only as a cheap gate
     (`ground.ts`). This removes the wrong-hairpin-leg error, and on its own it was **not enough**: re-measured
     after the change, the coarse ring was still metres above the road.
   - The real cause turned out to be resolution, not indexing. A fifty-metre triangle chords straight across a
     gully or a road cut that the five-metre mesh follows properly, and measured against the near ring rather
     than against the road, the disagreement reached **18.4 m** — far more than any sensible `farDrop`. So the
     rings are separated in **depth** instead of in height (`layers.ts`): Babylon clears the depth buffer
     between rendering groups, so the near ring and everything standing on it is simply drawn over the coarse
     one. Sky is group 0, coarse ring 1, everything else 2. Anything added to the scene has to join group 2 or
     it is drawn under the ground it stands on.
   - Depth layering cannot help where the coarse ring is *above the camera* and the near ring below it: no near
     geometry projects onto those pixels, so the coarse ring becomes a ceiling and the ride appears to enter a
     tunnel. Measured at Alpe 7570, the coarse ring sat 7.1 m above a road the camera was 2.9 m above. So the
     coarse ring now draws nothing within `Config.farHole` (400 m) of the rider, via a `MaterialPluginBase`
     that discards fragments inside a radius, written in both GLSL and WGSL
     (`render/materials/nearHole.ts`). 400 m is safely inside the ~600 m the near ring is guaranteed to cover;
     a sweep of 160 points per spot across both routes found no uncovered ground once streaming settles.
   - A jump (`[`, `]`, or a resumed session landing mid-route) now builds the ground under the rider before the
     frame is drawn, so the hole is never empty during a seek.

   An unplanned benefit: freeing the coarse ring from the sky dome's depth, which is only 3 km across while the
   ring reaches 6 km, means the snow-capped Grandes Rousses are visible from the upper hairpins for the first
   time.

   **The one thing clearing depth gives up** is the coarse ring's ability to hide anything in the near layer
   behind it. In practice it has nothing to hide: everything in that layer is within the detailed ring's own
   reach, so the same hillside is in the same layer and occludes properly. The exception is the trail ribbon,
   drawn `Config.ribbonAhead` (700 m) up the road, past the detailed ring's 600. It does not show, for a reason
   worth writing down: where there are ridges to hide the road — a mountain — the road folds back on itself and
   700 m along it is a couple of hundred metres away, and where 700 m along really is 700 m away — a rail trail
   across Missouri — there is nothing to hide it behind. Checked by rendering a hairpin both ways, with the
   depth clear on and off: the two frames are the same. Worth re-checking if a route is ever added that is both
   steep and straight.

   A note for anyone using `__shot`: it builds both rings synchronously rather than waiting for them to stream.
   That is around half a second on the Katy Trail, where the route runs the length of every coarse chunk and
   so a great many of their vertices need the exact projection. That is right for a harness and wrong for anything on a hot path.

**Performance baseline.** The first figure taken — 37 fps at 2048×1536 under WebGL2 — was worthless: the
desktop app's browser pane pauses animation frames while it is hidden, which also produced several blank
screenshots that looked like rendering bugs and were not. That is the single best argument for the harness.

Measured properly by `npm run shots` on WebGPU, headless Chromium, Apple M4, 1280×800, without the rider:

| | draw calls | triangles |
|---|---|---|
| lightest (Katy prairie) | 33 | 104 k |
| heaviest (Katy forest) | 34 | 461 k |
| Alpe, typical | 36–43 | 170–356 k |

Every spot sits at the 60 fps vsync cap, so the frame rate says only that there is headroom, not how much.
Against the budget below — 150 draw calls, 1.5 M triangles — there is a great deal of room for Phases 1 and 3.

**A later correction, measured 2026-09-20: this frame is fill-bound, not triangle-bound, and the triangle
budget above is the wrong thing to steer by.** The evidence is an A/B rather than an argument. Giving rocks
impostors took the alpine spots from 5 M triangles to 2.4 M and the frame rate from a solid 60 to 33; taking
every impostor off put the triangles back and the frame rate back with them. An impostor trades triangles for
pixels at a terrible rate — a quad the size of the whole silhouette, mostly empty, `discard`ed rather than
depth-tested (which costs the early-Z), and thousands of them overlapping in no order — so it only pays for
something big and genuinely far away, which here means tall trees and nothing else.

What the triangle count IS good for is spotting things nobody has counted. Grass turned out to be the largest
single item in the frame at over five million triangles, which nothing in the picture suggested. So: read the
triangles to find what is there, and read the frame rate to decide whether it costs anything.

Against that: with per-distance tree LODs, cheaper blades and a tighter grass ring, the same spots measure
2.0–3.4 M triangles and 112–314 draw calls, all at 60 fps.

## 2. The target

Not photoreal. The reference is the Virtual Museum garden: textured card canopies, a ground that has grain
and grass detail, a painted-cloud sky, and distance that goes blue. Applied to a real hillside that means:

- **Ground you could kneel on**: grass, scree, soil and snow that read at 2 m and at 2 km, blended by the slope
  and height rules `palette.ts` already computes.
- **Trees that are trees**: leaf-card canopies with light through them, four to six species, tens of thousands
  on screen in the Katy forest, individually shaped but deterministic from position as now.
- **A road with a surface**: asphalt with wear lines and a painted edge, packed limestone with two tyre tracks,
  a soft shoulder into the grass instead of a colour boundary.
- **A sky with weather in it**: clouds, a sun, and haze that makes the Romanche valley recede.
- **Mountains that are mountains**: ridges, gullies, cliffs, scree fans and snow above the line — from the same
  30 m model, with fractal detail added deterministically where the data has none.
- **A lit image**: physically based materials, image-based ambient, tonemapping, ambient occlusion, real
  anti-aliasing, and shadows from the trees and hills as well as the bodies.

## 3. Constraints that shape every phase

- **Floating origin.** Any world-space texturing (triplanar, detail normals, grass placement, noise) must take
  `frame.x/z` as a shader uniform and add it back, or every texture jumps a kilometre at each origin shift.
  This is the single most likely bug in the whole plan.
- **Streaming.** Ground is built a few chunks per frame; scatter is rebuilt per cell. New materials and
  meshes have to stay cheap to *build*, not just to draw.
- **Two engines.** Shaders must run on WebGPU and WebGL2. The route with least maintenance is Babylon's
  `PBRMaterial` plus `MaterialPluginBase` plugins that supply both a GLSL and a WGSL snippet, keeping Babylon's
  lighting, shadows, fog and IBL. Hand-written `ShaderMaterial` in two languages is the fallback for the sky
  and grass, where we replace the lighting anyway.
- **Budget.** Targets: 60 fps at 1440p on an M-series Mac or mid desktop GPU at *high*; 30 fps at 1080p on an
  iPad-class device at *medium*. Frame under ~1.5 M triangles, under ~150 draw calls, under 300 MB of textures.
  Quality tiers follow the avatar kit's `suggestQuality` convention (`?q=low|medium|high`).
- **Determinism.** A tree at km 214 is the same tree every session and for every rider. All placement and
  detail noise stays a pure function of world position (`hash`, value noise), never of time or of the frame.
- **Out of scope.** Rider, bike, companions, their shadow generator's frustum reasoning in `main.ts`. The tree
  and terrain shadow work below is a *second* generator, so it never resizes the bodies' 16 m box.
- **Licensing.** Every downloaded asset is CC0 or tracked CC-BY, recorded in `CREDITS.md` the way the avatar
  kit tracks its MakeHuman assets. Poly Haven (CC0) is already in use for the studio HDRI.

## 3a. Asked for

**Built:**

- **The camera gives way, and drifts.** Two things, both measured rather than eyeballed.

  The boom now shortens until the line from the rider to the camera is clear of anything solid, and comes
  back out more slowly than it goes in, because a camera that snaps outward the instant a trunk passes is
  worse than one that lingers. It also refuses to go below the ground, which it did on road cuts.

  Trunks alone were the first attempt, on the theory that pulling in for every crown would leave the camera
  lurching through a wood. Measured over 1400 frames of forest, the camera essentially never entered a trunk
  — and still went through things, because what it was passing through was foliage: low crowns on young
  trees, conifer skirts, bushes, all at the height a chase camera flies. So obstacles now carry the height
  band they occupy, which is what keeps this from becoming the lurching: a crown three metres above the
  camera's head is not in its way and is not counted.

  Where it actually mattered was the hairpins, because a camera that lags the road through a bend cuts the
  inside of it. Over the same run on Alpe d'Huez: **24 frames inside foliage or wood before, none after.**

  The drift is two slow waves on each of the side offset and the height, at lengths that are not multiples of
  one another so nothing repeats in any noticeable time. Deliberately small — a camera operator breathing,
  not a drone.

- **Clouds and a sun** (`render/materials/sky.ts`). The sky was a gradient painted into the dome's vertices,
  which cannot do either: a sun is a small bright disc with a wide halo, and a twenty-segment dome has
  nowhere near the vertices to carry a disc; clouds have to move. Both are now worked out per pixel.

  The clouds are a painted deck, not volumes: the view ray is intersected with a flat layer overhead and the
  point it hits looked up in a few octaves of noise, which gives clouds that crowd together toward the
  horizon the way real ones do. They are lit from the sun's side, with darker undersides, which is most of
  what separates a cloud from a smudge. **The projection has to be clamped** — a flat deck seen at a shallow
  angle runs away to infinity and the noise with it, and the clouds stretch into thin streaks that read as
  scratches on glass. Cover is per biome: the Missouri gets more of it than the Alps.

- **Conifers, plants and rocks, and a per-trail ecology** (`render/ecology.ts`). The libraries now hold
  fourteen tree species across deciduous and conifer, thirty-odd plants in tufts, bushes, flowers and cacti,
  and nine kinds of rock. Everything the renderer used to fold out of cards — conifers, bushes, boulders — is
  gone, and the only generated geometry left is the grass blades, which nothing in the library replaces and
  which are cheaper as blades anyway.

  **A biome name cannot carry this.** The Katy Trail's "forest" is oak bottomland in Missouri; Alpe d'Huez's
  is beech giving way to spruce as the road climbs. Both would be handed the same trees and both would be
  wrong. So a route names its own ecology, and an ecology is a list of bands: what grows, how thickly, in
  which biomes, between which **heights**, and on what steepness.

  Elevation is what makes a mountain road read as one. Riding Alpe d'Huez you leave broadleaf woods at around
  a thousand metres, climb through spruce and larch, and come out onto turf and scree above the tree line.
  The elevation model knows every metre of that and the game was drawing the same wood from bottom to top.
  Bands overlap deliberately, so the tree line is a belt where both accept rather than a line ruled across
  the hillside.

  Two things learned from the library: every plant band has to give a **height**, because the library grows
  each plant at its own full size and a meadow of two-metre mulleins is not a meadow — the first pass had
  sunflowers as ground cover and they became the entire prairie. And the library grows each tree in **five
  seasons**, so without asking for one you get snow-covered winter firs in a summer conifer belt, which is
  exactly what appeared. Season is now part of the ecology, and it is also a lever: the Katy gets a scattering
  of autumn maples through its bottomland.

- **Impostors, and the thing that makes them worth having.** Re-enabled for trees over five metres, now that
  the colour-space fix explains the black atlases — and they needed a second fix of the same shape, because
  the atlas holds an already tone-mapped image and the impostor material was applying the curve again. It has
  a neutral one of its own now.

  **The dissolve alone saved nothing.** It discards fragments, so a tree at two hundred metres still had every
  triangle transformed and submitted: measured with impostors on and off at the same spot, the frame's
  triangle count was *identical*. To reclaim the geometry the distant trees have to stop being sent at all,
  which means two instance buffers and a rule for which one an instance goes in. That runs on its own clock —
  far more often than the scenery is re-placed, because it only re-buckets numbers that already exist, and
  far less often than every frame. The buffers overlap by twice how far the rider can travel in between, so
  nothing is ever in neither, which would show as a tree vanishing.

  At the Katy forest spot: **10.33 M triangles before, 5.48 M after.**

  The changeover band is ten metres wide at two hundred, where a tree is a few pixels tall. Narrow on
  purpose: the dissolve across it is a screen-door stipple, and a stipple seen through the gaps in a nearer
  tree's foliage reads as the near tree being stippled — which is why the wider band had to go earlier.

**Not yet started:**
- **Weather.** The ecology carries a season; it does not yet carry weather, and the sky's cloud cover is
  still set per biome rather than per route.
- **Draw calls have roughly tripled**, to about 190 on Alpe d'Huez, because every species is its own mesh
  and most are two (bark and leaves) plus an impostor. That is past the 150 the budget above assumed. Nothing
  is struggling at 60 fps, but merging bark and leaves into one alpha-tested material per species, or
  batching species that share a leaf atlas, is the obvious next economy.
- **The ecology lives in code**, not in the route package. Moving it into the baked route is what would let a
  new trail bring its own without a rebuild, and it is the change with consequences for the package format.
- **Water** — creeks, ponds and falls following the ground. Sketched under Phase 6.

## 4. Phases

Each phase names files, a rough effort, and the reference spot that proves it. Phases 1–5 are the production
look; 6 is what makes it *this* route rather than a generic one.

### Phase 0 — see clearly, and fix the ground — **done, 2026-09-20**

1. **Screenshot harness** — `tools/shots.ts`, driven by Playwright, with the spots in `tools/shots.json` and
   the output in `docs/shots/`. It records which engine it actually got rather than asserting, so a WebGL run
   is still a usable before-and-after. See `docs/shots/README.md`.
   - The page exposes `__shot(s, opts)`: seek, build the ground rather than wait for it to stream, snap the
     chase camera (`Chase.snap` — the chase camera lags on purpose, so free-running frames never line up),
     hide the HUD and the banner, then wait until every enabled mesh's material reports ready. That last
     condition matters more than expected: `scene.executeWhenReady` is satisfied while textures are still
     loading, and a frame taken then has white cut-outs in it.
   - Reference spots checked into `tools/shots.json`: the nine above, plus one each for a hairpin apex
     (Alpe ≈ 3835), the summit plateau (Alpe 13200), and a Katy bridge once Phase 6 bakes them.
   - Output: `docs/shots/<run>/<n>-<route>-<s>.png` and `stats.json`, from `SceneInstrumentation` after a
     1.5 s warm-up. Without the warm-up the first spot of a run reads at 2 fps, which is shader compilation
     rather than the scene.
2. **WebGPU** — done via the kit's `createEngine`. The session-image note is in `INTEGRATION.md`; that path
   is documented but has not been exercised, because nothing calls `sessionImage()` in the standalone game.
3. **Far-ring intrusion** — `ground.ts` / `terrain.ts` / `main.ts`:
   - Far-ring vertices within ~300 m of the trail use the exact `nearest` instead of `nearestCoarse` (the far
     ring rebuilds every 240 m, so ~1,700 exact projections per chunk is nothing).
   - Inside `corridor + RELEASE` the far ring takes the near ring's height minus `farDrop`, so it can never be
     the higher of the two there.
   - Belt and braces once materials exist: the far material discards fragments inside the near ring's radius
     around the camera (a uniform), so even a wrong far vertex is invisible under the rider.
   - After `seek`, call `terrain.fill` before the next render, so the transient gap never shows either.
   - Re-run the scan in §1; acceptance is a far-ring worst case at or below 0 m at every window.

### Phase 1 — terrain material — **mostly done, 2026-09-20**

Built: aerial perspective, invented relief, and the four-surface splat. Deviations from the plan below, each
for a reason found while building:

- **StandardMaterial, not PBR.** PBR without an environment map reads dark and flat, and supplying one means
  dragging Phase 4's sky-derived lighting forward. The standard material already gives a hook where both the
  ground's colour and its normal can be replaced, which is all a splat needs, and the far ring's existing
  plugin did not have to be ported. Phase 5's tonemapping works on either.
- **Aerial perspective replaces the scene's fog rather than adding to it** (`materials/aerial.ts`). Distance
  does three things and a fog blend is one of them: it takes the saturation out first, and the haze it adds is
  warmer looking toward the sun. The sun tint depends on which way the pixel is from the camera, which a
  scene-wide fog colour cannot know. The per-biome densities turned out to be far too thin once desaturation
  was doing its share — at the mountain biome's own 0.00035 the air does nothing inside a kilometre — so they
  are scaled by `Config.aerialDensityScale`, at 2.4.
- **Invented relief is on the detailed ring only** (`ground.ts`), three octaves scaled by how steep the
  elevation model already is, faded out by the same easing that releases the ground from the trail, so the
  road is never roughened. The coarse ring cannot carry a ninety-metre ridge on fifty-metre vertices. Costs
  0.6 ms per chunk, measured.
- **The splat is projected from world position, not from UVs** (`materials/splat.ts`), with `setOrigin` adding
  the floating origin back — set from `frame.onShift`, not from `update`, because the coarse ring skips most
  of its updates and would otherwise slide its ground a kilometre under itself.
- **Which surface shows is decided per pixel**, from the shaded normal and real elevation, because a
  five-metre mesh cannot resolve where a cliff starts. The one thing only the mesh knows — how far a vertex is
  from the road — rides in the vertex colour's alpha.
- **Two lessons paid for in wrong-looking frames.** Multiplying a biome colour into a dark photograph gives
  dark mud, and dividing the photograph's colour out channel by channel to compensate turns the prairie orange
  and acid green: a dark pixel's channel ratio explodes. What works is taking the light and dark in full and
  the colour only partly. And a tiled page repeats as straight lines along its own axes, worst on flat open
  ground; the coordinates are now bent by a long slow wave before tiling and the macro tile is turned forty
  degrees, neither of which costs a texture read.

Still open in Phase 1:

- **The corridor carve was a staircase, and texture is what made it visible — now fixed.** The faces beside
  the road streaked whichever way they were projected, which was the clue: the ground there was not a slope.
  Measured at Alpe 7570, between two points 2.5 m apart the nearest leg of the road changed to one 39 m higher
  up the hillside, and the carved ground stepped **24.4 m**. There was one of these for every pair of
  hairpins. The raw elevation model's worst slope in that square is 0.77; after carving it was 4.13, with 300
  grid cells past 45°. The carve was manufacturing cliffs the mountain does not have.

  The cause is that the carve only ever knew about the single nearest piece of road, so somewhere between two
  legs the answer switched outright. `Route.nearestPair` now returns the nearest point and the nearest point
  at least 150 m away along the route, and the carve weights the two by the cube of their distances
  (`ground.ts`). The cube is the working part: sharp enough that standing on the road the other leg moves the
  ground by a centimetre, so the surface still meets the ribbon exactly, and soft enough that crossing between
  them is a ten-metre ramp. After: worst slope **1.66**, and the road sits within **1 mm** of where it did.
  The ground between two hairpins is still very steep, which is right — two roads forty metres apart in height
  have something near a wall between them — but it is a surface now, not a discontinuity.
- **Rock is bedded.** Two frequencies of horizontal banding, applied only where there is rock.
- **Verified: the textures do not slide with the floating origin.** Ridden across the Katy Trail's 156 km
  origin boundary; both rings' projection origins tracked the shift exactly and the ground did not jump.

Still open from Phase 1:

- **The far ring reads noticeably paler than the detailed one** where they meet at the 400 m hole edge, which
  is visible as a washed-out hillside on the right at Alpe 2450. Some of that is the aerial perspective doing
  its job and some is the far ring's ten-times-larger tiling averaging to something flatter. Worth a look
  before the sky work, since Phase 4 changes the haze anyway.
- The rock layer has no stratification, and there is no per-pixel macro breakup beyond the second tile.
- The coarse ring is textured at ten times the tile size; the seam where it meets the detailed ring at 400 m
  has not been examined closely.

The original plan for this phase follows.

### Phase 1 — terrain material (about 4 days)

`src/render/materials/terrain.ts`, `terrain.ts`, `ground.ts`, `palette.ts`.

- **Triplanar splat on `PBRMaterial`** via a plugin. Four layers per biome — grass, dry/scrub, rock, snow —
  from CC0 albedo + normal + roughness sets (Poly Haven: e.g. `aerial_grass_rock`, `rocky_terrain`,
  `snow_02`, `forrest_ground`; 1k is enough, 2k for grass at high). The existing per-vertex `groundColour`
  weights become per-vertex *layer weights* (a 4-channel colour buffer we already have), blended in the
  fragment shader, so the palette rules stay where they are and just pick textures instead of colours.
- **Two scales.** A macro tile (50–80 m repeat) breaks up the near tile (2–4 m repeat) so the hillside doesn't
  show a grid from 500 m. The mottle sine becomes a value-noise macro variation in the shader.
- **Detail from nothing.** `groundHeight` adds 2–3 octaves of deterministic fractal noise outside the corridor,
  amplitude scaled by local slope (ridges and gullies on steep ground, near-flat prairie stays flat), so the
  30 m model stops looking melted. Because it lives in `groundHeight`, trees, rocks and both rings agree. The
  shader adds a finer normal-map octave from the same noise so the far ring gets the same character.
- **Slope-driven rock and scree** in the shader rather than per vertex: the 5 m grid can't resolve a cliff
  edge, the fragment shader can. Rock layer gets a subtle stratification (banding along a world-space axis).
- **Aerial perspective.** Replace exponential fog with a per-biome haze in the material: with distance, blend
  toward the haze colour *and* desaturate *and* lift shadows. Far ring gets it strongest. This is the cheapest
  single step toward "serious": in every mountain screenshot today the far side of the valley is as green as
  the verge.
- **Proves it at:** Alpe 6000 (Roche du Regardet: rock bands, scree, valley recession), Alpe 13200 (alpine
  turf and rock), Katy 5000 (prairie must *not* look like a mountain: flat, grassy, hazy horizon).

### Phase 2 — the trail — **done, 2026-09-20**

The road now has a surface, and it is the ribbon's own eight columns that make it work rather than replace
them. The columns already carry the worn shoulder, the surface and the painted line, all from what
OpenStreetMap says is there; the photograph supplies grain and the light and dark of a real surface, and the
colour of the road stays the ribbon's. Same division of labour as the ground, and for the same reason.

- **Coordinates come from the mesh, not the world**: `u` is metres across the road and `v` is metres along the
  route from its start. That is better than world projection here, because the surface is then pinned to the
  road — it cannot crawl when the ribbon is rebuilt behind the rider, it owes nothing to the floating origin
  since a station is a distance rather than a place, and the wear can be written in terms of where a wheel
  actually goes.
- **Which surface is per vertex, not per material.** The Katy Trail crosses four short paved stretches in 386
  km and the join happens in the middle of a drawn ribbon, so the surface rides in the vertex colour's alpha
  and the three are blended in the shader.
- **Wear is the part that sells it.** A rail trail gets two pale lines where tyres have pressed the limestone
  flat and a looser, darker strip between them; a mountain road is worn the other way round, polished where
  the cars run and dirty at the edges, and crowned so the middle catches the light.
- **One trap worth writing down**: the standard material only carries texture coordinates to the fragment
  shader if something is using them, so the trail material is given a diffuse texture purely to turn
  `vMainUV1` on. Babylon's sample from it is overwritten and costs one read.
- Normalising the photograph's brightness against too low a value turned tarmac the colour of new concrete.
  The divisor is now roughly what these pages actually average.

Not done from the original list below: no crack detail keyed on station, and no scuffed inside line at hairpin
apexes. The alpha-blended verge strip was not needed — the ribbon's existing shoulder columns, now textured,
already give the ragged meeting with the grass they were built for.

The original plan for this phase follows.

### Phase 2 — the trail (about 2 days)

`trail.ts`, `palette.ts` (`SURFACES`), `src/render/materials/trail.ts`.

- UVs on the ribbon (u across, v = station in metres). Surface textures per `SURFACES`: asphalt (CC0
  `asphalt_02`-class) for paved, packed limestone/gravel for the Katy, dirt for the third.
- Wear as a shader term: two darker tyre lines on gravel, a lighter crown and darker edges on asphalt, crack
  detail from noise keyed on station so it doesn't repeat every 4 m.
- The painted line becomes a texture strip (one column pair goes away), with edge wear; hairpin apexes get the
  scuffed inside line a real one has (curvature is already known per station).
- Shoulder: an alpha-blended verge strip a metre wide, ground texture over the trail texture, so the road meets
  the grass with a ragged edge instead of a colour boundary; gravel spill on the outside of bends.
- **Proves it at:** Alpe 2450 (asphalt, line, shoulder on a climb), Katy 112000 (limestone with tracks under a
  canopy).

### Phase 3 — vegetation — **core done, 2026-09-20**

The lollipops are gone. A tree is now a trunk and a crown of alpha-cut leaf cards, and the whole thing is
**cheaper than what it replaced**: the Katy forest went from 461 k triangles to 188 k, because a dozen cards
is twenty-four triangles where a sphere-on-a-stick was a hundred.

- **The foliage pages are built offline** (`tools/canopies.ts`, `npm run canopies`). Poly Haven's CC0 tree
  models carry their leaves as a page of loose parts — eight separate leaves on black, or a sheet with two
  twigs, five cones and a lot of bark. Eight leaves is the wrong unit: a card showing one leaf at crown size
  is a banana, and a canopy built from forty single-leaf cards is forty times the triangles for the same
  picture. So the parts are cut out by flood-filling the mask, filtered to the ones that are actually foliage
  rather than bark or a cone (by how green they are — that test alone throws away 334 of the fir sheet's 342
  blobs), and composited into a cluster with a fixed seed.
- **Cards are placed to survive being looked at from anywhere** (`render/trees.ts`). A crown of parallel pages
  vanishes edge-on, so each card faces a different way round the trunk and leans by a different amount.
  Conifer pages step up a spire and droop; broadleaf pages wrap a ball.
- **Card normals point out from the trunk**, not out of the page. A true plane normal makes a tree read as a
  stack of boards, one face lit and the next black.
- **Trunks are separate meshes** because they are opaque and the canopy is not, and one material cannot be
  both without alpha-testing the bark too. Two meshes per species, four draw calls rather than two.
- **Wind** (`materials/wind.ts`) is the only thing in this world that depends on the clock. It reads world
  position, so neighbouring trees lean together in gusts crossing the hillside, and scales by height up the
  tree, so a trunk's foot stays put. It moves `worldPos` in the vertex shader, which is the one place a thin
  instance can be nudged without rewriting every matrix on the CPU.
- **A lesson repeated from Phase 1**: tinting a green photograph with a green colour gives near-black. The
  first pass turned the Katy's woods into coal. The pages are drawn white and the biome's colour comes in as a
  light wash that also stands in for light coming through a leaf.

Fixed after looking at the first version:

- **The conifer was upside down.** Its pages narrowed to nothing at the top while its trunk ran the full
  height, so what you saw was a bare pole standing out of a dark bush. A fir is the other way round: bare
  trunk for the first fifth, foliage to a point. The crown now reaches the top with a minimum page size at the
  tip, and the trunk stops inside it.
- **You could count the sides.** Fourteen cards at evenly divided angles is a lantern, not a crown. There are
  now twenty-eight to thirty, spread by the golden angle rather than divided evenly, each rolled within its
  own plane and varied in size. Cards also carry an explicit direction rather than a yaw and a tilt, which is
  what lets a broadleaf's pages sit tangent to a ball and a conifer's droop outward and down like boughs.

**Ground cover** (added after the first version, because real ground is covered): bushes on the tree grid at
their own per-biome density, and grass on a grid of its own.

- Grass is a separate pass on a 26 m grid over a 52 m ring, at densities *per square metre* rather than per
  hectare, because there are three orders of magnitude more of it. Beyond that ring a tuft is under a pixel.
- It is rebuilt on its own clock. Trees reach 600 m and only need redoing when the rider crosses a 100 m cell;
  grass reaches 52 m and has to follow much more closely, and rebuilding thousands of trees at the grass's
  rate would be waste.
- **The placement hash was not good enough for this.** A tree cell asks it for a couple of dozen numbers and
  any weakness is invisible; a grass cell asks for a thousand, and drawing them from neighbouring counter
  values put the tufts on a faint lattice that read as a planted field. The streams are now separated by large
  offsets.
- Grass and bushes take their colour from the biome, like the ground does.
- What makes ground look covered is tufts overlapping, not tufts reaching further, so the ring was made
  smaller and the density raised — the same triangles buy far more of the first.

**Ground cover, second pass**, after reading what other people do about this. The techniques that mattered,
in the order they mattered:

- **Tint every tuft toward the colour of the ground it grows out of.** This is the one that turns grass from
  objects scattered on a surface into more of the same ground. Stylised-grass shaders do it by rendering the
  terrain to a colour map and sampling it; here the terrain's colour is a function the renderer already has,
  so it costs one lookup per tuft and rides in a per-instance colour buffer. Note the trap: the palette's
  ground colour is what the terrain would be *without* its textures, and the ground actually drawn has been
  through the splat and comes out considerably lighter, so matching the palette straight off still leaves the
  tufts visibly darker than the grass around them. The blend is lifted to where the splat leaves it.
- **Per-instance variation on top of that**, or a meadow is one flat colour.
- **Shade the foot of the page.** Grass sits in its own shade, and without it a tuft looks stuck on rather
  than growing. Done in the compositor, so it is free at run time.
- **Shrink tufts away at the edge of the ring rather than thinning them out.** Dropping tufts at random leaves
  the survivors full size against bare ground, which reads as a mown circle around the rider.
- **Aspect ratio was doing more damage than anything else.** The cards were three times wider than tall,
  which makes squat green pancakes. A tuft is about as tall as it is broad, and that silhouette is most of
  what says which it is.
- **Ring size is traded against density.** Density comes first, because overlapping tufts are what make ground
  look covered — but too small a ring puts the edge of the grass in the middle of the picture, and no amount
  of fading hides a line across the middle distance.
- **Fixed: tufts were lying across the road.** A tuft is placed by its middle and is most of a metre across,
  so keeping its centre off the tarmac left half of it on the road. The margin now covers the tuft's reach.

**Third pass**, on the things a ride showed that a still did not:

- **The edge of the grass was a hard line that filled in with a lurch.** The fade was baked into each tuft's
  size when it was sown, and sowing only happens when the rider crosses a grid cell, so for twenty-odd metres
  the edge stood still while the rider rode at it, then jumped. The fade is now in the vertex shader against
  the camera every frame (`materials/fade.ts`): each tuft is collapsed toward its own foot by its distance, so
  blades grow up out of the ground as the rider approaches. The ring is sown wider than the fade by more than
  a cell so there is always geometry standing ready, and the cell was shrunk from 26 m to 18 m to waste fewer
  tufts standing invisibly beyond it.
- **The leaves were a metre across.** Sixty-four leaves at a fifth of the page each, on a four-metre card, is
  a leaf the size of a dinner plate, and the crowns read as a bunch of giant leaves. Nine hundred at a
  twentieth of the page puts a leaf at about fifteen centimetres, and the card reads as a mass of foliage.
  Conifer sprigs likewise.
- **Tufts were boxes.** Blades running to the edge of the card give it straight sides, and every tuft stood
  to attention. The page now keeps its blades inside a margin so the silhouette is ragged, and each tuft
  leans a little its own way.
- **A harness-only black ground.** One reference spot came out with the whole near ring shadowed black, live
  it was always fine, and it went away once shadows were turned off in any shot without a rider. That is
  consistent with a shadow map nothing has been drawn into (the bodies are the only casters, and they are
  hidden) not being reliably empty under WebGPU, but the cause was not confirmed — only the fix, which stands
  on its own: no rider, no caster, no reason for a shadow pass.
- **Where the triangles go.** The grass is sown to 88 m but fully visible only to about 37 m and gone by
  about 59 m, so at any moment well over half the sown tufts are collapsed to zero height and still
  submitted. That is the price of keeping a cell and a half of geometry standing ready beyond the fade. It is
  fine at 60 fps and it is the first place to reclaim budget when Phase 5's shadows arrive.

**Fourth pass — grass became geometry, and trees grew limbs.** Driven by a survey of how other games do
this, which changed the approach rather than tuning it.

- **The grass is real blades now, not a photograph of grass on a card.** Every studio that has published on
  stylized grass draws individual blades as solid geometry, and the reason is that a card is alpha-tested:
  every blade-shaped hole is a shaded fragment thrown away, overlapping cards shade the same pixels several
  times over, and the cut edges alias. Triangles are nearly free on a modern part; overdraw is not. So a
  clump is now twenty-two blades of opaque geometry — forty times the triangles of the card it replaced, and
  the frame got no slower, because nothing in it is discarded.

  It also fixed what no amount of tuning had: a photograph of grass on a flat card has no silhouette of its
  own, cannot catch light along its length, and is a sheet from the side.

  Each blade is a quadratic Bezier — root, a control point, a tip bent over — with the normals **fanned
  across its width** so it reads as a rounded strap with a highlight down one side rather than a flat ribbon
  that flips from lit to unlit as it turns. That one detail is most of what stops procedural blades looking
  like paper. Root shade is baked into the vertex colours; the clump's colour still arrives per instance from
  the ground it stands in, and the two multiply.
- **Trees have a trunk that forks.** The reference that made this obvious is any photograph of a wood edge:
  what reads as a tree is the fork — a trunk dividing into limbs reaching up and out, leaves gathered at their
  ends, sky between them. A pole with a ball on top is a bush on a stick, and no work on the leaf page fixes
  that, because what is wrong is the silhouette. Limbs are tapered five-sided tubes, kept deliberately
  **inside** where their own foliage will be, since a limb reaching past its leaves is a bare pole sticking
  out of a tree.
- **Bushes are domes, not balls.** Run as a sphere, a bush's dozen cards left a hollow underneath and the
  thing appeared to hover over the ground — which is exactly what it looked like from the road.
- **The re-sow hitch, found by measuring rather than guessing.** Pushing the grass out to 86 m put 30,000
  clumps in the ring, and rebuilding that list took **53 ms** — a three-frame stall every time the rider
  crossed a cell. Nearly all of it was `groundHeight`, which projects onto the trail twice and reads the
  elevation model, called once per clump. It is now sampled on a lattice per cell and interpolated between:
  the terrain mesh itself only has a vertex every five metres, so a lattice at that spacing describes the
  same surface a clump would have stood on anyway, and the same samples give the slope the tint needs for
  free. **53 ms → 16 ms**, and the saved budget went into blades.
- **Two fade bugs.** Deriving the fade's near and far from the ring radius produced near > far, so grass
  collapsed close to the camera and stood up in the distance. And collapsing only a blade's HEIGHT left a
  dark flake of it lying on the ground, several thousand of which turned the ground black out to the edge of
  the ring; the whole offset has to go.

**Fifth pass — octahedral impostors** (`render/impostor.ts`, `render/materials/lod.ts`).

A distant tree is now one square showing a photograph of itself from whatever angle you happen to be looking
from. The tree is photographed at load from an 8×8 grid of directions over the hemisphere, folded onto a
square by the octahedral mapping — centre of the square is straight above the tree, edges are the horizon, no
seams and no poles — and the shader picks the nearest cell from the view direction in the tree's own frame.

The reason this can be baked at load rather than offline is that **the sun never moves in this game**. A baked
picture carries its lighting with it, which is normally the awkward part of impostors; with a fixed sun the
light in the picture is the light the real tree would have had. The changeover is a screen-door dissolve: over
the band both the geometry and the picture are drawn, each discarding a complementary set of pixels, so the
sum is always a whole tree and nothing pops.

Five bugs, each of which produced nothing or produced rubbish, and all of them worth writing down:

1. **The bake drew nothing, because a clone of a thin-instance mesh is still a thin-instance mesh.** Turning
   its instance count down to photograph one tree turns it down to none. The copies are built from extracted
   vertex data instead.
2. **The tree's own handover discarded it during its own photograph.** The bake puts the tree at the origin,
   which is a long way from wherever the rider is, and at that distance the geometry has already dissolved
   away. The handover is suspended for the length of the bake.
3. **The bake ran before the leaves arrived.** Textures load from the network after the trees are built, so a
   tree photographed on the first frame is photographed bald. It now waits — and the obvious test, asking the
   material whether it is ready, is the wrong one: `isReady(mesh)` on a mesh carrying thin instances answers
   no for reasons that have nothing to do with the bake, and the trees waited forever. It asks the textures.
4. **`vEyePosition` is a fragment uniform.** A billboard has to be turned to face the camera in the vertex
   shader, which cannot see it, so the eye position is passed again.
5. **Mipmaps on an atlas average the neighbouring pictures together**, so every impostor came out a pale ghost
   of several trees at once; and the atlas holds gamma-encoded pixels which were then gamma-encoded a second
   time on the way out. Mipmaps off, and the sample linearised.

And one that was not the impostors at all: **a shadow map with nothing drawn into it does not reliably contain
nothing.** With the bodies hidden — which the screenshot harness does — the whole near ring came out shadowed
black. The road is now always a caster: it lies flat on the ground so it costs nothing and casts nothing, but
it keeps the map honest. This replaces the earlier harness-only workaround, which had stopped working.

Trees also lost their ball shape in this pass: the spherical shell of cards is down from twenty-two to seven,
the limbs are up from five to seven, and their lengths are spread much more widely, because limbs of one
length put every cluster of leaves on one sphere — which is the ball it was trying to stop being.

**Sixth pass — the crowns.** Looking at one tree close up, against the sky, is what showed the problem: the
crown was three or four leaf pages each a third the width of the whole tree. From any angle you were looking
at two or three flat slabs, which is why it read as a lump however the limbs underneath were arranged. The
pages are now a quarter that size and there are eight times as many, spread along the whole length of each
limb rather than bunched at the tip — the same triangles, a broken edge, and gaps for the sky to come through,
which is most of what says "tree" at a distance. Limbs are shorter and thinner to stay under their own leaves.

Two bugs found by that close-up, both of which had been invisible from the road:

- **The impostors were black.** The atlas holds exactly what the standard material wrote to the screen, and
  this material writes to the screen the same way, so there is no encode on the way out to undo. Linearising
  the sample on the theory that there was turned every impostor black — and it was only visible from a camera
  far enough from the rider for the handover to have happened, which the reference frames never are.
- **Feeding the shadow map the road put every tree in shadow.** The box is sixteen metres across so the
  rider's own shadow is crisp, and a seven-hundred-metre ribbon in a sixteen-metre box is not a caster, it is
  a wall. Reverted: with no rider there is simply no shadow pass, which is the harness's problem only.

**Seventh pass — the pre-generated tree library.** The project now grows its trees offline: a library of glTF
files under `public/trees/`, ten species with many seeds each, three levels of detail apiece, with the
species, height and crown radius written into each file's own glTF extras. They are far better than anything
assembled at run time out of quads — proper forking trunks, leaves clustered the way that species clusters
them, autumn colour on some — and everything in `render/trees.ts` that built a broadleaf out of cards is now
unused for them (the conifers and bushes still use it until their libraries arrive).

- **Only a handful are loaded** (`Config.treeFiles`). A wood stops looking stamped out after a few shapes at
  different sizes; loading all of them would be tens of megabytes for a difference nobody could see from a
  bicycle. Each loaded tree is its own species as far as the scatter is concerned, with its own instances, and
  a clump picks between them by hash.
- **Their materials are converted to StandardMaterial on the way in** (`render/treelib.ts`). Everything this
  renderer does to vegetation — the air, the wind, the handover — is written against the standard material's
  shader, whose injection points and variable names are not the physically based one's. Converting once at
  load is far less work than keeping two versions of each, and nothing in these trees needs what the physically
  based shader offers: they are lit by one sun, and they are leaves.
- **Nothing depends on an index file.** The library was regenerated mid-session and its `index.json` vanished;
  the metadata is in each glTF's extras anyway, and failing that a tree is measured as it loads.
- **A glTF mesh of several primitives arrives as a parent with one child per primitive**, so the bark and
  leaves of `LOD0` come through as `LOD0_primitive0` and `LOD0_primitive1`. Matching on the prefix catches
  both shapes.
- Planted at `Config.treeHeight`, which is deliberately a wide range: the library's trees are all around
  twelve metres, and a wood of one-size trees reads as a plantation. Density is up roughly two and a half
  times.
- The scene's ambient was raised well up at the same time. Everything here that reads badly reads badly by
  being too dark — a leaf in shade, the inside of a crown, the underside of a tree — and with no bounced light
  beyond that one number it has to do the work of all of it.

**Open, and the one real regression:** library trees are drawn as geometry the whole way out, with no impostor
behind them. They should have one — a tree at two hundred metres has no business costing fifteen hundred
triangles — and the machinery works for the trees this renderer grows itself. It does not work for these:
their photographs come out almost black (brightest opaque pixel about a quarter value) although the trees
themselves render correctly in the same frame, with the same materials and the same sun. Something about how
the converted materials light inside a render target differs, and it has not been run down. Black bars in the
middle distance are much worse than the triangles, so for now they are geometry, and the frame still holds
60 fps at up to 8.7 M triangles.

**Eighth pass — the lighting, which was the thing actually making everything dark.** Several passes had been
spent raising diffuse multipliers and ambient to fight it, which is the wrong lever: those lift the half of
the picture that was already correct along with the half that was not. Two things were missing.

- **There was no tone mapping or exposure at all.** Without it the shader's output is whatever the lighting
  arithmetic produced, clipped at one, so anything lit only by the ambient term lands near the bottom of the
  range and stays there. The scene now has an ACES curve and an exposure above one, set on
  `scene.imageProcessingConfiguration` rather than through a post-process pipeline, so the standard material
  applies it in its own fragment shader at no extra cost.
- **Light does not come through a leaf** (`render/materials/leaf.ts`). Stand under a tree on a sunny day and
  the canopy is bright saturated green, because a leaf is thin. Treated as an opaque surface it gets the
  negative dot product, receives only ambient, and the whole canopy over the rider comes out black — which is
  exactly what it did. The fix is the standard stand-in for subsurface scattering: a term for light arriving
  through the back, tinted because what comes through a leaf has been filtered by it, and sharpened toward the
  sun because a canopy glows most when you look into the light.

  One detail decided whether it worked: it has to read the **shaded** normal, not the raw varying. A leaf
  material is two-sided, so Babylon has already flipped the normal to face the viewer; the varying still
  points whichever way the triangle was wound, and reading that left half of every canopy asking for light
  through a face that was not facing away, getting none, and staying black.

**Ninth pass — dark trunks, and things showing through them.**

- **The dissolve is gone.** A screen-door stipple works when you are looking at one tree. Looking through a
  wood it does not: a nearer tree's own foliage is alpha-cut, and through every gap in it you see the stipple
  of the trees behind, which reads as the near tree being stippled. With the broadleaf trees now drawing as
  geometry the whole way out, the conifers were the only thing still doing it, and it was not worth the
  artefact for one species that is itself about to come from a library.
- **What was "shining through" the trunks was edge-on leaf cards.** The library's leaves are flat pages like
  everything else, and a page seen edge-on is a sliver a pixel or two wide. Crossing a dark trunk those
  slivers read as something behind it showing through, and in motion they crawl. The renderer's own foliage
  had been given a fade for exactly this and the library's had not; it now has the same one. (Checked first
  that it was not a depth-ordering fault: every piece of scenery is in one rendering group and every one
  writes depth.)
- **Trunks were too dark**, and not for the reason it looked. The bark texture is an ordinary mid-tone, and
  the vertex colours the generator bakes in are mild — 0.94 on average, measured. It was simply that a trunk
  is a cylinder with one sun on it and no bounced light: the shaded side had only the ambient term. Lifted,
  along with the ambient itself.
- **Both leaf fades now read the SHADED normal**, not the raw varying, for the same reason the transmission
  had to: these materials are two-sided, so Babylon has already turned the normal to face the viewer.

**Tenth pass — the trees were dark because their textures were being gamma-corrected twice.**

This is the one that had been hiding behind everything. The glTF loader uploads a base-colour texture as
sRGB, because the physically based shader wants a linear value and lets the hardware convert on every sample.
The standard material wants the opposite: a texture that is already display-ready, which it linearises itself
at the end of the frame now that image processing is on. Hand it the loader's texture and the curve is applied
twice — a mid-tone bark at 0.35 arrives as 0.09 — so a whole wood came out nearly black while every other
surface in the scene, whose textures this renderer loaded itself, was correctly lit.

Setting `gammaSpace` afterwards does nothing: the format was decided when the image was uploaded. The fix is
to load the same file again as an ordinary texture, which is cheap because the browser has it cached and a
handful of bark and leaf pages are shared across the whole library. Two traps on the way: the loader records
the path with a spurious `data:` prefix, and a texture asked for by that name fails silently, which looks like
trees with no bark rather than an error.

**How long it hid is the lesson.** Four passes were spent raising diffuse multipliers, emissive terms and the
ambient light against it. Each helped a little and none of them fixed it, because a squaring is a curve and no
amount of scaling undoes a curve. The multipliers are now back to about 1.1, where they belong.

This very probably explains the **black impostors** as well, which is the next thing to check: the impostor
bakes the tree into a render target, and a tree that renders dark photographs dark. The measured atlas — a
brightest opaque pixel around a quarter value — is about what a doubly-darkened tree would give.

The loader also skips a tree it cannot load rather than failing the ride, because the library is regenerated
from time to time and a missing or half-written file should cost one tree, not the session.

Still open in Phase 3:

- Blades are still a little fleshy close up, and a clump is one hue at several brightnesses.
- ~~A few leaf pages catch the light edge-on and show as bright slivers.~~ **Fixed**: a page seen edge-on is a
  bright sliver a pixel or two wide that reads as a shard of glass in the tree, and it is the artefact that
  gives card foliage away fastest. A card now stops being drawn before it gets there
  (`render/materials/card.ts`): the card's own vertex normal is the direction it faces, so how square-on it is
  to the eye is one dot product, and the fade is folded into the alpha the leaves are already cut out with, so
  the page thins away rather than snapping off. The pages behind it are still there, so the crown does not
  thin. Cards were shrunk again at the same time, to roughly a fifth of the crown's width, with more of them.
- ~~Cards floating clear of the tree.~~ **Fixed**, and it was two separate causes. The pages on each limb were
  scattered up to half a crown-radius off it, and a page on its own away from the mass has no other pages to
  read as part of, so it reads as a leaf the size of a door hanging beside the tree. And a shell of pages was
  laid over the whole crown owing nothing to the limbs at all — every one of those was a floater by
  construction, and it is gone; a bush is nothing but such a shell, a tree has limbs to hang its leaves on.

  The spread that replaced it widens toward each limb's tip, the way a branch ramifies, because a constant
  spread is a trap at both ends: wide all the way and the pages nearest the trunk hang in mid-air; tight all
  the way and each limb becomes a green sausage that never merges with the next. Limbs also reach out more
  than up now — limbs that mostly climb give a tall narrow crown on a long bare pole — and the leaves run
  just past each tip so no bare wood shows on the end.
- The handover is at 230–330 m, which is far enough that the impostors buy back less than they could. Closer
  would be cheaper; the limit is how well the picture matches the geometry, which has not been measured.
- Trunks are still on the dark side in a forest, even after two lifts.
- Alpha-tested foliage at distance erodes through the mipmaps; alpha-to-coverage under the engine's MSAA is
  the standard answer and is worth trying in Phase 5.
- The grass re-sow is still a 16 ms hitch every cell crossing. Spreading it over several frames is the fix
  when it starts to matter.
- **No clustering.** Trees and bushes are still spread at even density within a biome, so a wood has no edges
  and no clearings. A second low-frequency noise gating density is the plan.
- There is still nothing on a forest floor — no ferns, no logs, no fallen leaves.
- **No impostors, and they may not be needed.** The whole point of them was to make card trees affordable at
  distance, and card trees turned out to cost less than the geometry they replaced. Revisit only if the
  density work pushes the budget.
- Trees still do not cast shadows, for the reason in `main.ts`: a shadow frustum big enough to hold them
  gives the rider's own shadow about two pixels. That is Phase 5's cascaded-shadow work, not this one.

The original plan for this phase follows.

### Phase 3 — vegetation (about 6 days; the biggest visible step)

`scatter.ts` → `src/render/vegetation/{species,impostors,grass}.ts`, `CREDITS.md`.

- **Species.** Decision: download a *small* set rather than model in code. Four to six species at ≤3 k
  triangles each with alpha-tested leaf-card canopies: two conifers (spruce for Alpe, cedar/pine for Katy), two
  broadleaf (oak/maple and cottonwood/sycamore for the river bottoms), one shrub, one bare/dead tree for the
  alpine band. Sources in order of preference: Poly Haven models (CC0), Kenney Nature Kit (CC0, but stylised
  and untextured — only if the others fail), Sketchfab CC0/CC-BY with the attribution tracked. Every candidate
  must be *one mesh, one atlas* or be split into trunk+canopy parts on import, because scatter draws thin
  instances of one mesh per species.
  Fallback if no acceptable pack exists: keep procedural geometry but replace the sphere with 6–8 intersecting
  leaf-cluster cards using a CC0 leaf atlas, which gets 80% of the look.
- **Materials.** PBR with alpha test, two-sided, a translucency term (light through leaves: cheap
  wrap-lighting in the plugin, not full SSS), per-instance colour variation (autumn tint on the Katy river
  band, darker conifers at height) from a per-instance buffer, and a wind vertex offset from world position
  and time (the *only* thing allowed to depend on time).
- **Impostors.** At startup, render each species from 8 yaw angles into an atlas (`RenderTargetTexture`),
  and draw everything beyond ~150 m as billboards. This is what lets the Katy forest be a forest (22/ha over
  a 1 km ring is ~7,000 trees) at a few draw calls. Cross-fade between mesh and impostor over 20 m.
- **Placement stays deterministic** from `hash`, but gets smarter: clustering (a second noise gates density so
  woods have edges and clearings), no trees on the road bed or on >40° ground, riparian species near the river
  once Phase 6 bakes water, and a tree-line band where conifers thin and stunt before stopping.
- **Grass.** Within ~40 m of the camera, thin-instanced blade clumps (a 12-triangle mesh, 3 blades) with wind,
  fading with distance and density scaled by the grass layer weight. Dry/alpine biomes get sparser, yellower
  clumps; forest floor gets ferns from the same mechanism. This is the museum-garden "grain" at your feet.
- **Ground clutter.** Rocks become 3–4 CC0 boulder meshes (Poly Haven has several) with the same impostor
  path; small stones and logs on the forest floor from the extra-per-cell slots that are rocks today.
- **Proves it at:** Katy 112000 (dense forest either side, canopy over the trail), Alpe 2450 (mixed forest on a
  slope), Katy 215000 (open river bottom with big broadleaf), Alpe 9500 (mountain conifers thinning).

### Phase 4 — sky, light and weather (about 3 days)

`sky.ts` → `src/render/sky/{dome,clouds,ibl}.ts`.

- **Analytic sky** in a `ShaderMaterial` (GLSL + WGSL): a Preetham/Hosek-style gradient with a sun disc and
  halo, driven by the fixed sun direction. Keeps the README's decision that the light is the same every session;
  a time-of-day option is flagged as a later choice, not taken here.
- **Clouds.** A cirrus layer (scrolling FBM on a high dome band) and cumulus (a second, chunkier noise with a
  lit/shadowed edge from the sun direction) — painted, like the reference, not volumetric. Per-biome cover:
  more over the Missouri, less over the Alps; a `?weather=` override for overcast, which also flattens the sun
  and raises the ambient.
- **Image-based light.** Generate a small environment cubemap *from the sky shader* at load (and on weather
  change) and use it as the scene's IBL, so PBR ground and leaves are lit by the sky they're under. Sun as
  the directional. Hemispheric light goes away.
- **Haze and horizon.** The aerial-perspective term in Phase 1 reads the same haze colour and sun direction,
  so far ridges catch a warm rim toward the sun and go cool away from it.
- **Snow.** The baked Alpe model reaches 3,399 m and the palette's snow line is 2,650 m. Checked in-page:
  13,653 posts sit above the snow line, 9,799 of them within the far ring's 6 km, the nearest 3.1 km from the
  road. So the far ring *can* show the Grandes Rousses in snow once it is textured — today it never does
  because the whole near scene is under 1,850 m and the far ring is the same flat green at every height. Plan: snow on the far ring by height as
  designed, plus a per-route `season` in the manifest (`?season=winter` for testing) that drops the snow and
  tree lines so the upper hairpins can be ridden through snowbanks. Snow gets its own layer in the terrain
  splat (sparkle from a high-frequency normal, blue in shadow) and a drift shape at the road edge from the
  shoulder strip in Phase 2.
- **Proves it at:** Alpe 13200 (sun, clouds, snow peaks on the far ring), Katy 5000 (big prairie sky, low
  cumulus, hazy flat horizon).

### Phase 5 — post-processing and scenery shadows (about 2 days)

`main.ts`, `sky.ts`, `src/render/post.ts`.

- `DefaultRenderingPipeline`: ACES tonemapping with exposure/contrast per biome, FXAA on WebGL and MSAA on
  WebGPU, a light bloom for the sun and snow, a faint vignette, optional colour-grading LUT. SSAO2 at medium
  and high (this is what grounds trees and rocks on the ground).
- **Cascaded shadows** for terrain, trees and rocks: a `CascadedShadowGenerator` on the sun, 3 cascades,
  2048², `shadowMaxZ` ~400 m, trees casting via thin instances, ground receiving. Separate from the bodies'
  PCF generator, which keeps its fixed 16 m box (see the comment in `main.ts` for why that box must not grow).
  Two generators on one light needs care: Babylon supports one per light, so the scenery generator goes on a
  second `DirectionalLight` with the same direction, `shadowEnabled` only for scenery casters and the bodies
  excluded, and intensity zero for lighting (or the bodies' generator moves to the second light — decide when
  building, it is a one-line difference).
- **Proves it at:** Katy 112000 (tree shadows across the trail, AO under the canopy), Alpe 3835 (hillside
  self-shadow in the hairpin).

### Phase 6 — the things that make it this route (about 5 days, needs the baker)

**Water, in more detail, because it is the hard one and it is wanted.** Creeks, ponds and falls have to follow
the ground rather than sit on a plane through it, and that is a different problem from everything above:

- A pond is a level surface, so it is a plane, and the work is finding where its edge meets the ground — which
  means the ground has to be *lower* than the water there, and the baked corridor has to know a basin exists.
- A creek is not level. It follows the fall line, so it needs a centreline with a width and a depth, carved
  into `groundHeight` the same way the trail's corridor is carved, with the water drawn as a ribbon along it.
  That is the same machinery as `render/trail.ts` and should reuse it.
- A fall is where that centreline's gradient exceeds something steep, and is a different piece of geometry
  again.
- OpenStreetMap has all three: `natural=water` polygons, `waterway=stream`/`river` ways, `waterway=waterfall`
  nodes. The baker can carry them the way it carries the route.
- Order: carve first, then draw. Water that does not sit in a bed it has cut looks worse than no water.

`tools/bake.ts`, `tools/overpass.ts`, `src/route/package.ts`, new `src/render/features.ts`.

- **Water.** Bake OSM water polygons and waterways in the corridor (Romanche, Missouri, creeks). Draw as a
  flat reflective plane per polygon with a scrolling normal map and the sky's IBL, ground pulled to bank
  height. The Katy river biome without the Missouri beside it is the biggest missing landmark.
- **Bridges and cuts.** OSM `bridge=yes` on the route ways → a simple trestle/deck mesh and a gap in the
  ground; `cutting=yes`/`embankment=yes` → the corridor's release width changes so the ground rises or falls
  beside the trail the way the rail bed does. The Katy's bluff-side stretches (Rocheport) are rock cuts and
  should look like it.
- **Hairpin furniture.** Alpe's 21 bends have numbered signs; curvature already finds the apexes. Stone
  retaining walls on the uphill side of steep sections (`groundHeight` gradient across the road tells us which
  side). Kilometre posts. A few buildings at the towns the landmark list already names — flat-roofed boxes with
  a CC0 render facade are enough at 100 m.
- **Biome edges.** Fields on the prairie (rectangular colour patches from noise aligned to the road bearing),
  hedgerows, a cleared strip of meadow around the villages.
- Each of these is a baker addition plus a renderer feature and can ship independently.

### Quality tiers (throughout)

| | low | medium | high |
|---|---|---|---|
| Render scale | 0.75 | 1.0 | 1.0 |
| Terrain textures | 512, no detail normal | 1k | 2k grass, 1k rest |
| Trees as meshes within | 60 m | 120 m | 180 m |
| Grass radius | off | 25 m | 45 m |
| Scenery shadows | off | 2 cascades 1024² | 3 cascades 2048² |
| SSAO | off | half-res | full |
| Clouds | cirrus only | both | both, lit edges |

`Config` gains a `quality` block; `?q=` overrides; the harness runs every reference spot at all three.

## 5. Order and what "done" looks like

Build in the order above. Phase 0 first because everything after it is judged with its harness, and because
the far-ring bug is visible now. Phase 1 before Phase 3 even though trees are the bigger visual change:
textured ground is what the trees stand on, and the aerial perspective changes how every later phase is tuned.

Done means, for each phase, the harness's contact sheet before and after at the named spots, `stats.json`
within budget at *high* on the M4 and at *medium* with a forced-limits run (`?gpulimits=default`), the ride
tests still green (`tests/ride.test.ts` — nothing here touches physics, but the terrain height function is
shared with the sim's ground reads), and `CREDITS.md` updated for anything downloaded.

## 5a. Water (added after the phases above)

Water arrived late and is worth writing down because the two hard parts were not the ones expected.

**Where it is** comes from OpenStreetMap, through `tools/water.ts`, into an optional `<route>.water.json`
beside the three files the game already loads. A sidecar rather than a manifest field: folding it into the
package would have meant bumping the schema and re-baking a DEM the size of Missouri to add a river that was
always there. Routes without the file have no water, which is the truth for most of them.

Two traps, both expensive to find:

- **A multipolygon's outer ring arrives as unclosed fragments.** Treating each fragment as a polygon and
  running a crossing-count test on it does not fail loudly — it answers nonsense. The nonsense was "inside"
  for half of Missouri, which deleted every tree and every blade of grass within a kilometre of the river for
  standing in it. Members are stitched on shared endpoints now, and anything that will not close is dropped.
- **Over a big river the elevation model IS the water surface.** So depth taken as level minus ground is zero
  everywhere and the river renders as an invisible sheet lying exactly on the ground. Depth is modelled from
  the bank instead — shallow at the edge, deepening inward to a limit — and the model is used for the one
  thing it is good for, saying where the ground rises ABOVE the surface and cuts the water off.

**What it looks like** is `render/materials/water.ts`: Fresnel first (a river is silver along the surface and
dark at your feet, and that single term does most of the work), six travelling waves for the normal, a hard
specular for the sun's path, and depth driving both colour and transparency. The shoreline is not the polygon:
the surface arrives with its fade already in the vertex colour and is roughened by noise in the shader, so the
waterline has bays and spits and no grid edge anywhere in it.

Narrow water fades out with distance in proportion to its own width, because a two-metre torrent at three
hundred metres is a third of a pixel and Fresnel turns it into a white scratch.

## 5b. A note on the screen-door dissolve

The changeover from a tree's geometry to its impostor is dithered: over the band both are drawn and each
discards a complementary half of its pixels. That is the textbook trick and it does not work here, for a
reason worth writing down — the two halves are not halves of the same thing. One is real geometry with leaves
spread through three dimensions; the other is a flat photograph of a more compact silhouette. Add them
together at half strength each and the eye does not see a tree; it sees a cloud of green specks in the sky.

It was blamed on three other things first — the leaf cut-out plugin, the atlas having no mip-maps, and the
alpha threshold — and disproved each time by turning that thing off and finding the specks still there. What
finally identified it was turning the dissolve itself off, at which point the far trees became solid.

The fix is to make the band narrow rather than to make the dissolve better: three metres instead of twelve, so
the trees affected at any moment are the ones in a three-metre shell and the pop it hides is a third of a
second. The same caution applies to anything else dithered against something that is not its own twin.

## 5c. The bare trunks, and how long it took to find them

Worth recording as a method note rather than a fix. The Katy's middle distance had pale bare trunks standing
among the leafy trees — reported, reasonably, as "further trunks drawing over closer ones", because that is
what a bald tree behind a leafy one looks like. Six hypotheses were tested and disproved, each by turning the
suspect off and finding the trunks still there:

1. the leaf-card edge fade (forced to discard everything — proved the plugin works, and was not it);
2. the alpha cut-out threshold (taken from 0.4 down to 0.012, then the leaves drawn fully OPAQUE);
3. the coarsest level of detail (never used);
4. the impostors (never created);
5. the dissolve between them (band narrowed, then removed);
6. mip-mapping on the impostor atlas.

Two false trails are worth knowing about. Disabling meshes from the console proves nothing here, because the
scatter re-enables them on the next frame — only a change to `Config` or the ecology survives. And `scene.pick`
reports the nearest geometry along the ray, which is not what is drawn at that pixel; it sent the search after
the wrong species twice.

What found it was bisecting the ecology's species list. The culprit was `willow`: pale bark and leaves that are
thin drooping strands, which vanish against the grass at any distance while the trunk does not. Nothing was
wrong with the renderer at all.

## 5d. Frame rate, measured properly (2026-09-21)

`npm run shots` reports 60 fps everywhere because it waits for vsync; it cannot see headroom. `npm run bench`
runs Chromium uncapped at a device scale of 2 and compares pixel ratios in alternation. Three findings:

- **The game was drawing at the full Retina 2×** — four times the pixels the harness ever measured. It now
  starts at 1.5× and a controller (render/resolution.ts) moves between 0.85× and 2× on missed frames — but only
  keeps a step down if the frame rate actually rose, because:
- **The Katy is CPU-bound, not fill-bound.** Twelve of its thirteen milliseconds were JavaScript inside
  `scene.render`; a quarter of the pixels ran no faster. Per-mesh bookkeeping dominates the profile. Frozen
  materials once the impostors are baked, frozen world matrices and unsynced bounds on every scatter mesh (they
  never move — positions live in instance matrices), a bounding-box prefilter on the camera's obstacle test,
  a throttled water update and no pointer picking took the frame from 12.9 ms to 7.8 ms.
- **Triangles, by where they actually were:** ground cover had no levels of detail (1.7 M on the Katy, more
  than every tree), rocks were placed to the full scenery reach at 1160 triangles each, and grass was one tuft
  at all distances. Cover LODs, a 240 m rock reach, a half-blade tuft past 22 m and tighter tree LODs took the
  Katy from 4.35 M to 2.9 M triangles and the Alpe from 3.6 M to 2.0 M with no visible change.

Benchmarking trap: a Playwright run killed mid-way leaves a headless Chromium GPU process spinning. Four of
them were found at 71% CPU, and every number before they were killed was polluted. `pkill -9 -f
chrome-headless-shell` before measuring.

## 6. Open decisions

- Tree pack: download vs. procedural cards. Plan says download a small pack and keep the card fallback; the
  first day of Phase 3 is spent finding out whether a CC0 pack that meets the one-mesh-one-atlas rule exists.
- Fixed sun vs. time of day. The README defends fixed; Phase 4 keeps it and makes the change cheap later.
- Seasons: manifest field vs. query only. Manifest, so a winter Alpe can be a picker option.
- Whether the scenery shadow generator lives on a second light or the bodies' generator moves. Decide in
  Phase 5 with both on screen.
