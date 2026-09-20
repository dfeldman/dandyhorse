import { Config } from './config.js'
import { Rng } from './rng.js'

// The XZ shape of the trail loop, split out so Terrain and Biome can ask
// "how far is this point from the loop?" before Track builds its tables.
const Loop = (() => {
  const R = Config.TRAIL_RADIUS;
  const rng = Rng.stream('track');
  const lobes = [];
  for (let k = 2; k <= 6; k++) lobes.push({ k, a: rng.range(18, 48) * (7 - k) / 5, ph: rng.range(0, Math.PI * 2) });
  const radiusAt = (th) => R + lobes.reduce((acc, l) => acc + l.a * Math.cos(l.k * th + l.ph), 0);
  // radial distance from the loop (cheap proxy for true distance)
  const radialDist = (x, z) => Math.abs(Math.hypot(x, z) - radiusAt(Math.atan2(z, x)));
  return { R, radiusAt, radialDist, rng };
})();

export { Loop }
