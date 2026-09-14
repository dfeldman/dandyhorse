// All game tunables in one place.
// On Dandyhorse the pedal value is the rider's effort: 50 x power / steady power (src/platform.ts), so
// NEUTRAL_INPUT, the pedal that holds level flight, is riding at steady. The ring layout, the cue and the
// boosts are sized for the lag between the pedals and the plane: PLAYABILITY.md.
const Config = {
  // --- Input ---
  NEUTRAL_INPUT: 50,          // pedal value for level flight
  INPUT_TAU: 0.25,            // seconds, low-pass on raw pedal input
  KEY_RATE: 45,               // pedal units/sec when holding arrow keys

  // --- Track / pacing ---
  TRACK_RADIUS: 420,          // meters
  LAP_SECONDS: 220,           // one lap ~3.7 min
  NUM_RINGS: 14,              // 176 m (15 s) apart: time to change height through the lag (was 25)
  RING_PHASE: 0.7,            // rings sit at (i + RING_PHASE) * spacing
  RUNWAY_LEN: 100,            // meters of ground roll before the circle joins

  // --- Flight model ---
  MAX_PITCH: 25 * Math.PI / 180,  // radians at pedal 0 or 100
  PITCH_TAU: 1.2,             // seconds, pitch response lag
  ROLL_TAU: 0.8,
  BANK_RAD: 5 * Math.PI / 180,    // subtle constant inward bank on the circle
  MIN_ALT: 40,
  MAX_ALT: 175,
  ALT_BLEND: 25,              // soft floor/ceiling blend distance
  TAKEOFF_ACCEL: 1.8,         // m/s^2 ground roll
  TAKEOFF_PITCH: 12 * Math.PI / 180,
  LIFTOFF_S: -35,             // track param where the nose comes up

  // --- Rings (sized for the lag: PLAYABILITY.md) ---
  RING_MIN_ALT: 45,
  RING_MAX_ALT: 160,
  RING_STEP_MAX: 20,          // max altitude change between consecutive rings (was 35)
  RING_RADIUS: 10,            // torus radius (meters): the gold window, drawn (was 7)
  RING_HIT_TOL: 9,            // |planeAlt - ringAlt| to count a gold pass (was 6)
  RED_RING_HIT_TOL: 6,        // red rings: smaller, worth more
  RING_LOW_COUNT: 5,          // first rings of the game stay low over the city
  RING_LOW_MAX: 60,
  CUE_LEAD: 3,                // seconds: the HUD cue judges where the plane will be, not where it is

  // --- Workout ---
  WORKOUT_SECONDS: 30 * 60,
  DEFAULT_LEVEL: 'isla-uno',

  // --- Trainer resistance output (0-100, displayed always; the real
  // trainer will consume it via window.onResistanceChange).
  // Resistance is a steady base level; the ONLY in-game modifier is the
  // stackable Tailwind pickup (-10% each, 20 s). ---
  RESIST_BASE: 45,
  RESIST_TAKEOFF: 25,
  RESIST_MIN: 5,
  RESIST_MAX: 95,
  RESIST_TAU: 0.6,            // seconds, smoothing so the trainer isn't jerky
  TAILWIND_FACTOR: 0.9,       // each active tailwind multiplies resistance
  TAILWIND_SECONDS: 20,
  TAILWIND_CHANCE: 0.18,      // pickup roll share (fairly common)

  // --- Turbo (streak-powered fever mode) ---
  TURBO_SEGMENTS: 6,          // ring hits to fill the meter
  TURBO_SECONDS: 15,
  TURBO_SPEED: 0.15,          // ground-speed bonus while active (was 0.35: with the ring pulses, +25% at most)
  TURBO_SCORE_MULT: 2,

  // --- Ring-hit speed pulses (small surge on every hit) ---
  BOOST_RING: 0.05,           // was 0.12
  BOOST_MAX: 0.10,            // was 0.24
  BOOST_TAU: 3,               // seconds, pulse decay

  // --- NPC pylon races ---
  RACE_EVERY_LAPS: 2,         // rest laps between races (first race on lap 2)
  RACE_LAPS: 1,               // race length in laps (short and punchy)
  RACE_MIN_TIME: 480,         // don't start one with less than this left (s)
  RACE_POINTS: [1000, 500, 250, 100],

  // --- Scoring / ring & pickup variety ---
  RING_SCORE: 100,
  STREAK_BONUS: 25,
  RED_RING_CHANCE: 0.15,      // rare, smaller, worth more
  RED_RING_SCORE: 300,
  RED_RING_RADIUS: 7,         // drawn around the ±6 m window (was 5)
  STAR_CHANCE: 0.17,          // pickup: +1 pass to forgive a missed ring
  STAR_SCORE: 50,
  MAX_PASSES: 3,
  BALLOON_CHANCE: 0.13,       // pickup: 10 s of extra float
  FLOAT_SECONDS: 10,
  FLOAT_BONUS: 0.35,          // added to effort (-1..1) while floating
  PICKUP_TOL: 9,              // altitude tolerance to collect a pickup (balloon spans ~9m)

  // --- World ---
  ISLAND_SIZE: 1800,          // ground mesh side
  WATER_SIZE: 5000,
  CITY_R_MIN: 250,
  CITY_R_MAX: 540,
  BLOCK_GRID: 64,             // street grid pitch (streets on the lines)
  ROAD_W: 10,
  NUM_CARS: 110,
  BUILDING_MIN_H: 8,
  BUILDING_MAX_H: 34,
  PLATEAU_H: 4,               // island plateau height above water (y=0)

  // --- Camera ---
  CAM_BACK: 20,
  CAM_UP: 6,
  CAM_TAU: 0.35,
  CAM_LOOKAHEAD: 15,
  CAM_INWARD: 9,              // meters of lateral look-target bias toward the
                              // island center — peeks into the turn so the
                              // park landmarks appear on screen
};

Config.SPEED = (2 * Math.PI * Config.TRACK_RADIUS) / Config.LAP_SECONDS; // ~12 m/s

// Quaternion rotating unit vector `from` to unit vector `to`
// (BABYLON.Quaternion.FromUnitVectors is not in every build).
function quatFromTo(from, to) {
  const q = new BABYLON.Quaternion();
  if (BABYLON.Quaternion.FromUnitVectorsToRef) {
    BABYLON.Quaternion.FromUnitVectorsToRef(from, to, q);
    return q;
  }
  const d = BABYLON.Vector3.Dot(from, to);
  if (d > 0.99999) return BABYLON.Quaternion.Identity();
  if (d < -0.99999) return new BABYLON.Quaternion(1, 0, 0, 0); // 180° about X
  const axis = BABYLON.Vector3.Cross(from, to);
  q.set(axis.x, axis.y, axis.z, 1 + d);
  q.normalize();
  return q;
}
Config.CIRCUMFERENCE = 2 * Math.PI * Config.TRACK_RADIUS;
Config.RING_SPACING = Config.CIRCUMFERENCE / Config.NUM_RINGS;
