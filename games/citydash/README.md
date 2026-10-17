# Cycle Dash

A delivery game in a real San Francisco: your power moves the bike, the trainer feels every grade, and you steer at
the junctions from the bridge's d-pad (or let the route guide you).

**The game is not in this repo.** It is cityengine (its own repo, beside this one) and is served from its own site,
<https://dash.dfeldman.org>. What is here is all the platform needs:

- `metadata.json` — the catalog entry (bike variant, `controls.bike: grade`, the launch options);
- `index.html` — the shim the bridge loads as the game. It frames City Dash from its site, passing on the session's
  parameters (`session`, `variant`, `seed`, `debug`) and its own origin (`host`), and carries the game's
  `/gameapi/*` calls: the session cookie does not reach a page on another origin, so the game posts each request
  here and this page makes it. Only the origins it lists, only `/gameapi/`, only GET/POST/PUT. cityengine's
  `src/relay.ts` is the other half;
- `screenshot.jpg` — in the asset bucket like every game's (`make assets`).

To try a development copy of the game (cityengine's `npm run dev`, port 5200), open the game once with
`?citydash=http://localhost:5200` on this page's URL; it is remembered in that browser (`?citydash=default` forgets).

Run end to end on 2026-10-15 against a local server with a simulated bike: 200 W moved the rider, the street's
grade (−10.9 % to +10.3 %) reached the bridge, a d-pad turn was accepted and taken, a 0 W stretch brought the
bike to rest, and History got its picture.

**2026-10-17 (the owner's "clunky connection" report):**
- Keys reach the game through the bridge and this shim: the shim hands the focus on to the game's frame whenever it
  has it, and the game asks for it (`{dh: 'focus'}`, cityengine `src/relay.ts` `keepFocus`) while it has none — a frame
  focused while still loading kept the focus on the element, so no key ever arrived. The arrows steer on the platform
  too (cityengine `src/platform.ts`).
- `metadata.json` declares `capabilities.endScreen`: when a session completes the game shows its summary (distance,
  every delivery's stars and dollars) and the bridges keep it on screen until Done (PLAN.md §6.4.1).
- The phone's d-pad carries the game's optional actions as buttons (board / leave a cable car, observe from a tower,
  eat the order, the map); while paused the game shows its map.

