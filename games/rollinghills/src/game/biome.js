import { Config } from './config.js'
import { Rng } from './rng.js'
import { Util } from './util.js'

// Biomes: the map is split into angular sectors around the loop, each a
// different scene, softly blended. Every seed picks a different set.
//   Biome.weights(x,z) -> {name: weight} summing to 1 (all pool names present)
//   Biome.dominant(x,z) -> {name, w}
//   Biome.DEF[name]    -> every visual parameter for that area (one table)
const Biome = (() => {
  const H = Util.hex;
  const DEF = {
    meadow:   { label: 'Sunny Meadows', pal: { a: '#4cc457', b: '#b8ef66', dirt: '#d8bc7c', rock: '#9a90a8' }, fog: '#a9d8fb', trail: [1, 1, 1], profile: '#7fe36a', bush: '#4fcf5f', tuft: '#7fe36a', rockTint: [0.62, 0.58, 0.68], shape: 1.0, lift: 0, snow: 100, trees: { s: [['round', 7], ['pine', 3]], n: [6, 18], accept: 0.5, rad: [15, 40] }, house: 'cottage', settlements: 2, flowers: 0.55, butterflies: true },
    forest:   { label: 'Whispering Woods', pal: { a: '#2c8c3d', b: '#74cf5c', dirt: '#7b5a3a', rock: '#7d7a8c' }, fog: '#a4d4c4', trail: [0.9, 0.86, 0.8], profile: '#3fb052', bush: '#2f9a45', tuft: '#4fbf52', rockTint: [0.5, 0.5, 0.56], shape: 1.15, lift: 0, snow: 100, trees: { s: [['dark', 5], ['round', 3], ['pine', 4]], n: [28, 60], accept: 1.0, rad: [25, 60] }, house: 'cabin', settlements: 2, flowers: 0.3, leaves: 1 },
    desert:   { label: 'Red Rock Desert', pal: { a: '#e2a24f', b: '#f7d78c', dirt: '#c8773b', rock: '#c95a3a' }, fog: '#f2cfa0', trail: [1.06, 0.88, 0.76], profile: '#f0b35a', bush: '#9aa85a', tuft: '#d9c27a', rockTint: [0.8, 0.42, 0.28], shape: 0.4, lift: 0, snow: 100, trees: { s: [['cactus', 6], ['dead', 3]], n: [4, 12], accept: 0.55, rad: [15, 45] }, house: 'adobe', settlements: 2, flowers: 0, mesas: true, pebbles: true, dust: 1 },
    alpine:   { label: 'Frosty Peaks', pal: { a: '#88b585', b: '#d3e6c0', dirt: '#a5a08f', rock: '#8c8aa0' }, fog: '#dbe8f7', trail: [1.04, 1.02, 1.0], profile: '#dfe9f5', bush: '#5d9a63', tuft: '#a7cf8f', rockTint: [0.58, 0.58, 0.66], shape: 1.9, lift: 22, snow: 36, trees: { s: [['pine', 5], ['snowPine', 5]], n: [10, 30], accept: 0.75, rad: [15, 45] }, house: 'chalet', settlements: 1, flowers: 0, pebbles: true, sparkle: 1 },
    town:     { label: 'Bright Harbor Town', pal: { a: '#86cf86', b: '#c2eaa9', dirt: '#d6d0b8', rock: '#9a9aa8' }, fog: '#b8d6f2', trail: [0.5, 0.5, 0.56], profile: '#8fd0ff', bush: '#5fcf6f', tuft: '#8fe07a', rockTint: [0.6, 0.6, 0.66], shape: 0.3, lift: 0, snow: 100, trees: { s: [['round', 8], ['pine', 2]], n: [3, 8], accept: 0.3, rad: [10, 25] }, house: 'block', settlements: 3, flowers: 0.3, noRocks: true },
    autumn:   { label: 'Golden Hollow', pal: { a: '#7a9c3c', b: '#c9a24a', dirt: '#8a5a3a', rock: '#8a7a80' }, fog: '#e8c9a0', trail: [0.95, 0.85, 0.75], profile: '#f0a040', bush: '#c96a2a', tuft: '#c9a24a', rockTint: [0.55, 0.5, 0.5], shape: 1.1, lift: 0, snow: 100, trees: { s: [['autumn', 8], ['pine', 2]], n: [20, 45], accept: 0.9, rad: [20, 55] }, house: 'cabin', settlements: 2, flowers: 0.15, leaves: 2.5 },
    tropical: { label: 'Coconut Coast', pal: { a: '#3fd06a', b: '#b9f26a', dirt: '#f2dc9a', rock: '#9ab0a0' }, fog: '#bfe9f7', trail: [1.02, 0.95, 0.85], profile: '#3fd0a0', bush: '#34c75a', tuft: '#74e07a', rockTint: [0.6, 0.65, 0.6], shape: 0.7, lift: 0, snow: 100, trees: { s: [['palm', 8], ['round', 2]], n: [8, 22], accept: 0.7, rad: [15, 40] }, house: 'hut', settlements: 2, flowers: 0.4, lagoon: true, butterflies: true },
    volcanic: { label: 'Ember Ridge', pal: { a: '#4a4550', b: '#6e6470', dirt: '#ff6a1a', rock: '#2f2a33' }, fog: '#b9a9a9', trail: [0.7, 0.62, 0.6], profile: '#ff6a1a', bush: '#6a5a50', tuft: '#7a6a60', rockTint: [0.25, 0.22, 0.26], shape: 1.5, lift: 8, snow: 100, trees: { s: [['charred', 7], ['dead', 3]], n: [4, 12], accept: 0.5, rad: [15, 40] }, house: null, settlements: 0, flowers: 0, pebbles: true, volcano: true, dust: 0.5 },
    blossom:  { label: 'Blossom Valley', pal: { a: '#7fd58a', b: '#d9f2b0', dirt: '#f2c9d9', rock: '#a89ab0' }, fog: '#f3d6ea', trail: [1.0, 0.95, 0.98], profile: '#ffa6d5', bush: '#ffb3d9', tuft: '#9fe38a', rockTint: [0.66, 0.6, 0.7], shape: 0.9, lift: 0, snow: 100, trees: { s: [['blossom', 8], ['round', 2]], n: [10, 30], accept: 0.8, rad: [15, 45] }, house: 'pagoda', settlements: 2, flowers: 0.5, butterflies: true, petals: 1 },
  };
  for (const d of Object.values(DEF)) { d.palC = { a: H(d.pal.a), b: H(d.pal.b), dirt: H(d.pal.dirt), rock: H(d.pal.rock) }; d.fogC = H(d.fog); }
  const POOL = Object.keys(DEF);
  const LABELS = {}; for (const n of POOL) LABELS[n] = DEF[n].label;

  // pick this world's areas: meadow always, five more drawn from the rest
  const rng = Rng.stream('biome');
  const rest = POOL.filter(n => n !== 'meadow');
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const order = ['meadow', ...rest.slice(0, 5)];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const NAMES = order.slice();
  const widths = order.map(() => rng.range(0.75, 1.3));
  const total = widths.reduce((a, b) => a + b, 0);
  const sectors = [];
  let a = rng.range(0, Math.PI * 2);
  order.forEach((name, i) => { const span = widths[i] / total * Math.PI * 2; sectors.push({ name, a0: a, a1: a + span }); a += span; });
  const BLEND = 0.12;
  const TAU = Math.PI * 2;
  const angDiff = (d) => { d = ((d % TAU) + TAU) % TAU; return d > Math.PI ? d - TAU : d; };
  const has = (name) => NAMES.includes(name);

  function weights(x, z) {
    const th = Math.atan2(z, x);
    const out = {}; let sum = 0;
    for (const s of sectors) {
      const d0 = angDiff(th - s.a0), d1 = angDiff(s.a1 - th);
      const w = Util.smoothstep(-BLEND, BLEND, Math.min(d0, d1));
      out[s.name] = w; sum += w;
    }
    for (const n of NAMES) out[n] = (out[n] || 0) / (sum || 1);
    for (const n of POOL) if (!(n in out)) out[n] = 0;
    return out;
  }
  function dominant(x, z) {
    const w = weights(x, z);
    let best = NAMES[0];
    for (const n of NAMES) if (w[n] > w[best]) best = n;
    return { name: best, w: w[best] };
  }
  function sectorMid(name) { const s = sectors.find(s => s.name === name); return s ? (s.a0 + s.a1) / 2 : 0; }
  // blend any numeric DEF field by weights
  function blend(w, key) { let v = 0; for (const n of NAMES) v += (DEF[n][key] || 0) * w[n]; return v; }

  // landmark positions (outside the loop so they're visible from it)
  const volcano = has('volcanic') ? (() => { const th = sectorMid('volcanic'); const r = Config.TRAIL_RADIUS + 330; return { x: Math.cos(th) * r, z: Math.sin(th) * r, r: 190, h: 120 }; })() : null;

  return { NAMES, POOL, LABELS, DEF, sectors, weights, dominant, sectorMid, blend, has, volcano };
})();

export { Biome }
