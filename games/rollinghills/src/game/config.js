// All game tunables in one place. Ported from bikebike (../../bikebike) to Dandyhorse:
// the platform adapter (src/main.ts) publishes the session's seed, route, device type and
// preferences on window.RH_START before these scripts load (see config block at the bottom).
const Config = {
  // --- Session (filled from window.RH_START) ---
  DEVICE_TYPE: 'bike',        // 'bike' | 'treadmill'
  DEBUG: false,               // debug session: weather / time-of-day keys enabled

  // --- World / generation ---
  SEED: 1,                    // overridden by ?seed=
  MAP_SIZE: 2400,             // meters, square map centered on origin
  TERRAIN_STEP: 5,            // meters between terrain vertices
  TERRAIN_CHUNKS: 10,         // chunks per side (frustum culling)
  WATER_Y: 0,                 // sea level (terrain noise is centered above it)
  TRAIL_RADIUS: 560,          // mean loop radius (loop ~3.5 km)
  TRAIL_WIDTH: 4.5,           // meters, ribbon width
  TRAIL_LIFT: 0.06,           // the trail surface rides this far above Track's profile; the rider stands on it
  CORRIDOR: 22,               // meters, terrain blends toward the trail within this
  MAX_GRADE: 0.13,            // cap on trail slope (13%), overridden by the route preset
  // Route presets (?route=flat|rolling|hilly): terrain relief multiplier and grade cap
  ROUTES: {
    flat:    { relief: 0.5, maxGrade: 0.05, label: 'Flat' },
    rolling: { relief: 1.0, maxGrade: 0.09, label: 'Rolling' },
    hilly:   { relief: 1.35, maxGrade: 0.13, label: 'Hilly' },
  },
  ROUTE_NAME: 'rolling',
  BRIDGE_DECK: 3.5,           // deck height above water
  NUM_BASINS: 3,              // lakes forced onto the loop (=> bridges)

  // --- Riding model ---
  MASS: 85,                   // kg, bike + rider
  GRAVITY_SCALE: 0.55,        // <1 softens hills for fun (resistance still tracks true grade)
  MAX_POWER: 420,             // watts at pedal 100
  ROLLING: 0.006,             // rolling resistance coefficient
  DRAG: 0.32,                 // 0.5*rho*Cd*A (kg/m)
  MAX_SPEED: 22,              // m/s hard cap (~80 km/h downhill)
  PEDAL_POWER: 10,            // watts above which the cranks turn (bike)
  START_POWER: 10,            // watts that start the ride (bike)
  START_SPEED: 0.3,           // m/s belt speed that starts the ride (treadmill)
  SPEED_TAU: 0.5,             // seconds, smoothing of the 1 Hz belt speed for the eye (treadmill)
  WHEEL_RADIUS: 0.34,         // meters
  GEAR_RATIO: 2.7,            // wheel revs per crank rev

  // --- Camera ---
  CAM_BACK: 5.6,
  CAM_UP: 2.6,
  CAM_SIDE: 2.2,              // max sideways offset so the bike reads in 3/4 view
  CAM_SWAY_PERIOD: 40,        // seconds for one slow sway cycle
  CAM_LOOK_AHEAD: 7,
  CAM_TAU: 0.25,
  BIKE_SCALE: 1.2,            // cartoon presence
  CAM_FOV: 0.95,
  CAM_FOV_SPEED: 0.12,        // extra FOV at max speed (speed feel)

  // --- Day / night ---
  DAY_CYCLE: 420,             // seconds for a full day (?time=day|dusk|night|dawn, keys 5-8)
  START_TIME: 'day',

  // --- Visual polish ---
  SHADOWS: true,              // cascaded sun shadows near the bike (?shadows=0 to disable)
  SHADOW_MAP: 1536,
  SHADOW_MAX_Z: 120,

  // --- What we ask the machine for: the trail grade in percent ---
  // (the platform scales it by the user's difficulty / incline scale and clamps it to the machine)
  GRADE_TAU: 0.6,             // seconds, smoothing so a 1 Hz request does not chatter
  GRADE_STEP: 0.5,            // percent, resolution of the request

  // --- Company on the trail ---
  TRAFFIC: 5,                 // other riders/runners out there (0 for an empty trail)

  // --- Workout ---
  WORKOUT_SECONDS: 30 * 60,
};

// Seed, route and preferences must be applied before terrain/track evaluate (they seed at load).
// window.RH_START comes from the platform adapter; ?seed=&route=&time=&shadows= work when the
// game is opened on its own.
{
  const q = new URLSearchParams(location.search);
  const S = window.RH_START || {};
  if (S.seed != null) Config.SEED = S.seed >>> 0; else if (q.has('seed')) Config.SEED = Number(q.get('seed')) >>> 0;
  const route = S.route || q.get('route');
  if (route && Config.ROUTES[route]) Config.ROUTE_NAME = route;
  Config.ROUTE = Config.ROUTES[Config.ROUTE_NAME];
  Config.MAX_GRADE = Config.ROUTE.maxGrade;
  if (S.shadows === false || q.get('shadows') === '0') Config.SHADOWS = false;
  if (S.timeOfDay) Config.START_TIME = S.timeOfDay; else if (q.has('time')) Config.START_TIME = q.get('time');
  if (S.deviceType) Config.DEVICE_TYPE = S.deviceType;
  if (S.duration > 0) Config.WORKOUT_SECONDS = S.duration;
  if (S.weightKg > 0) Config.MASS = S.weightKg + 10;   // rider + a 10 kg bike
  Config.DEBUG = !!S.debug;
}

export { Config }
