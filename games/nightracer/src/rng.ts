/** Seeded randomness: the same seed builds the same track, city and race. */

export interface Rng {
  (): number
  range(a: number, b: number): number
  int(a: number, b: number): number
  pick<T>(arr: readonly T[]): T
  chance(p: number): boolean
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32, seeded from a number and an optional stream name so each system gets its own sequence. */
export function makeRng(seed: number, stream = ''): Rng {
  let a = (seed ^ hashString(stream)) >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = next as Rng
  rng.range = (lo, hi) => lo + (hi - lo) * next()
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next())
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)]!
  rng.chance = (p) => next() < p
  return rng
}

/** Smooth 2D value noise in [-1, 1] with fractal sums. */
export function makeNoise2D(seed: number, stream: string): { noise(x: number, z: number): number; fbm(x: number, z: number, octaves: number): number } {
  const rng = makeRng(seed, stream)
  const perm = new Uint16Array(512)
  const vals = new Float32Array(256)
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng() * 2 - 1 }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = perm[i]!; perm[i] = perm[j]!; perm[j] = t
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i]!
  const v = (ix: number, iz: number): number => vals[perm[(perm[ix & 255]! + iz) & 511]! & 255]!
  const fade = (t: number): number => t * t * (3 - 2 * t)
  const noise = (x: number, z: number): number => {
    const ix = Math.floor(x), iz = Math.floor(z)
    const fx = fade(x - ix), fz = fade(z - iz)
    const a = v(ix, iz), b = v(ix + 1, iz), c = v(ix, iz + 1), d = v(ix + 1, iz + 1)
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  }
  const fbm = (x: number, z: number, octaves: number): number => {
    let sum = 0, amp = 1, norm = 0, f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * f + o * 17.3, z * f - o * 9.1)
      norm += amp
      amp *= 0.5
      f *= 2.03
    }
    return sum / norm
  }
  return { noise, fbm }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Move `v` toward `target` by at most `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step)
