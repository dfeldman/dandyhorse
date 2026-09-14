# Kingdom Trek: plan

What to build next, collected from play-testing the first version (2026-09-13).
The design as built is in [docs/DESIGN.md](docs/DESIGN.md). Items are grouped by
area; within a group, the most useful come first.

## Done

From the first play-test, 2026-09-13:

- **"Out of banked Energy" while the bank was full.** At a fast pace (300%, the
  old developer maximum) pedaling alone matched the boost, so the bank was never
  touched. Banked Energy is now a boost *on top of* pedaling (+2 ⚡/s until the
  bank is empty), so pedaling harder is always faster and the label is always
  right. At a steady pace nothing changed.
- **Gold icon.** The 🪙 emoji looked like a moon; the HUD and item cards now draw a gold coin.
- **Scrolling the journal.** ← → scroll a page taller than the screen, and a
  "▼ More below" marker shows when there is more. On a phone, picking the page
  again turns to its next screen. The bag scrolls to the highlighted item.
- **Workout tab** in the journal: session time and Energy, lifetime time, Energy,
  kingdoms and battles, with dashes for distance, calories, speed, power and heart
  rate until device data arrives.
- **Workout slot in the HUD:** ⏱ session time, 🎯 target, 🚴 live reading, fed by
  `kingdomTrek.setTarget` / `feed`.
- **Testing speed:** `]` now steps up to 2000% pace; `F` still cycles time 1×/10×/60×.
- **Levels forever.** Enemies were calibrated to a hero who grows faster than the
  game allows, so a few levels in, a steady hero would lose to a wolf. Calibration
  now assumes only the +1 stats per level. From level 2 the Queen's gift includes
  a blade from her armory matched to the level (Knight's, Captain's, then Royal),
  because victory returns the relic weapon to the armory. A hero who never shops
  keeps up; a test fights at levels 1–15 with only those guarantees.
- **Pause and End session.** Esc/B in a town or on the road (or the ⏸ Pause
  choice) pauses the game: no time passes, no Energy is banked, and the HUD clock
  stops. The pause menu has just Resume and End session (the journal has its own
  choice everywhere). End session shows how the session went (time, Energy,
  leagues, battles, things made, what's next), then Save and exit saves, calls
  `kingdomTrek.onExit(save)` and dispatches `kingdomtrek:exit`.
- **Crafting** (DESIGN.md §4, §9). Every town has a workshop, named like its shop
  and with a keeper (The Royal Workshop, The Warm Hearth, The Bubbling Cauldron),
  and a building on the town map with a chimney and a glowing door. It lists every
  recipe in the game file (nothing to learn, and no workshop is special). Pick one
  and pedal: a meter fills at your live effort, each fill
  makes one, and it keeps going back to back until you stop or run out of
  ingredients. Pedal-only recipes never run out (a Healing Draught is a minute at
  a steady pace, 40 s pushing hard); recipes with ingredients cost effort in
  proportion to value. Pedaling goes into the work, so no Energy is banked
  meanwhile. Potions brew in a cauldron, metal is forged on an anvil and the rest
  is made at a grindstone, each working as fast as you pedal. Every generated
  game needs one royal item made this way; the validator, the solver bot and lost
  fights all know about recipes, so it can't become unwinnable. game-0000 has six
  optional recipes.
- **Travel gear wears out.** Items are kept from one adventure to the next, so
  anything that cuts travel Energy lasts a number of trips (Traveler's Cloak 6,
  Boots of Striding 10); otherwise every level would need less pedaling than the
  last. The item card shows the trips left, and the validator insists on it.
- **A penalty for losing or fleeing.** A loss still costs 20% of the gold carried
  and some ground, and now also 20% of banked Energy and one spare potion or
  treasure. It never takes gear, keys, the boss's items, or anything a quest, trade
  or lock still needs, so a loss can't make the game unwinnable. Fleeing costs a
  5% gold toll.
- **Prizes for winning.** When an enemy drops nothing of its own, a win sometimes
  turns up a prize anyway (25% for the weakest enemies, up to 50% for named foes;
  Luck helps): a potion or a bit of treasure.
- **Contests that feel like contests.** The tug of war now swings back and forth:
  a heave drags the rope back at a steady pace and a pause lets you win it back.
  In a race the enemy starts ahead, sprints faster than a steady rider, then
  stops to pant 💦, and the camera follows the runners. Fights last as long as
  before, and stopping still loses at the same speed.
- **More weapons:** thirteen new ones across the five elements and three price
  tiers (Ember Spear, Icicle Dagger, Spark Rapier, Morningstar, Thornlash,
  Cutlass, Glacier Pick, Longbow, Scorpion Bow, Inferno Greatsword, Winter's Edge,
  Tempest Spear, Dawnblade). Generated shops stock better ones further east, and
  ones that hit the local enemies' weaknesses.
- **A kit for every threat.** Each of the ten threats has a weapon that hits the
  boss's weakness, armour that resists its attack, and a relic. The validator now
  checks both, since bosses are balanced around them.
- **The game generator** (`npm run generate`, `src/gen/`, DESIGN.md §9). It makes
  a whole game from a seed: region, towns, roads, people, shops, quests, hints and
  the threat. The three items are found in different ways each time (a slay,
  fetch or delivery quest, an expensive shop, or a key traded for a good). Games
  are kept only if the bot wins with every class in 70–120 minutes.
  game-0001 to game-0009 are generated, one for each other threat, 76–118 minutes
  each, won 9/9 with no fights lost (regenerated with crafting, so their titles
  changed). The words are template-driven, so they read a little plainer than
  game-0000.
- **Hero names, skin tone and hair length.** The creator offers a short list of
  names for the class (or just "Hero"), the five emoji skin tones, and short,
  shoulder-length or long hair (skipped for a bald hero).
- **A friendlier hero.** Eyes set wider and lower, with a glint; a smile, rosy
  cheeks, ears, and brows where the forehead shows. The knight's helmet sits
  higher so the face shows. Hands hold the sword, staff and bow instead of the
  weapon floating beside them, and hair frames the face and tapers over the
  shoulders.
- **More varied townsfolk.** Generated people get skin tones and more varied
  faces, including some gender-neutral 🧑 people with names that suit anyone.
  game-0000's townsfolk got skin tones too.
- **Bosses drawn in full** (`src/render/bosses.ts`). Every boss is a big animated
  figure drawn in code instead of an emoji: a dragon (tinted by its name: the Red,
  the Black, the Gold), a kraken rising from a pool, a sorcerer with a crackling
  staff, a witch at her cauldron, a pirate king with a parrot, a warlord in black
  plate, a storm giant, a frost titan, a lich and a goblin king in three stolen
  crowns. Each breathes or sways, and shows its attack: fire, lightning, a poison
  cloud, frost breath, a swing.
- **The gate map on a phone** names only the towns that matter (where you are,
  the highlighted destination, the crisis), so the names no longer pile up.
- **Roadside finds on every road** of game-0000: picked up automatically as you pass.
- **Game length.** The game index records how long a steady hero usually needs
  (`minutes`, 90 for game-0000). The playthrough bot fails if a game's measured
  length drifts from its declared length, or if the declared length falls outside 1–2½ hours. The journal's
  Royal page shows progress (relics found, then the final battle), time in this
  adventure, and the usual length.
- **Ground textures.** Every biome has a seamless procedural ground (grass tufts
  and flowers, sand ripples and shells, gravel, leaf litter, snow sparkle, lava
  cracks, swamp puddles), scrolling with the road and broken up by large soft patches.
- **Scenery sprites drawn in code** instead of emoji: round and autumn trees, pines,
  snowy pines, palms, bushes, rocks, boulders, peaks, cacti, dead trees, reeds,
  mushrooms, stumps, crabs and sheep, each in several shapes, tints and sizes, and
  mirrored at random. Used on the road, in towns, behind battles, in close-ups and
  on the title screen. Items and people are still emoji.
- **A proper region map:** aged parchment with stains and burnt edges, the sea off
  coast towns, land tinted by biome, ink symbols for forests, peaks, hills, reeds,
  dunes and volcanoes, and a compass rose.
- **Town appearances and layouts.** Towns have a free-form `appearance`. The
  renderer knows `village` (a ring road round the plaza), `capital` (walled city,
  bannered towers, a castle for the mayor, cobbled grid streets, more houses),
  `fortress` (walls and a grid), `port` (harbour, quay, piers and boats), `river`
  (a river and bridge with a lane on each bank), `hillside` (terraces joined by
  switchbacks) and `ruins` (scorched, broken walls). Unknown words draw as a
  village, and a crisis town that says nothing draws as ruins. The hero walks the
  street graph to the highlighted place, so movement is unchanged. In game-0000
  Oakvale is now the capital, the Queen's royal seat.
- **Two new kinds of fight**, chosen per enemy by `battle`:
  - **Tug of war** (`tug`): the rope moves toward whoever pulls harder, and the
    enemy heaves every ten seconds or so, so you have to push through it.
  - **Race** (`race`): reach the flag first while the enemy sprints in bursts.

  Both use your battle strength times live effort, are calibrated like HP fights,
  and work with every potion. Bosses always fight for hit points. In game-0000,
  bandits, pirates, crabs and snow trolls tug; goblins, frost sprites and fire imps race.
- **A simple character creator** when a new game begins: a class, a build, clothes
  and hair, each one choice list (phone and gamepad friendly), with a live preview
  in a mirror.
  - **Knight:** +2 Strength, +1 Vigor; a leather cap.
  - **Mage:** +3 Magic; extra potions.
  - **Ranger:** +2 Luck, +1 Vigor; a hunting bow and a tonic.

  Each class nudges the rolled stats by a net +1, and each has its own look
  everywhere: helmet and sword, pointed hat and staff, or hood and bow.
- **A wizard who restyles you:** Zephyr the Wanderer in Thornwood changes your look
  for 60 gold, never your class or stats. Any NPC with `restyle: { price }` can do it.
- **A solver bot** (`src/sim/solver.ts`) that wins a game from the game file alone.
  - For each item the Queen needs, it works out every way to get it (shops, gifts,
    trades, keys and spots, road finds, fetch, deliver and slay quests), following
    chains like honey → key → shrine.
  - It does the nearest step it can, earns gold when that is all that blocks it,
    then faces the boss.
  - It plays the real engine through the choice list at a steady pace, so a game it
    finishes is winnable and its clock is the length estimate. It fails with a
    reason when stuck, beaten by the boss three times, or over a time cap.

  `npm run validate` runs the validator and the solver (3 classes × 3 seeds) on
  every game in the index, and `--write` stores the median minutes. game-0000 is won
  9/9, in 86–93 minutes, with no fights lost. The hand-written walkthrough is gone;
  the playthrough test uses the solver.

## Energy and fitness

- **Banked Energy:** decided, it stays as it is (a boost on top of pedaling).
- **Targets and real readings.** Planned in [INTEGRATION.md](INTEGRATION.md): effort
  = live ÷ the player's steady pace, from bike power, a treadmill estimate (speed and
  incline as bike-equivalent watts) or heart rate, with the steady watts coming from a
  new Dandyhorse preference. The device type only changes that sum; the game plays
  the same on either machine. No automatic pause: stopping to read a clue is part of
  play. The doc also lists the platform changes to make (a menu prompt for phones, an
  auto-pause opt-out, a game-side pause).
- **Workout totals.** Store lifetime distance, calories and averages in the save's
  `totals` once device data exists, and fill in the journal's Workout tab.

## Crafting

Built (see Done). Next:

- The solver bot crafts only when a recipe is the way to something the Queen
  needs; it could also brew potions when that beats buying them.
- Side quests could ask for something made at the workshop.
- Selling what you make is the one way effort turns into gold (about 7 gold a
  minute for Healing Draughts, close to the game's usual rate). Bag weight is the
  only brake on a 45-minute brewing session. Revisit if either feels off in play.

## Battles

- **More kinds of fight.** `hp`, `tug` and `race` exist (see Done). Ideas for more:
  - endure: hold a pace for N seconds while the enemy tries to break it
  - charge: fill a meter and release it for one big hit

## World and content

- **More checks for generated games**, on top of the solver (see Done):
  - A static gold check: shop-only required items must be affordable from the gold
    a level reliably pays.
  - A "sloppy player" bot that detours, sells things and loses a fight, to check
    that no choice can make the game impossible to finish.
- **Themes.** This game is medieval; later games could be modern, Roman,
  steampunk and so on. Decided: every theme is the same arc (a ruler or powerful
  figure, towns, people, bosses), only the words and graphics change. So a game
  file names its `theme`, the theme supplies the ruler and the generator's word
  tables, items are tagged by theme, and the renderer picks gate, building and
  palette art to match. Eventually each theme is a **series** of about 10 game
  files (medieval, steampunk, ...); INTEGRATION.md §9 has how a series would
  appear on the platform. Not needed yet.

## Look and feel

Emoji stay for items and people: they work well there. They look repetitive only
as scenery, where every tree and crab is identical and the same size.


## The hero

- **More classes and looks** once the three settle: a bard, a monk; hats, beards.
