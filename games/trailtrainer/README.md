# Trail Trainer

Ride a real route. Not a route that feels real — the actual shape and the actual profile of a road or trail
that exists, taken from open map and elevation data, with the scenery drawn from that same data rather than
filmed. Alpe d'Huez has twenty-one hairpins in it because Alpe d'Huez has twenty-one hairpins in it.

Two routes to start:

| Route | | |
|---|---|---|
| **Alpe d'Huez** — Bourg-d'Oisans → Alpe d'Huez, Isère | 14.7 km | 1134 m up, 7.5% average, asphalt |
| **Katy Trail** — Clinton → Machens, Missouri | 385.6 km | 1002 m up, flat, packed limestone |

```bash
npm install && npm run dev
```

Then <http://localhost:5196>. Arrow keys set the effort, **space** coasts, **P** pauses, **[** and **]** jump
500 m along the route. `?route=katy-trail&s=300000` drops you in at a spot; `?device=treadmill` runs it; 
`?others=0` empties the road.

## The idea

Every other game on the platform picks a length — half an hour, say — starts you at the beginning and ends you
when the time is up. That is wrong for a real route. The Katy Trail is 386 km and takes days; Alpe d'Huez is an
hour if you are good at it. **So the thing that persists between sessions is a position, not a score.** You
stop at km 214, and next week you start at km 214, and the route picker tells you how far in you are and how
long you have spent getting there. A session is a slice out of the middle of something longer.

That is the whole design, and everything else follows from it: the world streams around wherever you are
rather than being built from the start, the elevation profile has to be right rather than merely plausible, and
the progress bar shows the entire route with this session as a short bright segment on it.

## Coasting

The one thing a training game cannot fake.

**On a bike**, your measured power is one force among several and the others do not stop when the pedals do.
Stop pedalling on the flat and you roll on and slowly stop; stop pedalling on a descent and you speed up. The
model is a proper force balance —

```
m·dv/dt = P·η/v − m·g·sin θ − Crr·m·g·cos θ − ½·ρ·CdA·v²
```

— with rolling resistance taken from what OSM says the surface is made of (asphalt 0.004, gravel 0.008, dirt
0.012), air thinning with elevation, and a cornering cap so that nobody descends a 30 m hairpin at 60 km/h.
Gravity is not softened. If a session needs to be easier that is the platform's difficulty scale applied to the
grade the game *asks* for, not a fudge factor hidden in the physics.

**On a treadmill** there is no such thing. The belt speed is your speed: stop running and you are standing
still, on a 12% descent as much as on the flat, and you cover no ground at all. A runner never gets a metre for
free. The game asks the machine for the route's real grade; most belts cannot tilt below zero, so on a descent
the request saturates and the HUD says so rather than pretending the hill is flat.

Three tests in `tests/ride.test.ts` pin exactly this, and they are the ones to keep passing.

## Where the routes come from

Everything is fetched **once, offline**, by `npm run bake`, which writes three files per route into
`public/routes/`. The game loads those files and touches no network service at all.

```
OpenStreetMap ways ──► graph ──► shortest path between the route's two ends
                                      │
                           resampled to a fixed step on the sphere
                                      │
 national elevation model ──► centreline profile ──► smoothed ──► checked against published figures
 open terrain tiles ───────► a sparse grid of the ground either side
```

- **Shape** from OpenStreetMap, via Overpass. The route is defined by two real points and found as a shortest
  path through the ways around them, so it is connected and pointing the right way by construction, and it
  fails loudly instead of quietly leaving a gap.
- **Profile** from the best open model covering the route: IGN's 1–5 m lidar in France, the USGS 10 m national
  model in the United States. This matters more than it sounds. At 25–30 m posts, every hairpin apex on Alpe
  d'Huez reads about 15 m too high — the model sees the hillside the road is cut into — which invents a 24%
  ramp and a 7% descent on a climb that has neither, and smoothing hard enough to bury that also buries the
  real ramps between the bends.
- **Surrounding terrain** from the open terrain tiles, at 30 m, as sparse 64×64 tiles of a regular grid — only
  the tiles the corridor touches, which is how a 386 km route fits in 1.6 MB.
- **Surface and landmarks** from OSM's own tags: asphalt or crushed limestone, and the towns, peaks and
  viewpoints the trail passes, at the point it passes them. "Next: Marthasville in 2.90 km" is a real place
  2.90 km up the real trail.

Each bake is checked against published figures for the route before it is written, and the same check runs
again in `tests/route.test.ts` against the files that ship. `npm run profile` prints any baked route.

Licensing is in [CREDITS.md](CREDITS.md). Adding a route is one entry in `tools/routes.ts`.

## What is in here

```
tools/           the offline baker: overpass, elevation, terrain tiles, the route list, an inspector
src/route/       geo maths, the package format, and Route — the thing the game asks where it is
src/sim/         ride physics, the other people on the road, progress between sessions
src/render/      streamed terrain at two levels of detail, the trail ribbon, sky, scatter, rider, camera
src/controls.ts  the one seam the platform replaces
```

A few things worth knowing before changing them:

- **The floating origin** (`src/render/frame.ts`). At km 300 of the Katy Trail the world x is 300,000, where a
  32-bit float resolves 3 cm — and vertex buffers and matrices are 32-bit floats. The scene is drawn about an
  origin that jumps a kilometre at a time and everything placed is told to shift with it. Alpe d'Huez would
  never show the problem, which is why it is built in rather than discovered later.
- **Two elevation sources that disagree** (`src/render/ground.ts`). The trail's profile is metres-scale and the
  hillsides are thirty-metre, so the ground is pulled onto the trail's own profile in a narrow corridor and
  released over the next fifty. Narrow on purpose: the two legs of a hairpin are thirty metres apart. The
  coarse distant ring does the same thing over 260 m, and may only ever sink toward the road, never rise to it.
- **The two ground rings are separated in depth, not in height** (`src/render/layers.ts`). At fifty metres a
  vertex the coarse ring chords straight across a road cut the five-metre ring follows, by as much as eighteen
  metres on Alpe d'Huez — far more than `farDrop` can sink out of sight, which is why the road used to vanish
  into a hillside that was not there. The rings are drawn in separate rendering groups so the near one always
  wins, and the coarse ring draws nothing at all within `Config.farHole` of the rider.
- **`Route.nearest` projects onto the segment**, not the nearest sample. A height that jumps from sample to
  sample builds the corridor as a staircase, which then pokes up through the road every ten metres.

## Other people

There are a few of them, they are not networked, and they are not racing you. A companion cyclist is given a
power and run through the same force balance you are, so they slow on the steep parts and being passed by one
means they are genuinely putting out more than you are for their weight. Someone on foot gets a pace on the
flat, slowed by the hill. Whoever drifts too far ahead or behind is quietly moved round to the other side, so
three or four bodies populate an unbounded road. Each is a full avatar-kit body, which is the most expensive
thing on screen — `?others=0` if the machine is struggling.

## Running it

```bash
npm run dev         # localhost:5196
npm test            # the ride model and the shipped routes
npm run typecheck
npm run bake        # re-fetch and rebuild every route (needs the network, once)
npm run bake -- alpe-dhuez
npm run profile     # print what a baked route actually is
npm run shots       # reference frames of both routes, into docs/shots/ (needs npm run dev running)
npm run textures    # re-fetch the CC0 ground and surface textures (needs the network, once)
npm run canopies    # rebuild the leaf-card pages the trees are made of
npm run build
```

The tree, plant and rock libraries and the rider's avatar assets load from the shared asset bucket by default:
assetkit's and avatarkit's assetmgr indexes, read over public HTTPS with no key ([src/render/assetsource.ts](src/render/assetsource.ts)).
A fresh clone therefore rides without regenerating any of them. `?assets=local` (or `Config.assetSource`) reads
the old `public/trees|plants|rocks/`, `public/mh` and `public/env` instead, for working offline or on a library
you have just regenerated; `npm run shots -- --assets=local` makes the matching before-and-after frames. After
regenerating a library, re-import it into assetkit (`~/assetkit/tools/import-trailtrainer.ts`) and upload.

`public/mh` and `public/env` are symlinks into `libs/avatarkit`'s 300 MB of MakeHuman assets, so the build
skips `publicDir` and relinks them afterwards (only needed with `?assets=local`).

Putting this on Dandyhorse is [INTEGRATION.md](INTEGRATION.md) — one new file, and a different place to keep
the one number that matters.
