/**
 * The ten threats a generated game can face. Each has a boss, the three things that beat it (a weapon that
 * hits its weakness, armour that resists its attack, and a relic), servants on the roads near its lair, and the
 * words for the Queen's summons, the crisis town and the victory.
 *
 * Tokens: {boss} {Boss} {bossShort} {BossShort} {crisis} {region} {lair} {weapon} {Weapon} {armor} {relic}
 * {Relic} {ruler} {Ruler}. Capitalised tokens start a sentence.
 */
import type { Biome, EnemyDef, Threat } from '../content/types.ts'

export interface BossName { name: string; short: string }

export interface ThreatDef {
  /** Biomes the crisis town may have, and ones that suit the towns next to it. */
  crisis: Biome[]
  near: Biome[]
  kit: { weapon: string; armor: string; relic: string }
  /** How the Queen names each of the three in her summons. */
  lore: { weapon: string; armor: string; relic: string }
  boss: Pick<EnemyDef, 'emoji' | 'family' | 'weakness' | 'resist' | 'attack'> & { names: BossName[]; avatars: string[]; taunts: string[] }
  /** Enemy ids (bestiary) met on the roads to the crisis town. */
  minions: string[]
  titles: string[]
  lair: { names: string[]; emoji: string; texts: string[] }
  /** The Queen's second line: what has happened. */
  danger: string
  victory: string[]
  crisisBlurbs: string[]
  /** The crisis town's mayor, meeting the hero. */
  greeting: string[]
  /** What the old songs say about its weakness (a hint). */
  weakHint: string
  /** The east of the region, for its blurb. */
  east: string
  watchman: string[]
}

export const THREAT_DEFS: Record<Threat, ThreatDef> = {
  dragon: {
    crisis: ['volcano'],
    near: ['mountain', 'hills'],
    kit: { weapon: 'frostbrand', armor: 'dragonscale_shield', relic: 'tidestone' },
    lore: { weapon: 'the ice-blade Frostbrand', armor: 'a Dragonscale Shield to turn its fire', relic: 'the Tidestone, which drinks flame' },
    boss: {
      emoji: '🐉', family: 'dragon', weakness: 'ice', resist: 'fire', attack: 'fire',
      names: [{ name: 'Ashwing the Black', short: 'Ashwing' }, { name: 'Emberfang the Gold', short: 'Emberfang' }, { name: 'Scorchscale the Old', short: 'Scorchscale' }, { name: 'Pyrrhax the Red', short: 'Pyrrhax' }],
      avatars: [
        'huge black dragon with smoking nostrils, ragged wings, and eyes like molten glass',
        'gold-scaled dragon with a crown of horns and a belly that glows like a furnace',
        'ancient red dragon, scarred and grey around the muzzle, with a voice like a landslide',
      ],
      taunts: ['"Another morsel climbs my mountain. Come, little hero. Let me warm you."', '"I slept for a thousand years, and I woke up hungry."'],
    },
    minions: ['kobold', 'fire_imp'],
    titles: ['The Dragon of {crisis}', 'Fire over {crisis}'],
    lair: {
      names: ['{BossShort}\'s Lair', 'the Burning Cave'],
      emoji: '🌋',
      texts: ['Heat pours from a cave mouth above the town. Melted shields litter the slope.', 'A crack in the mountain glows orange. Every few breaths, smoke rolls out of it.'],
    },
    danger: 'A dragon, {boss}, has woken beneath {crisis} in the far east of {region}. Its fire has driven the townsfolk from their homes.',
    victory: [
      'You raise {relic} and {bossShort}\'s fire hisses into steam. {Weapon} bites, and bites again.',
      'With a last roar that shakes the mountain, {bossShort} crashes down the slope and moves no more.',
      'The fires of {crisis} gutter out. The townsfolk creep back, then cheer until they are hoarse.',
    ],
    crisisBlurbs: ['A town of red stone beneath a smoking mountain. Most folk have fled; ash drifts like snow.', 'Scorched roofs and blackened walls under a sky full of smoke. Only the bravest have stayed.'],
    greeting: ['You\'ve come! {Ruler} heard us!', '{BossShort} lairs in the mountain above the town. It burned my hall, and half the town with it.'],
    weakHint: 'Dragons hate the cold. A frost weapon would bite deep.',
    east: 'the smoking peak above {crisis}',
    watchman: ['I\'ve been throwing water on fires for a week.', 'Please tell me you\'re here to stop it.'],
  },

  sea_monster: {
    crisis: ['coast'],
    near: ['coast', 'swamp'],
    kit: { weapon: 'trident_of_tides', armor: 'selkie_cloak', relic: 'sirens_conch' },
    lore: { weapon: 'the Trident of Tides, which the sea obeys', armor: 'a Selkie Cloak against the cold of the deep', relic: 'the Siren\'s Conch, which stills the waves' },
    boss: {
      emoji: '🦑', family: 'sea', weakness: 'storm', resist: 'ice', attack: 'ice',
      names: [{ name: 'the Kraken of the Deep', short: 'the Kraken' }, { name: 'Old Grimtide', short: 'Grimtide' }, { name: 'the Leviathan', short: 'the Leviathan' }, { name: 'Maelstrom Maw', short: 'Maelstrom Maw' }],
      avatars: [
        'colossal grey-green squid with eyes like cartwheels and suckers the size of shields',
        'vast barnacled sea serpent with a mane of kelp and teeth like a portcullis',
        'enormous dark kraken trailing fishing nets and broken masts',
      ],
      taunts: ['The sea boils. Tentacles as thick as oak trees rise from the water, and something enormous blinks at you.', '"Little land-creature. The sea is mine, and so is everything that floats on it."'],
    },
    minions: ['kraken_spawn', 'drowned_sailor'],
    titles: ['The Beast Beneath {crisis}', 'The Deep below {crisis}'],
    lair: {
      names: ['the Drowned Grotto', 'the Black Deep'],
      emoji: '🌊',
      texts: ['Black water churns in a sea cave below the harbour. Something vast moves beneath it.', 'The harbour mouth is a whirlpool of dark water. Broken masts poke out of it like bones.'],
    },
    danger: '{Boss} has risen from the sea off {crisis}. It drags down every boat that leaves the harbour, and the town is going hungry.',
    victory: [
      'You blow {relic}, and the sea falls still as glass. {BossShort} rises, blinking, into the sunlight.',
      '{Weapon} crackles with lightning. With a last great splash, {bossShort} sinks into the deep and does not come back.',
      'By evening the boats of {crisis} are out on a calm sea, and the whole harbour is singing.',
    ],
    crisisBlurbs: ['A harbour town where no boats sail. The fishing fleet sits idle, and the sea is black and strange.', 'Empty quays, torn nets, and a harbour where nothing floats for long.'],
    greeting: ['Thank goodness! {Ruler} sent you!', '{BossShort} lurks in the deep below the harbour. Not a single boat has come home this month.'],
    weakHint: 'Sea monsters fear the lightning. A storm weapon would sting.',
    east: 'the dark harbour of {crisis}',
    watchman: ['I count the boats every morning. There are fewer every day.', 'My granny says the sea has a long memory. I hope it forgets us.'],
  },

  wizard_curse: {
    crisis: ['forest', 'mountain', 'hills'],
    near: ['forest', 'mountain', 'hills'],
    kit: { weapon: 'spellbreaker_staff', armor: 'warding_amulet', relic: 'mirror_of_truth' },
    lore: { weapon: 'the Spellbreaker Staff', armor: 'a Warding Amulet to turn aside lightning', relic: 'the Mirror of Truth, which breaks every illusion' },
    boss: {
      emoji: '🧙‍♂️', family: 'wizard', weakness: 'holy', resist: 'storm', attack: 'storm',
      names: [{ name: 'Malgrim the Grey', short: 'Malgrim' }, { name: 'Vexmoor the Hexer', short: 'Vexmoor' }, { name: 'the Sorcerer Zoltan', short: 'Zoltan' }, { name: 'Morvane the Cruel', short: 'Morvane' }],
      avatars: [
        'tall grey sorcerer in a cloak of storm clouds, with a staff crackling with lightning',
        'thin sorcerer with a pointed beard, violet robes, and eyes that glow in the dark',
        'hunched sorcerer in black and silver, surrounded by floating, whispering books',
      ],
      taunts: ['"Ah, a visitor. You look tired. Why not have a nice, long sleep?"', '"Nobody breaks my spells. Nobody!"'],
    },
    minions: ['shadow_imp', 'hexed_scarecrow'],
    titles: ['The Curse of {crisis}', 'The Sleep of {crisis}'],
    lair: {
      names: ['the Hex Tower', 'the Tower of Whispers'],
      emoji: '🔮',
      texts: ['A crooked tower leans over the town. Lightning flickers around its top, though the sky is clear.', 'Purple light glows in the tower windows, and the air hums like a beehive.'],
    },
    danger: 'A sorcerer called {boss} has laid a curse on {crisis}. Nearly everyone there has fallen into an enchanted sleep, and the curse is spreading.',
    victory: [
      'You hold up {relic}. {BossShort} sees a true reflection at last, and screams.',
      '{Weapon} cuts through the last spell like a knife through cobwebs. {BossShort} vanishes in a puff of grey smoke.',
      'All over {crisis}, people yawn, stretch, and wake up, wondering why everyone is cheering.',
    ],
    crisisBlurbs: ['A town of tall grey houses, silent as a painting. Its people sleep where they stood.', 'Snoring drifts from every window. Only a handful of townsfolk are still awake, and they look very tired.'],
    greeting: ['Oh! Someone else who is awake! {Ruler} sent you?', '{BossShort} cursed us from the tower above the town. I only stayed awake by drinking a great deal of very strong tea.'],
    weakHint: 'Holy light breaks a sorcerer\'s spells.',
    east: 'the sleeping town of {crisis}',
    watchman: ['If I sit down, I\'ll fall asleep. So I don\'t sit down.', 'My whole family is snoring. Even the dog.'],
  },

  witch_plague: {
    crisis: ['swamp'],
    near: ['swamp', 'forest'],
    kit: { weapon: 'hearthblade', armor: 'physicians_mantle', relic: 'heartroot' },
    lore: { weapon: 'the Hearthblade, forged in kitchen fires', armor: 'a Physician\'s Mantle against the plague', relic: 'the Heartroot, which cures any blight' },
    boss: {
      emoji: '🧙‍♀️', family: 'witch', weakness: 'fire', resist: 'poison', attack: 'poison',
      names: [{ name: 'Old Mother Blight', short: 'Mother Blight' }, { name: 'Grizelda of the Fens', short: 'Grizelda' }, { name: 'Hagatha Rotwood', short: 'Hagatha' }, { name: 'the Nettle Witch', short: 'the Nettle Witch' }],
      avatars: [
        'bent old witch in a cloak of moss and toadstools, with a hat as black as a cauldron',
        'tall green-faced witch with a crooked nose and a cloak that drips bog water',
        'tiny, ancient witch riding in a cauldron, cackling, with a crow on her hat',
      ],
      taunts: ['"A hero? In MY bog? Hee hee! Have a sniff of my latest brew."', '"Everything rots in the end, dearie. I just help it along."'],
    },
    minions: ['plague_rats', 'witchs_owl'],
    titles: ['The Plague of {crisis}', 'The Witch of {crisis}'],
    lair: {
      names: ['the Blighted Hollow', 'the Witch\'s Cottage'],
      emoji: '🍄',
      texts: ['A crooked cottage in a hollow of dead trees. Green smoke leaks from its chimney.', 'Toadstools the size of umbrellas ring a black pool. A cauldron bubbles beside it.'],
    },
    danger: '{Boss} has brewed a plague in the bogs near {crisis}. Crops are rotting, the wells are turning green, and folk are falling ill.',
    victory: [
      'You drop {relic} into the town well, and the green water runs clear.',
      '{Weapon} blazes like a hearth fire. With a shriek, {bossShort} melts into a puddle of bog water.',
      'The fever breaks all over {crisis}. By morning, the gardens are green again.',
    ],
    crisisBlurbs: ['A village on stilts over a sickly green bog. The frogs have stopped singing.', 'Shutters closed, gardens brown, and a green haze hanging over every roof.'],
    greeting: ['*cough* Welcome, Hero. Forgive me, *cough*, the whole town has it.', '{BossShort} brews the plague in a hollow past the bog. Please hurry.'],
    weakHint: 'Witchery can\'t stand the warmth of a good fire.',
    east: 'the sickly bogs of {crisis}',
    watchman: ['Don\'t drink the water. Don\'t even look at the water.', 'I\'d do anything for a glass of clean water.'],
  },

  pirates: {
    crisis: ['coast'],
    near: ['coast', 'plains', 'forest'],
    kit: { weapon: 'stormcaller', armor: 'admirals_coat', relic: 'skull_cove_map' },
    lore: { weapon: 'the cutlass Stormcaller', armor: 'an Admiral\'s Coat against cannon-fire', relic: 'the Map of Skull Cove, which shows the way to their hideout' },
    boss: {
      emoji: '🏴‍☠️', family: 'pirate', weakness: 'storm', attack: 'fire',
      names: [{ name: 'the Pirate King Blackwake', short: 'Blackwake' }, { name: 'Captain Scarlett Storm', short: 'Captain Storm' }, { name: 'Admiral Bonebeard', short: 'Bonebeard' }, { name: 'Red Kestrel of the Black Sails', short: 'Red Kestrel' }],
      avatars: [
        'towering pirate king in a coat of red velvet, with a black beard braided with gold coins',
        'fierce pirate captain with a scarlet tricorn hat, two cutlasses, and a monkey on one shoulder',
        'grizzled old admiral of pirates with a beard as white as sea-foam and a peg leg of whalebone',
      ],
      taunts: ['"Ahoy, landlubber! Ye\'ve come a long way to walk the plank!"', '"Everything on this coast belongs to me. Including, now, your boots."'],
    },
    minions: ['pirate_gunner', 'pirate_parrot'],
    titles: ['The Pirates of {crisis}', 'Black Sails over {crisis}'],
    lair: {
      names: ['Skull Cove', 'the Black Ship'],
      emoji: '🏴‍☠️',
      texts: ['A hidden cove behind the reefs, where a black-sailed ship lies at anchor.', 'A great black ship rides at anchor in the bay, bristling with cannons.'],
    },
    danger: '{Boss} and a fleet of black sails have seized {crisis}. They rob every ship on the coast and hold the town to ransom.',
    victory: [
      'Following {relic}, you slip through the reefs and climb aboard the black ship.',
      '{Weapon} brings down a squall on the deck. {BossShort} surrenders, soaked to the skin, and the crew throws down their cutlasses.',
      'The ships of {crisis} sail free again, and the harbour bells ring all night.',
    ],
    crisisBlurbs: ['A proud port under a black flag. Pirates swagger through the streets and eat the bakeries bare.', 'Merchant ships sit burnt at the quay, and a skull-and-crossbones flies over the harbour tower.'],
    greeting: ['Psst! In here, quick, before they see you. {Ruler} sent you?', '{BossShort} rules the town from a black ship out in the bay. We pay them every week, or they burn a warehouse.'],
    weakHint: 'Pirates fear nothing like a storm at sea.',
    east: 'the pirate-held port of {crisis}',
    watchman: ['They took my lantern. And my hat. And my other hat.', 'Every night they sing sea shanties. Badly. Very loudly.'],
  },

  enemy_nation: {
    crisis: ['plains', 'hills', 'mountain'],
    near: ['hills', 'plains', 'mountain'],
    kit: { weapon: 'northwind_spear', armor: 'bulwark_shield', relic: 'queens_banner' },
    lore: { weapon: 'the Northwind Spear of the old kings', armor: 'a Bulwark Shield against fire arrows', relic: 'my own banner, lost in the last war, to rally the people' },
    boss: {
      emoji: '🤺', family: 'soldier', weakness: 'ice', attack: 'fire',
      names: [{ name: 'Warlord Grax of the Iron Legion', short: 'Warlord Grax' }, { name: 'General Vorn', short: 'General Vorn' }, { name: 'the Iron Duke', short: 'the Iron Duke' }, { name: 'Marshal Kargoth', short: 'Marshal Kargoth' }],
      avatars: [
        'grim warlord in black iron armour, with a horned helm and a cloak of red wolf-fur',
        'scarred old general in a steel mask, with a voice like a trumpet',
        'giant of a soldier in plate armour, with a war-hammer as tall as a man',
      ],
      taunts: ['"{Ruler} sent one hero? How very brave. How very foolish."', '"Surrender, and I may let you carry my baggage."'],
    },
    minions: ['legion_spearman', 'war_hound'],
    titles: ['The Siege of {crisis}', 'The Iron Legion'],
    lair: {
      names: ['the Iron Camp', 'the Siege Lines'],
      emoji: '⛺',
      texts: ['Tents and siege towers cover the fields beyond the walls. War drums beat day and night.', 'Rows of black tents, a forest of spears, and in the middle a great striped pavilion.'],
    },
    danger: '{Boss} has marched the Iron Legion over our eastern border and laid siege to {crisis}. The town walls will not hold for long.',
    victory: [
      'You raise {relic} over the walls of {crisis}, and every soldier in the town cheers.',
      '{Weapon} howls like a winter wind. The Iron Legion breaks and runs for the border.',
      'The siege is over. {BossShort} signs a peace treaty with a very shaky hand and marches home.',
    ],
    crisisBlurbs: ['A walled border town under siege. Smoke rises from the fields beyond the walls.', 'Stout walls, tired guards, and a great deal of worried whispering in the market square.'],
    greeting: ['Hero! You made it through the lines! {Ruler} heard us.', '{BossShort} camps beyond the walls with a whole legion. We have food for a week, maybe two.'],
    weakHint: 'The Iron Legion comes from the hot south. They hate the cold.',
    east: 'the besieged walls of {crisis}',
    watchman: ['I\'ve been on this wall for six days. My feet have forgotten what a bed is.', 'Every morning they shout that we should surrender. Every morning we shout back something rude.'],
  },

  giant: {
    crisis: ['mountain', 'hills'],
    near: ['mountain', 'hills', 'snow'],
    kit: { weapon: 'giants_needle', armor: 'lodestone_belt', relic: 'lullaby_horn' },
    lore: { weapon: 'the Giant\'s Needle', armor: 'a Lodestone Belt to ground its lightning', relic: 'the Lullaby Horn, which sends giants to sleep' },
    boss: {
      emoji: '🧌', family: 'giant', weakness: 'poison', resist: 'storm', attack: 'storm',
      names: [{ name: 'Grumhold the Storm Giant', short: 'Grumhold' }, { name: 'Thundergut the Giant', short: 'Thundergut' }, { name: 'Old Rumblebelly', short: 'Rumblebelly' }, { name: 'Brontes the Loud', short: 'Brontes' }],
      avatars: [
        'storm giant as tall as a church tower, with a beard of thundercloud and a club made from a whole oak',
        'enormous grey giant wearing a barn roof as a hat, with lightning crackling in both fists',
        'huge, grumpy giant with a nose like a boulder and a belt of stolen church bells',
      ],
      taunts: ['"FEE, FI, FO... oh, never mind. I\'ll just squash you."', '"You are very small. I am very big. This will not take long."'],
    },
    minions: ['hill_ogre', 'stone_troll'],
    titles: ['The Giant of {crisis}', 'Thunder over {crisis}'],
    lair: {
      names: ['the Cloud Crag', 'the Giant\'s Stair'],
      emoji: '⛰️',
      texts: ['A crag so high its top is lost in thunderclouds. The ground shakes with every step up there.', 'Steps as tall as houses climb into the storm clouds. Something up there is snoring like thunder.'],
    },
    danger: '{Boss} has come down from the mountains to {crisis}. The giant stamps on barns for fun, and thunderstorms follow wherever it goes.',
    victory: [
      'You blow {relic}. {BossShort} gives a yawn as wide as a barn door.',
      'One jab of {weapon}, and down the giant goes, fast asleep, with a thud that shakes the hills.',
      'The people of {crisis} tie up the snoring giant with every rope in town, then roll it home to the mountains.',
    ],
    crisisBlurbs: ['A hill town of flattened barns and giant footprints. Thunder rumbles day and night.', 'Half the roofs are missing, and there is a footprint in the town square big enough to swim in.'],
    greeting: ['Mind your head! Oh, it\'s you. {Ruler} said you\'d come.', '{BossShort} sleeps up on the crag and comes down every morning to stamp on something. Yesterday it was the bakery.'],
    weakHint: 'Stingnettle poison makes a giant sleepy and slow.',
    east: 'the thundering crags of {crisis}',
    watchman: ['I used to guard the gate. Then the giant sat on it.', 'When the ground shakes, run. When it stops shaking, run faster.'],
  },

  undead: {
    crisis: ['swamp', 'forest', 'hills'],
    near: ['swamp', 'forest', 'hills'],
    kit: { weapon: 'lightbringer', armor: 'emberheart_amulet', relic: 'candle_of_dawn' },
    lore: { weapon: 'the sword Lightbringer', armor: 'an Emberheart Amulet against the chill of the grave', relic: 'the Candle of Dawn, which lays the dead to rest' },
    boss: {
      emoji: '💀', family: 'undead', weakness: 'holy', resist: 'poison', attack: 'ice',
      names: [{ name: 'the Bone King', short: 'the Bone King' }, { name: 'Lich-Lord Morgrath', short: 'Morgrath' }, { name: 'the Barrow King', short: 'the Barrow King' }, { name: 'Mordecai the Undying', short: 'Mordecai' }],
      avatars: [
        'crowned skeleton on a throne of bones, in a tattered royal cloak, with cold blue fire for eyes',
        'tall, gaunt lich in faded purple robes, with a staff topped by a glowing skull',
      ],
      taunts: ['"Welcome to my kingdom, little living thing. You will stay forever."', '"I have been dead for five hundred years. I am very patient."'],
    },
    minions: ['skeleton', 'zombie'],
    titles: ['The Restless Dead', 'The Barrows of {crisis}'],
    lair: {
      names: ['the Barrow of Kings', 'the Old Crypt'],
      emoji: '🪦',
      texts: ['An old barrow mound, its stone door hanging open. Cold mist spills out.', 'Stone steps lead down into the dark. The air coming up smells of old bones and candle smoke.'],
    },
    danger: '{Boss} has risen from an old barrow near {crisis}. Every night the dead climb out of their graves and march on the town.',
    victory: [
      'You light {relic}. Golden light floods the barrow, and the dead lie down, one by one.',
      '{Weapon} blazes like the rising sun. {BossShort} crumbles into dust and is gone.',
      'In {crisis} the night is quiet at last. In the morning, the chapel bells ring for an hour.',
    ],
    crisisBlurbs: ['A quiet town beside an old barrow. By day it sleeps; by night, everyone bars their doors.', 'Garlic on every door, candles in every window, and nobody out after dark.'],
    greeting: ['Come in, come in, before it gets dark! {Ruler} sent you?', '{BossShort} sits on a throne of bones in the barrow. Every night, more of the dead march out.'],
    weakHint: 'The dead cannot bear holy light.',
    east: 'the haunted barrows of {crisis}',
    watchman: ['Last night a skeleton asked me for directions. I pointed it the wrong way.', 'I don\'t sleep. Nobody sleeps. We just wait for the sun.'],
  },

  goblin_horde: {
    crisis: ['forest', 'hills', 'mountain'],
    near: ['forest', 'hills', 'mountain'],
    kit: { weapon: 'goblinsbane', armor: 'boarhide_jerkin', relic: 'sunstone' },
    lore: { weapon: 'the sword Goblinsbane', armor: 'a Boarhide Jerkin against poisoned darts', relic: 'the Sunstone, which goblins cannot bear to look at' },
    boss: {
      emoji: '👺', family: 'goblin', weakness: 'fire', attack: 'poison',
      names: [{ name: 'Snagtooth the Goblin King', short: 'Snagtooth' }, { name: 'King Grubnose', short: 'King Grubnose' }, { name: 'Warchief Skrag', short: 'Skrag' }, { name: 'Gobbo the Magnificent', short: 'Gobbo' }],
      avatars: [
        'fat goblin king on a throne of stolen chairs, wearing three crowns at once and a cape made of curtains',
        'wiry goblin warchief with one enormous tooth, a saucepan helmet, and a spear decorated with spoons',
      ],
      taunts: ['"Oi! That\'s a nice sword. It\'s MY sword now. Get \'em, lads!"', '"Bow to the king of all the goblins, or I\'ll pinch your trousers!"'],
    },
    minions: ['goblin_raider', 'wolf_rider'],
    titles: ['The Goblin War', 'The Goblins of {crisis}'],
    lair: {
      names: ['the Goblin Warren', 'Grubhole Palace'],
      emoji: '🕳️',
      texts: ['A hillside riddled with holes. Drums, cackling, and the smell of burnt sausages drift out.', 'A heap of stolen furniture piled up into a sort of palace, with a goblin flag on top.'],
    },
    danger: 'A goblin horde led by {boss} has overrun {crisis}. They have stolen every pie, pot and pony in the town, and they want more.',
    victory: [
      'You hold up {relic}. The goblins shriek, cover their eyes, and run for their holes.',
      '{Weapon} throws sparks everywhere. {BossShort} drops a stolen crown and flees, howling.',
      'The people of {crisis} get back every pie, pot and pony. Well, most of the pies.',
    ],
    crisisBlurbs: ['A market town turned upside down. Goblins have stolen the doors, the pans and the town clock.', 'Every hen-house is empty, and there is goblin scribble all over the town hall.'],
    greeting: ['A hero! A real one! {Ruler} heard us!', '{BossShort} has turned the old warren into a palace. They stole my chain of office. And my socks.'],
    weakHint: 'Goblins are terrified of fire and bright light.',
    east: 'goblin-infested {crisis}',
    watchman: ['They stole my spear. I\'m guarding the gate with a broom.', 'If you hear drums, hide the pies.'],
  },

  frost_titan: {
    crisis: ['snow'],
    near: ['snow', 'mountain', 'hills'],
    kit: { weapon: 'sunforge_hammer', armor: 'emberweave_cloak', relic: 'heart_of_summer' },
    lore: { weapon: 'the Sunforge Hammer', armor: 'an Emberweave Cloak against the cold', relic: 'the Heart of Summer, which holds a whole summer inside' },
    boss: {
      emoji: '☃️', family: 'giant', weakness: 'fire', resist: 'ice', attack: 'ice',
      names: [{ name: 'Hrimgar the Frost Titan', short: 'Hrimgar' }, { name: 'Old Winterheart', short: 'Winterheart' }, { name: 'Glacius the Titan', short: 'Glacius' }, { name: 'Ymirax the Everfrost', short: 'Ymirax' }],
      avatars: [
        'titan of blue ice as tall as a hill, with a beard of icicles and a crown of snow',
        'enormous frost giant in armour of glacier ice, breathing blizzards',
      ],
      taunts: ['"Summer? There will be no more summer. Only snow. Forever."', '"Shiver, little one. Shiver and freeze."'],
    },
    minions: ['frost_wolf', 'snow_troll'],
    titles: ['The Endless Winter', 'Frost over {crisis}'],
    lair: {
      names: ['the Frozen Throne', 'the Glacier Hall'],
      emoji: '🏔️',
      texts: ['A throne of ice on the glacier above the town. Snow never stops falling there.', 'A great hall carved in the glacier, glittering blue, where the wind never stops howling.'],
    },
    danger: '{Boss} has woken in the glacier above {crisis}. Winter has come in midsummer, and the snow grows deeper every day.',
    victory: [
      'You hold up {relic}, and summer pours out of it. Snow melts in rivers down the mountain.',
      '{Weapon} glows like a noon sun. {BossShort} shatters into a thousand icicles, which melt in minutes.',
      'Flowers pop up all over {crisis}. Children run outside without their coats for the first time in months.',
    ],
    crisisBlurbs: ['A town buried in midsummer snow. Icicles as long as spears hang from every roof.', 'Only the chimneys poke out of the snow, and the townsfolk dig tunnels to visit each other.'],
    greeting: ['Brrr! Come in by the fire. {Ruler} heard us!', '{BossShort} sits on a throne of ice above the town. If summer doesn\'t come back soon, nothing will grow this year.'],
    weakHint: 'Only fire can melt a frost titan\'s heart.',
    east: 'the frozen heights of {crisis}',
    watchman: ['I\'ve got four pairs of socks on. My toes are still cold.', 'Yesterday my eyebrows froze. Today, my ears.'],
  },
}

/** Kit weapons with proper names, said without "the". */
export const PROPER_NAMES = new Set(['frostbrand', 'hearthblade', 'stormcaller', 'lightbringer', 'goblinsbane'])
