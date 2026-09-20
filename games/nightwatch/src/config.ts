/**
 * Every tunable in one place. The ones marked FUN KNOB decide whether a night feels tense at a steady pace;
 * `npm run balance` shows what a change does before you look at it on screen.
 *
 * Effort is in pedal units throughout: 0–100, where 50 is the player's steady pace (the platform's EffortMeter × 50).
 */
export type Difficulty = 'easy' | 'normal' | 'hard'
export type WeatherMode = 'calm' | 'mixed' | 'wild'

export const Config = {
  DEFAULT_MINUTES: 30,
  /** Longest simulation substep (s), and the most wall-clock time one frame may catch up. */
  MAX_STEP: 1 / 30,
  MAX_CATCH_UP: 0.25,

  // --- the clock -----------------------------------------------------------------------------------------
  /** The workout is one night: the clock runs from dusk at NIGHT_START to dawn NIGHT_HOURS later. */
  NIGHT_START_HOUR: 20,
  NIGHT_HOURS: 10,
  /** The sky starts to lighten this long before the end (s). */
  DAWN_TIME: 75,

  // --- effort → the lamp --------------------------------------------------------------------------------------
  PEDAL_MAX: 100,
  STEADY: 50,
  /** The lamp's flywheel: seconds to close ~63% of the gap to the pedal, speeding up and coasting down. */
  FLY_UP: 0.9,
  FLY_DOWN: 1.8,
  /** What each ship needs, by level 1–4 (index 0 unused). A player at steady pace (50) lights levels 1–2 fully. FUN KNOB */
  LEVELS: [0, 40, 50, 57, 64],
  /** The lamp's target between ships: an easy walk keeps it lit. */
  REST_TARGET: 25,
  /** The lamp is fully bright at the target and dark this far below it (only the look; drift uses DRIFT_CURVE). */
  LAMP_FADE: 18,
  /** When a watch starts, the target climbs from rest to the ship's need over this long (s). */
  TARGET_RAMP: 5,
  /** Weather raises a ship's need by this much (pedal units). */
  WEATHER_NEED: { clear: 0, mist: 1, rain: 2, fog: 4, storm: 3 } as Record<string, number>,
  /** Scales how far every need sits above the rest target. */
  DIFFICULTY: { easy: 0.88, normal: 1.0, hard: 1.08 } as Record<string, number>,

  // --- ships drifting (FUN KNOBS) ---------------------------------------------------------------------------------
  /**
   * How far off the leading line a ship wanders (channel half-widths; 1 = on the rocks) against how far the lamp's
   * power is below its need (pedal units), linear between points. A ship heads for that line at a steady pace, so the
   * outcome depends on how dim the lamp is, not on how long the ship happens to be. On the need, it holds the line;
   * 3 short it wobbles (usually still three stars); 7 short (steady 50 on a strong ship) it wanders but gets by; 10 short
   * it scrapes; 14 short (steady 50 on a sprint) it's pinned on the rocks.
   */
  DRIFT_LINE: [[0, 0], [1, 0.03], [3, 0.28], [5, 0.5], [7, 0.75], [10, 1.05], [14, 1.25]] as [number, number][],
  /** Seconds to close ~63% of the gap to that line, going out (in the channel; the approach is slower) and back. */
  DRIFT_TIME_OUT: 14,
  DRIFT_TIME_BACK: 6,
  /** Speed limits (half-widths per second). */
  DRIFT_MAX_OUT: 0.12,
  DRIFT_MAX_BACK: 0.16,
  /** Each pedal unit above the need brings a ship back this much faster. */
  SURPLUS_BACK: 0.01,
  /** Recovery speed while the horn holds ships steady. */
  RECOVER: 0.14,
  /** A ship's drift speed follows the light with this lag (s): a two-second dip must not cost a star. */
  DRIFT_TAU: 2.2,
  /** Far out, a ship drifts out this many times slower (it has sea room). */
  APPROACH_DRIFT: 0.6,
  /** Out on the approach a ship can't reach the rocks. */
  APPROACH_CAP: 0.95,
  /** Storm gusts push ships by up to this much (half-widths per second), much less when the lamp is at its need. */
  GUST: 0.07,
  /** Most a ship can be pushed onto the rocks. */
  DRIFT_CAP: 1.25,
  /** Hull lost per second hard on the rocks (1 = aground); a quarter of that just touching them. */
  SCRAPE_RATE: 0.09,
  /** Three stars: drift never went past this. */
  STAR3_DRIFT: 0.42,
  /** The HUD warns once a ship drifts past this. */
  WARN_DRIFT: 0.5,

  // --- the horn -------------------------------------------------------------------------------------------------
  STEAM_START: 1,
  STEAM_MAX: 3,
  /** Steam builds from effort above max(target, STEAM_FLOOR): charges per second per pedal unit of surplus. FUN KNOB */
  STEAM_RATE: 0.0035,
  STEAM_FLOOR: 46,
  /** A blast pulls every watched ship this far back toward the line... */
  HORN_KICK: 0.5,
  /** ...and holds them steady this long (s). */
  HORN_CALM: 3,
  /** A blast only spends steam if some ship has drifted at least this far. */
  HORN_MIN_DRIFT: 0.12,
  HORN_COOLDOWN: 1.2,

  // --- hails ----------------------------------------------------------------------------------------------------
  /** A ship on watch may flash its signal lamp; tap the horn within the window to answer (never a penalty). */
  HAIL_CHANCE: 0.65,
  HAIL_WINDOW: 7,

  // --- the schedule -----------------------------------------------------------------------------------------------
  /** The first watch starts this far into the night (s). */
  WARMUP: 40,
  /** The last watch ends at least this long before dawn (s). */
  COOLDOWN: 45,
  /** A ship shows on the horizon (and sails in) this long before its watch (s). */
  HEADS_UP: 35,
  /** The target shows as a ghost mark on the lamp gauge this long before a watch (s). */
  GHOST_TIME: 12,
  /** Share of a watch spent on the approach; the rest is the channel between the rocks. */
  APPROACH_SHARE: 0.35,
  /** From the channel's end to the mooring (s). */
  HARBOR_TIME: 26,
  /** Watch length by level (s): harder ships are shorter. */
  WATCH_BY_LEVEL: [[0, 0], [95, 150], [75, 120], [55, 90], [42, 60]] as [number, number][],
  /** Rest after a ship: REST_BASE + REST_PER_LEVEL × level, ± REST_JITTER (s). */
  REST_BASE: 16,
  REST_PER_LEVEL: 10,
  REST_JITTER: 6,
  /** Shortest watch the schedule will squeeze in at the end. */
  MIN_WATCH: 42,
  /** Level weights by stage of the night [warm-up, build, peak, wind-down] for levels 1–4. FUN KNOB */
  LEVEL_WEIGHTS: [
    [1, 0, 0, 0],
    [1, 3, 2, 0.4],
    [0.4, 2, 3, 2],
    [1.5, 3, 1.2, 0.4],
  ],
  STAGE_ENDS: [0.1, 0.35, 0.8, 1],
  /** The big ship: a long level-3 watch around this share of the night (only in workouts of BIG_ONE_MINUTES+). */
  BIG_ONE_AT: 0.55,
  BIG_ONE_MINUTES: 15,
  BIG_ONE_WATCH: [125, 150] as [number, number],
  /** On hard, a second ship may follow close behind one in the last part of the night (a convoy). */
  CONVOY_FROM: 0.62,
  CONVOY_CHANCE: 0.45,
  CONVOY_GAP: [18, 30] as [number, number],

  // --- the harbour ------------------------------------------------------------------------------------------------
  MOORINGS: 6,
  /** An aground ship waits this long, then a tug tows it in over TOW_TIME (s). */
  TOW_DELAY: 18,
  TOW_TIME: 30,
  /** A moored ship leaving to make room takes this long to sail out of sight (s). */
  LEAVE_TIME: 40,

  // --- weather ----------------------------------------------------------------------------------------------------
  /** Weather spells per 10 minutes, by launch option. */
  WEATHER_RATE: { calm: 0.5, mixed: 0.9, wild: 1.5 } as Record<string, number>,
  WEATHER_LEN: [90, 220] as [number, number],
  WEATHER_FADE: 25,

  // --- score ------------------------------------------------------------------------------------------------------
  STAR_POINTS: 100,
  HAIL_POINTS: 50,
  /** Each three-star ship in a row adds this × the streak (counted up to STREAK_CAP). */
  STREAK_POINTS: 25,
  STREAK_CAP: 8,
}
