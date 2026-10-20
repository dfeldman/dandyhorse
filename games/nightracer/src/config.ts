/**
 * Every tunable in one place. The ones marked FUN KNOB decide whether a race is exciting at a steady pace;
 * `npm run balance` shows what a change does before you look at it on screen.
 */
export const Config = {
  // --- the track -------------------------------------------------------------------------------------
  /** Mean radius of the loop (m). A lap is about 2π × this plus the wiggles: ~2.6 km. */
  TRACK_RADIUS: 380,
  LANES: 4,
  LANE_WIDTH: 3.6,
  /** Paved shoulder outside the outer lanes (m), before the barrier. */
  SHOULDER: 1.1,
  /** Tightest bend allowed (m); generation retries until every bend is at least this wide. */
  MIN_TURN_RADIUS: 48,
  /** Road centrelines of two parts of the loop that aren't neighbours stay this far apart (m). */
  ROAD_CLEARANCE: 70,
  /** Steepest road (rise per metre). */
  MAX_GRADE: 0.11,
  /** Height of the rolling ground the city sits on (m). */
  HILL_HEIGHT: 60,
  /** Crests and dips along the road on top of the ground's own hills (m). */
  ROLLER_HEIGHT: 7,
  /** Banking: radians per unit curvature (1/m), and the cap. */
  BANK_GAIN: 9,
  BANK_MAX: 0.22,
  /** How far the city extends past the loop (m). */
  CITY_MARGIN: 420,

  // --- speed -------------------------------------------------------------------------------------------
  /** Car speed at pedal 50 = the player's steady pace (m/s). 42 m/s ≈ 150 km/h, a lap in about a minute. */
  CRUISE_SPEED: 42,
  /** speed = CRUISE × effort^EXP, effort = pedal / 50. Below 1 softens slowdowns and caps sprints. FUN KNOB */
  SPEED_EXP: 0.55,
  /** Pedal is capped here (effort 2). */
  PEDAL_MAX: 100,
  ACCEL: 7,
  DECEL: 6,
  BRAKE: 18,
  /** Uphill slows every car by grade × this; downhill speeds it up. */
  HILL_EFFECT: 0.9,
  /** Tight bends slow every car by up to this share. */
  CORNER_SLOW: 0.1,

  // --- rivals (FUN KNOBS) ----------------------------------------------------------------------------------
  /** Each rival's pace as a share of cruise speed, for difficulty normal. The player needs effort ≈ pace^(1/EXP). */
  RIVALS: [
    { id: 'blue', name: 'Blue Comet', pace: 1.03, dodge: 0.55, color: '#2f7dff' },
    { id: 'gold', name: 'Goldie', pace: 0.99, dodge: 0.4, color: '#ffc21a' },
    { id: 'green', name: 'Lime Rocket', pace: 0.93, dodge: 0.3, color: '#38d45a' },
  ] as Array<{ id: string; name: string; pace: number; dodge: number; color: string; ghost?: boolean }>,
  DIFFICULTY: { easy: 0.9, normal: 1.0, hard: 1.08 } as Record<string, number>,
  /** Rivals' pace wobbles by this share, each on its own slow cycle, so positions change at a steady pace. */
  WOBBLE: 0.05,
  WOBBLE_PERIOD: [20, 38],
  /** Each race every rival is on form or off it by up to this share. */
  FORM: 0.04,
  /** The soft band: a rival more than BAND_START ahead of the player eases off, one BAND_BEHIND behind pushes on.
   *  It fades out over the last BAND_FADE of the final lap, so the run to the flag is a straight fight. */
  BAND_START: 12,
  BAND_BEHIND: 25,
  BAND_RANGE: 150,
  BAND_SLOW: 0.12,
  BAND_FADE: 0.5,
  /** Share of the band still acting at the flag. */
  BAND_FINAL: 0.35,
  /** In the band's fade every rival finds a little extra, up to this share. */
  FINALE_PUSH: 0.05,
  /** Far ahead (past BAND_FAR) a rival eases off by up to this much more, so a slow player still sees the pack. */
  BAND_FAR: 260,
  BAND_FAR_SLOW: 0.14,
  /** ...and one far behind pushes this much more. */
  BAND_FAR_PUSH: 0.1,
  BAND_PUSH: 0.14,

  // --- lanes -------------------------------------------------------------------------------------------------
  CAR_LENGTH: 4.4,
  CAR_WIDTH: 2.0,
  /** Lateral speed of a lane change (m/s). */
  LANE_SPEED: 4.2,
  /** How often a car rethinks its lane (s). */
  LANE_THINK: 0.3,
  /** Seconds of look-ahead for a slower car in the lane. */
  LOOK_AHEAD: 1.6,
  /** A car behind another in its lane tucks in to draft from this far (m) before pulling out to pass. */
  DRAFT_SEEK: 55,
  DRAFT_MIN: 3,
  DRAFT_MAX: 30,
  /** Extra speed while drafting. */
  DRAFT_BOOST: 0.06,

  // --- Turbo -----------------------------------------------------------------------------------------------
  /** The meter has SEGMENTS; each fills in CHARGE_TIME s of steady pedalling (faster when you push) and one tap
   *  spends one for TURBO_TIME s of boost. Taps stack. FUN KNOB: a tap every few seconds is the target cadence. */
  TURBO_SEGMENTS: 3,
  TURBO_CHARGE_TIME: 8,
  TURBO_TIME: 1.6,
  TURBO_MAX_STACK: 5,
  TURBO_BOOST: 0.4,
  TURBO_ACCEL: 18,
  /** Drafting fills Turbo this much faster. */
  TURBO_DRAFT_FILL: 1.8,
  /** A tap in this window around GO (s before, s after) launches a rocket start. */
  ROCKET_WINDOW: [1.6, 0.8],
  ROCKET_TIME: 2.6,

  // --- Oil ---------------------------------------------------------------------------------------------------
  OIL_CHARGES: 2,
  OIL_START_CHARGES: 1,
  /** Seconds of racing per new oil can. */
  OIL_RECHARGE: 40,
  OIL_LIFETIME: 25,
  OIL_HALF_WIDTH: 2.6,
  OIL_LENGTH: 7,
  /** Dropped this far behind the car (m). */
  OIL_DROP_BACK: 3.5,
  /** A rival behind in the player's lane within this range (m) is a target: the Oil button pulses. */
  OIL_RANGE: [5, 45],
  /** Rivals closer than this when the slick lands can't dodge it. */
  OIL_REACT: 13,
  SPIN_TIME: 2.2,
  SPIN_SPEED: 0.25,

  // --- rival items ---------------------------------------------------------------------------------------------
  RIVAL_TURBO_CHARGE_TIME: 9,
  RIVAL_ROCKET_CHANCE: 0.45,

  // --- the series ------------------------------------------------------------------------------------------------
  POINTS: [10, 7, 5, 3],
  MAX_LAPS: 3,
  INTRO_TIME: 4,
  COUNTDOWN_TIME: 3,
  RESULTS_TIME: 7,
  STANDINGS_TIME: 6,
  /** Seconds between races that don't count toward the laps estimate. */
  RACE_OVERHEAD: 22,
  DEFAULT_MINUTES: 30,

  // --- the simulation ---------------------------------------------------------------------------------------------
  /** Longest simulation substep (s), and the most wall-clock time caught up in one frame. */
  MAX_STEP: 0.05,
  MAX_CATCH_UP: 2,
} as const

export type Difficulty = 'easy' | 'normal' | 'hard'

/** Half the paved width, barrier to barrier. */
export const ROAD_HALF = (Config.LANES * Config.LANE_WIDTH) / 2 + Config.SHOULDER

/** Lateral offset of lane i's centre (m, + is right). */
export const laneCenter = (i: number): number => (i - (Config.LANES - 1) / 2) * Config.LANE_WIDTH
