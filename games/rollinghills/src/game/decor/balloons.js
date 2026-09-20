import * as BABYLON from '@babylonjs/core'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Hot-air balloons drifting and bobbing over the trail (animated).
Decor.register({
  name: 'balloons',
  build(scene, ctx) {
    const rng = ctx.rng('balloons');
    const mat = Util.matte(scene);
    const list = [];
    const palettes = [['#ff5a5a', '#ffd42a'], ['#3d8bff', '#ffffff'], ['#a86bff', '#ff8ac9'], ['#38c172', '#ffe36e'], ['#ff8c42', '#5fb3ff']];
    for (let i = 0; i < 6; i++) {
      const parts = [];
      const [c1, c2] = rng.pick(palettes);
      const env = BABYLON.MeshBuilder.CreateSphere('env', { diameter: 7, segments: 10 }, scene);
      env.scaling.y = 1.15; Util.colorize(env, c1); parts.push(env);
      for (let k = 0; k < 4; k++) {   // vertical gores in the second color
        const g = BABYLON.MeshBuilder.CreateBox('g', { width: 0.9, height: 6.2, depth: 7.15 }, scene);
        g.rotation.y = k * Math.PI / 4; g.scaling.y = 1.0; Util.colorize(g, c2); parts.push(g);
      }
      const neck = BABYLON.MeshBuilder.CreateCylinder('neck', { height: 1.6, diameterTop: 2.6, diameterBottom: 1.2, tessellation: 8 }, scene);
      neck.position.y = -4.2; Util.colorize(neck, c1); parts.push(neck);
      const basket = BABYLON.MeshBuilder.CreateBox('bk', { width: 1.6, height: 1.2, depth: 1.6 }, scene);
      basket.position.y = -6.4; Util.colorize(basket, '#8a5a2b'); parts.push(basket);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const rope = BABYLON.MeshBuilder.CreateCylinder('rp', { height: 1.6, diameter: 0.06 }, scene);
        rope.position.set(sx * 0.7, -5.2, sz * 0.7); Util.colorize(rope, '#444444'); parts.push(rope);
      }
      const m = Util.merge(parts, 'balloon'); m.material = mat;
      const s = rng.range(0, ctx.trackLength);
      const p = ctx.besideTrail(s, rng.range(-60, 60));
      list.push({ m, x: p.x, z: p.z, y: Math.max(p.y, ctx.waterY) + rng.range(28, 55), vx: rng.range(-1.2, 1.2), vz: rng.range(-1.2, 1.2), ph: rng.range(0, 6.28) });
    }
    return {
      update(dt, t) {
        for (const b of list) {
          b.x += b.vx * dt; b.z += b.vz * dt;
          if (Math.abs(b.x) > ctx.half) b.vx *= -1;
          if (Math.abs(b.z) > ctx.half) b.vz *= -1;
          b.m.position.set(b.x, b.y + Math.sin(t * 0.4 + b.ph) * 2.5, b.z);
          b.m.rotation.y = t * 0.05 + b.ph;
        }
      },
    };
  },
});
