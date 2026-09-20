import { Config } from './config.js'
import { Track } from './track.js'
import { Util } from './util.js'

// The riding model, fed by what the machine MEASURES (never what the game asked for).
//   bike:      measured power against gravity (grade), rolling resistance and drag -> virtual speed
//   treadmill: the belt speed the user chose IS the speed (smoothed a little for the eye);
//              the game never commands belt speed.
// Either way the trail grade is what the game asks the machine for (as incline or grade); the
// platform scales it by the user's difficulty / incline scale and clamps it to the machine.
const Ride = (() => {
  const g = 9.81;
  let s = 0, v = 0, dist = 0, laps = 0, gradeOut = 0;
  let pose = Track.poseAt(0);
  const isBike = () => Config.DEVICE_TYPE === 'bike';

  // m: {power, speed} measured, null = unknown (never treated as a number)
  // active=false holds the bike still (before the ride starts, while paused, after the workout)
  function update(m, dt, active = true) {
    pose = Track.poseAt(s);
    let power = null, pedaling = false;
    if (active) {
      const theta = Math.atan(pose.grade);
      if (isBike()) {
        power = m.power == null ? 0 : m.power;
        const fProp = power / Math.max(v, 1.5);
        const fGrav = -Config.MASS * g * Math.sin(theta) * Config.GRAVITY_SCALE;
        const fRoll = -Config.MASS * g * Config.ROLLING * Math.cos(theta) * (v > 0 ? 1 : 0);
        const fDrag = -Config.DRAG * v * Math.abs(v);
        v += (fProp + fGrav + fRoll + fDrag) / Config.MASS * dt;
        if (power < 1 && v < 0.3 && pose.grade >= -0.005) v = 0;   // not pedaling on the flat: stop, never creep
        pedaling = power > Config.PEDAL_POWER;
      } else {
        const belt = m.speed == null ? 0 : m.speed;
        v += (belt - v) * (1 - Math.exp(-dt / Config.SPEED_TAU));
        if (belt <= 0 && v < 0.05) v = 0;
        pedaling = v > 0.2;
      }
      v = Util.clamp(v, 0, Config.MAX_SPEED);
      const ds = v * dt;
      s += ds; dist += ds;
      if (s >= Track.length) { s -= Track.length; laps++; }
    } else {
      v = 0;
    }
    // the request to the machine: the trail grade in percent, smoothed and stepped
    const target = pose.grade * 100;
    gradeOut += (target - gradeOut) * (1 - Math.exp(-dt / Config.GRADE_TAU));
    const request = Math.round(gradeOut / Config.GRADE_STEP) * Config.GRADE_STEP;
    return { s, v, pose, dist, laps, power, pedaling, grade: pose.grade, request };
  }

  function reset() { s = 0; v = 0; dist = 0; laps = 0; }
  function setS(val) { s = ((val % Track.length) + Track.length) % Track.length; }   // debug
  return { update, reset, setS, get s() { return s; }, get v() { return v; }, get pose() { return pose; }, get dist() { return dist; }, get laps() { return laps; } };
})();

export { Ride }
