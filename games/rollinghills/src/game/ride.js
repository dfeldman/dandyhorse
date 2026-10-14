import { Config } from './config.js'
import { bikeAccel } from './physics.js'
import { Track } from './track.js'
import { Util } from './util.js'

// The riding model, fed by what the machine MEASURES (never what the game asked for).
//
// Both machines pedal the same virtual bike, and they pedal it with EFFORT, not raw watts: how hard this
// rider is working against the steady pace they could hold all day (src/drive.ts, gamekit's EffortMeter).
// One unit of effort is REFERENCE_WATTS at the cranks, so everyone riding at their own steady pace holds
// the same speed up the same hill — the ride fits the rider instead of rewarding the fittest.
//   bike:      power / their steady watts
//   treadmill: belt speed and incline as watts (ACSM) / their steady watts. The game never commands belt
//              speed; it asks for incline, and because effort counts incline, a climb both costs the rider
//              more and pushes the bike up the hill.
// Either way the trail grade is what the game asks the machine for (as incline or grade); the
// platform scales it by the user's difficulty / incline scale and clamps it to the machine.
const Ride = (() => {
  let s = 0, v = 0, dist = 0, laps = 0, gradeOut = 0;
  let pose = Track.poseAt(0);

  // m: {effort, power, speed} measured, null = unknown (never treated as a number)
  // active=false holds the bike still (before the ride starts, while paused, after the workout)
  function update(m, dt, active = true) {
    const from = Track.poseAt(s);   // where this step begins: the slope the rider is on for its duration
    let power = null, pedaling = false;
    if (active) {
      // effort -> watts at the cranks. Nothing reading means nobody is pedalling, exactly as a missing
      // power reading did before.
      power = m.effort == null ? 0 : Math.max(0, m.effort) * Config.REFERENCE_WATTS;
      v += bikeAccel(v, from.grade, power, Config.MASS) * dt;
      if (power < 1 && v < 0.3 && from.grade >= -0.005) v = 0;   // not pedaling on the flat: stop, never creep
      pedaling = power > Config.PEDAL_POWER;
      v = Util.clamp(v, 0, Config.MAX_SPEED);
      const ds = v * dt;
      s += ds; dist += ds;
      if (s >= Track.length) { s -= Track.length; laps++; }
    } else {
      v = 0;
    }
    // Where the rider ENDS the step, which is what gets drawn. Reporting the pose the step started from
    // left the avatar short by one substep, and the substep left over from a frame is whatever is left of
    // it after the 50 ms ones — so on a machine with uneven frame times (iOS Safari) that shortfall changed
    // every frame and the rider surged and stalled against a camera that smooths it away.
    pose = Track.poseAt(s);
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
