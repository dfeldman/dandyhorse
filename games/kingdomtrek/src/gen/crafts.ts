/**
 * Recipes the generator hands out (DESIGN.md §9). Every game has a Healing Draught and a tonic made from pedaling
 * alone, a few things made from what its lands turn up, and one of the three things the boss requires.
 */
import type { Biome, Threat } from '../content/types.ts'

interface Need { item: string; qty: number }

/** Seconds of steady pedaling for one of the three: a few minutes of real work, like a quest's detour. */
export const KIT_SECONDS = 240

/**
 * The one of the three each threat's hero makes rather than finds, and what from. Anything wanted twice, drunk or
 * wielded is sold in a shop that never runs out; a single treasure is found once. `words` names them for the hint.
 */
export const KIT_RECIPES: Record<Threat, { slot: 'weapon' | 'armor' | 'relic'; needs: Need[]; words: string }> = {
  dragon: { slot: 'relic', needs: [{ item: 'sea_glass', qty: 2 }, { item: 'frost_lily', qty: 1 }], words: 'two pieces of sea glass bound round a frost lily' },
  sea_monster: { slot: 'relic', needs: [{ item: 'sea_glass', qty: 2 }, { item: 'pearl', qty: 1 }], words: 'a pearl set in two pieces of sea glass' },
  wizard_curse: { slot: 'relic', needs: [{ item: 'silver_ore', qty: 2 }, { item: 'crystal_shard', qty: 1 }], words: 'two lumps of silver ore, polished round a crystal shard' },
  witch_plague: { slot: 'weapon', needs: [{ item: 'iron_sword', qty: 1 }, { item: 'ember_crystal', qty: 1 }], words: 'an iron sword, forged again in the heat of an ember crystal' },
  pirates: { slot: 'weapon', needs: [{ item: 'cutlass', qty: 1 }, { item: 'pearl', qty: 1 }], words: 'a cutlass with a storm-pearl set in its hilt' },
  enemy_nation: { slot: 'relic', needs: [{ item: 'silk_ribbon', qty: 2 }, { item: 'eagle_feather', qty: 1 }], words: 'two lengths of silk ribbon and an eagle feather' },
  giant: { slot: 'relic', needs: [{ item: 'silver_ore', qty: 2 }, { item: 'carved_tusk', qty: 1 }], words: 'a carved tusk bound with two lumps of silver ore' },
  undead: { slot: 'relic', needs: [{ item: 'jar_of_honey', qty: 2 }, { item: 'holy_water', qty: 1 }], words: 'two jars of honey for the wax, and some Holy Water' },
  goblin_horde: { slot: 'relic', needs: [{ item: 'crystal_shard', qty: 2 }, { item: 'ember_crystal', qty: 1 }], words: 'two crystal shards and an ember crystal' },
  frost_titan: { slot: 'relic', needs: [{ item: 'jar_of_honey', qty: 2 }, { item: 'ember_crystal', qty: 1 }], words: 'two jars of summer honey and an ember crystal' },
}

/** Things made from local finds, offered when the region has one of `lands`. */
export const LOCAL_RECIPES: { item: string; needs: Need[]; seconds: number; lands: Biome[] }[] = [
  { item: 'frost_flask', needs: [{ item: 'frost_lily', qty: 1 }], seconds: 30, lands: ['snow'] },
  { item: 'fire_flask', needs: [{ item: 'ember_crystal', qty: 1 }], seconds: 30, lands: ['volcano'] },
  { item: 'thunder_vial', needs: [{ item: 'sea_glass', qty: 1 }], seconds: 30, lands: ['coast'] },
  { item: 'venom_vial', needs: [{ item: 'spider_silk', qty: 1 }], seconds: 30, lands: ['forest'] },
  { item: 'holy_water', needs: [{ item: 'pearl', qty: 1 }], seconds: 30, lands: ['swamp', 'coast'] },
  { item: 'fur_cloak', needs: [{ item: 'wolf_pelt', qty: 3 }], seconds: 90, lands: ['plains', 'hills', 'snow'] },
  { item: 'chainmail', needs: [{ item: 'silver_ore', qty: 2 }], seconds: 150, lands: ['mountain'] },
]
