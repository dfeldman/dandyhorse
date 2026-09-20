import { Config } from './config.js'

// How a body moves along the trail. The player's ride (src/game/ride.js) and everyone else on the trail
// (src/game/traffic.js) share these, so there is one model of what a hill costs, not two that drift apart.
const G = 9.81;

/**
 * Acceleration (m/s^2) of a rider of `mass` kg putting out `power` W at `v` m/s on a slope of `grade`
 * (rise/run): the pedals against gravity, rolling resistance and drag.
 */
function bikeAccel(v, grade, power, mass, gravityScale = Config.GRAVITY_SCALE) {
  const theta = Math.atan(grade);
  const fProp = power / Math.max(v, 1.5);   // the chain can't push infinitely hard from a standstill
  const fGrav = -mass * G * Math.sin(theta) * gravityScale;
  const fRoll = -mass * G * Config.ROLLING * Math.cos(theta) * (v > 0 ? 1 : 0);
  const fDrag = -Config.DRAG * v * Math.abs(v);
  return (fProp + fGrav + fRoll + fDrag) / mass;
}

/**
 * The speed a runner holds on a slope, given the `base` speed they hold on the flat at the same effort.
 * Running costs about 6% more per 1% of climb, so a 10% wall halves the pace; a gentle descent is a
 * little quicker than the flat, and a steep one is slower again because it is braking, not running.
 */
function runSpeed(base, grade) {
  const g = Math.max(-0.3, Math.min(0.3, grade));
  const cost = g >= 0 ? 1 + 6.0 * g : 1 + 1.6 * g + 22 * g * g;
  return base / Math.max(0.9, cost);
}

/**
 * Whether a rider is freewheeling: once a descent is carrying them along faster than they would ride on
 * the flat, they stop pedalling and let it. `cruise` is the speed their effort holds on the level. The
 * two thresholds are hysteresis, so a rider on a shallow grade doesn't flicker in and out of pedalling.
 *
 * (A runner has no equivalent: there is no coasting on foot, which is why gravity buys them so little.)
 */
function freewheeling(wasCoasting, grade, v, cruise) {
  if (grade > -0.01) return false;
  return v > cruise * (wasCoasting ? 0.95 : 1.02);
}

/** The speed `power` watts holds on the flat for a rider of `mass` kg: where the forces balance. */
function cruiseSpeed(power, mass) {
  let v = 8;
  for (let i = 0; i < 4000; i++) v = Math.max(0.5, v + bikeAccel(v, 0, power, mass) * 0.02);
  return v;
}

export { bikeAccel, runSpeed, freewheeling, cruiseSpeed };
