/**
 * Deterministic randomness. Everything the game generates from the seed goes through here so
 * two sessions with the same seed produce the same world (ghosts and leaderboards depend on it).
 */

/** mulberry32: a tiny 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smoothstep (3t² - 2t³): C1-continuous interpolation weight. */
const smooth = (t: number) => t * t * (3 - 2 * t)

/**
 * 1-D value noise with integer lattice points and a repeat `period`, so noise(x) === noise(x + period).
 * Output is in [0, 1). Periodicity is what lets the loop route close seamlessly.
 */
export function valueNoise1D(seed: number, period: number): (x: number) => number {
  const n = Math.max(2, Math.floor(period))
  const rand = mulberry32(seed)
  const lattice = Array.from({ length: n }, () => rand())
  return (x: number) => {
    const xi = Math.floor(x)
    const i0 = ((xi % n) + n) % n
    const i1 = (i0 + 1) % n
    const a = lattice[i0] ?? 0
    const b = lattice[i1] ?? 0
    return a + (b - a) * smooth(x - xi)
  }
}
