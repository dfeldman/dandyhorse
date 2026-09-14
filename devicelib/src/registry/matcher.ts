/**
 * Registry matching (see docs/devices/identification.md).
 *
 * Two passes: entries whose user_option the user has chosen, then entries without a user_option;
 * file order decides within a pass and the first match wins.
 *
 * Before connecting, rules that need GATT data are "unknown" and the match is provisional.
 * Web Bluetooth does not expose advertised services, so adv_service rules fall back to the
 * discovered GATT table once connected.
 */
import { REGISTRY_ENTRIES } from './entries.generated.ts';
import type { MatchRule, RegistryEntry } from './types.ts';

export interface MatchContext {
  name: string | undefined;
  /** Advertised service UUIDs (128-bit lowercase), or undefined when the platform hides them. */
  advertisedServices?: ReadonlySet<string>;
  /** Services and characteristics found after connecting, or undefined before connecting. */
  gatt?: ReadonlySet<string>;
  /** user_option values the user has chosen for this device. */
  options?: ReadonlySet<string>;
}

export type RuleResult = 'pass' | 'fail' | 'unknown';

export interface MatchResult {
  entry: RegistryEntry;
  /** True when some rules could not be checked yet; re-run after connecting. */
  provisional: boolean;
}

function hasNameRule(m: MatchRule): boolean {
  return !!(m.name_prefix || m.name_exact !== undefined || m.name_contains || m.name_regex || m.or_gatt_has);
}

function nameAlternative(m: MatchRule, name: string | undefined, gatt: ReadonlySet<string> | undefined): RuleResult {
  const hasNameKeys = !!(m.name_prefix || m.name_exact !== undefined || m.name_contains || m.name_regex);
  if (!hasNameRule(m)) return 'pass';
  if (name !== undefined) {
    const upper = name.toUpperCase();
    if (m.name_prefix?.some((p) => (m.case_sensitive ? name.startsWith(p) : upper.startsWith(p.toUpperCase())))) return 'pass';
    if (m.name_exact !== undefined && (m.case_sensitive ? name === m.name_exact : upper === m.name_exact.toUpperCase())) return 'pass';
    if (m.name_contains?.some((c) => upper.includes(c.toUpperCase()))) return 'pass';
    if (m.name_regex?.some((r) => new RegExp(r).test(upper))) return 'pass';
  }
  if (m.or_gatt_has) {
    if (!gatt) return 'unknown';
    if (m.or_gatt_has.some((u) => gatt.has(u))) return 'pass';
  }
  return 'fail';
}

function combine(results: RuleResult[]): RuleResult {
  if (results.includes('fail')) return 'fail';
  if (results.includes('unknown')) return 'unknown';
  return 'pass';
}

/** Evaluate every rule of one entry. user_option is checked against ctx.options. */
export function evaluate(entry: RegistryEntry, ctx: MatchContext): RuleResult {
  const m = entry.match;
  const name = ctx.name;
  const results: RuleResult[] = [nameAlternative(m, name, ctx.gatt)];
  const n = name ?? '';

  if (m.name_length !== undefined) results.push(n.length === m.name_length ? 'pass' : 'fail');
  if (m.name_length_any) results.push(m.name_length_any.includes(n.length) ? 'pass' : 'fail');
  if (m.exclude_prefix) {
    const upper = n.toUpperCase();
    results.push(m.exclude_prefix.some((p) => upper.startsWith(p.toUpperCase())) ? 'fail' : 'pass');
  }
  if (m.name_excludes_chars) results.push(m.name_excludes_chars.some((c) => n.includes(c)) ? 'fail' : 'pass');
  if (m.user_option !== undefined) results.push(ctx.options?.has(m.user_option) ? 'pass' : 'fail');

  // Advertised services: use the advertisement when the platform gives it, else the GATT table.
  const services = ctx.advertisedServices ?? ctx.gatt;
  if (m.adv_service) results.push(!services ? 'unknown' : m.adv_service.every((u) => services.has(u)) ? 'pass' : 'fail');
  if (m.adv_service_absent) results.push(!services ? 'unknown' : m.adv_service_absent.some((u) => services.has(u)) ? 'fail' : 'pass');
  if (m.gatt_has) results.push(!ctx.gatt ? 'unknown' : m.gatt_has.every((u) => ctx.gatt!.has(u)) ? 'pass' : 'fail');

  return combine(results);
}

/**
 * First entry that is not ruled out, following the two-pass order.
 *
 * After connecting (ctx.gatt set) this is exact. Before connecting, entries identified only by
 * services cannot be checked, so the provisional guess prefers entries whose name rule matched.
 */
export function matchDevice(ctx: MatchContext, entries: readonly RegistryEntry[] = REGISTRY_ENTRIES): MatchResult | undefined {
  const chosen = entries.filter((e) => e.match.user_option !== undefined && ctx.options?.has(e.match.user_option));
  const defaults = entries.filter((e) => e.match.user_option === undefined);
  let fallback: MatchResult | undefined;
  for (const entry of [...chosen, ...defaults]) {
    const r = evaluate(entry, ctx);
    if (r === 'fail') continue;
    const result = { entry, provisional: r === 'unknown' };
    if (ctx.gatt || (hasNameRule(entry.match) && nameAlternative(entry.match, ctx.name, ctx.gatt) === 'pass')) return result;
    fallback ??= result;
  }
  return fallback;
}

export interface Variant {
  option: string;
  entry: RegistryEntry;
}

/**
 * Variants the user could choose for a device with this name: entries whose name rules match
 * but which need a user_option. Show these as "Which model is this?" choices.
 */
export function variantsFor(name: string | undefined, entries: readonly RegistryEntry[] = REGISTRY_ENTRIES): Variant[] {
  const out: Variant[] = [];
  for (const entry of entries) {
    const opt = entry.match.user_option;
    if (opt === undefined || !hasNameRule(entry.match)) continue;
    // Only variants whose name rule actually matched; entries without name rules would match anything.
    if (nameAlternative(entry.match, name, undefined) !== 'pass') continue;
    if (evaluate(entry, { name, options: new Set([opt]) }) !== 'fail') out.push({ option: opt, entry });
  }
  return out;
}

export function entryById(id: string, entries: readonly RegistryEntry[] = REGISTRY_ENTRIES): RegistryEntry | undefined {
  return entries.find((e) => e.id === id);
}
