/**
 * The medieval theme's words for the generator: names, places, people, shops, spots, quests and hints. Another
 * theme (modern, Roman, steampunk) would be another file of the same shape with its own ruler; the threats and
 * the bestiary would get theme versions too.
 *
 * Tokens: {town} {region} {realm} {ruler} {Ruler} {neighbor} {foe} {crisis} {bossShort} {BossShort}; spots
 * also take {a} {A} (what is found, with "a" or "the") and {key}.
 */
import type { Biome, Element } from '../content/types.ts'

export const REGION_NAMES = [
  'the Westmarch', 'the Greenholt', 'the Silverdales', 'the Harrowlands', 'the Brightwater Vale', 'the Rookmoor',
  'the Wyvernshire', 'the Lindenlands', 'the Hollowmark', 'the Fairfields', 'the Oakenreach', 'the Duskmere',
  'the Thistledowns', 'the Copperlands', 'the Starfall Hills', 'the Ravenmarch', 'the Honeyvale', 'the Eastmoors',
]

/** A few words for each kind of land, for the region's blurb. */
export const LAND: Record<Biome, string[]> = {
  plains: ['golden fields', 'wheat fields and windmills', 'green farmland'],
  forest: ['deep forest', 'old oak woods', 'dark pine forest'],
  hills: ['green rolling hills', 'windy sheep-hills'],
  coast: ['white sea cliffs', 'a long rocky coast'],
  mountain: ['grey mountains', 'high mountain passes'],
  swamp: ['misty bogs', 'reedy marshes'],
  snow: ['snowy uplands', 'frozen moors'],
  volcano: ['smoking hills'],
  desert: ['red dunes', 'sun-baked sands'],
}

// --- towns --------------------------------------------------------------------------------------

export const TOWN_NAMES: Record<Biome | 'capital', { pre: string[]; suf: string[] }> = {
  capital: { pre: ['Kings', 'Crown', 'Bright', 'Golden', 'Swan', 'Lion', 'Queens'], suf: ['bury', 'ford', 'vale', 'haven', 'gate', 'bridge'] },
  plains: { pre: ['Oak', 'Wheat', 'Barley', 'Golden', 'Lark', 'Apple', 'Clover', 'Honey', 'Mill', 'Hay'], suf: ['vale', 'field', 'ton', 'stead', 'bury', 'meadow', 'wick', 'brook'] },
  forest: { pre: ['Thorn', 'Elder', 'Holly', 'Moss', 'Fern', 'Briar', 'Ash', 'Hazel', 'Rowan', 'Oak'], suf: ['wood', 'hollow', 'glen', 'shade', 'dell', 'grove'] },
  hills: { pre: ['Lark', 'Wind', 'Green', 'High', 'Ram', 'Heather', 'Cloud', 'Thistle'], suf: ['ridge', 'down', 'hill', 'dale', 'combe', 'knoll'] },
  coast: { pre: ['Salt', 'Gull', 'Tide', 'Shell', 'Coral', 'Brine', 'Pearl', 'Storm'], suf: ['haven', 'port', 'cove', 'cliff', 'bay', 'mouth'] },
  mountain: { pre: ['High', 'Iron', 'Stone', 'Grey', 'Eagle', 'Anvil', 'Silver', 'Raven'], suf: ['crag', 'peak', 'fell', 'spire', 'hold', 'gate'] },
  swamp: { pre: ['Mire', 'Fen', 'Reed', 'Murk', 'Frog', 'Willow', 'Mist', 'Heron'], suf: ['water', 'marsh', 'moor', 'pool', 'mere'] },
  snow: { pre: ['Frost', 'Winter', 'White', 'Ice', 'Snow', 'Rime', 'North'], suf: ['ford', 'hold', 'fell', 'reach', 'mark', 'stead'] },
  volcano: { pre: ['Ember', 'Ash', 'Cinder', 'Char', 'Flame', 'Smoke', 'Red'], suf: ['peak', 'fall', 'hollow', 'spire', 'crag'] },
  desert: { pre: ['Sun', 'Sand', 'Dune', 'Amber', 'Mirage', 'Palm', 'Copper'], suf: ['well', 'rest', 'spring', 'reach', 'haven'] },
}

/** Names game-0000 already uses, kept for it. */
export const RESERVED_TOWNS = ['Oakvale', 'Millbrook', 'Saltmere', 'Thornwood', 'Frostford', 'Mirewater', 'Highcrag', 'Emberpeak']

/** Blurbs by `look:biome`, then by look, then by `village:biome`. */
export const BLURBS: Record<string, string[]> = {
  capital: [
    'The royal city of {region}: white walls, red roofs, and a castle flying {ruler}\'s banners.',
    'The greatest town in {region}, with a castle on the hill and a market that never sleeps.',
    'A walled city of bell towers and busy markets. {Ruler}\'s summer castle stands over it all.',
  ],
  river: [
    'Two banks joined by an old stone bridge, with a mill on each side and ducks everywhere.',
    'A town of boatmen and millers, where the river is wide and slow and full of fish.',
    'Willows trail their branches in the river, and every house has a little boat tied up outside.',
  ],
  port: [
    'A harbour of bright boats and tarred nets. The fish market opens before sunrise.',
    'A lighthouse on the point, taverns on the quay, and a smell of salt and tar over everything.',
    'A snug harbour behind a long stone pier, where the fishing boats come home at dusk.',
  ],
  fortress: [
    'A walled town on a crag, guarding the only pass through the mountains.',
    'Grey towers, steep streets, and a great gate that has never been broken.',
    'A mining town behind thick stone walls. Hammers ring from every tunnel.',
  ],
  'hillside:snow': [
    'Terraces of snowy roofs climb the mountainside, joined by steep, icy stairs.',
    'A town of fur traders and sled dogs, built in steps up a snowy hill.',
  ],
  'hillside:hills': [
    'Cottages climb the hillside in neat rows, and goats graze on the turf roofs.',
    'A hill town of orchards and stone walls, with a view over half of {region}.',
  ],
  'hillside:mountain': [
    'Stone houses cling to the mountainside, one above the other, like steps for a giant.',
    'A town of goatherds and stonecutters, stacked up a steep and windy slope.',
  ],
  'hillside:volcano': ['Black stone houses climb a warm hillside, and steam rises from the hot springs between them.'],
  'village:plains': [
    'A farming village of haystacks, duck ponds and very proud pumpkin growers.',
    'Thatched cottages around a village green, with a maypole in the middle.',
  ],
  'village:forest': [
    'A woodcutters\' village in a clearing, where the sawmill hums and the air smells of pine.',
    'Cottages with mossy roofs hide among the trees. Fireflies light the lanes at night.',
    'Tree-houses joined by rope bridges, high above the forest floor.',
  ],
  'village:hills': ['A shepherds\' village of stone walls and windy hilltops.', 'A village of cheese-makers, tucked into a fold of the green hills.'],
  'village:swamp': [
    'A village of reed huts and boardwalks over the marsh. Everyone owns a punt.',
    'Lantern-lit walkways wind between the houses over dark, still water. Frogs sing all night.',
  ],
  'village:mountain': ['A village of goatherds clinging to the mountainside, where the air is thin and sweet.'],
  'village:snow': ['A village of log cabins buried to the windowsills in snow.'],
  'village:coast': ['A fishing village of upturned boats and drying nets, down among the dunes.'],
  'village:desert': [
    'An oasis town of palm trees and cool stone courtyards, with a well in every garden.',
    'Mud-brick houses around a deep blue well, with camels dozing in the shade.',
  ],
  'village:volcano': ['A town of black stone and hot springs, where the ground is always warm.'],
}

// --- people ---------------------------------------------------------------------------------------

/** Women, men, and people who are neither or don't say (🧑-style emoji, names that suit anyone). */
export type Gender = 'f' | 'm' | 'n'

export const FIRST_NAMES: Record<Gender, string[]> = {
  n: ['Robin', 'Sage', 'Rowan', 'Kit', 'Morgan', 'Quill', 'Rue', 'Sparrow', 'Ellis', 'Jules', 'Arden', 'Blair', 'Emery', 'Hollis', 'Marlow', 'Perry', 'Teagan', 'Rook'],
  f: [
    'Marigold', 'Coralie', 'Morwenna', 'Beatrix', 'Rowena', 'Elspeth', 'Maud', 'Gwendolyn', 'Linnea', 'Odette', 'Petra',
    'Sabine', 'Tamsin', 'Wilhelmina', 'Yvaine', 'Clover', 'Ottilie', 'Hester', 'Agatha', 'Constance', 'Bryony', 'Delphine',
    'Edith', 'Fenella', 'Greta', 'Hazel', 'Ida', 'Juniper', 'Lark', 'Mabel', 'Nell', 'Olwen', 'Posy', 'Rosalind',
    'Saffron', 'Tilly', 'Una', 'Violet', 'Winifred', 'Zinnia', 'Bess', 'Ivy', 'Willa', 'Kara', 'Nessa', 'Poppy', 'Dora',
  ],
  m: [
    'Tobias', 'Fenwick', 'Aldous', 'Osric', 'Roderic', 'Bertram', 'Cedric', 'Dunstan', 'Edmund', 'Godfrey', 'Hugo',
    'Jasper', 'Leofric', 'Merrick', 'Percival', 'Quentin', 'Reginald', 'Silas', 'Theobald', 'Ulric', 'Wystan', 'Alaric',
    'Bram', 'Barnaby', 'Crispin', 'Digby', 'Egbert', 'Florian', 'Gus', 'Horace', 'Ivor', 'Jory', 'Lem', 'Mo', 'Ned',
    'Oswin', 'Pip', 'Rufus', 'Sven', 'Tam', 'Wendel', 'Alfie', 'Basil', 'Cole', 'Hale', 'Otto', 'Rolf', 'Toby',
  ],
}

export const MAYOR = {
  titles: { f: ['Duchess', 'Countess', 'Baroness', 'Lady', 'Mayor'], m: ['Duke', 'Count', 'Baron', 'Lord', 'Earl', 'Margrave', 'Mayor'], n: ['Mayor', 'Reeve', 'Warden'] },
  emoji: {
    f: ['👩‍🦰', '👩‍🦱', '👩‍🦳', '👩', '👱‍♀️', '👵', '👩‍🦲'],
    m: ['🧔', '👨‍🦳', '🧓', '👨‍🦰', '👨‍🦱', '👱‍♂️', '🧔‍♂️', '👴', '👨‍🦲'],
    n: ['🧑', '🧑‍🦰', '🧑‍🦱', '🧑‍🦳', '🧑‍🦲', '🧓'],
  },
  builds: ['plump, cheerful', 'tall, thin', 'stout', 'small, brisk', 'broad', 'elegant', 'white-haired, twinkling-eyed'],
  features: {
    f: ['braided red hair', 'dark curls', 'silver hair in a bun', 'freckles and a gap-toothed smile', 'a long golden plait'],
    m: ['a bushy black beard', 'a neat white beard', 'a magnificent moustache', 'a bald head that shines', 'a red beard braided with beads'],
    n: ['short grey hair', 'a shaved head', 'wild curly hair', 'a neat plait', 'freckles and a crooked grin'],
  },
  garments: ['a green velvet coat', 'a plum-coloured cloak', 'a mustard-yellow waistcoat', 'a sea-green robe', 'a fur-trimmed mantle', 'a patched but proud coat', 'a long blue coat with silver buttons'],
  accessories: ['a gold chain of office', 'a silver circlet', 'a tawny owl on one shoulder', 'spectacles on a ribbon', 'a walking stick topped with a silver fox', 'a lapdog under one arm', 'a wheat-sheaf brooch', 'a very large hat'],
  avatar: '{build} {title} with {feature}, {garment}, and {accessory}',
  hello: [
    'Welcome to {town}, Hero! {Ruler}\'s messenger said you would come.',
    'Ah, {ruler}\'s champion! Welcome to {town}.',
    '{town} welcomes you, Hero. We have heard all about you.',
    'A hero, in {town}! Come in, come in, mind the step.',
  ],
  local: {
    plains: ['We are simple farmers, but we will help however we can.', 'Try the bread. Everyone in {town} bakes.'],
    forest: ['Walk softly; the forest listens.', 'The trees here are older than the kingdom. Be kind to them.'],
    hills: ['Have some cheese. Everyone here has cheese.', 'On a clear day you can see all the way to {neighbor} from here.'],
    coast: ['Mind the gulls; they steal.', 'The sea gives and the sea takes. Mostly it gives fish.'],
    mountain: ['{town} stands firm, and so do its people.', 'Watch your step. Our streets mostly go up.'],
    swamp: ['Forgive the smell; it is the bog.', 'Mind the boardwalks. Some of the planks are, well, optional.'],
    snow: ['Brr! Come in by the fire. It is cold here, but our hearts are warm.', 'Keep your mittens on. Frostbite is no joke.'],
    volcano: ['The ground is warm here. Our boots last about a month.'],
    desert: ['Drink some water first. Everyone who arrives here needs it.', 'Welcome to the coolest shade in the desert.'],
  } as Record<Biome, string[]>,
  capital: ['{town} is the pride of {region}, and we are glad to have you.', 'Anything you need, ask. {Ruler}\'s champion is welcome everywhere in {town}.'],
}

/** A kind of townsperson: how they are named, look, and talk. */
export interface RoleDef {
  role: string
  /** Put before the first name ("Smith Greta"); '' for none. One is picked. */
  prefix: string[]
  /** Emoji for women, men, and others (a role for one gender leaves the rest empty). People get a skin tone too. */
  f: string[]
  m: string[]
  n?: string[]
  avatar: string[]
  lines: string[]
  /** Where they live; anywhere when absent. */
  biomes?: Biome[]
}

/** Everyday townsfolk. Two lines are picked; one may be replaced by a hint. */
export const FOLK: RoleDef[] = [
  { role: 'farmer', prefix: ['Farmer', 'Old'], f: ['👩‍🌾'], m: ['👨‍🌾'], n: ['🧑‍🌾'], avatar: ['wiry old farmer in a straw hat, with a pitchfork over one shoulder', 'sunburnt farmer in a patched smock, with mud up to the knees'], lines: ['Rain\'s coming. My knees always know.', 'Best soil in {region}, this. Grows turnips as big as your head.', 'The crows are bold this year. Bolder than the scarecrow, anyway.', 'If you\'re walking to {neighbor}, keep an eye out for {foe} on the road.'], biomes: ['plains', 'hills'] },
  { role: 'beekeeper', prefix: [''], f: ['🐝'], m: ['🐝'], avatar: ['beekeeper in a white veiled hat, bees drifting lazily around'], lines: ['My bees make the sweetest honey in {region}.', 'Bees know when trouble is coming. Lately they won\'t leave the hive.', 'Never swat a bee. It only makes the others cross.'], biomes: ['plains', 'forest', 'hills'] },
  { role: 'miller', prefix: ['Miller'], f: ['👩‍🦳'], m: ['👴'], avatar: ['dusty old miller with flour in the eyebrows'], lines: ['The mill never stops. Neither do I, most days.', 'Flour for all of {town}, and half of {neighbor} too.', 'Hear that creak? That\'s the wheel. It\'s been creaking for forty years.'], biomes: ['plains'] },
  { role: 'baker', prefix: ['Baker'], f: ['👩‍🍳'], m: ['👨‍🍳'], n: ['🧑‍🍳'], avatar: ['round, rosy baker in a floury apron, with a tray of buns'], lines: ['Fresh buns every morning, before the rooster is up.', 'Heroes need feeding. You look like you skipped breakfast.', 'My pies are famous as far as {neighbor}. Well, as far as the end of the street.'] },
  { role: 'shepherd', prefix: [''], f: ['🐑'], m: ['🐑'], avatar: ['shepherd in a thick wool cloak, with a crook and a sheepdog at heel'], lines: ['Four hundred sheep, and I know every one by name.', 'The wolves have been bold this year. Keep to the road.', 'The wind up here could blow the whiskers off a cat.'], biomes: ['hills', 'mountain', 'plains'] },
  { role: 'woodcutter', prefix: [''], f: ['👩‍🦰'], m: ['🧔'], n: ['🧑‍🦰'], avatar: ['broad woodcutter in a checked shirt, with a long axe and sawdust everywhere'], lines: ['Oak for beams, ash for handles, pine for kindling.', 'The deep woods are no place to wander after dark.', 'Hear that? A woodpecker. Or a goblin with a hammer. Hard to say.'], biomes: ['forest'] },
  { role: 'fisher', prefix: ['Fisher'], f: ['🎣'], m: ['🎣'], avatar: ['weathered fisher in oilskins, with a net over one shoulder'], lines: ['The tide brings in all sorts. Pearls, if you look in the right places.', 'A quiet net and a calm sea. That\'s all I ask.', 'The fish are biting early this year. Something\'s got them nervous.'], biomes: ['coast', 'swamp', 'plains'] },
  { role: 'old sailor', prefix: ['Old'], f: ['👵'], m: ['🧓'], avatar: ['ancient sailor in a salt-stained cap, with a telescope tucked under one arm'], lines: ['Sixty years at sea, and I only fell overboard twice.', 'Red sky at night, sailor\'s delight. Red sky in the morning, stay in bed.', 'I\'ve seen sea serpents and mermaids, and a whale that could sing.'], biomes: ['coast'] },
  { role: 'miner', prefix: ['Miner'], f: ['👷‍♀️'], m: ['👷'], n: ['👷'], avatar: ['stocky miner with a lamp on the helmet and coal on the nose'], lines: ['Silver, copper, and the odd bit of gold, if you dig deep enough.', 'Down in the dark you hear things. Mostly other miners.', 'Never whistle in a mine. It annoys the trolls.'], biomes: ['mountain', 'hills'] },
  { role: 'mountain guide', prefix: ['Guide'], f: ['🧗‍♀️'], m: ['🧗'], avatar: ['wiry mountain guide with a coil of rope and wind-burned cheeks'], lines: ['The pass is open, for now. Snow could close it any day.', 'From here the road to {neighbor} climbs, and keeps on climbing.', 'Watch your step. The mountain doesn\'t forgive.'], biomes: ['mountain', 'snow'] },
  { role: 'trapper', prefix: [''], f: ['👩‍🦰'], m: ['🧔‍♂️'], n: ['🧑‍🦱'], avatar: ['fur trapper in a bearskin hat, with snowshoes strapped to the back'], lines: ['Snow tells you everything, if you can read it. Tracks, weather, trouble.', 'Fox, hare, and once a snow leopard. It got away. Or I did.', 'Keep your mittens on. Frostbite takes fingers faster than wolves do.'], biomes: ['snow'] },
  { role: 'frog-catcher', prefix: [''], f: ['🐸'], m: ['🐸'], avatar: ['barefoot child with a net, muddy to the knees and grinning'], lines: ['Ribbit! That\'s frog for hello.', 'I caught forty frogs today. I let them all go again.', 'The bog is safe if you know where to step. I know where to step.'], biomes: ['swamp'] },
  { role: 'ferry-keeper', prefix: [''], f: ['🛶'], m: ['🛶'], avatar: ['lean ferry-keeper in a wide hat, leaning on a long pole'], lines: ['Across and back, across and back. Forty years of it.', 'Mind the water. It\'s deeper than it looks, and colder.', 'I take anyone across. Except goblins. Goblins don\'t tip.'], biomes: ['swamp', 'plains'] },
  { role: 'good witch', prefix: ['Granny'], f: ['🧙‍♀️'], m: [], avatar: ['tiny, kindly witch in a mossy shawl, with a toad sitting on her hat'], lines: ['Not all witches are wicked, dearie.', 'Nettle soup for strength, willow tea for aches. Nothing for goblins, sadly.', 'My cat says you have a kind face. My cat is never wrong.'], biomes: ['swamp', 'forest'] },
  { role: 'peddler', prefix: ['Peddler'], f: ['🧳'], m: ['🧳'], avatar: ['round peddler under a huge pack hung with pots and trinkets'], lines: ['Buttons, ribbons, pots and pans! Well, I\'m sold out of pans.', 'I walk every road in {region}. Most of them twice.', 'Word on the road is that {crisis} is in a bad way.'] },
  { role: 'minstrel', prefix: [''], f: ['🎻'], m: ['🎻'], avatar: ['cheerful minstrel in a feathered cap, with a fiddle under one arm'], lines: ['I\'m writing a song about you! So far it\'s mostly about your boots.', 'Every hero needs a ballad. Yours is coming along nicely.', 'They sing about {bossShort} in every tavern now. Not happy songs.'] },
  { role: 'grandmother', prefix: ['Granny', 'Old'], f: ['👵'], m: [], avatar: ['stooped grandmother in a knitted shawl, with a basket of eggs'], lines: ['In my day, heroes wiped their boots before coming in.', 'Eat something! You\'re all bones.', 'I remember the last time {realm} needed a hero. You look taller than that one.'] },
  { role: 'village elder', prefix: ['Old'], f: [], m: [], n: ['🧓'], avatar: ['bright-eyed village elder with a knobbly stick and a patchwork cloak'], lines: ['I\'ve seen eighty winters in {town}. This one feels different.', 'Sit a while, Hero. The young are always in such a hurry.', 'Mind the road to {neighbor}. It has a mind of its own.'] },
  { role: 'grandfather', prefix: ['Grandpa', 'Old'], f: [], m: ['👴'], avatar: ['white-bearded grandfather on a bench, with a walking stick across his knees'], lines: ['When I was your age, I fought a bear with a spoon. A big spoon.', 'Back in my day the roads were safe. Mostly. Sometimes.', 'Go on, Hero. Show them what {town} is made of.'] },
  { role: 'child', prefix: [''], f: ['👧'], m: ['👦'], n: ['🧒'], avatar: ['freckled child with a wooden sword and a helmet three sizes too big', 'small child with scabby knees and a pet frog in one pocket'], lines: ['When I grow up, I\'m going to be a hero too!', 'Have you ever fought {foe}? What was it like?', 'Can I hold your sword? Just for a second? Please?'] },
  { role: 'caravan driver', prefix: [''], f: ['🐪'], m: ['🐪'], avatar: ['caravan driver wrapped in blue cloth against the sand'], lines: ['A camel can walk ten days without water. I cannot.', 'The dunes move at night. Always ask the way.', 'Sandstorms come fast. Cover your face and wait.'], biomes: ['desert'] },
  { role: 'well-keeper', prefix: [''], f: ['🏺'], m: ['🏺'], avatar: ['old well-keeper with a clay jar and a kind, wrinkled face'], lines: ['Water is life. Drink, stranger, before you speak.', 'This well has never run dry. Not in three hundred years.'], biomes: ['desert'] },
  { role: 'lighthouse keeper', prefix: [''], f: ['👩‍🦳'], m: ['👨‍🦳'], n: ['🧑‍🦳'], avatar: ['lighthouse keeper with a lantern and a long grey coat'], lines: ['I keep the light burning every night, storm or no storm.', 'From the top of the lighthouse you can see all the way to {neighbor}.'], biomes: ['coast'] },
  { role: 'bath-keeper', prefix: [''], f: ['♨️'], m: ['♨️'], avatar: ['cheerful bath-keeper with a towel over one shoulder and very pink cheeks'], lines: ['The springs cure aches, colds, and bad moods.', 'The mountain grumbles, but it keeps our water warm.'], biomes: ['volcano'] },
]

/** Trainers sell a stat point (the lines must say so). */
export const TRAINERS: Record<'strength' | 'vigor' | 'magic', RoleDef[]> = {
  strength: [
    { role: 'guard', prefix: ['Sergeant', 'Captain'], f: ['💂‍♀️'], m: ['💂'], n: ['💂'], avatar: ['grizzled town guard in a dented steel cap, leaning on a halberd'], lines: ['Arms up, chin down, hit hard.', 'I can train you, for a few coins.'] },
    { role: 'smith', prefix: ['Smith'], f: ['👩‍🏭'], m: ['👨‍🏭'], n: ['🧑‍🏭'], avatar: ['muscular smith with soot-streaked arms and a leather apron'], lines: ['Hammer and anvil, all day long. Look at these arms!', 'I can build up yours too, for a fee.'] },
  ],
  vigor: [
    { role: 'ranger', prefix: ['Ranger'], f: ['🧝‍♀️'], m: ['🧝'], avatar: ['hooded ranger with a longbow and a scar across one cheek'], lines: ['The wild wears you down, if you let it.', 'I can toughen you up, if you\'ve the coin.'] },
    { role: 'hunter', prefix: ['Hunter'], f: ['👩‍🦰'], m: ['🧔'], n: ['🧑‍🦰'], avatar: ['weathered hunter in green leather, with a hawk on one wrist'], lines: ['Out here, the tough get through and the rest go home.', 'A few coins, and I\'ll make you as tough as old roots.'] },
  ],
  magic: [
    { role: 'scholar', prefix: ['Scholar'], f: ['👩‍🏫'], m: ['👨‍🏫'], n: ['🧑‍🏫'], avatar: ['young scholar with ink-stained fingers and round spectacles'], lines: ['Potions obey those who understand them.', 'I can teach you, for a modest fee.'] },
    { role: 'herbalist', prefix: ['Herbalist'], f: ['🌿'], m: ['🌿'], avatar: ['herbalist in a green apron, with bundles of drying herbs hanging from the belt'], lines: ['Every potion is a little poem, if you know how to read it.', 'Lessons are cheap. Not knowing is expensive.'] },
  ],
}

/** The wizard who changes the hero's look for gold. */
export const WIZARD = {
  role: 'travelling wizard',
  f: ['🧙‍♀️'],
  m: ['🧙‍♂️'],
  n: ['🧙'],
  epithets: ['Wanderer', 'Wise', 'Colourful', 'Magnificent', 'Slightly Singed', 'Starry'],
  avatar: [
    'tall wizard in a starry indigo robe and a floppy pointed hat, with a crooked staff',
    'small, round wizard in a patchwork robe covered in singe marks, with spectacles on a chain',
  ],
  lines: [
    ['Tired of that face? I can change it. A little magic, a little gold.', 'Build, clothes, hair. Nothing I have not done a thousand times.'],
    ['Ooh, I could do wonders with you. New hair? New cloak?', 'Magic is cheap. Well, sixty gold. That is cheap, for magic.'],
  ],
  price: 60,
}

/** The child in the capital who gives the hero a healing draught. */
export const GIFT_LINE = 'Are you a real hero? Mum says heroes always carry healing draughts. Here, take one of mine!'
/** Someone keeping one of the makings of a royal item. {thing}: what they give; {item}: what it makes. */
export const CRAFT_GIFT = 'So you\'re the Queen\'s hero! Take this {thing}, then. They say {item} is made with one.'

// --- locked places and their keys -----------------------------------------------------------------

export interface LockDef {
  spot: { name: string; emoji: string; text: string; locked: string }
  /** Who keeps the key and trades it away. Lines take {spot} and {spotTown}. */
  holder: RoleDef
  /** On handing the key over. Tokens {GoodA} {goodA} ("a jar of honey") and {key}. */
  trade: string
  /** Biomes the locked place suits; anywhere when absent. */
  biomes?: Biome[]
}

export const LOCKS: Record<string, LockDef> = {
  shrine_key: {
    spot: { name: 'the Sunken Shrine', emoji: '⛩️', text: 'The {key} turns. Water pours from the gate, and on the altar lies {a}.', locked: 'The shrine\'s gate is barred and locked. The keyhole is shaped like a wave.' },
    holder: { role: 'hermit', prefix: ['Old'], f: ['👵'], m: ['🧓'], avatar: ['ancient hermit in patched robes that smell of seaweed'], lines: ['Eh? A hero? Heroes never bring me anything nice.', '{Spot} in {spotTown}? I keep its key. What\'s it to you?'] },
    trade: '{GoodA}! Oh, you dear thing. Here, take the {key}. Mind the frogs.',
    biomes: ['swamp', 'coast', 'forest'],
  },
  tower_key: {
    spot: { name: 'the Old Watchtower', emoji: '🏰', text: 'The {key} grinds in the lock. At the top of the winding stairs, in the watchman\'s chest, lies {a}.', locked: 'The watchtower door is bolted, with a lock as big as your hand.' },
    holder: { role: 'retired warden', prefix: ['Warden'], f: ['👵'], m: ['👴'], avatar: ['retired tower warden in a faded uniform, with a ring of empty key hooks'], lines: ['I kept that tower for thirty years. Now my knees won\'t climb the stairs.', 'The key to {spot} in {spotTown}? I still have it. Old habits.'] },
    trade: '{GoodA}? For me? How kind. Here, the {key} is yours. I\'ve no more use for it.',
  },
  crypt_key: {
    spot: { name: 'the Old Crypt', emoji: '🪦', text: 'The {key} hums as it turns. On a stone shelf, in a box carved with suns, lies {a}.', locked: 'The crypt door is sealed with iron bands. The lock is cold to the touch.' },
    holder: { role: 'gravedigger', prefix: [''], f: ['👩‍🦳'], m: ['👨‍🦳'], n: ['🧑‍🦳'], avatar: ['gravedigger in a long black coat, leaning on a spade and surprisingly cheerful'], lines: ['Graves are peaceful. It\'s the living who cause trouble.', 'Nobody goes into {spot} in {spotTown}. I have the only key, and I like it that way.'] },
    trade: 'Is that {goodA}? My favourite! All right, all right. Here is the {key}.',
  },
  vault_key: {
    spot: { name: 'the Guildhall Vault', emoji: '🏛️', text: 'The {key} turns, and the great door swings open. Among the dusty ledgers sits {a}.', locked: 'A great round vault door, stamped with a crown. It is locked tight.' },
    holder: { role: 'steward', prefix: ['Steward'], f: ['👩‍🦱'], m: ['👨‍🦱'], n: ['🧑‍🦱'], avatar: ['fussy steward in a velvet waistcoat, with a quill behind one ear'], lines: ['Everything in its place, and a place for everything.', 'The key to {spot} in {spotTown}? Only the steward has it. I am the steward.'] },
    trade: '{GoodA}! Well. That is very irregular. And very welcome. Here, the {key}.',
  },
  cellar_key: {
    spot: { name: 'the Inn Cellar', emoji: '📦', text: 'The {key} turns with a squeak. Behind the barrels in the cellar you find {a}.', locked: 'The cellar door is locked. It smells of apples and damp behind it.' },
    holder: { role: 'innkeeper', prefix: [''], f: ['👩‍🦰'], m: ['👨‍🦰'], n: ['🧑‍🦰'], avatar: ['jolly innkeeper with a red face, a white apron and a jangling ring of keys'], lines: ['Welcome, welcome! Best stew in {town}, and the only stew in {town}.', 'The inn at {spotTown}? That was mine once. I still have the key to {spot}.'] },
    trade: '{GoodA}! Just what the stew needed. Here, have the {key}.',
  },
  gate_key: {
    spot: { name: 'the Walled Garden', emoji: '⛲', text: 'The {key} opens the garden gate. Beside the old fountain lies {a}.', locked: 'A high wall, a locked iron gate, and roses peeking over the top.' },
    holder: { role: 'gardener', prefix: [''], f: ['👩‍🌾'], m: ['👨‍🌾'], n: ['🧑‍🌾'], avatar: ['elderly gardener in a wide straw hat, with a basket of roses'], lines: ['Roses need patience. So do people.', 'I used to tend {spot} in {spotTown}. When the old lady moved away, I locked it and kept the key.'] },
    trade: 'Oh, {goodA}! Lovely. Here, take the {key}, and water the roses if you can.',
    biomes: ['plains', 'hills', 'forest', 'desert'],
  },
  sea_chest_key: {
    spot: { name: 'the Old Wreck', emoji: '⚓', text: 'You open the sea-chest in the wreck with the {key}. Inside, wrapped in oilcloth: {a}.', locked: 'In the wreck lies an iron-bound sea-chest, locked with a green copper lock.' },
    holder: { role: 'old sea captain', prefix: ['Captain'], f: ['👵'], m: ['🧓'], avatar: ['old sea captain with a wooden leg, a salt-stained coat and a telescope'], lines: ['I sailed that ship for twenty years before she hit the rocks.', 'My old sea-chest is still aboard her, at {spotTown}. I kept the key, just in case.'] },
    trade: '{GoodA}! Just like we had at sea. Here, take the {key}. The chest is yours.',
    biomes: ['coast'],
  },
}

/** The side chest opened by a key found elsewhere (never traded). */
export const OLD_CHEST = {
  key: 'rusty_key',
  spot: { name: 'the Old Chest', emoji: '📦', text: 'The {key} turns with a screech. Inside the old chest: {a}!', locked: 'A heavy chest sits in the corner, locked tight. The keyhole is caked with rust.' },
}

// --- places to search -----------------------------------------------------------------------------

/** [name, emoji, what the hero finds: {a} or {A}]. */
export type SpotDef = [string, string, string]

export const SPOTS: Record<Biome, SpotDef[]> = {
  plains: [['the Old Well', '🪣', 'You haul up the old bucket. Tangled in the rope is {a}!'], ['the Haystack', '🌾', 'You dig through the haystack, sneezing. At the bottom: {a}!'], ['the Duck Pond', '🦆', 'Something glints in the mud of the duck pond. You fish out {a}, and the ducks complain loudly.']],
  forest: [['the Hollow Oak', '🌳', 'Deep inside the hollow oak, among old acorns and junk, something glints: {a}!'], ['the Fairy Ring', '🍄', 'In the middle of the ring of mushrooms lies {a}. You hear tiny giggles.'], ['the Woodcutter\'s Shed', '🪵', 'Behind a stack of logs in the old shed you find {a}.']],
  hills: [['the Standing Stones', '🗿', 'Tucked between the two tallest stones is {a}.'], ['the Shepherd\'s Hut', '🛖', 'Under a pile of old fleeces in the hut: {a}!'], ['the Sheep Pen', '🐑', 'A ram is sitting on something, looking very pleased with itself. It is {a}.']],
  coast: [['the Tide Pools', '🌊', 'Among the rocks and anemones you find {a}!'], ['the Wrecked Boat', '🛶', 'Wedged under the rotten planks of an old boat: {a}.'], ['the Sea Cave', '🪨', 'Far back in the dripping sea cave, on a dry ledge: {a}.']],
  mountain: [['the Abandoned Mine', '🕳️', 'In the dark of the old shaft your hand closes on {a}.'], ['the Eagle\'s Nest', '🦅', 'High on the cliff, in an empty eagle\'s nest, lies {a}.'], ['the Rockfall', '🪨', 'Under the fallen rocks you spot {a}.']],
  swamp: [['the Old Boathouse', '🛶', 'Floating in the flooded boathouse: {a}!'], ['the Reed Maze', '🌾', 'At the heart of the reeds, on a muddy tussock: {a}.'], ['the Frog Pond', '🐸', 'A very large frog is sitting on {a}. It lets you have it, eventually.']],
  snow: [['the Frozen Pond', '🧊', '{A} is frozen into the ice at the pond\'s edge. You chip it free.'], ['the Ice Cave', '❄️', 'Deep in the blue ice cave, you find {a}.'], ['the Snowman', '☃️', 'Inside the snowman, right where its heart would be: {a}!']],
  volcano: [['the Hot Springs', '♨️', 'Steaming at the bottom of the hot spring: {a}!'], ['the Old Forge', '🔥', 'In the ashes of the old forge, still warm: {a}.']],
  desert: [['the Dry Well', '🪣', 'At the bottom of the dry well, half-buried in sand: {a}.'], ['the Buried Statue', '🗿', 'Between the statue\'s stone paws lies {a}.'], ['the Oasis', '🌴', 'Under the palms, beside the cool water, you find {a}.']],
}

export const ANY_SPOTS: SpotDef[] = [['the Old Chapel', '⛪', 'Behind the altar, in a dusty niche: {a}.'], ['the Bell Tower', '🔔', 'Up among the bells, in a pigeon\'s nest: {a}!']]

// --- shops ----------------------------------------------------------------------------------------

export const SHOPS: Record<Biome, { names: string[]; lines: string[] }> = {
  plains: { names: ['{keeper}\'s General Store', 'The Golden Sheaf', 'The Busy Bee'], lines: ['Fresh bread, fresh draughts, fresh advice. What\'ll it be?', 'Best prices in {town}! Well, the only prices in {town}.'] },
  forest: { names: ['{keeper}\'s Outfitters', 'The Acorn & Arrow', 'The Mossy Kettle'], lines: ['Bows, cloaks, and forest remedies. All handmade.', 'Everything a traveller needs, and a few things they don\'t.'] },
  hills: { names: ['{keeper}\'s Trading Post', 'The Woolly Ram', 'The Crooked Crook'], lines: ['Wool, cheese and cudgels: the three things every hill-walker needs.', 'Come in out of the wind!'] },
  coast: { names: ['{keeper}\'s Chandlery', 'The Rusty Anchor', 'The Gull & Oyster'], lines: ['Everything the sea washes up, I sell. Mostly.', 'Rope, tar, lanterns and luck. Everything a sailor needs.'] },
  mountain: { names: ['{keeper}\'s Armoury', 'The Iron Anvil', 'The Deep Delve'], lines: ['Steel for heroes. Only the best, and the best isn\'t cheap.', 'Forged in the mountain, cooled in snowmelt. Take a look.'] },
  swamp: { names: ['{keeper}\'s Curios', 'The Bubbling Pot', 'The Lantern & Lily'], lines: ['Potions, poisons, er, remedies. Curios of every kind.', 'Mind the jars. Some of them bite.'] },
  snow: { names: ['{keeper}\'s Trading Post', 'The Snug Mitten', 'The Frosted Kettle'], lines: ['Furs, flasks, and frost-proof boots. Stay warm, friend.', 'Shut the door! You\'re letting the winter in.'] },
  volcano: { names: ['{keeper}\'s Supplies', 'The Cinder Stall'], lines: ['Fireproof, mostly. Take a look.', 'Everything here has been singed a little. It\'s still good.'] },
  desert: { names: ['{keeper}\'s Bazaar', 'The Blue Jar', 'The Shady Palm'], lines: ['Silks, spices, and cool water. Come in out of the sun!', 'Everything a desert traveller could want. Especially water.'] },
}

/** Workshops, where any hero may use the cauldron, anvil and grindstone. Names by land; {keeper} is the owner. */
export const WORKSHOPS: Record<Biome, { names: string[]; lines: string[] }> = {
  plains: { names: ['{keeper}\'s Workshop', 'The Mill Wheel Workshop', 'The Busy Anvil'], lines: ['Anvil, cauldron, grindstone: use what you like. Pedal hard and it all goes faster!', 'Mind the sparks, and put the tools back where you found them.'] },
  forest: { names: ['{keeper}\'s Woodshop', 'The Whittled Owl', 'The Sawdust Hut'], lines: ['Bark, sap and elbow grease. Help yourself to the bench.', 'The grindstone sings when you pedal fast. Make it sing!'] },
  hills: { names: ['{keeper}\'s Smithy', 'The Hilltop Forge', 'The Shepherd\'s Bench'], lines: ['The forge is hot and the anvil is free. Get to it!', 'Everything I own, I made right here. So can you.'] },
  coast: { names: ['{keeper}\'s Boatshed', 'The Salt & Tar Shed', 'The Driftwood Bench'], lines: ['Ropes, tar and a cauldron that has boiled a thousand crabs. Use it all.', 'Pedal hard and the bellows roar like the sea.'] },
  mountain: { names: ['{keeper}\'s Forge', 'The High Forge', 'The Stonecutter\'s Yard'], lines: ['The best anvil this side of the mountains. Strike while it\'s hot!', 'Dwarves built this forge. It has never once gone cold.'] },
  swamp: { names: ['{keeper}\'s Brewhouse', 'The Bubbling Cauldron', 'The Bog-Iron Forge'], lines: ['The cauldron never stops bubbling. Put something good in it.', 'Stir clockwise. Always clockwise. Trust me.'] },
  snow: { names: ['{keeper}\'s Smithy', 'The Warm Hearth', 'The Frost Forge'], lines: ['The warmest room in town! Pedal and you\'ll soon forget the cold.', 'Keep that fire roaring and you can make anything.'] },
  volcano: { names: ['{keeper}\'s Forge', 'The Cinder Forge'], lines: ['The mountain keeps the forge hot for free. Help yourself.', 'Hot enough to melt steel. Hot enough for you?'] },
  desert: { names: ['{keeper}\'s Glassworks', 'The Sandglass Kiln', 'The Sun Forge'], lines: ['Sand and fire make glass. Sand and fire and you make anything.', 'The kiln is hot and the sun is hotter. Work fast!'] },
}

/** Workshop keepers: [emoji, avatar]. */
export const CRAFTERS: Record<Gender, [string, string][]> = {
  f: [
    ['👩‍🔧', 'strong-armed smith in a leather apron, with soot on her nose and a hammer on her belt'],
    ['👩‍🏭', 'glassblower with goggles pushed up into her curls'],
    ['👩‍🦰', 'red-haired carpenter with a pencil behind her ear and sawdust in her hair'],
  ],
  m: [
    ['👨‍🔧', 'broad smith in a scorched leather apron, with forearms like hams'],
    ['👨‍🏭', 'wiry tinker with goggles, a tool belt and a grin'],
    ['🧔', 'bearded woodworker with curls of shavings stuck to his jumper'],
  ],
  n: [
    ['🧑‍🔧', 'cheerful tinker with a tool belt full of odd little tools'],
    ['🧑‍🏭', 'patient glassblower with singed sleeves and careful hands'],
  ],
}

/** Shopkeepers: [emoji, avatar]. */
export const KEEPERS: Record<Gender, [string, string][]> = {
  f: [
    ['👩‍🍳', 'broad-shouldered shopkeeper with rolled sleeves and a flour-dusted apron'],
    ['🧝‍♀️', 'wood-elf shopkeeper with leaf-green braids and a quiver on her back'],
    ['👱‍♀️', 'stubborn young shopkeeper with a smudged face and a lantern'],
    ['👩‍🦱', 'brisk shopkeeper with a pencil behind one ear and a ledger under one arm'],
    ['👩‍🦰', 'freckled shopkeeper in a patchwork apron, with a cat asleep on the counter'],
  ],
  m: [
    ['👨‍🦲', 'cheerful bald merchant in a honey-coloured vest'],
    ['👨‍🦰', 'red-haired ex-sailor with a tattooed forearm and a gold earring'],
    ['🧔‍♂️', 'huge shopkeeper with a braided blond beard and a fur vest'],
    ['👨‍🏭', 'soot-faced armourer with a thick moustache and a hammer on his belt'],
    ['👨‍🦳', 'kindly old shopkeeper in half-moon spectacles and a knitted waistcoat'],
  ],
  n: [
    ['🧑‍🍳', 'cheerful cook-turned-shopkeeper in a flour-dusted apron'],
    ['🧑‍🦱', 'quick-talking trader with curly hair and a ledger under one arm'],
    ['🧑‍🦰', 'red-headed shopkeeper who hums while counting coins'],
    ['🧑', 'calm shopkeeper in a green apron, with a pencil behind one ear'],
  ],
}

/** Goods a town grows or makes, sold in its shop. */
export const PRODUCE: Record<Biome, string[]> = {
  plains: ['jar_of_honey', 'apple_pie'], forest: ['jar_of_honey'], hills: ['wheel_of_cheese'], coast: ['smoked_fish', 'spiced_tea'],
  mountain: ['wheel_of_cheese'], swamp: ['smoked_fish'], snow: ['knitted_socks'], volcano: ['bag_of_toffee'], desert: ['spiced_tea', 'silk_ribbon'],
}

/** Goods a key-holder can want, and how to say more than one. */
export const GOODS: Record<string, string> = {
  jar_of_honey: 'honey', wheel_of_cheese: 'cheese', apple_pie: 'apple pies', bag_of_toffee: 'toffee',
  knitted_socks: 'knitted socks', smoked_fish: 'smoked fish', spiced_tea: 'spiced tea', silk_ribbon: 'silk ribbon',
}

// --- quests ---------------------------------------------------------------------------------------

/** Parcels to deliver: why, and what the recipient says. {from}: the sending town. */
export const PARCELS: { item: string; reason: string; thanks: string }[] = [
  { item: 'sealed_letter', reason: 'It is about the harvest fair, and it must arrive before the fair does.', thanks: 'A letter from {from}! How lovely. I have been waiting for news.' },
  { item: 'healing_herbs', reason: 'A fever has broken out there, and these herbs will cool it.', thanks: 'Herbs from {from}! Bless you. The sick will sleep easy tonight.' },
  { item: 'ore_sample', reason: 'We have struck a new seam, and they want to see a sample.', thanks: 'Beautiful! Look at that silver. {from} will be rich.' },
  { item: 'wedding_cake', reason: 'My niece is getting married there, and nobody else can be trusted not to eat it.', thanks: 'The cake! And not a single fingerprint in the icing. Wonderful!' },
  { item: 'sealed_charts', reason: 'They need new charts before the autumn storms.', thanks: 'The new charts! Now the boats can find their way home.' },
  { item: 'prize_pumpkin', reason: 'It is entered in their harvest fair. It will win, of course.', thanks: 'What a pumpkin! First prize, easily. Don\'t tell the judges I said so.' },
  { item: 'book_of_songs', reason: 'It is for their choir. They have been singing the same three songs for years.', thanks: 'New songs, at last! The choir will be thrilled. The neighbours, less so.' },
  { item: 'seed_grain', reason: 'Their fields flooded and they lost next year\'s seed. We can spare this.', thanks: 'Seed grain! Now we can plant again. Thank {from} for us.' },
  { item: 'love_letter', reason: 'It is, er, a private matter. Please don\'t read it.', thanks: 'A letter? For me? From {from}? Oh my. Oh my, oh my.' },
  { item: 'kitten_basket', reason: 'Our cat had kittens again, and I hear they have mice.', thanks: 'Kittens! Oh, look at them. The mice had better watch out.' },
  { item: 'bolt_of_cloth', reason: 'It is for their festival banner. They can\'t finish it without the blue.', thanks: 'The blue cloth! Now the banner will be done in time.' },
  { item: 'sack_of_nails', reason: 'They are rebuilding after the storm, and they have run out of nails.', thanks: 'Nails! Now the barn roof can go back on. Thank you, Hero.' },
]

/** Lost things a mayor wants back, hidden in another town. {where}: that town. */
export const LOST: { item: string; loss: string; how: string; joy: string }[] = [
  { item: 'silver_bell', loss: 'Our Silver Bell was stolen! We ring it when the river floods.', how: 'A goblin ran off toward {where} with it.', joy: 'My bell! Now we\'ll hear the floods coming.' },
  { item: 'town_charter', loss: 'The town charter is gone! Without it, {town} has no rights at all.', how: 'A magpie flew off toward {where} with it. Magpies love parchment.', joy: 'The charter! {town} is a proper town again.' },
  { item: 'golden_egg', loss: 'Our famous goose laid a golden egg, and somebody has pinched it!', how: 'A fox was seen carrying it toward {where}.', joy: 'The golden egg! And not even cracked!' },
  { item: 'mill_gear', loss: 'The mill has stopped. A gear is missing, and without it we can\'t grind a thing.', how: 'The miller\'s boy says a troll took it to {where} to wear as a hat.', joy: 'The gear! The mill will be turning again by supper.' },
  { item: 'harvest_cup', loss: 'The Harvest Cup has vanished from the hall, and the fair is next week!', how: 'The folk of {where} won it last year and never got over losing it. I bet it\'s there.', joy: 'The Harvest Cup! Just in time for the fair.' },
  { item: 'spyglass', loss: 'The harbour master\'s spyglass is missing, and nobody can see the ships coming in.', how: 'A gull took it. It was last seen flying toward {where}.', joy: 'The spyglass! Now we can watch for ships again.' },
  { item: 'weather_rooster', loss: 'The weather rooster blew off the steeple in the last storm.', how: 'The wind was blowing toward {where}. It must have landed there.', joy: 'Our rooster! Back up on the steeple it goes.' },
  { item: 'lost_lute', loss: 'Our minstrel lost her lute, and now she just sighs all day.', how: 'She last played it in {where}, at a very long party.', joy: 'The lute! Listen, she\'s playing already.' },
  { item: 'wind_chime', loss: 'The chapel wind-chime was stolen, and now the chapel is far too quiet.', how: 'The thief was seen running toward {where}.', joy: 'The wind-chime! Hear how it rings.' },
]

/** Things a mayor wants bought in another town. */
/** `a`: how to ask for one, when "a" plus the name won't do. */
export const WANTED: { item: string; title: string; need: string; joy: string; a?: string }[] = [
  { item: 'frost_flask', title: 'A Cure for the Fever', need: 'Our children are burning with a fever. A Frost Flask would cool them.', joy: 'The fever will break tonight. Thank you.' },
  { item: 'holy_water', a: 'some Holy Water', title: 'Holy Water for the Wedding', need: 'The chapel font has run dry, and there is a wedding on Sunday.', joy: 'Holy Water! The wedding can go ahead.' },
  { item: 'fire_flask', title: 'The Midsummer Bonfire', need: 'Our midsummer bonfire won\'t light. The wood is too damp. A Fire Flask would do it!', joy: 'Now we\'ll have a bonfire to remember!' },
  { item: 'thunder_vial', title: 'The Stubborn Weathervane', need: 'The weathervane has stuck. The old priest says a jolt of lightning would free it.', joy: 'Look at it spin! Thank you, Hero.' },
  { item: 'wheel_of_cheese', title: 'The Cheese-Rolling Race', need: 'The cheese-rolling race is tomorrow, and the mice ate our cheese.', joy: 'A cheese! The race is saved.' },
  { item: 'knitted_socks', title: 'Cold Feet', need: 'My feet are freezing, and nobody in {town} can knit.', joy: 'Socks! Oh, my toes. My poor, grateful toes.' },
  { item: 'spiced_tea', title: 'A Proper Cup of Tea', need: 'I haven\'t had a proper cup of tea in a month.', joy: 'Tea! Real tea! Put the kettle on.' },
  { item: 'jar_of_honey', title: 'Honey for a Cough', need: 'My granddaughter has a cough, and honey is the only cure she\'ll take.', joy: 'Honey! She\'ll be well in no time.' },
  { item: 'smoked_fish', title: 'The Hungry Cat', need: 'The town cat has stopped catching mice. It wants fish, and it wants it now.', joy: 'Fish! Listen to it purr.' },
]

/** Things to say more than one of a wanted thing that isn't a good. */
export const PLURALS: Record<string, string> = {
  frost_flask: 'Frost Flasks', holy_water: 'Holy Water', fire_flask: 'Fire Flasks', thunder_vial: 'Thunder Vials',
  sea_glass: 'sea glass', silver_ore: 'silver ore', crystal_shard: 'crystal shards', iron_sword: 'iron swords', cutlass: 'cutlasses',
}

export const QUEST = {
  deliverOffer: 'Would you carry this {parcel} to {who} in {to}? {reason}',
  deliverPay: ['They pay their couriers well, I promise.', 'You\'ll be well paid for your trouble.'],
  deliverPayKit: '{Who} has {item}, and has promised it to whoever brings this.',
  deliverReminder: '{Who} in {to} is waiting for the {parcel}.',
  lostEnd: '{how} Bring it back and {promise}.',
  wantedEnd: '{shop} in {where} sells {plural}, I am told. Bring me one, please.',
  wantedReminder: 'Have you found {itemA}? {shop} in {where} sells {plural}.',
  lostReminder: 'Any sign of the {thing}? {how}',
  slayOffer: '{Foe} has been prowling the road to {to}, frightening every traveller. {trouble}',
  slayTrouble: ['Nobody dares to use that road any more.', 'The traders have stopped coming, and the market is empty.', 'Even the bravest carters turn back.'],
  slayEnd: 'Beat {foe}, and {promise}.',
  slayReminder: '{Foe} is still out on the road to {to}.',
  slayDone: '{Foe} beaten? Then {town} owes you a great deal.',
  promise: ['I\'ll make it worth your while', 'you\'ll have my thanks, and a reward besides'],
  promiseKit: '{item}, which {story}, is yours',
  story: { weapon: 'has hung in my hall for a hundred years', armor: 'has sat in my armoury since my grandmother\'s day', relic: 'has been in my family for generations' },
  reward: ['Take this, with {town}\'s thanks.', 'Here is your reward, and well earned.'],
  rewardDeliver: ['Here, for your trouble.', 'Take this, with my thanks.'],
  rewardKit: 'As promised: {item}. May it serve you well against {bossShort}.',
  rewardKitDeliver: 'I have kept {item} safe for years. It is yours now: go and put it to good use.',
}

// --- the Queen, the crisis town, and hints ----------------------------------------------------------

export const SUMMONS = {
  open: [
    'Hero, thank you for coming so swiftly. Grave news has reached the throne.',
    'Ah, Hero, you came! Sit, please. I am afraid the news is bad.',
    'Welcome, Hero. I wish I had called you here for a feast, not a fight.',
  ],
  three: [
    'Our scholars say three things can bring {bossShort} down: {weaponLore}, {armorLore}, and {relicLore}.',
    'The old songs name three things that can defeat {bossShort}: {weaponLore}, {armorLore}, and {relicLore}.',
  ],
  find: [
    'Find all three, then face {bossShort} at {lair}. Ask everyone you meet; the people of {region} know more than they think.',
    'Gather all three, then go to {crisis} and face {bossShort}. Talk to everyone: somebody always knows something.',
  ],
  close: [
    'Take this purse and these draughts. My carriage will carry you to {start}. {realm} is counting on you.',
    'Here is gold for the road, and a few draughts. My carriage waits to take you to {start}. Go with my blessing.',
  ],
}

export const CRISIS = {
  elder: ['{BossShort}? Terrible business. I\'ve seen worse. Not much worse, mind.', 'I\'ve lived in {crisis} for eighty years, and I\'m not leaving now.', 'Everyone keeps telling me to run. Run where? My knees are eighty-three.'],
  elderAll: '{Weapon}, {armor} and {relic}. The old songs say you need all three.',
  shopNames: ['The Stubborn Stall', 'The Brave Kettle', 'The Last Candle'],
  shopLines: ['I\'m staying till the end. Buy what you need; you\'ll need it.', 'Everyone else has gone, but somebody has to sell the potions.'],
  workshopNames: ['The Cracked Anvil', 'The Last Forge'],
  workshopLines: ['Fire\'s the one thing we have plenty of. Use the forge, and hurry.', 'Everyone else has fled. The anvil\'s all yours.'],
  spot: ['the Ruined Hall', '🏚️', 'In the rubble of the old hall you find {a}, somehow unbroken.'] as SpotDef,
  watchman: { role: 'watchman', prefix: ['Watchman'], f: ['💂‍♀️'], m: ['💂'], n: ['💂'], avatar: ['exhausted young watchman in a battered helmet, holding a bucket'], lines: [] } as RoleDef,
}

/** Words for what a boss attacks with. */
export const ATTACK_WORD: Record<Element, string> = { fire: 'fire', ice: 'freezing cold', storm: 'lightning', poison: 'poison', holy: 'light' }

export const HINTS = {
  slay: ['{mayor} of {town} keeps {item}, and has promised it to whoever defeats {foe}.', '{Foe} prowls the road between {town} and {other}.'],
  shop: ['{shop} in {town} sells {itemA}. It costs a fortune: {price} gold.', 'Only {itemA} can turn {bossShort}\'s {attack}. {shop} in {town} has one.'],
  keys: ['{Item} lies in {spot} in {town}.', '{Spot} in {town} is locked. {holder}, the {role} of {other}, keeps the key.', '{holder} in {other} will trade almost anything for {goodA}.', '{shop} in {goodTown} sells {plural}.'],
  fetch: ['{mayor} of {town} would give {item} to whoever brings back the lost {thing}.', 'The {thing} from {town} is hidden in {spot} in {where}.'],
  deliver: ['{Who} in {other} has {item}, and has promised it to whoever brings the {parcel} from {town}.', '{mayor} of {town} is looking for a courier to {other}.'],
  all: 'To defeat {bossShort} you need {weapon}, {armor} and {relic}.',
  roads: 'The quickest road to {crisis} is the one from {town}.',
  lost: 'The {thing} from {town} is hidden in {spot} in {where}.',
  chest: '{Spot} in {town} is locked. Its key was lost in {keySpot} in {keyTown} years ago.',
  craft: [
    '{Item} can\'t be bought or found: it has to be made, at the workshop in any town, from {words}. It takes a few minutes of hard pedaling.',
    '{shop} in {town} sells {plural}.',
    'There is {a} hidden in {spot} in {town}.',
    '{npc} in {town} has {a}, and would give it to a hero.',
  ],
}
