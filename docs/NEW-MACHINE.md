# Setting up a new machine

Everything needed to work on Dandyhorse and its sibling projects comes from five git repos and the shared asset
bucket. Nothing else has to be copied from an old machine except the few secrets and works in progress listed at
the end. This was rehearsed on 2026-10-14 by cloning all five into an empty folder and running each one's install,
asset restore and tests.

## The repos

Clone them side by side. They find each other through environment variables, each defaulting to the checkout
beside it, so with the default layout nothing needs setting:

| Variable | Default | Used by |
|---|---|---|
| `ASSETMGR_DIR` | `../assetmgr` | every repo's `npm run assets` / `make assets`, the import tools |
| `ASSETKIT_DIR` | `../assetkit` | cityengine (SF tree generator, local-assets mode), Trail Trainer local mode |
| `AVATARKIT_DIR` | `../avatarkit` | dandyhorse (Makefile, server's `/avatars/`, Vite), cityengine and Trail Trainer local mode |
| `CITYENGINE_DIR` | `../cityengine` | assetkit's statue importer |
| `DANDYHORSE_DIR` | `../dandyhorse` | cityengine, only to run as a Dandyhorse game (gamekit); optional |
| `ASSETMGR_ENV_FILE` | — | the bucket keys, only for uploading |

Nothing is symlinked between repos and there are no submodules. The one fixed relative path is npm's own:
package.json files name no sibling paths either: npm cannot read environment variables there, so each package
that uses a sibling (avatarkit, carkit, assetmgr) links it in `postinstall` with a small `link-siblings.mjs`, which
points `node_modules/<name>` at the variable's directory. Set the variables before `npm install`.

| Repo | What | Depends on |
|---|---|---|
| `assetmgr` | the asset manager (CLI + library) and the Asset Shelf browser (`viewer/index.html`) | — |
| `assetkit` | shared assets: tree/plant/rock generators, statue indexes, carkit (procedural vehicles) | assetmgr |
| `avatarkit` | MakeHuman avatars and the avatar designer | (assetmgr only to upload) |
| `dandyhorse` | the platform: server, console, bridge, devicelib, and the small games (incl. Trail Trainer, Lane One) | avatarkit, assetmgr |
| `cityengine` | the city model and Street Runner / Cycle Dash | avatarkit, assetkit, assetmgr |

```bash
mkdir ~/dev && cd ~/dev     # any folder; the repos only need to be siblings
for r in assetmgr assetkit avatarkit dandyhorse cityengine; do git clone https://github.com/dfeldman/$r; done
```

## Tools to install

| Tool | For | macOS |
|---|---|---|
| Node ≥ 22.18 (26 used) and npm | everything (runs `.ts` directly) | `brew install node` |
| Python 3 + uv | the Dandyhorse server | `brew install uv` |
| Blender 4.4 | assetkit's generators, cityengine's sign and SF-tree tools | `brew install --cask blender` |
| Python 3 with Pillow and numpy | texture painting, facade generator, generator helpers | `pip3 install pillow numpy` |
| osmium-tool | cityengine's local OpenStreetMap queries (public Overpass is too easily overloaded) | `brew install osmium-tool` |
| Playwright's Chromium | screenshot tools (`npm run shots`, cityengine views) | `npx playwright install chromium` |
| a Python venv with tools/lidar/requirements.txt | cityengine: the San Francisco lidar ground model before an SF bake | see cityengine docs/ASSETS.md |
| git-filter-repo | only for history surgery | `brew install git-filter-repo` |

## Bringing each repo up

Assets come back from the bucket's **public** URL: no keys are needed for any of this.

```bash
cd assetmgr && npm install && npm test && cd ..             # npm install builds dist/ (the CLI everyone uses)

cd assetkit && npm install && npm run assets                # texture sources back into tools/cache/
(cd carkit && npm install && npm test); cd ..

cd avatarkit && npm install && npm run assets && npm test && cd ..   # ~250 MB of MakeHuman assets into public/

cd dandyhorse && make install && make assets && make test && cd ..   # screenshots, Trail Trainer textures/routes

cd cityengine && npm install && npm run assets && npx vitest run && cd ..
```

Every repo pulls its files with `npm run assets` (dandyhorse: `make assets`), which is `assetmgr restore`, and
pushes changes with `npm run assets:upload` (dandyhorse: `make assets-upload`), which records them in the repo's
indexes and uploads; uploading needs `ASSETMGR_ENV_FILE`. What they bring back is everything a repo keeps out of git but needs at a fixed path:
the game screenshots, Trail Trainer's ground textures and baked routes, avatarkit's MakeHuman set, cityengine's
facades, palms, roads and rock surfaces, and assetkit's Poly Haven sources. The shared libraries (trees, plants,
rocks, statues, avatars) are read straight from the bucket by URL at run time.

## Data that is downloaded, not stored

These are large, public and re-fetchable, so they are in neither git nor the bucket. Each has a script.

| Data | Repo | How to get it | Size |
|---|---|---|---|
| OpenStreetMap extracts (Geofabrik) | cityengine | `npm run osm:fetch` (docs/OSM-DATA.md) | ~2.6 GB |
| Baked cities: shipped `public/cities/<id>/v3/`, bake-private `tools/cache/bake/<id>/` | cityengine | `npm run bake san-francisco` after osm:fetch (docs/ASSETS.md, "What a bake writes"); only San Francisco is live (`src/cities.json`) | GBs |
| Terrain tiles (AWS Terrain Tiles) | cityengine, trailtrainer | fetched by the bakes (`tools/terrarium.ts`) | small |
| USGS lidar (Entwine Point Tiles) | cityengine | `tools/lidar/dtm.py san-francisco` before an SF bake (docs/ASSETS.md); the research pipeline in docs/LIDAR.md | small for the bake, ~2 GB for research |
| Mapillary street photos | cityengine | `tools/photo.ts`, needs a free Mapillary token (below) | ~1.2 GB |
| Wikimedia Commons photos | cityengine | `tools/commons.ts` | ~160 MB |
| SF assessor rolls | cityengine | `tools/sf-parcels.ts` (data.sf.gov) | small |
| Route elevation + OSM | trailtrainer | `npm run bake` in games/trailtrainer (CREDITS.md) | small |
| Poly Haven textures | assetkit, trailtrainer | `npm run *:textures` / `npm run textures` (also kept in the bucket) | — |

All of these sources were checked reachable on 2026-10-14.

## Copy by hand from the old machine

Secrets (never in git, never in the bucket):

- `~/assetmgr/.env`: the R2 bucket's S3 keys and a Cloudflare API token. Only needed to **upload** assets; point
  each repo at it with `export ASSETMGR_ENV_FILE=~/dev/assetmgr/.env`.
- `cityengine/.mapillary_token`: the Mapillary API token for `tools/photo.ts` (or make a new one at
  mapillary.com → Developers).
- `cityengine/api_key`: an older set of bucket credentials that no code reads; probably obsolete.

Work in progress, deliberately not committed:

- `cityengine/incoming_models/`: Tripo statues being worked on. (The twelve current ones are also in the bucket,
  as the source files of `assetkit-statues-paris`.)
- `assetkit/statues_to_model/`: reference photos and models for statues still to be made.

Optional:

- Claude Code's memory for these projects (`~/.claude/projects/-Users-dfeldman-bikebike/memory/`), if you want the
  assistant to keep its notes.
- Caches that save re-downloading: `cityengine/tools/cache/` (OSM, lidar, Mapillary, ~7 GB) and
  `dandyhorse/games/trailtrainer/tools/cache/`.

Nothing else on the old machine is needed. The folders `~/kingdomtrek`, `~/nightracer`, `~/nightwatch` and
`~/laneone` are older copies of games now in `dandyhorse/games/`; `~/bikebike` was the original prototype, whose
device registry now lives in `dandyhorse/docs/devices`. The `*-legacy-*`, `*-pre-merge-*` folders and
`~/repo-backups-2026-10-14` are backups from the restructure.
