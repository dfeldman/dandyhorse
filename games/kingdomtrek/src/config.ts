/**
 * Every balance number in one place (docs/DESIGN.md §5–§7). Effort 1.0 = the player's steady pace.
 */

export const CONFIG = {
  // --- Energy and travel ---
  /** Energy per second at effort 1.0. */
  energyPerSecond: 1,
  /** Travel Energy per map unit; neighbours 190–240 units apart → 7–9 min at steady pace. */
  energyPerUnit: 2.2,
  /** While the bank has Energy, it adds this much speed on top of your pedaling, draining at the same rate. */
  boostExtra: 2,
  /** Travel cost multiplier when the bag is heavier than capacity. */
  overloadMult: 1.4,
  /** Clothing can save at most this fraction of travel Energy. */
  travelSavingCap: 0.3,
  /** Encounters are placed between these fractions of a road. */
  encounterSpan: [0.2, 0.85] as [number, number],

  // --- New hero ---
  startEnergy: 60,
  startGold: 30,
  statStart: { min: 3, max: 7, totalMin: 18, totalMax: 22 },
  /** The Queen's gift at the start of every adventure. */
  queensGift: { gold: 100, items: ['healing_draught', 'healing_draught'] },
  starterWeapon: 'rusty_sword',
  /**
   * From level 2 the Queen's gift includes the best blade from her armory for the hero's level, if it beats
   * every weapon they carry. It keeps a hero who never shops up with `typical.power`.
   */
  armory: [
    { level: 2, item: 'knights_blade' },
    { level: 3, item: 'captains_blade' },
    { level: 5, item: 'royal_blade' },
  ],
  /**
   * Chosen in the character creator: a nudge to the rolled stats (never below 1), a starting kit, and names to
   * pick from (no typing; "Hero" is always offered too).
   */
  classes: {
    knight: {
      name: 'Knight', emoji: '🛡️', blurb: 'Strong and hardy. Starts with a leather cap.', stats: { strength: 2, magic: -1, vigor: 1, luck: -1 }, items: ['leather_cap'],
      names: ['Aldric', 'Brienne', 'Cedric', 'Elaine', 'Gawain', 'Rowena', 'Tristan', 'Wynne'],
    },
    mage: {
      name: 'Mage', emoji: '🔮', blurb: 'Potions work wonders. Starts with extra potions.', stats: { strength: -1, magic: 3, vigor: -1, luck: 0 }, items: ['healing_draught', 'fire_flask'],
      names: ['Ember', 'Lyra', 'Merrin', 'Orrin', 'Sable', 'Thorne', 'Vesper', 'Zara'],
    },
    ranger: {
      name: 'Ranger', emoji: '🏹', blurb: 'Lucky and quick. Starts with a bow and a tonic.', stats: { strength: -1, magic: -1, vigor: 1, luck: 2 }, items: ['hunting_bow', 'travelers_tonic'],
      names: ['Ash', 'Briar', 'Fenn', 'Hawk', 'Linden', 'Robin', 'Sorrel', 'Wren'],
    },
  },

  // --- Stats ---
  strength: { damage: 0.08, capacityBase: 30, capacityPer: 3 },
  magic: { potency: 0.07 },
  vigor: { hpBase: 30, hpPer: 5 },
  luck: { gold: 0.03, crit: 0.01, drops: 0.03 },
  /** A stat gains a point when its xp reaches statXpBase + the stat's value. */
  statXpBase: 3,
  trainGrowth: 0.5,

  // --- Battle ---
  battle: {
    /** Strike meter fill per second at effort 1.0 (a strike every 2.5 s). */
    strikeRate: 0.4,
    critBase: 0.1,
    critMult: 1.8,
    weakMult: 1.5,
    resistMult: 0.5,
    baneMult: 2,
    armorCap: 0.6,
    /** Seconds between enemy attacks (±20% jitter). */
    enemyInterval: 3,
    /** Seconds a typical hero at steady pace needs to win, by tier (index = tier). */
    tierSeconds: [0, 40, 55, 75, 90, 180],
    /** A typical hero survives this many times the fight length. */
    safety: 2.2,
    /** Bosses are closer fights. */
    bossSafety: 1.4,
    /** Boss attacks hit this much harder; the required armor's resistance cancels it. */
    bossUnresisted: 2,
    /**
     * A loss costs these shares of the gold carried and the banked Energy, one spare potion or treasure (never
     * anything the game still needs, so a loss can't make it unwinnable), and some ground.
     */
    loseGoldFraction: 0.2,
    loseEnergyFraction: 0.2,
    losePushback: 0.15,
    /** Fleeing costs a small toll and a little ground. */
    fleeGoldFraction: 0.05,
    fleePushback: 0.05,
    introSeconds: 2.5,
    resultSeconds: 6,
    randomLo: 0.85,
    randomHi: 1.15,
    /** Potions a fight can award Magic xp for. */
    magicXpCap: 2,
    /**
     * A win whose enemy dropped nothing may still turn up a prize: the chance by tier (index = tier; Luck helps),
     * then one of `prizes`, weighted, from those allowed at that tier.
     */
    prizeChance: [0, 0.25, 0.35, 0.5, 0.5, 0],
    prizes: [
      { item: 'healing_draught', weight: 6, tier: 1 },
      { item: 'travelers_tonic', weight: 2, tier: 1 },
      { item: 'shield_tonic', weight: 2, tier: 1 },
      { item: 'potion_of_might', weight: 2, tier: 1 },
      { item: 'goblin_trinket', weight: 2, tier: 1 },
      { item: 'sea_glass', weight: 1, tier: 1 },
      { item: 'greater_healing', weight: 2, tier: 2 },
      { item: 'quickening_elixir', weight: 1, tier: 2 },
      { item: 'crystal_shard', weight: 1, tier: 2 },
    ],
  },
  /** Gold rewards grow this much per level. */
  goldPerLevel: 0.15,

  // --- Shops ---
  sellFraction: 0.5,
  sellLuck: 0.02,

  // --- Crafting ---
  /** Seconds of steady pedaling per gold of value, for things made from pedaling alone (a Healing Draught: 60 s). */
  craftSecondsPerGold: 4,

  // --- Level up ---
  levelUpGold: 150,

  // --- Engine ---
  autosaveSeconds: 10,
  /** Engine substep, seconds. */
  tick: 0.1,
} as const

/**
 * The typical hero at level L, used to calibrate enemies (DESIGN.md §7). It grows only by what every hero is
 * sure to have: +1 to each stat per kingdom saved, and weapons up to the power the game files reliably offer.
 * Anything more (stat xp, training, tomes, better gear) makes fights shorter: that is the reward for growing.
 */
export const typical = {
  power: (level: number) => Math.min(14, 9 + 1.5 * (level - 1)),
  strength: (level: number) => 5 + (level - 1),
  vigor: (level: number) => 5 + (level - 1),
  hp: (level: number) => CONFIG.vigor.hpBase + CONFIG.vigor.hpPer * typical.vigor(level),
  dps: (level: number) =>
    CONFIG.battle.strikeRate * typical.power(level) * (1 + CONFIG.strength.damage * typical.strength(level)),
}

/** The monarch never changes, whatever the game file. */
export const KINGDOM = {
  name: 'Everwyn',
  monarch: {
    id: 'queen',
    /** How people refer to her: "the Queen". */
    title: 'Queen',
    name: 'Queen Isolde',
    emoji: '👸',
    avatar: 'kind silver-haired queen in a deep blue gown and a slim gold crown, seated on an oak throne',
  },
}
