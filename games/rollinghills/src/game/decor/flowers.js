import * as BABYLON from '@babylonjs/core'
import { Biome } from '../biome.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Ground clutter near the trail: flower patches, bushes, grass tufts
// (thin instances, pure eye candy; colors follow the biome).
Decor.register({
  name: 'flowers',
  build(scene, ctx) {
    const rng = ctx.rng('flowers');
    const mat = Util.matte(scene);
    const stem = BABYLON.MeshBuilder.CreateCylinder('st', { height: 0.5, diameter: 0.06, tessellation: 4 }, scene);
    stem.position.y = 0.25; Util.colorize(stem, '#3fa34d');
    const head = BABYLON.MeshBuilder.CreateSphere('hd', { diameter: 0.34, segments: 4 }, scene);
    head.position.y = 0.55; head.scaling.y = 0.55; Util.colorize(head, '#ffffff');
    const flower = Util.merge([stem, head], 'flower'); flower.material = mat;
    const bush = BABYLON.MeshBuilder.CreateSphere('bush', { diameter: 1.6, segments: 5 }, scene);
    bush.position.y = 0.5; bush.scaling.y = 0.7; bush.bakeCurrentTransformIntoVertices();
    Util.colorize(bush, '#ffffff'); bush.material = mat;
    // grass tuft: three crossed blades
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const b = BABYLON.MeshBuilder.CreateCylinder('bl', { height: 0.7, diameterTop: 0, diameterBottom: 0.28, tessellation: 3 }, scene);
      b.position.y = 0.35; b.rotation.y = i * Math.PI / 3; b.rotation.z = rng.range(-0.25, 0.25); Util.colorize(b, '#ffffff'); blades.push(b);
    }
    const tuft = Util.merge(blades, 'tuft'); tuft.material = mat;
    const rock = BABYLON.MeshBuilder.CreatePolyhedron('pebble', { type: 1, size: 0.35 }, scene);
    Util.colorize(rock, '#ffffff'); rock.material = mat;

    const petals = ['#ff5a8a', '#ffd42a', '#ff8c42', '#ffffff', '#a86bff', '#ff4fa3'].map(Util.hex);
    const BUSH = {}, TUFT = {}; for (const n of Biome.POOL) { BUSH[n] = Biome.DEF[n].bush; TUFT[n] = Biome.DEF[n].tuft; }
    const fl = [], bu = [], tu = [], pb = [];
    for (let s = 0; s < ctx.trackLength; s += 5) {
      const pose = ctx.poseAt(s);
      if (pose.bridge) continue;
      const biome = ctx.biome(pose.x, pose.z).name;
      // flowers (not in desert/alpine)
      if (rng.chance(Biome.DEF[biome].flowers || 0)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const c = ctx.besideTrail(s, side * rng.range(3.4, 10));
        if (ctx.okSpot(c.x, c.z, { minTrail: 3, maxSlope: 0.7 })) {
          const color = rng.pick(petals);
          for (let i = 0; i < rng.int(4, 10); i++) {
            const x = c.x + rng.range(-2.5, 2.5), z = c.z + rng.range(-2.5, 2.5);
            if (ctx.trailDist(x, z) < 2.8) continue;
            fl.push({ x, y: ctx.heightAt(x, z), z, s: rng.range(0.8, 1.3), color });
          }
        }
      }
      // bushes
      if (rng.chance(biome === 'forest' ? 0.4 : 0.22)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const c = ctx.besideTrail(s, side * rng.range(3.5, 12));
        if (ctx.okSpot(c.x, c.z, { minTrail: 3.2, maxSlope: 0.7 })) {
          const v = rng.range(0.85, 1.15), base = Util.hex(BUSH[biome]);
          bu.push({ x: c.x, y: c.y - 0.1, z: c.z, s: rng.range(0.7, 1.6), ry: rng.range(0, 6.28), color: base.scale(v) });
        }
      }
      // tufts fill the near field
      for (let i = 0; i < 3; i++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const c = ctx.besideTrail(s + rng.range(0, 5), side * rng.range(2.8, 16));
        if (!ctx.okSpot(c.x, c.z, { minTrail: 2.6, maxSlope: 0.8, aboveWater: 0.3 })) continue;
        const v = rng.range(0.8, 1.15), base = Util.hex(TUFT[biome]);
        tu.push({ x: c.x, y: c.y - 0.05, z: c.z, s: rng.range(0.7, 1.5), ry: rng.range(0, 6.28), color: base.scale(v) });
      }
      // pebbles in desert / alpine
      if (Biome.DEF[biome].pebbles && rng.chance(0.5)) {
        const side = rng.chance(0.5) ? 1 : -1;
        const c = ctx.besideTrail(s, side * rng.range(3, 14));
        if (ctx.okSpot(c.x, c.z, { minTrail: 2.8, maxSlope: 0.9 })) {
          const v = rng.range(0.7, 1.0);
          pb.push({ x: c.x, y: c.y, z: c.z, s: rng.range(0.5, 1.6), ry: rng.range(0, 6.28), color: (() => { const t = Biome.DEF[biome].rockTint; return new BABYLON.Color3(t[0] * v * 1.2, t[1] * v * 1.2, t[2] * v * 1.2); })() });
        }
      }
    }
    for (const [m, list] of [[flower, fl], [bush, bu], [tuft, tu], [rock, pb]]) {
      if (list.length) { Util.thinInstances(m, list); m.freezeWorldMatrix(); if (m === bush) ctx.shadow(m); } else m.setEnabled(false);
    }
  },
});
