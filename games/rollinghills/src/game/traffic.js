import { GeometryService, randomSpec, suggestQuality } from '@dandyhorse/avatarkit'
import { Config } from './config.js'
import { bikeAccel, cruiseSpeed, freewheeling, runSpeed } from './physics.js'
import { Rider } from './rider.js'
import { Rng } from './rng.js'
import { Track } from './track.js'
import { Util } from './util.js'

// Other people out on the trail: a few strangers with random bodies and a pace of their own, riding or
// running the same loop. They are scenery, not competition — nobody drafts, nobody swerves, and the
// player rides straight through anyone directly ahead, which is why everybody else keeps to one side.
//
// They hold their own effort, not their own speed, so the hills sort them out: the same rider who came
// past on the flat is the one you reel in on the climb.

const AHEAD = 420;      // meters: beyond this in front, bring them round behind
const BEHIND = -90;     // meters: dropped this far back, move them up the road out of sight
const LANE = 1.35;      // meters right of the centre line (the player rides the middle)
// Only the stretch of road the player can actually see is drawn: the camera sits about 6 m back, and a
// rider 250 m up the trail is a few pixels, usually round a bend. The rest keep rolling undrawn.
const SEEN_BACK = -22, SEEN_AHEAD = 250;

/** Shortest signed distance from b to a around the loop. */
function gap(a, b) {
  const L = Track.length;
  let d = (a - b) % L;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  return d;
}

const Traffic = (() => {
  /**
   * opts:
   *   count    how many strangers (default Config.TRAFFIC)
   *   startS   where the player starts, so nobody is built on top of them
   */
  function create(scene, opts = {}) {
    const count = opts.count ?? Config.TRAFFIC;
    const list = [];
    if (count <= 0) return { update() {}, riders: list, ready: Promise.resolve() };
    const rng = Rng.stream('traffic');
    const riding = Config.DEVICE_TYPE === 'bike';
    // one queue for all of them: the service builds a body at a time, and the player has their own
    const service = new GeometryService();
    // a step below the player: half a dozen bodies at full detail is a lot to ask of a middling GPU
    const player = opts.quality ?? suggestQuality(scene.getEngine());
    const quality = player === 'high' ? 'medium' : 'low';
    const startS = opts.startS ?? 0;

    for (let i = 0; i < count; i++) {
      const n = {
        // spread around the road ahead and behind, nobody on the start line
        s: startS + rng.range(-70, 360) + i * 40,
        v: 0,
        lane: LANE + rng.range(-0.3, 0.3),
        // what they can hold all day: watts on a bike, meters per second on foot
        effort: riding ? rng.range(115, 265) : rng.range(2.3, 4.3),
        mass: rng.range(72, 96),
        cruise: 0,       // the speed their effort holds on the flat: past it downhill, they freewheel
        coasting: false,
        seen: true,
        rider: null,
      };
      n.cruise = riding ? cruiseSpeed(n.effort, n.mass) : n.effort;
      n.v = riding ? n.cruise : n.effort;
      n.rider = Rider.create(scene, {
        name: 'other' + i,
        spec: randomSpec(Math.floor(rng.range(1, 1e9))),
        service,
        quality,
        offset: n.lane,
        extras: false,
        color: rng.pick(['#3d8bff', '#38c172', '#ff8c42', '#a86bff', '#ffd42a', '#ff5a5a', '#22d3ee']),
      });
      list.push(n);
    }

    /** dt seconds, with the player at arc length playerS. */
    function update(dt, playerS) {
      for (const n of list) {
        const pose = Track.poseAt(n.s);
        if (riding) {
          // nobody pedals down a hill that is already taking them faster than they ride on the flat
          n.coasting = freewheeling(n.coasting, pose.grade, n.v, n.cruise);
          const power = n.coasting ? 0 : n.effort;
          n.v = Util.clamp(n.v + bikeAccel(n.v, pose.grade, power, n.mass) * dt, 1.2, Config.MAX_SPEED);
        } else {
          // a runner settles into the new pace over a few strides rather than changing speed on the line
          const target = runSpeed(n.effort, pose.grade);
          n.v += (target - n.v) * (1 - Math.exp(-dt / 2.5));
        }
        n.s += n.v * dt;
        const d = gap(n.s, playerS);
        // recycling happens out of sight: dropped far behind, they turn up somewhere up the road; far
        // enough ahead, they come round behind for the player to catch later
        if (d < BEHIND) n.s = playerS + rng.range(240, 400);
        else if (d > AHEAD) n.s = playerS + rng.range(-160, -70);
        const seen = d > SEEN_BACK && d < SEEN_AHEAD;
        if (seen !== n.seen) { n.seen = seen; n.rider.setEnabled(seen); }
        if (seen) n.rider.update(pose, n.v, riding && !n.coasting ? 100 : 0, dt);
      }
    }

    const ready = Promise.all(list.map((n) => n.rider.ready));
    return { update, riders: list, ready, dispose() { for (const n of list) n.rider.dispose(); service.dispose(); } };
  }

  return { create };
})();

export { Traffic };
