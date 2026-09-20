import { Biome } from './biome.js'
import { Config } from './config.js'
import { Loop } from './loop.js'
import { Terrain } from './terrain.js'
import { Util } from './util.js'
import { M } from './modules.js'

// The rail the bike rides: a closed, seeded, wobbly loop in XZ with an
// elevation profile derived from the raw landscape, smoothed and grade-capped.
// Where the profile crosses water the trail becomes a bridge deck.
//   poseAt(s)  -> {x,y,z, tx,ty,tz (unit tangent), grade, k (curvature), bridge}
//   nearest(x,z) -> {d, s, y, bridge} for points within ~30 m of the trail
const Track = (() => {
  const { clamp, smoothstep } = Util;
  const R = Loop.R, radiusAt = Loop.radiusAt, rng = Loop.rng;

  // ---- per-meter XZ table ----
  const X = [], Z = [];
  let LEN = 0;
  {
    const N = 16384, raw = [];
    let sAcc = 0, px = radiusAt(0), pz = 0;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2, r = radiusAt(th);
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      if (i > 0) sAcc += Math.hypot(x - px, z - pz);
      raw.push({ s: sAcc, x, z }); px = x; pz = z;
    }
    LEN = Math.floor(sAcc);
    let j = 0;
    for (let m = 0; m < LEN; m++) {
      while (j < raw.length - 2 && raw[j + 1].s < m) j++;
      const a = raw[j], b = raw[j + 1], f = (m - a.s) / Math.max(1e-6, b.s - a.s);
      X.push(a.x + (b.x - a.x) * f); Z.push(a.z + (b.z - a.z) * f);
    }
  }
  const wrap = (i) => ((i % LEN) + LEN) % LEN;

  // ---- lakes forced onto the loop (so there are bridges) ----
  for (let i = 0; i < Config.NUM_BASINS; i++) {
    const s = Math.floor(((i + 0.5) / Config.NUM_BASINS) * LEN + rng.range(-0.12, 0.12) * LEN);
    const k = wrap(s);
    Terrain.basins.push({ x: X[k], z: Z[k], r: rng.range(70, 110), s: k });
  }
  if (Biome.has('tropical')) {   // a lagoon in the tropical sector
    const th = Biome.sectorMid('tropical');
    let best = 0, bd = Infinity;
    for (let i = 0; i < LEN; i += 4) { const d = Math.abs(((Math.atan2(Z[i], X[i]) - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d < bd) { bd = d; best = i; } }
    Terrain.basins.push({ x: X[best], z: Z[best], r: 120, s: best });
  }

  // ---- elevation profile ----
  const Y = new Float32Array(LEN);
  const spanId = new Int16Array(LEN).fill(-1);
  const bridges = [];
  {
    const deck = Config.WATER_Y + Config.BRIDGE_DECK;
    const rawH = new Float32Array(LEN);
    for (let i = 0; i < LEN; i++) rawH[i] = Terrain.rawHeight(X[i], Z[i]);
    // wet runs -> spans (extended by abutments, small gaps merged)
    const wet = new Uint8Array(LEN);
    for (let i = 0; i < LEN; i++) wet[i] = rawH[i] < Config.WATER_Y + 0.5 ? 1 : 0;
    const ABUT = 6, GAP = 18;
    const wet2 = new Uint8Array(LEN);
    for (let i = 0; i < LEN; i++) if (wet[i]) for (let d = -ABUT; d <= ABUT; d++) wet2[wrap(i + d)] = 1;
    // merge gaps
    for (let i = 0; i < LEN; i++) if (!wet2[i]) {
      let g = 0; while (g < GAP && !wet2[wrap(i + g)]) g++;
      if (g < GAP && wet2[wrap(i - 1)]) for (let d = 0; d < g; d++) wet2[wrap(i + d)] = 1;
    }
    // label spans (handle wrap by starting at a dry index)
    let start = 0; while (start < LEN && wet2[start]) start++;
    if (start === LEN) start = 0;
    let id = -1;
    for (let n = 0; n < LEN; n++) {
      const i = wrap(start + n);
      if (wet2[i]) {
        if (!wet2[wrap(i - 1)] || n === 0) { id++; bridges.push({ s0: i, s1: i, id }); }
        spanId[i] = id; bridges[id].s1 = i;
      }
    }
    // target profile
    for (let i = 0; i < LEN; i++) Y[i] = spanId[i] >= 0 ? deck : rawH[i];
    const boxcar = (arr, w) => {
      const out = new Float32Array(LEN);
      for (let i = 0; i < LEN; i++) { let sum = 0; for (let d = -w; d <= w; d++) sum += arr[wrap(i + d)]; out[i] = sum / (2 * w + 1); }
      return out;
    };
    const clampDeck = () => { for (let i = 0; i < LEN; i++) if (spanId[i] >= 0) Y[i] = Math.max(Y[i], deck); };
    let T = boxcar(boxcar(Y, 22), 22); Y.set(T); clampDeck();
    // raise-only grade limiter, both directions, twice around the loop
    const G = Config.MAX_GRADE;
    const limitGrade = () => {
      for (let pass = 0; pass < 2; pass++) {
        for (let n = 1; n < LEN * 2; n++) { const i = wrap(n), p = wrap(n - 1); Y[i] = Math.max(Y[i], Y[p] - G); }
        for (let n = LEN * 2; n > 0; n--) { const i = wrap(n - 1), p = wrap(n); Y[i] = Math.max(Y[i], Y[p] - G); }
      }
    };
    limitGrade();
    T = boxcar(boxcar(Y, 5), 5); Y.set(T); clampDeck();
    for (let i = 0; i < LEN; i++) if (spanId[i] < 0 && Y[i] < Config.WATER_Y + 1.2) Y[i] = Config.WATER_Y + 1.2;
    limitGrade();   // the clamps above can reintroduce short steep steps
    for (const b of bridges) { b.len = wrap(b.s1 - b.s0) + 1; b.deck = deck; }
  }

  // ---- spatial hash for nearest-point queries ----
  const CELL = 30;
  const cells = new Map();
  const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
  for (let i = 0; i < LEN; i++) {
    const k = key(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
    let arr = cells.get(k); if (!arr) { arr = []; cells.set(k, arr); }
    arr.push(i);
  }
  function nearest(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = cells.get(key(cx + dx, cz + dz));
      if (!arr) continue;
      for (const i of arr) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return null;
    return { d: Math.sqrt(bd), s: best, y: Y[best], bridge: spanId[best] >= 0 };
  }

  function kappaAt(i) {
    const p0 = wrap(i - 3), p2 = wrap(i + 3);
    const abx = X[i] - X[p0], abz = Z[i] - Z[p0], bcx = X[p2] - X[i], bcz = Z[p2] - Z[i];
    const cross = abx * bcz - abz * bcx;
    const d = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(X[p2] - X[p0], Z[p2] - Z[p0]);
    return d > 1e-6 ? (2 * cross) / d : 0;
  }

  function poseAt(s) {
    const m = ((s % LEN) + LEN) % LEN;
    const i = Math.floor(m), f = m - i, j = wrap(i + 1);
    const x = X[i] + (X[j] - X[i]) * f, y = Y[i] + (Y[j] - Y[i]) * f, z = Z[i] + (Z[j] - Z[i]) * f;
    const a = wrap(i - 1), b = wrap(i + 2);
    let tx = X[b] - X[a], ty = Y[b] - Y[a], tz = Z[b] - Z[a];
    const hl = Math.hypot(tx, tz) || 1;
    const grade = ty / hl;
    const tl = Math.hypot(tx, ty, tz) || 1;
    return { x, y, z, tx: tx / tl, ty: ty / tl, tz: tz / tl, hx: tx / hl, hz: tz / hl, grade, k: kappaAt(i), bridge: spanId[i] >= 0, s: m };
  }

  return { poseAt, nearest, bridges, radiusAt, R, get length() { return LEN; } };
})();

M.Track = Track

export { Track }
