# Trail Trainer on Dandyhorse

What it takes to run Trail Trainer on the exercise platform (`~/dandyhorse`). It covers only the points where
the two meet; the game's own rules are in [README.md](README.md). The platform's contract for games is
`dandyhorse/docs/GAME_AUTHORING.md` and the tutorial is `docs/GAME_DEVELOPER_GUIDE.md`.

Nothing here is built yet. As with Night Watch and Night Racer, the work comes down to one new file — plus one
genuinely new idea the platform has not had to carry before, which is §5.

## 1. The shape of it

```
machine ─► bridge ─► server ─► getstate (1 Hz) ─► DandyhorseControls.measured()  = power / belt speed
game ─► setstate (1 Hz): grade request, score, custom ─► History, the machine
game ─► putsave: { routes: { <id>: { s, elapsed, sessions, completed } } }   ◄── the important one
```

- **Location:** the game becomes `games/trailtrainer`, a static Vite build with `base: '/games/trailtrainer/'`
  and the dev proxy from `games/rollinghills/vite.config.ts`. Babylon and the avatar kit are bundled from npm,
  so it needs no internet — and neither do the routes, which are baked offline and shipped as static files.
- **The adapter:** one new file, `src/platform.ts`, implementing `Controls` (`src/controls.ts`) and
  `ProgressStore` (`src/sim/progress.ts`) on top of gamekit's `SessionClient`. `main.ts` uses them when
  `?session=` is in the URL and keeps `LocalControls` / `LocalProgress` otherwise.
- **Start first:** `main.ts` already starts by choosing a route and a place on it, then builds the world around
  *that* point. On the platform the route and the resume point come from `startsession` instead of the picker.

## 2. Assets

The avatar assets come from the shared asset bucket (`loadFromBucket`, src/render/rider.ts); the platform can
instead serve its own copy, which is the only change there:

```ts
// src/render/rider.ts, local mode
setAssetBase(siblingUrl('avatarkit', 'public/mh/'))        // platform: '/avatars/mh/'
setStudioHdri(siblingUrl('avatarkit', `public/${STUDIO_HDRI}`))
```

The base must stay an **absolute** URL. The kit builds bodies in a worker, and a relative `./mh/` there
resolves against the worker's own script rather than the page, which quietly fetches `index.html` and fails
with a JSON parse error.

The baked routes (`public/routes/`, about 2 MB for both) ship with the game like any other asset.

## 3. Effort → movement

The game reads what the machine **measured**, never what it asked for. `Controls.measured()` returns
`{ power, speed, cadence, heartRate }`, each `null` when there is no reading — never a zero standing in for
one. `src/sim/ride.ts` does the rest, and the split between the two machines is the thing not to blur:

- **Bike:** `power` in watts drives a force balance. Zero watts is a legitimate reading: the bike coasts.
  `gamekit`'s `EffortMeter` is *not* wanted here — this game needs absolute watts, not a 0–100 effort scale,
  because the whole point is that 250 W up Alpe d'Huez means outdoors what it means here.
- **Treadmill:** `speed` in m/s is the rider's speed. Nothing else. Auto-pause should stay **on**: a stopped
  belt is a stopped runner, and the platform already knows how to pause on that.

Rider mass comes from `start.bodyData?.weight` when the platform has it (`Config.riderMassKg`), which changes
the climb honestly — a heavier rider is slower up a hill at the same watts, as outdoors.

## 4. The grade request

`setstate` carries the route's real grade in percent, smoothed over 0.6 s and stepped to 0.5%:

```ts
{ ...targets(deviceType, state.request, state.speed), score: Math.round(state.s), custom: { … } }
```

The platform scales it by the user's difficulty / incline setting and clamps it to the machine. Two things
follow that the HUD already handles and the platform should not paper over:

- **Descents on a treadmill.** Most belts stop at 0%. The request saturates, the runner gets an easier
  kilometre than the route says, and the HUD says so ("most belts will not tilt down — the descent is free
  here"). That is the honest outcome; silently flattening the route would not be.
- **Grades beyond the trainer's range.** Alpe d'Huez touches 18.7% over short stretches. A trainer that caps
  at 15% should clamp, and the game does not need to know.

`Config.gradeTau` and `Config.gradeStep` are the two knobs if the machine chatters.

## 5. Progress is the save state — and it changes what a session means

This is the part that is new to the platform.

Every other game treats `requestedDuration` as the length of the thing: you start at the beginning, you ride
for half an hour, the game ends. A real route does not work that way. The Katy Trail is 386 km. So:

- **`requestedDuration` ends the session, not the route.** The session ends `complete` when the time is up,
  wherever on the route the rider happens to be. That is a success, not an abandonment.
- **`saveState` carries the position**, per route, exactly as `ProgressStore` already defines it:

  ```json
  { "routes": { "katy-trail": { "s": 214380, "elapsed": 39120, "sessions": 11, "completed": false } } }
  ```

  Written every 5 s and on `pagehide`, so a closed tab is a paused ride rather than a lost one.
- **The launch screen needs a resume question.** Standalone it is a dialog ("You stopped 214 km in, with 171 km
  to go"). On the platform, either the game shows it after `startsession` — the simplest option, and what
  `StartScreen` already does — or `metadata.json` gains a launch option, which would mean the platform
  understanding per-route progress. The first is better: the platform stays generic and the game keeps the
  one concept only it has.
- **Completion is worth an achievement and then a reset.** Crossing the end marks `completed` and parks the
  marker back at 0, so the next session starts a fresh lap rather than sitting on the finish line.

If the platform only ever offers one `saveState` blob per (game, variant), that is enough: the object above is
keyed by route inside it.

## 6. metadata.json

A draft is in [platform/metadata.json](platform/metadata.json).

- **Variants:** a bike variant and a treadmill variant, both writing grade.
- **Launch options:** `route` (the enum grows as routes are added) and `others` (how many people are on the
  road, which is the one setting that meaningfully costs GPU).
- **Capabilities:** `saveState: true` is not optional here — it is the game. `seed: false`: a real route is the
  same every time on purpose, which is what makes two sessions on it comparable. `input: false`, `ghosts:
  false` for now; per-route ghosts of your own previous passage would be the natural next thing.
- **Auto-pause:** on, for both variants.

## 7. Session image

`sessionImage()` should use Babylon's `Tools.CreateScreenshotAsync(engine, camera, size)` rather than reading
the canvas directly. The game runs on WebGPU where the browser has it (`createEngine`, shared with the avatar
kit), and `preserveDrawingBuffer` is a WebGL-only option — a raw `toDataURL` off the canvas is blank under
WebGPU. A good frame is the rider with the profile bar in it, which is what is on screen anyway.

## 8. What is deliberately not here

- **No networking.** The other people on the road are simulated locally from a seed (`src/sim/companions.ts`).
  If the platform ever grows multiplayer, they are the obvious place to plug real riders in — the interface is
  already "somebody at position `s` moving at speed `v`".
- **No weather or day/night.** A route ridden in pieces across weeks should look the same each time, or two
  sessions on it are not comparable. This is a deliberate difference from Rolling Hills.
- **No fictional scenery.** No balloons, no monorail, no volcano. The route is a real place and the scenery is
  what the elevation data says is there.

## 9. Checklist

1. `src/platform.ts`: `DandyhorseControls implements Controls`, `PlatformProgress implements ProgressStore`.
2. `main.ts`: use them when `?session=` is present; take route and resume point from `startsession`.
3. `vite.config.ts`: `base: '/games/trailtrainer/'`, the API proxy, `fs.allow` for the kit.
4. `setAssetBase('/avatars/mh/')`, `setStudioHdri('/avatars/' + STUDIO_HDRI)`.
5. Copy `platform/metadata.json` into place and add a `screenshot.jpg`.
6. Confirm with the platform team that a `complete` session part-way along a route is recorded as a success.
