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
npm run backfill -- --weeks 8 --max 8 # eight sessions each, enough to fill the boards
npm run backfill -- --at-once 1       # one bot at a time, if the machine is busy
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
honest way to speed that up without making the numbers fiction.

What it does do is ride them **at the same time**: every bot is its own player with its own session and its
own bridge, so five of them cost the same wall clock as one. Twelve weeks for five bots is a few hours
rather than a day. `--at-once N` turns that down if the machine is needed for something else.

Five headless games on one laptop is what actually sets the pace: each is a full 3-D game, and they share
one machine. Measured on a laptop, five at once each send about **0.5 updates a second** instead of one, and
sessions run somewhat longer than their planned minutes.

That costs resolution, not accuracy. A session's distance, calories and climbing come from the trainer feed,
which this process sends at a steady 1 Hz whatever the game is doing; what thins out is the game's own
record — where the rider was, how many parcels they had delivered — which a later player races against. A
sample every two seconds is plenty for that. If you want it sharper, `--at-once 2`.

Without `--disable-background-timer-throttling` and its two companions (`runner.ts` `CHROMIUM_ARGS`) it is
far worse: Chromium slows the timers of a page nobody is looking at, and a game measured at 0.04 Hz — one
update every 25 seconds — leaves a record too coarse to race.

Each bot still rides its own sessions **oldest first**, so its fitness visibly improves across its history
and its streak builds up the right way round. Use `--weeks 2` to begin with and extend later: slots already
filled are not refilled, since each run picks fresh ones from the schedules.

**Their faces.** `bots.json` carries an `avatarSeed`, not an avatar: a MakeHuman spec is hundreds of lines
and nobody would read the file again afterwards. The console turns the seed into a whole person and renders
the small headshot that lists and leaderboards show — open it as an admin and press **Give everyone a
face**. That is where avatarkit already lives, so this stays a thin API client.

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
