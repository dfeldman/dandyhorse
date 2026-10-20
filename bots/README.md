# Bot players

Five people who are not people. They have names, bodies, habits and legs, and they **play the real games**
in a headless browser — the same build anybody else loads — while this process pedals for them through the
bridge API. So their distance, their climbing, their crashes and their deliveries are the games' own doing,
not numbers somebody made up. Then each session is moved into the past, so a brand-new server looks like a
place where people have been riding for months.

The design is PLAN.md §18.8.

| File | |
|---|---|
| `bots.json` | Who they are: names, bodies, weekly habits, fitness curves and the games they play. The only place the performance model lives; profiles can also be edited in the console's Admin page. |
| `src/sim.ts` | Their legs: a target power that wanders as a random walk, fades through a session, and was lower months ago. |
| `src/schedule.ts` | When they exercised: which weekdays, near which hour, for how long. |
| `src/runner.ts` | One session end to end: launch, drive the trainer, let the game play, backdate. |
| `src/api.ts` | The platform, as a bot. |
| `src/cli.ts` | `upsert`, `once`, `backfill`. |

## Setting it up

```bash
cd bots && npm install && npx playwright install chromium
```

The server needs a bot token. Put one in the repo's `.env` (git-ignored; the name is in `.env.example`):

```bash
echo "DANDYHORSE_BOT_TOKEN=$(openssl rand -hex 32)" >> ../.env
```

Then restart the server, and make the bots:

```bash
npm run upsert
```

## Running them

```bash
npm run once -- marta                 # one session now, to see a game played
npm run once -- marta --game citydash # a particular game
npm run backfill -- --weeks 12        # three months of history for everybody
DH=http://localhost:8081 npm run upsert   # another server (the online one, say)
CITYDASH_ORIGIN=http://localhost:5200 npm run once -- marta --game citydash   # a dev build of Cycle Dash
```

**Cycle Dash is not served from the platform.** Its page frames the game from its own site (cityengine, its
own repo). A bot's browser starts empty, so without `CITYDASH_ORIGIN` it rides against whatever is deployed
at `dash.dfeldman.org` — which may not match this branch. Set `CITYDASH_ORIGIN` to a running `npm run dev`
when you want bots riding the Cycle Dash you are working on.

Give Cycle Dash a real session length. It builds a city before the rider is on the street, which takes a
minute or so in a headless browser; a five-minute bot session is mostly loading, and the game never reaches
its own finish, so the runner ends it and the game's end-of-ride line is never written. The bots' own
schedules (25–50 minutes) are fine.

**A backfill takes as long as the riding does.** The platform measures a session against its own clock —
distance is speed integrated over real seconds — so a 40-minute session takes 40 minutes, and there is no
honest way to speed that up without making the numbers fiction. Five bots over twelve weeks is roughly a
day of wall clock. Start it in the evening, or use `--weeks 2` to begin with and extend later: slots the
bots have already filled are not refilled, since each run picks fresh ones from their schedules.

Sessions are played **oldest first**, so a bot's fitness visibly improves across their history and their
streak builds up in the right order.

## What a bot is, on the platform

An ordinary user row with `is_bot=1`. Nothing in the console marks them out — that was the owner's choice,
so the place feels populated rather than staffed. They are public, they appear on the Players page and the
leaderboards, they can be a competitor in somebody's game, and an admin can edit their profile like anybody
else's. What they cannot do is sign in: `/botapi/token` exchanges the one shared token for a login token,
and every call after that is the ordinary API.

`npm run upsert` writes only the fields `bots.json` actually names, so anything an admin changes in the
console — a bio, a pasted avatar, whether they are public — survives the next upsert unless `bots.json` has
an opinion about that field too.

Bots get no streak milestone lines on their timeline, because those would be dated the day the backfill ran
rather than the week the streak reached. Their streak number itself is correct and shows on their profile.
