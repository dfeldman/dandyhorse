/** Deterministic randomness, so a seed and a length always give the same Random programme. */

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

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Round to a step (0.1, 0.5, 5), the way a console's buttons do. */
export const quantize = (v: number, step: number): number => Math.round(v / step) * step
