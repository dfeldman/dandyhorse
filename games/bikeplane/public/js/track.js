// The rail the plane rides. Piecewise path parameterized by arc length s:
//   s < 0  : straight runway segment, tangent to the loop at s = 0
//   s >= 0 : a gently WAVING loop around the island — radius swells and dips
//            (two cosine lobes), so the plane weaves and banks to follow.
// The wave is tuned so r(0) = TRACK_RADIUS and r'(0) = 0: the runway join
// stays tangent-continuous. Pose comes from a per-meter arc-length table.
const Track = (() => {
  const R = Config.TRACK_RADIUS;

  function radiusAt(theta) {
    return R + 20 * (Math.cos(3 * theta) - 1) + 11 * (Math.cos(5 * theta) - 1);
  }

  // --- Build the per-meter lookup ---
  const pts = [];
  let LOOP_LEN = 0;
  {
    const N = 8192;
    const raw = [];
    let sAcc = 0, px = radiusAt(0), pz = 0;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = radiusAt(th);
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      if (i > 0) sAcc += Math.hypot(x - px, z - pz);
      raw.push({ s: sAcc, x, z });
      px = x; pz = z;
    }
    LOOP_LEN = sAcc;
    const M = Math.ceil(LOOP_LEN);
    let j = 0;
    for (let m = 0; m <= M + 1; m++) {
      const sT = Math.min(LOOP_LEN, (m / M) * LOOP_LEN);
      while (j < raw.length - 2 && raw[j + 1].s < sT) j++;
      const a = raw[j], b = raw[j + 1];
      const f = (sT - a.s) / Math.max(1e-6, b.s - a.s);
      pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
    }
  }
  // The rest of the game derives pacing from the true loop length.
  Config.CIRCUMFERENCE = LOOP_LEN;
  Config.RING_SPACING = LOOP_LEN / Config.NUM_RINGS;

  // Signed curvature from three consecutive samples (positive = left turn).
  function kappaAt(i) {
    const n = pts.length - 1;
    const p0 = pts[(i - 2 + n) % n], p1 = pts[i % n], p2 = pts[(i + 2) % n];
    const abx = p1.x - p0.x, abz = p1.z - p0.z;
    const bcx = p2.x - p1.x, bcz = p2.z - p1.z;
    const cross = abx * bcz - abz * bcx;
    const d = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(p2.x - p0.x, p2.z - p0.z);
    return d > 1e-6 ? (2 * cross) / d : 0;
  }

  function poseAt(s) {
    if (s < 0) {
      return { x: R, z: s, tx: 0, tz: 1, k: 0 };
    }
    const m = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
    const i = Math.floor(m);
    const f = m - i;
    const a = pts[i], b = pts[i + 1];
    const x = a.x + (b.x - a.x) * f;
    const z = a.z + (b.z - a.z) * f;
    const p2 = pts[(i + 2) % (pts.length - 1)];
    let tx = p2.x - a.x, tz = p2.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    return { x, z, tx: tx / tl, tz: tz / tl, k: kappaAt(i) };
  }

  // Distance from point (x,z) to the runway rectangle's centerline segment.
  function distToRunway(x, z) {
    const zc = Math.max(-Config.RUNWAY_LEN - 20, Math.min(10, z));
    return Math.hypot(x - R, z - zc);
  }

  return { poseAt, distToRunway, radiusAt, R, get length() { return LOOP_LEN; } };
})();
