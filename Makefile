.PHONY: install build test serve devicelib avatar-assets dev-console dev-bridge dev-mockgame dev-rollinghills dev-kingdomtrek dev-bikeplane dev-nightracer dev-nightwatch dev-avatar dev-carkit

LIBS := libs/gamekit libs/avatarkit libs/carkit devicelib
FRONTENDS := consoles/web bridges/web games/mockgame games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch

# The avatar designer's assets: mh/ (MakeHuman bodies, garments, hair and textures, about 300 MB) and env/ (the
# studio lighting). None of it is in git; see libs/avatarkit/README.md. The MakeHuman set is built once from
# MakeHuman's own data with the tools in libs/avatarkit/tools/; this copies a prepared one in.
AVATAR_ASSETS ?= $(HOME)/avatarkit/public
AVATAR_DIR := libs/avatarkit/public
VUE_APPS := consoles/web bridges/web
SERVER := servers/api-flask

install:
	for d in $(LIBS) $(FRONTENDS); do (cd $$d && npm install) || exit 1; done
	cd $(SERVER) && uv sync
	cd devicelib && npm run build

# The bridge imports devicelib's built dist/ (file: dependency), so build it first.
devicelib:
	cd devicelib && npm run build

# The avatar designer needs its MakeHuman assets (bodies, garments, hair, textures) in place.
avatar-assets:
	@test -d "$(AVATAR_ASSETS)/mh" || { echo "No avatar assets at $(AVATAR_ASSETS) (expected mh/ and env/ inside). Pass AVATAR_ASSETS=/path/to/public (see libs/avatarkit/README.md)."; exit 1; }
	mkdir -p $(AVATAR_DIR)
	rsync -a --delete "$(AVATAR_ASSETS)/" $(AVATAR_DIR)/
	@du -sh $(AVATAR_DIR)

build: devicelib
	for d in $(FRONTENDS); do (cd $$d && npm run build) || exit 1; done

test: devicelib
	cd $(SERVER) && uv run pytest
	for d in $(VUE_APPS) games/rollinghills games/kingdomtrek games/bikeplane games/nightracer games/nightwatch; do (cd $$d && npm test) || exit 1; done
	cd libs/gamekit && npm test
	cd libs/carkit && npm test
	cd devicelib && npm test
	@if [ -d $(AVATAR_DIR)/mh ]; then (cd libs/avatarkit && npm test) || exit 1; \
	else echo "skipping libs/avatarkit tests: no MakeHuman assets (make avatar-assets)"; fi

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
	cd libs/avatarkit && npm run dev

# the vehicle kit's demo: showroom, bench, drive and traffic
dev-carkit:
	cd libs/carkit && npm run dev
