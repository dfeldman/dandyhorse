// Timed segments derived from the generated profile: the biggest climb
// (KOM) and a flat sprint. Bests live in the platform's per-user save state
// (Segments.bests, keyed seed:route:kind; Segments.onBest stores a new one).
const Segments = (() => {
  const list = [];
  let active = null;
  let onEvent = null;   // (type, seg, seconds, best) -> void
  let onBest = null;    // (key, seconds) -> void
  let bests = {};       // key -> seconds, loaded before build()

  function build() {
    const L = Track.length;
    const Y = new Float32Array(L);
    for (let i = 0; i < L; i++) Y[i] = Track.poseAt(i).y;
    // --- KOM: contiguous ascent with the largest gain (allowing tiny dips) ---
    let best = { gain: 0, s0: 0, s1: 0 };
    let start = 0, low = Y[0], dipRun = 0;
    for (let n = 1; n < L * 2; n++) {
      const i = n % L, p = (n - 1) % L;
      if (Y[i] >= Y[p] - 0.02) { dipRun = 0; }
      else { dipRun += 1; }
      if (dipRun > 25 || n - start > L) {   // ascent ended
        const endN = n - dipRun, gain = Y[endN % L] - low;
        if (gain > best.gain && endN - start >= 150) best = { gain, s0: start % L, s1: endN % L };
        start = n; low = Y[i]; dipRun = 0;
      }
    }
    if (best.gain > 8) list.push({ kind: 'kom', name: 'KOM CLIMB', s0: best.s0, s1: best.s1, len: ((best.s1 - best.s0) % L + L) % L, gain: best.gain });
    // --- sprint: flattest 300 m window away from the KOM ---
    const W = 300; let flat = { score: Infinity, s0: 0 };
    for (let s = 0; s < L; s += 10) {
      let score = 0, bad = false;
      for (let k = 0; k < W; k += 10) { const p = Track.poseAt(s + k); score += Math.abs(p.grade); if (p.bridge) bad = true; }
      const kom = list[0];
      if (kom) { const inKom = (x) => ((x - kom.s0) % L + L) % L < kom.len; if (inKom(s) || inKom(s + W)) bad = true; }
      if (!bad && score < flat.score) flat = { score, s0: s };
    }
    list.push({ kind: 'sprint', name: 'SPRINT', s0: flat.s0, s1: (flat.s0 + W) % L, len: W, gain: 0 });
    for (const seg of list) { const b = bests[key(seg)]; seg.best = typeof b === 'number' && b > 0 ? b : null; }
    return list;
  }

  const key = (seg) => `${Config.SEED}:${Config.ROUTE_NAME}:${seg.kind}`;
  function saveBest(seg) { bests[key(seg)] = seg.best; if (onBest) onBest(key(seg), seg.best); }

  // prevS -> s crossing detection (handles the lap wrap)
  function crossed(prev, now, mark) {
    const L = Track.length;
    const d = ((now - prev) % L + L) % L;
    return d < L / 2 && ((mark - prev) % L + L) % L < d;
  }
  function update(prevS, s, dt) {
    if (active) {
      active.t += dt;
      if (crossed(prevS, s, active.seg.s1)) {
        const seg = active.seg, t = active.t;
        const isBest = seg.best == null || t < seg.best;
        if (isBest) { seg.best = t; saveBest(seg); }
        if (onEvent) onEvent('end', seg, t, isBest);
        active = null;
      }
      return;
    }
    for (const seg of list) if (crossed(prevS, s, seg.s0)) { active = { seg, t: 0 }; if (onEvent) onEvent('start', seg); break; }
  }

  return {
    build, update, list, key,
    get active() { return active; },
    set onEvent(f) { onEvent = f; },
    set onBest(f) { onBest = f; },
    get bests() { return bests; }, set bests(b) { bests = b && typeof b === 'object' ? b : {}; },
  };
})();
