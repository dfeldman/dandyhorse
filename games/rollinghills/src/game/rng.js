import { Config } from './config.js'

// Seeded PRNG + 2D value noise / fBm. Everything generated derives from
// Config.SEED so a seed reproduces the same world.
const Rng = (() => {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Independent stream per purpose, so adding a decorator doesn't reshuffle
  // the terrain.
  function stream(name) {
    let h = 2166136261 ^ Config.SEED;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    const next = mulberry32(h >>> 0);
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (a, b) => a + Math.floor(next() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
    };
  }

  // Gradient-free value noise on an integer lattice with smooth interpolation
  function makeNoise2D(seedStr) {
    const r = stream('noise:' + seedStr);
    const P = new Uint8Array(512);
    const perm = [];
    for (let i = 0; i < 256; i++) perm.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    const grad = new Float32Array(512);
    for (let i = 0; i < 512; i++) grad[i] = r.next() * 2 - 1;
    const lat = (ix, iy) => grad[P[(P[ix & 255] + iy) & 511]];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    function noise(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fade(fx), v = fade(fy);
      const a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;   // -1..1
    }
    function fbm(x, y, octaves, lacunarity, gain) {
      let sum = 0, amp = 1, freq = 1, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += noise(x * freq, y * freq) * amp;
        norm += amp; amp *= gain; freq *= lacunarity;
      }
      return sum / norm;
    }
    return { noise, fbm };
  }

  return { stream, makeNoise2D };
})();

export { Rng }
