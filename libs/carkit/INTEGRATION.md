# Putting carkit into Street Runner

**Status: done 2026-10-01.** Street Runner draws its cars and buses with carkit (`src/render/street-fleet.ts`,
called from `Life.update`); `?without=carkit` brings back the old stand-ins (`models.ts` `car()`/`bus`) for
comparison. Measured: ~52 draw calls for ~300 vehicles, frame time unchanged (median 16.7 ms, p95 33.3 ms, with and
without). Deviations from the plan below: indicators come on inside the junction box and while held at its line
for the turn (Street Runner's `Vehicle` carries no distance to the junction); the fog density is converted
(carkit's fog is exp², Street Runner's exp: `density / sqrt(ln 2)` gives the same half-way distance); the sun is
negated (Street Runner's `sun` is the light's direction, carkit wants the direction to the sun). No
`optimizeDeps.entries` change was needed: every Babylon module carkit imports, Street Runner already imports.

## Dependency

As with avatarkit: in `~/streetrunner/package.json` add
`"@dandyhorse/carkit": "file:../dandyhorse/libs/carkit"`, and add `'../dandyhorse/libs/carkit/src/**/*.ts'`
to `optimizeDeps.entries` in `vite.config.ts`. carkit has no worker and no assets.

## Where it plugs in

Replace the `cars` and `buses` pools in `Life` with one `Fleet`:

```ts
const fleet = new Fleet(scene, { shadows: false, renderingGroupId: 3 })
```

- `renderingGroupId: 3` is the buildings' group. Groups 1–3 clear depth, and anything left in group 0 is
  painted over by the streets (the lesson recorded in `life.ts`).
- `shadows: false`: `Life` already lays its own sun-stretched blob under every vehicle. Keep it, sized from
  `car.layout.min/max` instead of the hard-coded 4.6 × 2.1 and 12 × 3.

Keep one `Car` per `Vehicle.id` in a map, add on first sight and remove when the id disappears. Pick the spec
once, from the id, so a vehicle never changes shape:

| `Vehicle` | carkit |
|---|---|
| `kind: 'bus'` | `randomSpec('bus', id % 4, 'transit')`; the region's bus colour in `paint` |
| `kind: 'car'` | an archetype from a city mix (see `MIX` in `src/demo/main.ts`), `randomSpec(a, id % 4)`; a few as taxi, and SF gets the odd `schoolbus` |
| `colour` | `car.paint` (keep Street Runner's colour choice) |
| `waiting` | `car.lights.brake` |
| `next.turn` / `inBox.turn` (`'left' \| 'straight' \| 'right'`) | `car.lights.indicator`: signal from about 30 m before the junction until out of the box; `'straight'` → `'off'` |
| `speed`, frame `dt` | `car.drive(speed * dt)`, metres since the last call (not the running total: avatarkit's `Bike.update` had exactly that bug) |
| heading change per metre | `car.steer = steerForCurvature(car.layout, dHeading / ds)`. Only visual, so a smoothed estimate is fine |
| night (`NIGHT`) | `car.lights.headlights = true`, and `fleet.setLook({..., night})` |

Keep the shape count down: `id % 4` seeds and a dozen archetype/livery pairs give about 40 shapes, so about 41
draw calls for all the traffic.

## Pose: hills, and the bridge trap

On the ground:

```ts
car.place(v.at.x, v.at.z, v.heading, (x, z) => terrain.heightAt(x, z), dt)
```

This samples the terrain under all four tyres. Passing `dt` smooths pitch, roll and height over about 0.12 s,
so a car settles over a crest instead of snapping; the wheels are re-dropped from the smoothed body so they
stay on the road. Remember the memory note that fast descents must stay smooth: measure pitch per frame on a
steep SF descent before and after.

**On a raised edge (`v.y` is set) do NOT use `place`.** The height callback would sample the terrain under the
deck, metres below the car. Use the edge's own grade instead:

```ts
const grade = (yAhead - yBehind) / span        // from the edge's deck heights either side of the car
car.setPose(slopePose(v.at.x, v.y, v.at.z, v.heading, grade))
car.drops = car.layout.wheels.map(() => 0)
```

The same applies in tunnels (bores) and anywhere else the ridden surface is not `terrain.heightAt`.

## Look

`fleet.setLook(look)` takes `CarLook`, which is Street Runner's `SkyLook` (sun, sunColour, skyColour,
groundColour, fogColour, fogDensity) plus `night`. Call it wherever `applyCartoonLook` is called. carkit sets
the camera eye itself in `fleet.update`.

## Checks before calling it done

- The traffic count (`window.__traffic`) and the drawn count (`fleet.stats.cars`) agree.
- Draw calls: `fleet.stats.drawCalls` stays under about 50 with the full traffic budget.
- At a signalised junction, queued cars show brake lamps; turning cars indicate the right way. Left in
  carkit is −x, and Street Runner's heading has the same sense as carkit's yaw.
- On Hyde Street and the other steep grades, the tyres sit on the road at both ends of a bus (screenshot it at
  street level).
- On the bridges, cars ride the deck: none hang in the air, none sink.
