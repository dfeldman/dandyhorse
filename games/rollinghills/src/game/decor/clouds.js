import * as BABYLON from '@babylonjs/core'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Puffy clouds drifting slowly across the sky (animated decorator).
Decor.register({
  name: 'clouds',
  build(scene, ctx) {
    const rng = ctx.rng('clouds');
    const mat = new BABYLON.StandardMaterial('cloudMat', scene);
    mat.diffuseColor = new BABYLON.Color3(1, 1, 1); mat.specularColor = BABYLON.Color3.Black();
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.38, 0.45);
    const clouds = [];
    for (let i = 0; i < 34; i++) {
      const parts = [];
      const n = rng.int(3, 6);
      for (let j = 0; j < n; j++) {
        const s = BABYLON.MeshBuilder.CreateSphere('c', { diameter: rng.range(14, 30), segments: 6 }, scene);
        s.position.set(rng.range(-16, 16), rng.range(-3, 4), rng.range(-7, 7));
        s.scaling.y = 0.55; parts.push(s);
      }
      const m = Util.merge(parts, 'cloud');
      m.material = mat;
      m.position.set(rng.range(-ctx.half, ctx.half), rng.range(150, 260), rng.range(-ctx.half, ctx.half));
      m.scaling.setAll(rng.range(0.8, 1.8));
      clouds.push({ m, vx: rng.range(1.5, 4) });
    }
    return {
      update(dt) {
        for (const c of clouds) {
          c.m.position.x += c.vx * dt;
          if (c.m.position.x > ctx.half + 100) c.m.position.x = -ctx.half - 100;
        }
      },
    };
  },
});
