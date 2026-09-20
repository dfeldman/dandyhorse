import * as BABYLON from '@babylonjs/core'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Flocks of birds circling over the trail, wings flapping (animated).
Decor.register({
  name: 'birds',
  build(scene, ctx) {
    const rng = ctx.rng('birds');
    const mat = Util.matte(scene);
    const flocks = [];
    for (let f = 0; f < 6; f++) {
      const s = rng.range(0, ctx.trackLength);
      const p = ctx.besideTrail(s, rng.range(-40, 40));
      const center = new BABYLON.Vector3(p.x, Math.max(p.y, ctx.waterY) + rng.range(18, 35), p.z);
      const birds = [];
      const n = rng.int(4, 8);
      const color = rng.pick(['#222222', '#ffffff', '#ff6b4d']);
      for (let i = 0; i < n; i++) {
        const root = new BABYLON.TransformNode('bird', scene);
        const body = BABYLON.MeshBuilder.CreateSphere('bb', { diameter: 0.5, segments: 4 }, scene);
        body.scaling.z = 1.8; Util.colorize(body, color); body.material = mat; body.parent = root;
        const wings = [];
        for (const side of [1, -1]) {
          const w = BABYLON.MeshBuilder.CreateBox('bw', { width: 1.2, height: 0.05, depth: 0.45 }, scene);
          w.setPivotPoint(new BABYLON.Vector3(-side * 0.6, 0, 0));
          w.position.x = side * 0.6; Util.colorize(body, color); Util.colorize(w, color); w.material = mat; w.parent = root; wings.push({ m: w, side });
        }
        birds.push({ root, wings, phase: rng.range(0, 6.28), r: rng.range(6, 16), h: rng.range(-3, 3), speed: rng.range(0.25, 0.4), flap: rng.range(5, 8) });
      }
      flocks.push({ center, birds, dir: rng.chance(0.5) ? 1 : -1 });
    }
    return {
      update(dt, t) {
        for (const f of flocks) for (const b of f.birds) {
          const a = f.dir * (t * b.speed + b.phase);
          const x = f.center.x + Math.cos(a) * b.r, z = f.center.z + Math.sin(a) * b.r;
          b.root.position.set(x, f.center.y + b.h + Math.sin(t * 0.7 + b.phase) * 1.5, z);
          b.root.rotation.y = -a + (f.dir > 0 ? 0 : Math.PI);
          const fl = Math.sin(t * b.flap + b.phase) * 0.6;
          for (const w of b.wings) w.m.rotation.z = fl * w.side;
        }
      },
    };
  },
});
