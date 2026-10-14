# carkit

Procedural low-poly vehicles for Dandyhorse games — the street's counterpart to avatarkit's people. Enough
kinds to fill a busy city: hatchbacks, sedans, coupés, SUVs, pickups, minivans, panel vans, box trucks, city
buses and school buses, plus taxi, police, ambulance, delivery and transit liveries.

Every vehicle is generated from a spec of a few numbers in metres, so there are as many shapes as there are
seeds. No third-party meshes are used; nothing needs licensing or crediting.

- **Opaque glass.** Windows are dark, with the sky reflected in them. Nobody is ever drawn inside.
- **Steering.** The front wheels turn, split by Ackermann so the inside wheel turns more.
- **Live lamps.** Brake lamps, indicators (with hazards), headlamps, reversing lamps, emergency beacons and roof
  signs light per vehicle, with no extra draw calls.
- **Hills.** `place()` samples the ground under all four tyres, pitches and rolls the body to match, and drops
  each wheel onto the road within its suspension travel.
- **Cheap.** Thin instances throughout. Vehicles of the same shape share a mesh and all wheels share one, so
  300 cars in 40 shapes cost about 42 draw calls.

## Use

```ts
import { Fleet, randomSpec, steerForCurvature } from '@dandyhorse/carkit'

const fleet = new Fleet(scene, { shadows: true })
const taxi = fleet.add(randomSpec('sedan', 42, 'taxi'))

// every frame
taxi.place(x, z, heading, (x, z) => ground.heightAt(x, z), dt)  // on the hill, wheels on the road
taxi.steer = steerForCurvature(taxi.layout, curvature)           // radians, positive = right
taxi.drive(speed * dt)                                           // metres SINCE THE LAST CALL: spins the wheels
taxi.lights.brake = slowing
taxi.lights.indicator = 'left'                                   // 'off' | 'left' | 'right' | 'hazard'
fleet.update(dt)
```

`@dandyhorse/carkit/geometry` is the Babylon-free half — specs, `buildBody`, `buildWheel` and the pose maths —
for tests, workers or a different renderer.

## The frame

+z is forward, +y up, +x the driver's right. The origin is **on the road, midway between the axles**, not the
middle of the body, so tilting a vehicle onto a slope only needs the front and rear heights. Heading 0 faces
+z and π/2 faces +x. Angles follow Babylon's `RotationYawPitchRoll`: **positive pitch is nose down**, so a car
climbing has negative pitch, and positive roll lifts the right side.

## Archetypes and specs

`randomSpec(archetype, seed, livery)` picks every number inside the archetype's ranges (`ARCHETYPE_DEFS` in
`src/spec.ts`); proportions are stored as fractions of length or height, so a long pick still looks right.
`PRESETS` names the common combinations. `shapeKey(spec)` covers everything that changes the shape and nothing
that only changes colour: it decides which vehicles share a mesh. For a city, use a few seeds per archetype
and vary `car.paint` per copy.

The body is cross-section rings swept from tail to nose (`src/geometry/body.ts`, explained at its head). The
lines along the car — belt, roof, width, sill-and-arches — are straight between knots, and the creases are
the low-poly look.

## Develop

```bash
npm run dev          # demo on http://localhost:5204: showroom, inspector, drive, traffic
npm test             # geometry invariants, pose and steering
npm run shots        # headless contact sheets of the demo into shots/ (dev server must be running)
```

`npm run shots -- --only=bus` limits the run; `python3 tools/sheet.py a b c -o shots/sheet.png` tiles shots
into a sheet. Judge models from these, not the app's Browser pane, which stops rendering while hidden.

`window.__carkit` in the demo: `mode(name)`, `select(spec | presetName)`, `bench` (grade, bank, steer, speed),
`lights`, `setNight(bool)`, `step(dt, n)`, `ready()`, `shot()`, `fleet`, `scene`, `camera`.

## Gotchas

- **Winding.** `Builder.tri` computes outward normals by the right-hand rule. Babylon (left-handed) treats
  clockwise-on-screen as front-facing, so `build()` writes each triangle's indices as a, c, b. Change one
  without the other and every vehicle renders inside out.
- An empty thin-instanced mesh is still drawn once with garbage matrices. The fleet disables empty shapes.
- The demo's StandardMaterial shaders are imported explicitly. Without that, Babylon fetches them by URL and
  Vite answers with `index.html`.
