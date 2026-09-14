.PHONY: install build test serve devicelib dev-console dev-bridge dev-mockgame dev-rollinghills dev-kingdomtrek

LIBS := libs/gamekit devicelib
FRONTENDS := consoles/web bridges/web games/mockgame games/rollinghills games/kingdomtrek
VUE_APPS := consoles/web bridges/web
SERVER := servers/api-flask

install:
	for d in $(LIBS) $(FRONTENDS); do (cd $$d && npm install) || exit 1; done
	cd $(SERVER) && uv sync
	cd devicelib && npm run build

# The bridge imports devicelib's built dist/ (file: dependency), so build it first.
devicelib:
	cd devicelib && npm run build

build: devicelib
	for d in $(FRONTENDS); do (cd $$d && npm run build) || exit 1; done

test: devicelib
	cd $(SERVER) && uv run pytest
	for d in $(LIBS) $(VUE_APPS) games/rollinghills games/kingdomtrek; do (cd $$d && npm test) || exit 1; done

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
