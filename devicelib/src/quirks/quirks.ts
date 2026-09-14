/** Typed access to one device's quirk flags and params, with user overrides. */
import type { RegistryEntry } from '../registry/types.ts';
import { QUIRK_FLAGS, type QuirkFlag } from './flags.generated.ts';

export interface QuirkOverrides {
  /** Force flags on (true) or off (false), e.g. from an advanced settings screen. */
  flags?: Partial<Record<QuirkFlag, boolean>>;
  params?: Record<string, unknown>;
}

const KNOWN = new Set<string>(QUIRK_FLAGS);

export class Quirks {
  readonly flags: ReadonlySet<QuirkFlag>;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(flags: Iterable<QuirkFlag> = [], params: Record<string, unknown> = {}, overrides: QuirkOverrides = {}) {
    const set = new Set<QuirkFlag>(flags);
    for (const [k, v] of Object.entries(overrides.flags ?? {})) {
      if (!KNOWN.has(k)) throw new Error(`unknown quirk flag: ${k}`);
      if (v) set.add(k as QuirkFlag);
      else set.delete(k as QuirkFlag);
    }
    this.flags = set;
    this.params = { ...params, ...overrides.params };
  }

  static fromEntry(entry: RegistryEntry | undefined, overrides?: QuirkOverrides): Quirks {
    return new Quirks(entry?.flags ?? [], entry?.params ?? {}, overrides);
  }

  has(flag: QuirkFlag): boolean {
    return this.flags.has(flag);
  }

  num(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  optNum(key: string): number | undefined {
    const v = this.params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  str(key: string): string | undefined {
    const v = this.params[key];
    return typeof v === 'string' ? v : undefined;
  }

  /** Flags set on this device that the given driver does not implement yet. */
  unhandled(handled: Iterable<QuirkFlag>): QuirkFlag[] {
    const h = new Set(handled);
    return [...this.flags].filter((f) => !h.has(f));
  }
}
