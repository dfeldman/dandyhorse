import * as BABYLON from '@babylonjs/core'
import { Config } from '../config.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Start/finish arch and kilometer posts along the trail.
Decor.register({
  name: 'signs',
  build(scene, ctx) {
    const parts = [];
    const p0 = ctx.poseAt(0);
    const W = Config.TRAIL_WIDTH + 2;
    // arch
    for (const side of [1, -1]) {
      const post = BABYLON.MeshBuilder.CreateCylinder('ap', { height: 5, diameter: 0.4 }, scene);
      post.position.set(p0.x - p0.hz * side * W / 2, p0.y + 2.5, p0.z + p0.hx * side * W / 2);
      Util.colorize(post, '#ffffff'); parts.push(post);
    }
    const banner = BABYLON.MeshBuilder.CreateBox('banner', { width: W + 0.4, height: 1.4, depth: 0.2 }, scene);
    banner.position.set(p0.x, p0.y + 5.2, p0.z); banner.rotation.y = Math.atan2(p0.hx, p0.hz);
    Util.colorize(banner, '#ffd42a'); parts.push(banner);
    // checker stripe under the arch: paint on the trail surface, not a kerb to stand in — all but 4 mm of it
    // sits below the road, or the rider parked on the start line looks sunk into the ground
    const sqY = p0.y + Config.TRAIL_LIFT - 0.021;
    for (let i = 0; i < 6; i++) {
      const sq = BABYLON.MeshBuilder.CreateBox('sq', { width: W / 6, height: 0.05, depth: 1.2 }, scene);
      sq.position.set(p0.x - p0.hz * (-W / 2 + (i + 0.5) * W / 6), sqY, p0.z + p0.hx * (-W / 2 + (i + 0.5) * W / 6));
      sq.rotation.y = Math.atan2(p0.hx, p0.hz);
      Util.colorize(sq, i % 2 ? '#222222' : '#ffffff'); parts.push(sq);
    }
    // km posts
    const cols = ['#ff5a5a', '#3d8bff', '#38c172', '#ff8c42', '#a86bff'];
    for (let km = 1; km * 1000 < ctx.trackLength; km++) {
      const p = ctx.besideTrail(km * 1000, Config.TRAIL_WIDTH / 2 + 1);
      const post = BABYLON.MeshBuilder.CreateBox('kp', { width: 0.18, height: 1.6, depth: 0.18 }, scene);
      post.position.set(p.x, p.y + 0.8, p.z); Util.colorize(post, '#ffffff'); parts.push(post);
      const sign = BABYLON.MeshBuilder.CreateBox('ks', { width: 1.0, height: 0.7, depth: 0.1 }, scene);
      sign.position.set(p.x, p.y + 1.8, p.z); sign.rotation.y = Math.atan2(p.pose.hx, p.pose.hz);
      Util.colorize(sign, cols[km % cols.length]); parts.push(sign);
    }
    const merged = Util.merge(parts, 'signs');
    if (merged) { merged.material = Util.matte(scene); Util.freeze(merged); ctx.shadow(merged); }
  },
});
