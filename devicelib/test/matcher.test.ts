import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY_ENTRIES } from '../src/registry/entries.generated.ts';
import { matchDevice, variantsFor, type MatchContext } from '../src/registry/matcher.ts';
import { normalizeUuid, UUID } from '../src/core/uuid.ts';
import { QUIRK_FLAGS } from '../src/quirks/flags.generated.ts';

const UART = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const id = (ctx: MatchContext) => matchDevice(ctx)?.entry.id;

test('Horizon 7.0AT: provisional before connecting, confirmed by 0xFFF3', () => {
  const pre = matchDevice({ name: 'HORIZON 7.0AT' });
  assert.equal(pre?.entry.id, 'horizon_7_series');
  assert.equal(pre?.provisional, true);
  const post = matchDevice({ name: 'HZ_7.0AT-1234', gatt: new Set([UUID.FTMS, UUID.VENDOR_FFF3]) });
  assert.equal(post?.entry.id, 'horizon_7_series');
  assert.equal(post?.provisional, false);
  assert.equal(post?.entry.recommend, 'prefer_ftms');
  assert.ok(post?.entry.flags.includes('speed_sent_in_tenth_kmh'));
  assert.ok(!id({ name: 'HORIZON 7.0AT', gatt: new Set([UUID.FTMS]) })?.startsWith('horizon'));
});

test('the 7-series speed quirk covers 7.x names only', () => {
  const fff3 = new Set([UUID.FTMS, UUID.VENDOR_FFF3]);
  for (const name of ['HORIZON_7.0AT 4959', 'HORIZON 7.4AT', 'HORIZON_7.8AT-1', 'HZ_7.0AT-99']) {
    assert.equal(id({ name, gatt: fff3 }), 'horizon_7_series', name);
  }
  for (const name of ['HORIZON T101', 'HZ_T101-1', 'HORIZON 7', 'PARAGON X 1']) {
    assert.notEqual(id({ name, gatt: fff3 }), 'horizon_7_series', name);
  }
  const chosen = (name: string) => matchDevice({ name, gatt: fff3, options: new Set(['horizon_7_8_or_paragon_x']) })?.entry;
  assert.ok(chosen('HORIZON_7.8AT-1')?.flags.includes('speed_sent_in_tenth_kmh'));
  assert.equal(chosen('PARAGON X 1')?.id, 'horizon_paragon_x');
  assert.ok(!chosen('PARAGON X 1')?.flags.includes('speed_sent_in_tenth_kmh'));
});

test('Zwift Hub matches by name, and by the Zwift service when the name is missing', () => {
  assert.equal(id({ name: 'Zwift Hub 5B2A' }), 'zwift_hub');
  assert.equal(id({ name: undefined, gatt: new Set([UUID.ZWIFT_SERVICE, UUID.FTMS]) }), 'zwift_hub');
});

test('catch-all prefixes do not shadow specific entries', () => {
  assert.equal(id({ name: 'ECH-ROW-1234', gatt: new Set() }), 'echelon_rower');
  assert.equal(id({ name: 'ECH-EC-SPT-1', gatt: new Set() }), 'echelon_stair_climber');
  assert.equal(id({ name: 'ECH-SPORT-1', gatt: new Set() }), 'echelon_connect_bike');
  assert.equal(id({ name: 'DOMYOS-ROW-9', gatt: new Set([UART]) }), 'domyos_rower');
  assert.equal(id({ name: 'Domyos-Bike-1', gatt: new Set([UART]) }), 'domyos_bike');
  assert.equal(id({ name: 'KETTLER C12', gatt: new Set() }), 'kettler_c12');
  assert.equal(id({ name: 'STAGES BIKE 22', gatt: new Set() }), 'stages_sb20');
  assert.equal(id({ name: 'I-ROWER 1', gatt: new Set() }), 'ftms_rower_ftms_only_subscribe');
});

test('user-chosen variants win over defaults (two-pass matching)', () => {
  assert.equal(id({ name: 'TOORX 123', gatt: new Set() }), 'toorx_appgate_treadmill');
  assert.equal(id({ name: 'TOORX 123', gatt: new Set(), options: new Set(['toorx_bike']) }), 'toorx_appgate_bike_shared_names');
  const opts = variantsFor('TOORX 123').map((v) => v.option);
  assert.ok(opts.includes('toorx_bike'));
  assert.ok(opts.includes('toorx_ftms_treadmill'));
  // Entries with no name rule (Peloton OCR, power meter as bike) must not be offered for every device.
  assert.deepEqual(variantsFor('HORIZON 7.0AT').map((v) => v.option), []);
  assert.deepEqual(variantsFor('HORIZON_7.8AT-1').map((v) => v.option), ['horizon_7_8_or_paragon_x']);
});

test('case sensitivity follows the entry', () => {
  assert.equal(id({ name: 'ECH-ROW-1', gatt: new Set() }), 'echelon_rower');
  assert.notEqual(id({ name: 'ech-sport', gatt: new Set() }), 'echelon_connect_bike');
});

test('every registry entry is reachable with a name built from its own rules', () => {
  const unreachable: string[] = [];
  for (const e of REGISTRY_ENTRIES) {
    const m = e.match;
    if (!m.name_prefix?.length) continue;
    let name = m.name_prefix[0]!;
    const len = m.name_length ?? m.name_length_any?.[0];
    if (len !== undefined) name = name.padEnd(len, '1').slice(0, len);
    else name += '1234';
    const gatt = new Set<string>([...(m.gatt_has ?? []), ...(m.adv_service ?? [])]);
    const got = matchDevice({
      name,
      advertisedServices: new Set(m.adv_service ?? []),
      gatt,
      options: m.user_option ? new Set([m.user_option]) : undefined,
    });
    if (got?.entry.id !== e.id) unreachable.push(`${e.id} (${name}) -> ${got?.entry.id}`);
  }
  assert.deepEqual(unreachable, []);
});

test('generated registry uses only known flags and normalised UUIDs', () => {
  const flags = new Set<string>(QUIRK_FLAGS);
  for (const e of REGISTRY_ENTRIES) {
    for (const f of e.flags) assert.ok(flags.has(f), `${e.id}: ${f}`);
    for (const u of [...(e.match.gatt_has ?? []), ...(e.match.adv_service ?? []), ...(e.match.or_gatt_has ?? [])]) {
      assert.equal(u, normalizeUuid(u));
    }
  }
});
