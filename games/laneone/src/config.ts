/**
 * Every tunable in one place. The ones marked FUN KNOB decide how a programme feels; `npm run programs`
 * prints each one's profile as a chart so a change can be checked without opening a browser.
 *
 * The model is SI throughout: m/s, percent, watts, seconds. Display units are applied at the screen only.
 */
import type { UnitSystem } from './units.ts'

export const Config = {
  // --- the clock ----------------------------------------------------------------------------------------
  DEFAULT_MINUTES: 30,
  /** Longest simulation substep (s), and the most wall-clock a frame may catch up after a throttled tab. */
  MAX_STEP: 1 / 30,
  MAX_CATCH_UP: 2,

  // --- the base the ± buttons set -----------------------------------------------------------------------
  /** Where a treadmill session starts: a brisk walk, and flat. */
  BASE_SPEED: 1.56, // m/s ≈ 5.6 km/h ≈ 3.5 mph
  BASE_INCLINE: 0,
  /** Where a bike session starts, if the player's steady watts are unknown. */
  BASE_POWER: 130, // W, the platform's default steady pace
  BASE_GRADE: 0,
  /**
   * What the base may be. A hill trim may go negative — that is how a one-touch INCLINE key can flatten a
   * programme's climb — because what is finally *sent* is clamped separately, below.
   */
  BASE_RANGE: {
    speed: [0, 6.7],
    incline: [-15, 15],
    power: [30, 600],
    grade: [-15, 15],
  } as Record<'speed' | 'incline' | 'power' | 'grade', [number, number]>,

  /** Limits on what the console will ask a machine for. The bridge clamps again for the real device. */
  SPEED_RANGE: [0, 6.7] as [number, number], // m/s, 0–24 km/h ≈ 0–15 mph
  INCLINE_RANGE: [0, 15] as [number, number], // percent
  GRADE_RANGE: [-5, 15] as [number, number], // percent
  POWER_RANGE: [30, 600] as [number, number], // W

  /** Button steps, in the units the player reads. A console steps 0.1 mph or 0.1 km/h, never SI. */
  STEP: {
    speed: { metric: 0.1, us: 0.1 } as Record<UnitSystem, number>, // km/h or mph
    incline: 0.5, // percent
    grade: 0.5, // percent
    power: 5, // W
  },
  /** The one-touch buttons, in display units: a console's 3 / 5 / 7 speed keys and 0 / 2 / 4 / 6 incline keys. */
  QUICK: {
    speed: { metric: [4, 6, 8, 10], us: [2, 3, 4, 5] } as Record<UnitSystem, number[]>,
    incline: [0, 2, 4, 6, 8],
    grade: [0, 2, 4, 6, 8],
    powerFactor: [0.6, 0.8, 1.0, 1.2, 1.5],
  },

  // --- programmes ---------------------------------------------------------------------------------------
  /** Warm-up and cool-down: this share of the workout, held between these many seconds. */
  WARMUP: { share: 0.12, min: 120, max: 300 },
  COOLDOWN: { share: 0.1, min: 90, max: 240 },
  /** On a short workout the ends are squeezed so the middle keeps at least this share. */
  MIDDLE_MIN_SHARE: 0.3,
  /** Level 1–10 scales how far a programme swings from the base; 5 is the printed profile. FUN KNOB */
  LEVEL_DEFAULT: 5,
  LEVEL_RANGE: [1, 10] as [number, number],
  /** A level 10 programme swings this many times as far from the base as level 5; level 1, this little. */
  LEVEL_SCALE: { 1: 0.4, 5: 1, 10: 1.7 } as Record<number, number>,

  // --- turning one dial into another (drive.ts) -----------------------------------------------------------
  /**
   * A machine that can only change one thing has to take the whole programme through it.
   * FUN KNOBS, all three: they set how hard a hill or an interval lands on each kind of machine.
   */
  /** Treadmill, incline only: each 1.00 of extra effort becomes this much incline (percent). */
  EFFORT_TO_INCLINE: 6,
  /** Bike, grade only: each 1.00 of extra effort becomes this much grade (percent). */
  EFFORT_TO_GRADE: 4,
  /** Bike, ERG: each 1 % of programmed grade becomes this much extra power (fraction). */
  GRADE_TO_POWER: 0.06,

  // --- heart-rate programmes -------------------------------------------------------------------------------
  HR: {
    /** With nothing set: resting 60 bpm, and 208 − 0.7 × age for the maximum. */
    DEFAULT_RESTING: 60,
    DEFAULT_MAX: 180,
    /** How often the console may move the base to chase the target (s). A console adjusts slowly on purpose. */
    ADJUST_EVERY: 20,
    /** One adjustment, as a fraction of the base. FUN KNOB */
    ADJUST_STEP: 0.04,
    /** Inside this many bpm of the target, leave it alone. */
    DEADBAND: 4,
    /** Never move the base further than this from where the player set it. */
    AUTHORITY: [0.6, 1.6] as [number, number],
  },

  // --- the track ---------------------------------------------------------------------------------------
  /** The player runs in lane 1; the pace marker that shows the programme's target runs in lane 3. */
  PLAYER_LANE: 1,
  TARGET_LANE: 3,
  /** A split is recorded every lap and at every segment change. */
  SPLIT_ON_LAP: true,

  // --- the screen ----------------------------------------------------------------------------------------
  /** Readouts are rewritten at this rate; the track animates every frame. */
  READOUT_HZ: 5,
  /** How long a "target reached" flash lasts (s). */
  FLASH: 1.2,
}
