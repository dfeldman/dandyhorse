# Kingdom Trek — design

A role-playing adventure played on exercise equipment. The player pedals at a
steady pace for long stretches and presses a button now and then. Pedaling makes
**Energy**; Energy moves the hero across the land. Fights are won by pedaling in
real time. Every rescue of the kingdom is one **Level**, and there is no last level.

Milestone 1 (this document's scope): **one hand-authored game file, fully
playable in the browser.** The generator for many game files, the exercise
platform (Dandyhorse) and real device input come later; the schemas below are
already shaped for them.

---

## 1. Principles

1. **Six buttons.** Up, Down, Left, Right, Select (Enter), Back (Esc). Nothing
   else is needed to play. A gamepad maps the same way (d-pad, A, B).
2. **Everything is a choice list.** Every screen shows one list of options on
   the right. Up/Down highlight, Select picks, Back picks the list's back
   option. A phone can mirror the same list later (text only).
3. **Long stretches, little input.** Travel and battles run by themselves; the
   player only pedals. Results screens continue on their own after a few seconds.
4. **One JSON blob of player state.** Everything needed to resume is in the
   save (§8), small enough to checkpoint to a database every few seconds.
5. **Pure engine, thin views.** The rules run headless (`step(dt, effort)` and
   `choose(optionId)`); the canvas and DOM only draw. A bot plays the real
   engine in tests.

## 2. Controls

| Button | Key | Gamepad | Meaning |
|---|---|---|---|
| Up / Down | ↑ ↓ | d-pad, left stick | move the highlight in the choice list |
| Left / Right | ← → | d-pad, left stick | jump a page in long lists |
| Select | Enter, Space | A | pick the highlighted option |
| Back | Esc, Backspace | B | pick the list's back option (Leave, Close...) |

Developer keys (not part of play): `[` `]` lower/raise pedal effort, `F` cycles
time speed (1×, 10×, 60×), `` ` `` toggles the dev panel (effort, speed, save JSON).

## 3. Choice framework

```ts
interface ChoiceOption { id: string; label: string; disabled?: boolean; itemId?: string; hint?: string }
interface ChoiceList   { key: string; title: string; options: ChoiceOption[]; backId?: string; highlight?: string }
```

- `id` is stable and semantic (`place:shop`, `buy:healing_draught`, `travel:millbrook`);
  the bot and tests pick by id. `label` is plain text, ≤ 40 characters, and may
  start with one emoji.
- Up to 100 options. The panel shows a scrolling window; Left/Right page. Lists
  that could grow (bag, sell) are grouped by item type first.
- `backId` names the option Back triggers. `itemId` makes the side panel show
  an item card while that option is highlighted (shop, bag). `hint` is a one-line
  explanation shown under the list for the highlighted option.
- `key` changes whenever the list changes, so a mirror (phone) knows to redraw.
  A future phone adapter maps `{key, title, labels}` to a prompt and pages
  lists longer than the phone's limit.

## 4. Modes

The engine keeps a stack of modes. The bottom is the **base** (a town, or the
road), and only the base is saved; everything pushed on top is transient.

```
 title ─► intro (throne room) ─► TOWN ◄──────────────────────────────┐
                                  │  ├─► shop      (push, Back pops)  │
                                  │  ├─► craft     (push)             │
                                  │  ├─► npc       (push)             │
                                  │  ├─► mayor     (push)             │
                                  │  ├─► gate ─► TRAVEL ─► arrive ────┘
                                  │  ├─► journal   (push, anywhere)
                                  │  └─► lair ─► battle(boss) ─► victory ─► intro (next level)
                                  TRAVEL ─► battle (push, automatic) ─► TRAVEL
```

The eight user-facing modes: **introduction** (title + throne room),
**town**, **travel**, **battle**, **shop**, **craft**, **npc**, **mayor**. Supporting
modes: gate (pick a destination), journal (quest log, bag, hero, map, hints),
dialog (lines of text with Continue), menu (pause), farewell (end of session),
creator (the hero's look), victory (level up).

- **Town.** One screen: the town seen from above, the hero walking to the
  highlighted place. Options: Mayor's hall, Shop, Workshop, each NPC, search spots,
  the Gate, the Journal, Pause, and at the crisis town the lair. Moving within a
  town costs nothing.
- **Gate.** Neighbouring towns with their Energy cost and rough minutes.
- **Travel.** The hero walks a winding road through the route's terrain. No
  input needed. Options: Journal, Turn back, travel potions, Pause.
- **Battle.** Starts by itself when an enemy blocks the road. Options: drink a
  potion, switch weapon, flee. Pedaling does the fighting.
- **Shop.** Buy and Sell, one at a time; the highlighted item's card is shown.
- **Craft.** A town's workshop (`workshop` in the town: named like its shop,
  with a keeper, and a building on the town map). Every recipe in the game file
  is listed (none are learned, and no workshop is special): pick one and pedal. A
  meter fills at the pace you pedal (the recipe's `seconds` at a steady pace);
  each fill makes one and uses its ingredients, and it carries on until you stop
  or run out. Pedal-only recipes (a Healing Draught, a minute) never run out.
  Pedaling goes into the work, so no Energy is banked meanwhile.
- **Pause.** Esc or B in a town or on the road, or the ⏸ Pause choice: Resume
  or End session. No time passes and no Energy is banked while paused.
- **NPC.** They talk (hints are recorded in the journal), and some trade,
  give gifts, take deliveries, or train a stat for gold.
- **Mayor.** Offers one quest, takes it back when done, pays the prize.

## 5. Economy (the numbers everything else derives from)

`effort` is pedal output relative to the player's steady pace (1.0 = steady).
Milestone 1 assumes 1.0; `[` `]` change it for testing. Later it comes from
speed, cadence, power or heart rate.

| Quantity | Value | Why |
|---|---|---|
| Energy income | 1 ⚡/s × effort | a steady minute = 60 ⚡, easy mental math |
| Travel cost | 2.2 ⚡ per map unit | neighbouring towns are 190–240 units apart → 420–530 ⚡ → **7–9 min** at steady pace |
| Travel with banked Energy | the hero walks at the pace you pedal, plus 2 ⚡/s from the bank until it is empty | banked Energy is a boost on top of pedaling: pedaling done in town is never wasted, and pedaling harder is always faster |
| Travel with an empty bank | the hero walks at the pace you pedal | "out of banked Energy, keep pedaling" |
| Energy in battle | the bank is untouched; only live effort fights | the brief: stored Energy is not useful in battle |
| Energy at the workshop | the bank is untouched; live effort fills the craft meter | another place where real-time effort counts |
| Energy elsewhere | town, shop, dialog, journal: income goes to the bank (nothing while paused) | |
| One level | 10 legs on the shortest path (≈ 84 min of Energy) + ~11 fights | the test bot takes **81–94 min**; a real player who explores and does side quests **≈ 2 h** |

Energy is conserved: time spent pedaling in town shortens the next trip by the
same amount. So a level's length is (Energy the trips need ÷ income) + time in
battle, whatever the player does in between.

Overloaded (bag weight above capacity) → travel costs × 1.4. Travel clothing
reduces cost (capped at −30%). A Traveler's Tonic makes the next trip −20%.

**Nothing permanent may cut the pedaling a level needs.** Items are kept from
one adventure to the next, so travel clothing wears out after a number of trips
(`lasts`: the Traveler's Cloak 6, Boots of Striding 10), and the validator
insists on it. Crafting doesn't get round it: a Traveler's Tonic takes two
minutes of pedaling to make and saves a little less than that on the road.

## 6. Hero

- **Class and look**, picked in the character creator when a new game begins
  (one choice list per step, with a live preview in a mirror):
  - **Knight:** +2 Strength, +1 Vigor, −1 Magic, −1 Luck; a leather cap.
  - **Mage:** +3 Magic, −1 Strength, −1 Vigor; extra potions.
  - **Ranger:** +2 Luck, +1 Vigor, −1 Strength, −1 Magic; a hunting bow and a tonic.

  Then a name from a short list for the class (or just "Hero"; no typing), a
  build (sturdy, slim, tall), a skin tone (the five emoji tones), clothes (six
  colours) and hair (five colours or none; then short, shoulder-length or long).
  The class also sets the silhouette:
  helmet and sword, pointed hat and staff, or hood and bow. A wizard NPC
  (`restyle: { price }`) changes the look later for gold, never the class, name
  or stats. Numbers and names are in `CONFIG.classes`.
- **Stats** (start random 3–7, total 18–22, then the class nudge):
  - 💪 **Strength** — weapon damage +8% per point; bag capacity 30 + 3 per point.
  - ✨ **Magic** — potion potency +7% per point (heal, damage, buff length).
  - ❤️ **Vigor** — battle HP = 30 + 5 per point.
  - 🍀 **Luck** — +3% gold per point, +1% critical hits, better drop chances.
- **Stats grow by use.** Each stat has experience; a point is gained when it
  reaches 3 + the stat's value. Win a fight: Strength +1 xp. Each potion drunk
  in battle: Magic +1 (max 2 per fight). End a fight below half HP: Vigor +1.
  Finish a mayor's quest: Luck +2; find an item: Luck +1. Trainers in towns sell
  a point for gold (40, then +50% each time). Saving the kingdom: +1 to every stat.
- **Gold** from fights, quests, selling, and finds. Energy never turns into gold,
  but what you make at the workshop can be sold: about 7 gold for a minute's
  Healing Draught, close to the game's usual rate.
- **Level** = kingdoms saved + 1. Enemies scale with it (§7).

## 7. Battle

Real time, a battle lasts 30 s–3 min.

**Battle styles.** Each enemy names its style (`battle`, default `"hp"`); bosses
always fight for hit points. The engine talks to a battle only through
`step(dt, effort)`, `usePotion`, `switchWeapon`, `flee` and an outcome, so a new
style is one class. Three exist:

- `hp`: strike until it falls (in detail below).
- `tug`: a tug of war. The rope moves by the hero's pull (battle strength × live
  effort) against the enemy's. The enemy heaves for 3 s about every 10 s and eases
  off in between, and the rope swings with it (`TUG_SWING`): at a steady pace a
  heave drags it back and a pause lets the hero win it back. Pulling harder during
  a heave loses less ground. Win at +1, lose at −1.
- `race`: reach the flag first. The hero runs at battle strength × effort. The
  enemy starts 30% down the track and runs like the hare, sprinting faster than a
  steady hero and then stopping to get its breath back, so the lead changes hands.
  The camera follows the runners.

Contests are calibrated like fights: a typical hero at a steady pace wins in the
tier's time, and doing nothing loses in `safety` × that. "Battle strength" is the
hero's damage rate (weapon, Strength, element, average crits) over the typical
hero's. Potions work in every style: heal is a second wind, and damage flasks
make the enemy lose its grip or stumble. In game-0000 bandits, pirates, crabs and
snow trolls tug; goblins, frost sprites and fire imps race.

`hp` in detail:

- The hero's **strike meter** fills at 0.4/s × effort (a strike every 2.5 s at
  steady pace; twice as often at double effort; none if the player stops).
- Strike damage = weapon power × (1 + 0.08 × Strength) × element × bane ×
  buffs × random 0.85–1.15. Criticals (10% + Luck%) do × 1.8.
- Element: weapon element matching the enemy's weakness × 1.5, its resistance × 0.5.
  **Bane** weapons (Frostbrand vs dragons) × 2.
- The enemy attacks every ~3 s. Armor (clothing, capped 60%) reduces damage;
  a resistance to the attack's element halves it.
- **Enemies are calibrated to a typical hero at the current level**, so fights
  stay the same length at any level while a stronger-than-typical hero wins faster:
  - typical DPS(L) = 0.4 × power(L) × (1 + 0.08 × str(L)), power(L) = min(14, 9 + 1.5(L−1)),
    str(L) = vig(L) = 5 + (L−1): only what every hero is sure to have (+1 per stat at each
    level-up, weapons the game files reliably offer). Stat xp, training, tomes and better gear
    put a hero above typical, so fights get shorter as the hero grows, and never impossible.
    From level 2 the Queen's gift includes a blade from her armory matched to `power(L)`
    (config `armory`: Knight's 11 at L2, Captain's 12 at L3, Royal 14 at L5), so even a
    hero who never shops keeps up. A test fights a wolf at levels 1–15 with only those
    guarantees and must win.
  - enemy HP = tierSeconds × typical DPS(L); tierSeconds 40 / 55 / 75 / 90 / boss 180
    (a fight is a real effort interval, not a blip)
  - enemy damage/s = typical HP(L) ÷ (tierSeconds × 2.2) — a typical hero
    who keeps pedaling ends a fight at about half HP; one who stops pedaling
    loses in roughly twice the fight's length. Bosses use 1.4: closer fights.
  - the boss hits twice as hard unless the hero resists its element (the
    required armor), and its HP assumes the required weapon.
- **Potions** (Magic scales them): heal a fraction of max HP; damage worth N
  seconds of typical strikes; Might (× 1.5 damage), Shield (+40% armor),
  Quickening (× 1.6 strike speed) for a few seconds.
- **Win**: gold (by tier, × level scale, × Luck), maybe the enemy's drop, and if
  it dropped nothing, sometimes a prize (25–50% by tier, Luck helps): a potion or
  a bit of treasure (`CONFIG.battle.prizes`). Stat xp. A short results screen
  continues by itself after 6 s.
- **Lose**: lose 20% of the gold carried and 20% of banked Energy, and one spare
  potion or treasure. Never gear, keys, the boss's items, or anything a quest, a
  trade or a lock needs (`R.isNeeded`), so losing can't make a game unwinnable.
  Get pushed back 15% along the road; the enemy is gone for this trip. Losing never costs pedaled distance you can't recover
  quickly. At the lair, losing returns you to the town.
- **Flee** (not from the boss): no reward, a 5% gold toll, pushed back 5%.

## 8. Items

`public/data/items.json` holds every item any game can use:

```ts
interface ItemDef {
  id: string; name: string; emoji: string
  type: 'key' | 'potion' | 'weapon' | 'clothing' | 'general'
  value: number        // gold; shops sell at value, buy back at half (+Luck)
  weight: number
  description: string
  weapon?:   { power: number; element?: Element; bane?: Family[] }
  potion?:   { effect: 'heal'|'damage'|'might'|'shield'|'haste'|'travel'|'stat'; power: number;
               seconds?: number; element?: Element; stat?: Stat }
  clothing?: { armor?: number; hp?: number; resist?: Element[]; travel?: number;
               gold?: number; damage?: number; potency?: number }
  noSell?: boolean     // keys and plot items
  tags?: string[]      // 'treasure', 'threat:dragon', ...
}
```

- **key** opens a locked spot. **potion** is used once (battle potions, travel
  tonics, stat tomes). **weapon** is used in battle forever; one is equipped.
  **clothing** is worn automatically as long as it is carried; effects stack,
  weight is the limit. **general**: quest parcels, plot items, treasure to sell.
- Elements: fire, ice, storm, holy, poison. Families (for banes and flavor):
  beast, bandit, goblin, pirate, undead, spirit, giant, dragon, sea, witch, wizard, soldier.

## 9. Game file

`public/data/games/game-0000.json`; `public/data/games/index.json` lists the files.
A game file is a complete plan for one level, independent of the player's level.

```ts
interface GameFile {
  schemaVersion: 1; id: string; title: string
  region: { name: string; blurb: string; width: number; height: number }
  startTown: string
  towns: Town[]; routes: Route[]; enemies: EnemyDef[]; hints: Hint[]
  recipes?: Recipe[]
  challenge: Challenge
}
interface Person { id: string; name: string; emoji: string; avatar: string }   // avatar: visual description, unused for now
interface Town   { id; name; biome; x; y; blurb; crisis?: boolean
                   appearance?: string   // village | capital | fortress | port | river | hillside | ruins;
                                         // anything else draws as a village (the crisis town as ruins)
                   mayor: Person & { title: string; greeting: string[]; quest?: Quest; hint?: string }
                   shop:  { name: string; keeper: Person; lines: string[]; stock: { item: string; qty?: number }[] }
                   workshop?: { name: string; keeper: Person; lines: string[] }   // where recipes are made
                   npcs:  Npc[]; spots: Spot[] }
interface Npc    extends Person { role: string; lines: string[]; hint?: string
                   gives?:  { item: string; line: string }                     // once
                   trade?:  { wants: string; gives: string; line: string }     // once
                   trains?: { stat: Stat; price: number } }
interface Spot   { id; name; emoji; item?: string; gold?: number; requiresKey?: string; text: string }
interface Route  { id; a; b; distance; terrain; danger: number; enemies: string[]
                   fixed?: { id; enemy; at: number; quest?: string }[]  // named foes, quest-gated
                   finds?: { id; item: string; at: number }[] }         // lying by the road, once
interface EnemyDef { id; name; emoji; family; tier: 1|2|3|4|5; weakness?; resist?; attack?: Element
                     gold: [number, number]; drops?: { item; chance }[]; taunt: string; boss?: boolean }
interface Quest  { id; type: 'fetch'|'deliver'|'slay'; title; offer: string[]; reminder: string; done: string[]
                   item?: string                        // fetched / delivered
                   to?: { town; npc?: string }          // deliver target (npc id, or the town's mayor)
                   foe?: string                         // slay: fixed encounter id
                   reward: { gold: number; items?: string[] } }
interface Challenge { threat; title; summons: string[]; crisisTown; lair: { name; emoji }
                      requires: string[]; boss: string; victory: string[]
                      sources: { item; how: 'quest'|'shop'|'spot'|'trade'|'gift'|'route'|'craft'; town: string; ref: string }[] }
interface Hint   { id; text; about?: string }
interface Recipe { item: string; needs?: { item: string; qty: number }[]; seconds: number }  // one per item; seconds at a steady pace
```

- **Challenge** — the threat (dragon, sea monster, wizard's curse, witch's
  plague, pirates, enemy nation, ...). To finish: carry every `requires` item to
  the crisis town and win the boss fight at the lair. `sources` records where
  each item is obtainable: the game never shows it, the validator and the bot use it.
- **Quests** — fetch (bring an item back), deliver (carry a parcel to someone
  in another town; the recipient pays), slay (a named foe appears on a road
  only while the quest is active; return to the mayor).
- **Hints** — NPCs and mayors tell them; heard hints go into the journal.
- **Recipes** — what the workshop makes in this game (§4 Craft): pedal-only
  ones, and ones with ingredients where the effort is in proportion to the
  value. The validator counts a recipe's output as obtainable when its
  ingredients are, in the numbers it needs (a shop that never runs out counts as
  any number). A lost fight never takes, and shops won't buy, the makings of a
  royal item until it is made.
- **Monarch** — always the same: Queen Isolde of Everwyn (code constant).
- **Theme** — `theme` names the words and look (`"medieval"`, the default and so
  far the only one). Every theme is the same arc (a ruler or powerful figure,
  towns, people, bosses); only the words and graphics change, so a later theme
  brings its own ruler.

**Generated games.** `npm run generate` (tools/generate.ts, `src/gen/`) makes a
game file from a seed:

- Eight towns laid out west to east: the start a capital, the crisis town in
  ruins. Roads join the nearest towns without crossing, 7–12 minutes each, and
  every town has at least two.
- Lands by latitude (snow in the north, coast and marsh in the south) and by the
  threat near its lair. Enemies by the road's terrain, tougher toward the east,
  with the threat's servants on the roads to the lair.
- The three things the boss requires are the threat's kit: a weapon that hits its
  weakness, armour that resists its attack, and a relic. Each is found a
  different way: a mayor's slay, fetch or delivery quest, an expensive shop, or a
  locked place whose key someone trades for a good sold in a third town.
- One of the three is always made at the workshop (`src/gen/crafts.ts`), from
  things sold where they never run out (anything needed twice, drunk or wielded)
  and a treasure found once (a place to search, or someone's gift). Every game
  also has a Healing Draught and a tonic from pedaling alone, Greater Healing
  from two draughts, and two recipes from local finds.
- Every other mayor has a side quest. There are three trainers, the wizard,
  places to search (one a chest whose key is lost in another town), a find on
  every road, and hints in other towns for every step.
- People get varied faces: skin tones, and some gender-neutral 🧑 people.
- Every town has a workshop, named by its land like the shops (The Warm Hearth,
  The Bubbling Cauldron, {keeper}'s Forge).

A candidate is kept only if the validator passes and the solver bot wins with
every class on three seeds in 70–120 minutes. The words come from
`src/gen/medieval.ts`; a new theme is a new word file.

## 10. Save (the checkpoint blob)

```ts
interface SaveState {
  version: 1; gameId: string; level: number; heroName: string
  heroClass: 'knight' | 'mage' | 'ranger' | null   // null until the creator runs
  look: { body: 'sturdy' | 'slim' | 'tall'; skin: string; outfit: string; hair: string; hairLength: 'short' | 'shoulder' | 'long' }
  energy: number; gold: number
  stats: Record<Stat, number>; statXp: Record<Stat, number>; trained: Record<Stat, number>
  inventory: Record<string, number>; weapon: string | null
  where: { kind: 'intro' } | { kind: 'town'; town: string }
       | { kind: 'travel'; route: string; from: string; to: string; pos: number /* 0 at route.a, 1 at route.b */;
           dir: 1 | -1; cost: number;
           plan: { at: number; enemy: string; fixed?: string; done?: boolean }[] }
  quests: Record<string, 'active' | 'done'>
  taken: string[]; defeated: string[]; hints: string[]; visited: string[]
  bought: Record<string, number>     // "town:item" → count, for limited stock
  wear: Record<string, number>       // trips walked in gear that wears out (ItemDef.lasts)
  completedGames: string[]; rng: number   // RNG state, so a reload continues the same sequence
  totals: { playSeconds; energyEarned; distance; battlesWon; battlesLost; kingdomsSaved; itemsCrafted }
  adventureSeconds: number           // play time in this adventure (journal progress)
  savedAt: string
}
```

Checkpointed to localStorage every 10 s and whenever the base mode changes.
`window.kingdomTrek.getSave()` / `loadSave(blob)` are the hooks the platform
will use. Mid-battle and mid-dialog are not saved: loading puts the hero back in
the town or on the road.

**Level up.** The boss falls → the throne room: +1 every stat, a gold reward,
level + 1. The challenge's relics (Frostbrand, the shield, the Tidestone) go to
the royal armory, so a later adventure that needs them starts from scratch; keys
and plot items stay behind; other weapons, clothing, potions and treasure carry over. The next game file is the first one not yet completed (with one file,
it repeats; enemies scale with level so it stays a fight).

## 11. Game 0000 — "The Dragon of Emberpeak"

Eight towns in the Amberlands. Cindermaw the Red has taken Emberpeak.

| Needed | Where | How |
|---|---|---|
| Frostbrand (weapon, ice, dragon-bane) | Frostford | the Earl's quest: slay the Great Grey Wolf on the Highcrag road |
| Dragonscale Shield (clothing, fire resist) | Highcrag | buy it (240 gold) |
| Tidestone (general) | Mirewater | the Sunken Shrine, locked; the Saltmere hermit trades the Shrine Key for a Jar of Honey from Millbrook |

Shortest path, as the test bot plays it: Oakvale → Millbrook (honey) → Frostford
(accept) → Highcrag (the wolf on the way) → Frostford (Frostbrand) → Thornwood →
Saltmere (key) → Mirewater by the coast road (Tidestone) → Thornwood → Highcrag
(shield, once there is gold) → Emberpeak. 10 legs, 81–94 minutes at a steady pace
including about 11 fights. Five optional mayor quests pay gold, gear, and stat
xp; hints in every town point at the three items.

## 12. Architecture

```
src/
  content/types.ts     schemas (items, game file) — the single source of truth
  content/validate.ts  reference checks for a game file against the item catalog
  config.ts            every balance number in §5–§7
  engine/              pure, no DOM
    world.ts           indexed game file + catalog, route lookup
    save.ts            SaveState, new game, parse/migrate
    rng.ts             seeded RNG
    rules.ts           prices, weight, travel cost, derived battle stats, stat xp
    battle.ts          battle simulation
    engine.ts          mode stack, step(), choices(), choose(), events
    modes/*.ts         intro, town, gate, travel, battle, shop, npc, mayor, journal, dialog, victory
  ui/                  DOM: HUD, choice panel, dialog box, item card, journal pages, toasts
  render/              canvas scenes per mode (town, travel, battle, rooms)
  sim/bot.ts           a player who uses only the choice list (tests and tools drive it)
  sim/solver.ts        wins any game file from the file alone, pedaling steadily; times it
  gen/                 the game generator: map, threats, bestiary, the theme's words, the builder
  input.ts             keyboard + gamepad → Press
  effort.ts            pedal effort source (steady for now, dev override)
  main.ts              loading, loop, persistence, window.kingdomTrek
tools/validate.ts      npm run validate: every game valid, winnable, and how long it takes
tools/generate.ts      npm run generate: new game files, kept only if valid, winnable and 70–120 minutes
tests/                 rules, content, town layouts, the solver winning game-0000
```

## 13. Later

The working backlog, from play-testing, is [PLAN.md](../PLAN.md). The big pieces:

- Exercise platform: effort from device data; the choice list mirrored to a phone. The plan is
  [INTEGRATION.md](../INTEGRATION.md).
- Avatars: every person has an `avatar` description, ready for generated art.
- Races/classes (explicitly not now), sound, more threats and items.
