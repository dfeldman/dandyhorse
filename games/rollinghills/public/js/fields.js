// Farm fields: striped crop rectangles beside the trail in the meadow sector.
// Terrain ground color asks Fields.colorAt(x,z); built lazily (needs Track).
const Fields = (() => {
  let list = null;
  const PAL = [['#e8c95a', '#f4dc7c'], ['#4a9f3d', '#78cc5a'], ['#a07ad8', '#c3a1ec'], ['#d9a15a', '#efc07a'], ['#5fbf6a', '#c9ef8f']];
  function build() {
    list = [];
    const rng = Rng.stream('fields');
    const sec = Biome.sectors.find(s => s.name === 'meadow');
    if (!sec) return;
    for (let i = 0; i < 7; i++) {
      const th = sec.a0 + (sec.a1 - sec.a0) * rng.range(0.08, 0.92);
      const r = Loop.radiusAt(th);
      const n = Track.nearest(Math.cos(th) * r, Math.sin(th) * r);
      if (!n) continue;
      const p = Track.poseAt(n.s);
      const side = rng.chance(0.5) ? 1 : -1;
      const off = rng.range(34, 70), w = rng.range(40, 90), d = rng.range(28, 60);
      const cx = p.x - p.hz * side * off, cz = p.z + p.hx * side * off;
      if (Terrain.rawHeight(cx, cz) < Config.WATER_Y + 3) continue;
      const cols = rng.pick(PAL).map(Util.hex);
      list.push({ cx, cz, ux: p.hx, uz: p.hz, w, d, cols, pitch: rng.range(5, 8) });
    }
  }
  const tmp = new BABYLON.Color3();
  // returns a Color3 (shared) or null
  function colorAt(x, z, h) {
    if (!list) build();
    if (h < Config.WATER_Y + 1.5) return null;
    for (const f of list) {
      const dx = x - f.cx, dz = z - f.cz;
      const u = dx * f.ux + dz * f.uz, v = -dx * f.uz + dz * f.ux;
      if (Math.abs(u) > f.w / 2 || Math.abs(v) > f.d / 2) continue;
      const n = Track.nearest(x, z);
      if (n && n.d < Config.CORRIDOR + 2) return null;
      const stripe = Math.floor((u + f.w / 2) / f.pitch) & 1;
      tmp.copyFrom(f.cols[stripe]);
      return tmp;
    }
    return null;
  }
  return { colorAt, get list() { if (!list) build(); return list; } };
})();
