// Level registry. A level bundles Config overrides, mechanic toggles, and
// optional hooks so future islands can change tuning and behavior without
// touching the core loop.
//
// To add a level: register an entry here, give it `overrides` (any Config
// keys), `mechanics` flags, and optional `hooks`:
//   ringAltitude(prevAlt, walkFn) -> alt   — custom ring altitude pattern
//   resistance(base, planeState)  -> 0-100 — custom resistance profile
//   onLapStart(lap)                        — per-lap events (weather, etc.)
// main.js consults Levels.current for all of these; missing hooks fall back
// to the defaults.
const Levels = (() => {
  const defs = {
    'isla-uno': {
      id: 'isla-uno',
      name: 'Isla Uno',
      overrides: {},            // stock tuning
      mechanics: {
        races: true,            // NPC pylon races every RACE_EVERY_LAPS laps
        turbo: true,            // streak-powered turbo meter
        pickups: true,          // stars + balloons
      },
      hooks: {},
    },
    // Future examples (not yet built):
    // 'night-city':  darker palette, lit windows, no pickups, denser rings
    // 'mount-storm': headwind sectors via a resistance hook, weather laps
  };

  let current = null;

  function apply(id) {
    const def = defs[id] || defs[Config.DEFAULT_LEVEL];
    Object.assign(Config, def.overrides);
    current = def;
    return def;
  }

  return {
    apply,
    get current() { return current; },
    get mechanics() { return current ? current.mechanics : {}; },
    get hooks() { return current ? current.hooks : {}; },
  };
})();
