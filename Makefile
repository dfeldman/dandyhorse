.PHONY: install build test serve devicelib avatar-assets dev-console dev-bridge dev-mockgame dev-rollinghills dev-kingdomtrek dev-bikeplane dev-nightracer dev-nightwatch dev-avatar

LIBS := libs/gamekit devicelib
FRONTENDS := consoles/web bridges/web games/mockgame games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch

# avatarkit is its own repo (github.com/dfeldman/avatarkit), checked out beside this one. Its MakeHuman assets
# (mh/ and env/, about 300 MB, not in git) come from the shared asset bucket: `make avatar-assets` runs its
# `npm run assets`. See ../avatarkit/ASSETS.md.
AVATARKIT ?= $(abspath $(CURDIR)/../avatarkit)
AVATAR_DIR := $(AVATARKIT)/public
VUE_APPS := consoles/web bridges/web
SERVER := servers/api-flask

install:
	@test -d "$(AVATARKIT)" || { echo "avatarkit is missing: clone github.com/dfeldman/avatarkit beside this repo (or pass AVATARKIT=/path)"; exit 1; }
	cd $(AVATARKIT) && npm install
	for d in $(LIBS) $(FRONTENDS); do (cd $$d && npm install) || exit 1; done
	cd $(SERVER) && uv sync
	cd devicelib && npm run build

# The bridge imports devicelib's built dist/ (file: dependency), so build it first.
devicelib:
	cd devicelib && npm run build

# The avatar designer needs its MakeHuman assets (bodies, garments, hair, textures) in place: rebuilt in
# ../avatarkit/public from the shared asset bucket (public, no key; re-running skips what is there).
avatar-assets:
	cd $(AVATARKIT) && npm run assets
	@du -sh $(AVATAR_DIR)

build: devicelib
	for d in $(FRONTENDS); do (cd $$d && npm run build) || exit 1; done

test: devicelib
	cd $(SERVER) && uv run pytest
	for d in $(VUE_APPS) games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch; do (cd $$d && npm test) || exit 1; done
	cd libs/gamekit && npm test
	cd devicelib && npm test
	@if [ -d $(AVATAR_DIR)/mh ]; then (cd $(AVATARKIT) && npm test) || exit 1; \
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
dev-avatar:
	cd $(AVATARKIT) && npm run dev

