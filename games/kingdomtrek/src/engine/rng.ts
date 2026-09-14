/** Seeded RNG (mulberry32). The whole state is one 32-bit number, so it lives in the save. */
export class Rng {
  state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float()
  }

  /** Inclusive of both ends. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1))
  }

  chance(p: number): boolean {
    return this.float() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)]
  }
}

/** Stable 32-bit hash of a string, for deterministic per-thing seeds (town layouts). */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
