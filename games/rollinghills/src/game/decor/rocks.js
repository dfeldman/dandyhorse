import * as BABYLON from '@babylonjs/core'
import { Biome } from '../biome.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Boulders: mostly on steep ground, rarely on flat ground, never in town.
// Colored per biome (red in the desert, gray in the mountains).
Decor.register({
  name: 'rocks',
  build(scene, ctx) {
    const rng = ctx.rng('rocks');
    const base = BABYLON.MeshBuilder.CreatePolyhedron('rock', { type: 3, size: 0.7 }, scene);   // icosahedron: roundish, faceted
    Util.colorize(base, '#ffffff');
    base.material = Util.matte(scene);
    const TINT = {}; for (const n of Biome.POOL) TINT[n] = Biome.DEF[n].rockTint;
    const list = [];
    for (let i = 0; i < 5000; i++) {
      const x = rng.range(-ctx.half + 60, ctx.half - 60), z = rng.range(-ctx.half + 60, ctx.half - 60);
      const h = ctx.heightAt(x, z);
      if (h < ctx.waterY + 0.8) continue;
      const biome = ctx.biome(x, z).name;
      const def = Biome.DEF[biome];
      if (def.noRocks) continue;
      const slope = ctx.slopeAt(x, z);
      const flatChance = def.pebbles ? 0.06 : 0.012;
      if (slope < 0.35 && !rng.chance(flatChance)) continue;
      if (ctx.trailDist(x, z) < 4) continue;
      const s = slope < 0.35 ? rng.range(0.5, 1.3) : rng.range(0.6, 2.2);
      const v = rng.range(0.8, 1.15), t = TINT[biome];
      list.push({ x, y: h + s * 0.25, z, sx: s * rng.range(0.8, 1.25), sy: s * rng.range(0.6, 0.95), sz: s, ry: rng.range(0, 6.28), rx: rng.range(-0.2, 0.2), color: new BABYLON.Color3(t[0] * v, t[1] * v, t[2] * v) });
    }
    Util.thinInstances(base, list); base.freezeWorldMatrix(); ctx.shadow(base);
  },
});
