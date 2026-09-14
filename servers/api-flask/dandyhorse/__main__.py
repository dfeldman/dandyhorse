"""`python -m dandyhorse` — run the dev server (no reloader: it would wipe live sessions)."""
import logging

from . import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
cfg = app.dh.config  # type: ignore[attr-defined]
logging.getLogger("dandyhorse").info("root=%s data=%s games=%s", cfg.root, cfg.data_dir,
                                     list(app.dh.catalog.games))  # type: ignore[attr-defined]
app.run(host=cfg.host, port=cfg.port, threaded=True, use_reloader=False, debug=False)
