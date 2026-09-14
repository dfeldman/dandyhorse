/**
 * Who walks the roads: ordinary enemies by terrain, named foes for a mayor's "slay" quest, and the servants each
 * threat sends out (listed by the threats). Tier sets a fight's length (DESIGN.md §7); every number scales with
 * the hero's level, so the same wolf is a fair fight at level 1 and level 10.
 */
import type { Biome, EnemyDef } from '../content/types.ts'

const LIST: EnemyDef[] = [
  // --- the ordinary roadside ---
  { id: 'wolf', name: 'Grey Wolf', emoji: '🐺', family: 'beast', tier: 1, weakness: 'fire', gold: [8, 13], drops: [{ item: 'wolf_pelt', chance: 0.35 }], taunt: 'A wolf slinks out of the grass, teeth bared.' },
  { id: 'boar', name: 'Wild Boar', emoji: '🐗', family: 'beast', tier: 1, gold: [8, 12], taunt: 'A boar paws the ground and snorts.' },
  { id: 'bandit', name: 'Road Bandit', emoji: '🥷', family: 'bandit', tier: 2, battle: 'tug', gold: [15, 24], drops: [{ item: 'healing_draught', chance: 0.2 }], taunt: '"Your gold or your life, traveler!"' },
  { id: 'angry_swan', name: 'Angry Swan', emoji: '🦢', family: 'beast', tier: 1, battle: 'race', gold: [6, 11], taunt: 'A swan spreads its wings and hisses like a kettle. It wants the whole road to itself.' },
  { id: 'goblin', name: 'Goblin Scout', emoji: '👺', family: 'goblin', tier: 1, battle: 'race', weakness: 'fire', gold: [9, 14], drops: [{ item: 'goblin_trinket', chance: 0.4 }], taunt: 'A goblin cackles and waves a rusty knife.' },
  { id: 'giant_spider', name: 'Giant Spider', emoji: '🕷️', family: 'beast', tier: 2, weakness: 'fire', attack: 'poison', gold: [12, 18], drops: [{ item: 'spider_silk', chance: 0.4 }], taunt: 'A spider as big as a pony drops from the branches on a silver thread.' },
  { id: 'brown_bear', name: 'Brown Bear', emoji: '🐻', family: 'beast', tier: 2, battle: 'tug', weakness: 'fire', gold: [12, 20], drops: [{ item: 'jar_of_honey', chance: 0.3 }], taunt: 'A bear rears up on its hind legs. It smells of honey and bad temper.' },
  { id: 'wild_ram', name: 'Wild Ram', emoji: '🐏', family: 'beast', tier: 1, battle: 'race', gold: [7, 12], taunt: 'A ram lowers its curly horns and paws the turf.' },
  { id: 'hill_ogre', name: 'Hill Ogre', emoji: '👹', family: 'giant', tier: 3, battle: 'tug', weakness: 'storm', gold: [24, 34], drops: [{ item: 'carved_tusk', chance: 0.4 }], taunt: 'An ogre sits in the road eating a whole cabbage. It wipes its mouth and stands up.' },
  { id: 'crab', name: 'Giant Crab', emoji: '🦀', family: 'sea', tier: 1, battle: 'tug', weakness: 'storm', gold: [7, 12], drops: [{ item: 'pearl', chance: 0.1 }], taunt: 'A crab the size of a cart clacks its claws.' },
  { id: 'pirate', name: 'Pirate Deckhand', emoji: '🏴‍☠️', family: 'pirate', tier: 2, battle: 'tug', gold: [14, 22], drops: [{ item: 'pirate_doubloon', chance: 0.5 }], taunt: '"Arr! Hand over yer valuables!"' },
  { id: 'giant_octopus', name: 'Giant Octopus', emoji: '🐙', family: 'sea', tier: 2, battle: 'tug', weakness: 'storm', gold: [12, 20], drops: [{ item: 'sea_glass', chance: 0.4 }], taunt: 'Eight long arms reach up out of a rock pool. One of them grabs your boot.' },
  { id: 'thieving_gulls', name: 'Thieving Gulls', emoji: '🐦', family: 'beast', tier: 1, battle: 'race', gold: [6, 10], drops: [{ item: 'sea_glass', chance: 0.15 }], taunt: 'A flock of gulls swoops down, screaming. One of them has your lunch.' },
  { id: 'rock_golem', name: 'Rock Golem', emoji: '🗿', family: 'giant', tier: 2, weakness: 'storm', gold: [14, 20], drops: [{ item: 'silver_ore', chance: 0.2 }], taunt: 'A boulder unfolds into a grinding, rumbling golem.' },
  { id: 'cave_bats', name: 'Cave Bats', emoji: '🦇', family: 'beast', tier: 1, weakness: 'holy', gold: [6, 10], taunt: 'A swarm of bats pours out of the rocks!' },
  { id: 'mountain_eagle', name: 'Mountain Eagle', emoji: '🦅', family: 'beast', tier: 2, battle: 'race', gold: [12, 18], drops: [{ item: 'eagle_feather', chance: 0.5 }], taunt: 'An eagle with wings as wide as a cart dives out of the sun.' },
  { id: 'stone_troll', name: 'Stone Troll', emoji: '🧌', family: 'giant', tier: 3, battle: 'tug', weakness: 'storm', gold: [24, 34], drops: [{ item: 'troll_tooth', chance: 0.5 }], taunt: 'A troll steps out from behind a boulder. No, wait: the boulder IS the troll.' },
  { id: 'bog_lurker', name: 'Bog Lurker', emoji: '🐊', family: 'beast', tier: 2, weakness: 'fire', attack: 'poison', gold: [12, 18], taunt: 'Something scaly rises from the muck.' },
  { id: 'marsh_wisp', name: 'Marsh Wisp', emoji: '👻', family: 'spirit', tier: 2, weakness: 'holy', gold: [10, 16], taunt: 'A pale light drifts closer, whispering your name.' },
  { id: 'giant_toad', name: 'Giant Toad', emoji: '🐸', family: 'beast', tier: 1, battle: 'race', weakness: 'fire', attack: 'poison', gold: [7, 12], taunt: 'A toad the size of a barrel blinks at you, then flicks out a very long tongue.' },
  { id: 'frost_sprite', name: 'Frost Sprite', emoji: '🥶', family: 'spirit', tier: 1, battle: 'race', weakness: 'fire', resist: 'ice', attack: 'ice', gold: [8, 13], taunt: 'A shivering sprite hurls a snowball. It is mostly ice.' },
  { id: 'snow_troll', name: 'Snow Troll', emoji: '🧌', family: 'giant', tier: 3, battle: 'tug', weakness: 'fire', gold: [25, 35], drops: [{ item: 'troll_tooth', chance: 0.5 }], taunt: 'A troll heaves itself out of a snowdrift.' },
  { id: 'white_bear', name: 'White Bear', emoji: '🐻‍❄️', family: 'beast', tier: 2, battle: 'tug', weakness: 'fire', attack: 'ice', gold: [13, 20], drops: [{ item: 'frost_lily', chance: 0.25 }], taunt: 'A white bear lumbers out of the snow. It looks hungry, and a bit annoyed.' },
  { id: 'frost_wolf', name: 'Frost Wolf', emoji: '🐺', family: 'beast', tier: 2, weakness: 'fire', resist: 'ice', attack: 'ice', gold: [12, 18], drops: [{ item: 'wolf_pelt', chance: 0.4 }], taunt: 'A wolf as white as the snowfield pads closer, its breath freezing in the air.' },
  { id: 'kobold', name: 'Kobold Firetender', emoji: '🦎', family: 'dragon', tier: 2, weakness: 'ice', resist: 'fire', attack: 'fire', gold: [14, 22], drops: [{ item: 'ember_crystal', chance: 0.15 }], taunt: '"The great one will roast you!"' },
  { id: 'fire_imp', name: 'Fire Imp', emoji: '👿', family: 'spirit', tier: 2, battle: 'race', weakness: 'ice', resist: 'fire', attack: 'fire', gold: [13, 20], taunt: 'An imp giggles and juggles little flames.' },
  { id: 'fire_beetle', name: 'Fire Beetle', emoji: '🪲', family: 'beast', tier: 1, weakness: 'ice', resist: 'fire', attack: 'fire', gold: [8, 13], drops: [{ item: 'ember_crystal', chance: 0.1 }], taunt: 'A beetle with a shell like a glowing coal scuttles across the ash.' },
  { id: 'scorpion', name: 'Giant Scorpion', emoji: '🦂', family: 'beast', tier: 1, weakness: 'ice', attack: 'poison', gold: [8, 13], taunt: 'A scorpion raises its tail and clicks its claws.' },
  { id: 'sand_snake', name: 'Sand Snake', emoji: '🐍', family: 'beast', tier: 1, battle: 'race', weakness: 'ice', attack: 'poison', gold: [7, 12], taunt: 'The sand ripples. A snake shoots out of it like an arrow.' },
  { id: 'dust_devil', name: 'Dust Devil', emoji: '🌪️', family: 'spirit', tier: 2, battle: 'race', weakness: 'holy', attack: 'storm', gold: [12, 18], drops: [{ item: 'crystal_shard', chance: 0.15 }], taunt: 'A whirlwind of sand spins toward you, giggling.' },
  { id: 'mummy', name: 'Wandering Mummy', emoji: '🧟‍♂️', family: 'undead', tier: 2, battle: 'tug', weakness: 'fire', gold: [12, 20], drops: [{ item: 'golden_idol', chance: 0.05 }], taunt: 'Bandages trailing, a mummy shuffles out of a half-buried tomb.' },

  // --- servants of the threats ---
  { id: 'kraken_spawn', name: 'Kraken Spawn', emoji: '🦑', family: 'sea', tier: 2, battle: 'tug', weakness: 'storm', attack: 'ice', gold: [13, 20], drops: [{ item: 'sea_glass', chance: 0.3 }], taunt: 'A squid the size of a rowing boat hauls itself onto the road.' },
  { id: 'drowned_sailor', name: 'Drowned Sailor', emoji: '🧟‍♀️', family: 'undead', tier: 2, weakness: 'holy', attack: 'ice', gold: [12, 20], drops: [{ item: 'pirate_doubloon', chance: 0.3 }], taunt: 'A sailor in dripping rags squelches toward you, seaweed hanging from her hat.' },
  { id: 'shadow_imp', name: 'Shadow Imp', emoji: '😈', family: 'spirit', tier: 2, battle: 'race', weakness: 'holy', attack: 'storm', gold: [12, 18], taunt: 'A little purple imp blinks into being, snickering.' },
  { id: 'hexed_scarecrow', name: 'Hexed Scarecrow', emoji: '🎃', family: 'spirit', tier: 2, battle: 'tug', weakness: 'fire', gold: [12, 20], taunt: 'A scarecrow climbs down off its pole. Its pumpkin head grins at you.' },
  { id: 'plague_rats', name: 'Plague Rats', emoji: '🐀', family: 'beast', tier: 1, battle: 'race', weakness: 'fire', attack: 'poison', gold: [7, 12], taunt: 'A tide of rats pours across the road, squeaking.' },
  { id: 'witchs_owl', name: 'Witch\'s Owl', emoji: '🦉', family: 'spirit', tier: 2, battle: 'race', weakness: 'holy', attack: 'poison', gold: [12, 18], taunt: 'An owl with glowing green eyes swoops at you. It does not hoot. It cackles.' },
  { id: 'pirate_gunner', name: 'Pirate Gunner', emoji: '💣', family: 'pirate', tier: 2, weakness: 'storm', attack: 'fire', gold: [14, 22], drops: [{ item: 'pirate_doubloon', chance: 0.5 }], taunt: '"Fire in the hole!" A pirate lights a fuse and grins.' },
  { id: 'pirate_parrot', name: 'Pirate Parrot', emoji: '🦜', family: 'beast', tier: 1, battle: 'race', gold: [6, 12], drops: [{ item: 'pirate_doubloon', chance: 0.2 }], taunt: '"Pieces of eight! Pieces of eight!" A parrot dives at your hat.' },
  { id: 'legion_spearman', name: 'Legion Spearman', emoji: '💂', family: 'soldier', tier: 2, battle: 'tug', weakness: 'ice', attack: 'fire', gold: [14, 22], drops: [{ item: 'healing_draught', chance: 0.2 }], taunt: '"Halt! This road belongs to the Iron Legion now."' },
  { id: 'war_hound', name: 'War Hound', emoji: '🐕', family: 'beast', tier: 1, battle: 'race', weakness: 'fire', gold: [8, 13], taunt: 'A huge hound in a spiked collar bounds toward you, barking.' },
  { id: 'skeleton', name: 'Skeleton', emoji: '💀', family: 'undead', tier: 1, battle: 'race', weakness: 'holy', resist: 'poison', gold: [8, 13], taunt: 'A skeleton rattles out of a ditch and raises a rusty sword.' },
  { id: 'zombie', name: 'Shambling Zombie', emoji: '🧟', family: 'undead', tier: 2, battle: 'tug', weakness: 'holy', attack: 'poison', gold: [12, 20], taunt: 'A zombie lurches out of the mist, groaning about brains. Or possibly bread.' },
  { id: 'goblin_raider', name: 'Goblin Raider', emoji: '👺', family: 'goblin', tier: 2, battle: 'tug', weakness: 'fire', attack: 'poison', gold: [12, 20], drops: [{ item: 'goblin_trinket', chance: 0.5 }], taunt: 'A goblin in a saucepan helmet shrieks and charges.' },
  { id: 'wolf_rider', name: 'Goblin Wolf-Rider', emoji: '🐺', family: 'goblin', tier: 2, battle: 'race', weakness: 'fire', gold: [13, 20], drops: [{ item: 'wolf_pelt', chance: 0.3 }], taunt: 'A goblin riding a wolf bursts out of the bushes, whooping.' },
]

export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(LIST.map((d) => [d.id, d]))

/** Ordinary enemies of each terrain. */
export const ROADSIDE: Record<Biome, string[]> = {
  plains: ['wolf', 'boar', 'bandit', 'angry_swan'],
  forest: ['wolf', 'goblin', 'boar', 'giant_spider', 'brown_bear'],
  hills: ['wolf', 'goblin', 'wild_ram', 'bandit', 'hill_ogre'],
  coast: ['crab', 'pirate', 'giant_octopus', 'thieving_gulls'],
  mountain: ['rock_golem', 'cave_bats', 'goblin', 'mountain_eagle', 'stone_troll'],
  swamp: ['bog_lurker', 'marsh_wisp', 'goblin', 'giant_toad'],
  snow: ['wolf', 'frost_sprite', 'snow_troll', 'white_bear', 'frost_wolf'],
  volcano: ['kobold', 'fire_imp', 'cave_bats', 'fire_beetle'],
  desert: ['scorpion', 'sand_snake', 'dust_devil', 'mummy'],
}

/** Named foes (tier 3) a mayor can send the hero after, by the terrain of their road. */
export const NAMED: Record<Biome, EnemyDef[]> = {
  plains: [
    { id: 'boar_king', name: 'the Boar King', emoji: '🐗', family: 'beast', tier: 3, weakness: 'fire', gold: [35, 45], drops: [{ item: 'carved_tusk', chance: 1 }], taunt: 'A boar as big as an ox, with tusks like scythes, snorts in the middle of the road.', avatar: 'enormous black boar with a bristling mane and cracked yellow tusks' },
    { id: 'one_eyed_jack', name: 'One-Eyed Jack', emoji: '🥷', family: 'bandit', tier: 3, battle: 'tug', gold: [40, 55], drops: [{ item: 'pirate_doubloon', chance: 1 }], taunt: '"One-Eyed Jack, at your service. Now hand over everything shiny."', avatar: 'lanky bandit chief with an eyepatch, a feathered hat and far too many daggers' },
  ],
  forest: [
    { id: 'great_grey_wolf', name: 'the Great Grey Wolf', emoji: '🐺', family: 'beast', tier: 3, weakness: 'fire', gold: [35, 45], drops: [{ item: 'wolf_pelt', chance: 1 }], taunt: 'A wolf as big as a pony blocks the road. Its eyes are yellow lamps.', avatar: 'enormous grey wolf with a torn ear and yellow eyes' },
    { id: 'mother_spider', name: 'Old Mother Spider', emoji: '🕷️', family: 'beast', tier: 3, weakness: 'fire', attack: 'poison', gold: [35, 50], drops: [{ item: 'spider_silk', chance: 1 }], taunt: 'Old Mother Spider lowers herself from the treetops on a rope of silk. Her eight eyes glitter.', avatar: 'spider as big as a cart, with grey-striped legs and a crown of cobwebs' },
  ],
  hills: [
    { id: 'black_ram', name: 'the Black Ram', emoji: '🐏', family: 'beast', tier: 3, battle: 'race', gold: [35, 45], drops: [{ item: 'carved_tusk', chance: 1 }], taunt: 'The Black Ram scrapes a hoof, lowers its great curled horns, and charges.', avatar: 'huge black ram with curling golden horns and a temper to match' },
    { id: 'grimtooth', name: 'Grimtooth the Ogre', emoji: '👹', family: 'giant', tier: 3, battle: 'tug', weakness: 'storm', gold: [40, 55], drops: [{ item: 'troll_tooth', chance: 1 }], taunt: '"Grimtooth hungry. You look crunchy."', avatar: 'hulking green ogre with one enormous tooth, a patched tunic, and a club made from a whole tree' },
  ],
  coast: [
    { id: 'captain_barnacle', name: 'Captain Barnacle', emoji: '🏴‍☠️', family: 'pirate', tier: 3, gold: [40, 55], drops: [{ item: 'pirate_doubloon', chance: 1 }], taunt: '"Captain Barnacle, at yer service! Now empty yer pockets."', avatar: 'barrel-chested pirate captain with a barnacle-crusted peg leg and a parrot' },
    { id: 'great_crab', name: 'the Great Crab', emoji: '🦀', family: 'sea', tier: 3, battle: 'tug', weakness: 'storm', gold: [35, 45], drops: [{ item: 'pearl', chance: 1 }], taunt: 'A crab as big as a cottage rises from the surf, clacking claws like drawbridges.', avatar: 'colossal red crab with barnacles on its shell and one claw much bigger than the other' },
  ],
  mountain: [
    { id: 'thunder_eagle', name: 'the Thunder Eagle', emoji: '🦅', family: 'beast', tier: 3, battle: 'race', attack: 'storm', gold: [35, 50], drops: [{ item: 'eagle_feather', chance: 1 }], taunt: 'Lightning cracks as the Thunder Eagle dives, its feathers crackling with sparks.', avatar: 'golden eagle with wings like sails and sparks crackling along its feathers' },
    { id: 'boulderback', name: 'Old Boulderback', emoji: '🧌', family: 'giant', tier: 3, battle: 'tug', weakness: 'storm', gold: [40, 55], drops: [{ item: 'crystal_shard', chance: 1 }], taunt: '"Old Boulderback says: nobody crosses my pass."', avatar: 'moss-covered mountain troll with a back like a boulder and pebbles for eyes' },
  ],
  swamp: [
    { id: 'bog_beast', name: 'the Bog Beast', emoji: '🐊', family: 'beast', tier: 3, weakness: 'fire', attack: 'poison', gold: [35, 50], drops: [{ item: 'pearl', chance: 1 }], taunt: 'The bog heaves. A great scaly beast rises, dripping weed and bad temper.', avatar: 'huge scaly swamp beast draped in pondweed, with lantern-yellow eyes' },
    { id: 'old_croaker', name: 'Old Croaker', emoji: '🐸', family: 'beast', tier: 3, battle: 'race', weakness: 'fire', attack: 'poison', gold: [35, 45], drops: [{ item: 'crystal_shard', chance: 1 }], taunt: 'Old Croaker, the biggest toad in the bog, blinks slowly and puffs up like a drum.', avatar: 'toad as big as a haycart, warty and green, with a crown-shaped golden spot on its head' },
  ],
  snow: [
    { id: 'old_frostpaw', name: 'Old Frostpaw', emoji: '🐻‍❄️', family: 'beast', tier: 3, battle: 'tug', weakness: 'fire', attack: 'ice', gold: [35, 50], drops: [{ item: 'frost_lily', chance: 1 }], taunt: 'Old Frostpaw rears up out of a snowdrift, taller than a house, roaring.', avatar: 'gigantic white bear with frost in its fur and one torn ear' },
    { id: 'winter_wolf', name: 'the Winter Wolf', emoji: '🐺', family: 'beast', tier: 3, weakness: 'fire', resist: 'ice', attack: 'ice', gold: [35, 45], drops: [{ item: 'wolf_pelt', chance: 1 }], taunt: 'The Winter Wolf howls, and the air around you freezes.', avatar: 'pale blue wolf with icicle fangs and breath that freezes the air' },
  ],
  volcano: [
    { id: 'ash_salamander', name: 'the Ash Salamander', emoji: '🦎', family: 'beast', tier: 3, weakness: 'ice', resist: 'fire', attack: 'fire', gold: [35, 50], drops: [{ item: 'ember_crystal', chance: 1 }], taunt: 'The Ash Salamander uncoils from a crack in the ground, glowing like a poker in the fire.', avatar: 'long red-black salamander with glowing cracks along its back' },
    { id: 'magma_golem', name: 'the Magma Golem', emoji: '🗿', family: 'giant', tier: 3, battle: 'tug', weakness: 'ice', resist: 'fire', attack: 'fire', gold: [40, 55], drops: [{ item: 'ember_crystal', chance: 1 }], taunt: 'A golem of cooling lava hauls itself upright, dripping sparks.', avatar: 'hulking golem of black rock with molten orange seams' },
  ],
  desert: [
    { id: 'king_scorpion', name: 'the King Scorpion', emoji: '🦂', family: 'beast', tier: 3, weakness: 'ice', attack: 'poison', gold: [35, 50], drops: [{ item: 'crystal_shard', chance: 1 }], taunt: 'The King Scorpion bursts from the dunes, tail high, claws snapping.', avatar: 'scorpion as big as a wagon, black and gold, with a crown-shaped crest' },
    { id: 'sand_wyrm', name: 'the Sand Wyrm', emoji: '🐍', family: 'beast', tier: 3, battle: 'race', weakness: 'ice', attack: 'poison', gold: [35, 45], drops: [{ item: 'golden_idol', chance: 0.5 }], taunt: 'The dunes ripple, and the Sand Wyrm surges toward you like a wave.', avatar: 'enormous sand-coloured serpent with a shovel-shaped head' },
  ],
}
