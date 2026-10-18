.PHONY: install build test serve devicelib assets assets-upload avatar-assets dev-console dev-bridge dev-mockgame dev-rollinghills dev-kingdomtrek dev-bikeplane dev-nightracer dev-nightwatch dev-trailtrainer dev-laneone dev-avatar

LIBS := libs/gamekit devicelib
FRONTENDS := consoles/web bridges/web games/mockgame games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch games/laneone games/trailtrainer
# standalone for now (no metadata.json, so the server does not list it); installed and tested with the rest
STANDALONE :=

# Sibling repos come from environment variables, defaulting to the checkouts beside this one (no symlinks):
# AVATARKIT_DIR and ASSETMGR_DIR. avatarkit is its own repo (github.com/dfeldman/avatarkit). Its MakeHuman assets
# (mh/ and env/, about 300 MB, not in git) come from the shared asset bucket: `make avatar-assets` runs its
# `npm run assets`. See ../avatarkit/ASSETS.md.
AVATARKIT_DIR ?= $(abspath $(CURDIR)/../avatarkit)
AVATAR_DIR := $(AVATARKIT_DIR)/public
VUE_APPS := consoles/web bridges/web
SERVER := servers/api-flask

install:
	@test -d "$(AVATARKIT_DIR)" || { echo "avatarkit is missing: clone github.com/dfeldman/avatarkit beside this repo (or set AVATARKIT_DIR=/path)"; exit 1; }
	cd $(AVATARKIT_DIR) && npm install
	for d in $(LIBS) $(FRONTENDS) $(STANDALONE); do (cd $$d && npm install) || exit 1; done
	cd $(SERVER) && uv sync
	cd devicelib && npm run build

# The bridge imports devicelib's built dist/ (file: dependency), so build it first.
devicelib:
	cd devicelib && npm run build

# The avatar designer needs its MakeHuman assets (bodies, garments, hair, textures) in place: rebuilt in
# ../avatarkit/public from the shared asset bucket (public, no key; re-running skips what is there).
avatar-assets:
	cd $(AVATARKIT_DIR) && npm run assets
	@du -sh $(AVATAR_DIR)

# Files this repo keeps out of git (game screenshots, Trail Trainer's textures and baked routes) are in the shared
# asset bucket; `make assets` puts them back where the games expect them (public HTTPS, no key), and fetches
# avatarkit's MakeHuman assets. Needs ../assetmgr built (`cd ../assetmgr && npm install`).
ASSETMGR_DIR ?= $(abspath $(CURDIR)/../assetmgr)
assets: avatar-assets
	node $(ASSETMGR_DIR)/dist/cli.js restore

# After changing any of those files: record them (scripts/assets-import.mjs) and upload (needs the bucket's keys).
assets-upload:
	node scripts/assets-import.mjs
	node $(ASSETMGR_DIR)/dist/cli.js upload

build: devicelib
	for d in $(FRONTENDS); do (cd $$d && npm run build) || exit 1; done

test: devicelib
	cd $(SERVER) && uv run pytest
	for d in $(VUE_APPS) games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch games/laneone games/trailtrainer $(STANDALONE); do (cd $$d && npm test) || exit 1; done
	cd libs/gamekit && npm test
	cd devicelib && npm test
	@if [ -d $(AVATAR_DIR)/mh ]; then (cd $(AVATARKIT_DIR) && npm test) || exit 1; \
	else echo "skipping avatarkit tests: no MakeHuman assets (make avatar-assets)"; fi

serve:
	cd $(SERVER) && uv run python -m dandyhorse

dev-console:
	cd consoles/web && npm run dev

dev-bridge:
	cd bridges/web && npm run dev

dev-mockgame:
	cd games/mockgame && npm run dev

dev-rollinghills:
	cd games/rollinghills && npm run dev

dev-kingdomtrek:
	cd games/kingdomtrek && npm run dev

dev-bikeplane:
	cd games/bikeplane && npm run dev

dev-nightracer:
	cd games/nightracer && npm run dev

dev-nightwatch:
	cd games/nightwatch && npm run dev

# the avatar designer on its own (the console embeds the same thing under Preferences)
dev-laneone:
	cd games/laneone && npm run dev

dev-trailtrainer:
	cd games/trailtrainer && npm run dev

dev-avatar:
	cd $(AVATARKIT_DIR) && npm run dev

