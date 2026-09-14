import type { QuirkFlag } from '../quirks/flags.generated.ts';

export type RegistryClass =
  | 'treadmill'
  | 'bike'
  | 'elliptical'
  | 'rower'
  | 'run_sensor'
  | 'sensor'
  | 'stair_climber'
  | 'stepper'
  | 'jump_rope';

/** support: use as is. prefer_ftms: vendor protocol is legacy, use FTMS when present. skip: not worth supporting. */
export type Recommend = 'support' | 'prefer_ftms' | 'skip';

/**
 * Match rules, as documented in the header of docs/devices/quirks.yaml.
 * Name keys (name_prefix, name_exact, name_contains, name_regex, or_gatt_has) are alternatives;
 * every other key present must hold. UUIDs are 128-bit lowercase.
 */
export interface MatchRule {
  name_prefix?: string[];
  name_exact?: string;
  name_contains?: string[];
  name_regex?: string[];
  case_sensitive?: boolean;
  name_length?: number;
  name_length_any?: number[];
  exclude_prefix?: string[];
  name_excludes_chars?: string[];
  adv_service?: string[];
  adv_service_absent?: string[];
  gatt_has?: string[];
  or_gatt_has?: string[];
  user_option?: string;
}

export interface RegistryEntry {
  id: string;
  class: RegistryClass;
  protocol: string;
  recommend: Recommend;
  match: MatchRule;
  flags: QuirkFlag[];
  params: Record<string, unknown>;
  /** Documentation page, relative to docs/devices. */
  doc: string;
  notes?: string;
}
