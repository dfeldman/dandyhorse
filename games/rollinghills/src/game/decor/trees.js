import * as BABYLON from '@babylonjs/core'
import { Biome } from '../biome.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Trees & cacti: cartoon species as thin instances, mixed per biome.
Decor.register({
  name: 'trees',
  build(scene, ctx) {
    const rng = ctx.rng('trees');
    const mat = Util.matte(scene);

    function pine(snow) {
      const trunk = BABYLON.MeshBuilder.CreateCylinder('t', { height: 1.6, diameterTop: 0.35, diameterBottom: 0.5, tessellation: 6 }, scene);
      trunk.position.y = 0.8; Util.colorize(trunk, '#8a5a2b');
      const parts = [trunk];
      const greens = snow ? ['#2f7f47', '#e8f4ff', '#ffffff'] : ['#2fa84f', '#3cbf5c', '#49d06a'];
      for (let i = 0; i < 3; i++) {
        const c = BABYLON.MeshBuilder.CreateCylinder('c', { height: 2.2, diameterTop: 0, diameterBottom: 3.2 - i * 0.8, tessellation: 7 }, scene);
        c.position.y = 2.2 + i * 1.3; Util.colorize(c, greens[i]); parts.push(c);
      }
      return Util.merge(parts, snow ? 'snowPine' : 'pine');
    }
    function round(colors, name, trunkColor = '#9a6435') {
      const trunk = BABYLON.MeshBuilder.CreateCylinder('t', { height: 2.0, diameterTop: 0.4, diameterBottom: 0.55, tessellation: 6 }, scene);
      trunk.position.y = 1.0; Util.colorize(trunk, trunkColor);
      const parts = [trunk];
      const blobs = [[0, 3.2, 0, 3.4], [1.1, 2.6, 0.4, 2.2], [-1.0, 2.7, -0.3, 2.0], [0.2, 2.5, 1.0, 1.9], [-0.3, 2.6, -1.0, 1.9]];
      blobs.forEach((b, i) => {
        const s = BABYLON.MeshBuilder.CreateSphere('b', { diameter: b[3], segments: 6 }, scene);
        s.position.set(b[0], b[1], b[2]); Util.colorize(s, colors[i]); parts.push(s);
      });
      return Util.merge(parts, name);
    }
    // A frond as a tapered blade that leaves the crown, arches over and droops at the tip. The points are built
    // in the tree's own space, so the blade starts exactly at the crown: rotating a box about a shifted pivot
    // used to fling the leaves off the trunk and turn them the wrong way up.
    function frond(top, yaw, len, rise, droop, color) {
      const N = 7;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);       // out from the trunk
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);      // across the blade
      const left = [], right = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const out = len * t;
        const y = top.y + rise * t - droop * Math.pow(t, 2.3);
        const w = 0.32 * Math.sin(Math.PI * Math.pow(t, 0.5));   // nothing at the stem, a point at the tip
        const cx = top.x + dx * out, cz = top.z + dz * out;
        left.push(new BABYLON.Vector3(cx + sx * w, y, cz + sz * w));
        right.push(new BABYLON.Vector3(cx - sx * w, y, cz - sz * w));
      }
      const f = BABYLON.MeshBuilder.CreateRibbon('f', { pathArray: [left, right], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
      return Util.colorize(f, color);
    }
    function palm() {
      const path = [];
      for (let i = 0; i <= 6; i++) path.push(new BABYLON.Vector3(Math.sin(i / 6 * 1.2) * 1.2, i * 0.9, 0));
      const trunk = BABYLON.MeshBuilder.CreateTube('t', { path, radius: 0.18, tessellation: 6 }, scene);
      Util.colorize(trunk, '#b07a3c');
      const parts = [trunk];
      const top = path[6];
      const greens = ['#3fd15e', '#57e070', '#34bf50', '#69e87d'];
      for (let i = 0; i < 9; i++) {
        const yaw = (i / 9) * Math.PI * 2 + 0.15;
        // every other frond reaches further and hangs lower, so the crown is not a flat wheel
        const long = i % 2 === 0;
        parts.push(frond(top, yaw, long ? 3.2 : 2.5, long ? 0.9 : 1.0, long ? 2.3 : 1.7, greens[i % greens.length]));
      }
      for (const [ox, oz] of [[0.16, 0.1], [-0.14, 0.13], [0.02, -0.18]]) {
        const nut = BABYLON.MeshBuilder.CreateSphere('n', { diameter: 0.3, segments: 5 }, scene);
        nut.position.set(top.x + ox, top.y - 0.22, top.z + oz); Util.colorize(nut, '#6b4423'); parts.push(nut);
      }
      return Util.merge(parts, 'palm');
    }
    function cactus() {
      const parts = [];
      const body = BABYLON.MeshBuilder.CreateCylinder('cb', { height: 3.4, diameter: 0.7, tessellation: 8 }, scene);
      body.position.y = 1.7; Util.colorize(body, '#3f9f4f'); parts.push(body);
      const cap = BABYLON.MeshBuilder.CreateSphere('cc', { diameter: 0.7, segments: 6 }, scene);
      cap.position.y = 3.4; Util.colorize(cap, '#3f9f4f'); parts.push(cap);
      for (const side of [1, -1]) {
        const a = BABYLON.MeshBuilder.CreateCylinder('ca', { height: 1.0, diameter: 0.4, tessellation: 6 }, scene);
        a.rotation.z = Math.PI / 2; a.position.set(side * 0.55, 1.6 + (side > 0 ? 0.3 : 0), 0); Util.colorize(a, '#48ad58'); parts.push(a);
        const u = BABYLON.MeshBuilder.CreateCylinder('cu', { height: 1.3, diameter: 0.4, tessellation: 6 }, scene);
        u.position.set(side * 1.0, 2.2 + (side > 0 ? 0.3 : 0), 0); Util.colorize(u, '#48ad58'); parts.push(u);
        const k = BABYLON.MeshBuilder.CreateSphere('ck', { diameter: 0.4, segments: 5 }, scene);
        k.position.set(side * 1.0, 2.85 + (side > 0 ? 0.3 : 0), 0); Util.colorize(k, '#48ad58'); parts.push(k);
      }
      return Util.merge(parts, 'cactus');
    }
    function deadTree(color = '#7a5a3a', name = 'deadTree') {
      const parts = [];
      const trunk = BABYLON.MeshBuilder.CreateCylinder('dt', { height: 2.6, diameterTop: 0.15, diameterBottom: 0.35, tessellation: 5 }, scene);
      trunk.position.y = 1.3; Util.colorize(trunk, color); parts.push(trunk);
      for (let i = 0; i < 3; i++) {
        const br = BABYLON.MeshBuilder.CreateCylinder('db', { height: 1.4, diameterTop: 0.05, diameterBottom: 0.15, tessellation: 4 }, scene);
        br.position.set(0, 1.9 + i * 0.3, 0); br.rotation.z = (i - 1) * 0.9 + 0.3; br.rotation.y = i * 2.1;
        br.translate(new BABYLON.Vector3(0, 1, 0), 0.6, BABYLON.Space.LOCAL);
        Util.colorize(br, color); parts.push(br);
      }
      return Util.merge(parts, name);
    }

    const species = {
      pine: pine(false), snowPine: pine(true), palm: palm(), cactus: cactus(), dead: deadTree(),
      round: round(['#5fd35a', '#78e06a', '#4cc84f', '#8fe873', '#6ad862'], 'roundTree'),
      dark: round(['#2f9a45', '#3fb052', '#28883c', '#4cc25a', '#36a44a'], 'darkTree'),
      autumn: round(['#e8801a', '#f0a030', '#d9502a', '#f2c040', '#c94a2a'], 'autumnTree', '#6b4423'),
      blossom: round(['#ffb3d9', '#ffc9e6', '#ff9fce', '#ffd6ec', '#ffa6d5'], 'blossomTree', '#5a3a2a'),
      charred: deadTree('#2a2428', 'charredTree'),
    };
    for (const m of Object.values(species)) { m.material = mat; m.isPickable = false; }
    const place = {}; for (const k of Object.keys(species)) place[k] = [];
    const tint = () => { const v = rng.range(0.85, 1.12); return new BABYLON.Color3(v, v * rng.range(0.95, 1.05), v); };

    // what grows where: [species, weight] per biome, plus cluster size/acceptance
    const MIX = {}; for (const n of Biome.POOL) MIX[n] = Biome.DEF[n].trees;
    const pickSpecies = (biome, h) => {
      const mix = MIX[biome].s;
      if (biome === 'alpine') return h > 42 ? 'snowPine' : 'pine';
      let tot = mix.reduce((a, b) => a + b[1], 0), r = rng.range(0, tot);
      for (const [k, w] of mix) { r -= w; if (r <= 0) return k; }
      return mix[0][0];
    };
    const add = (kind, x, z, h) => place[kind].push({ x, y: h - 0.15, z, s: rng.range(0.75, 1.35), ry: rng.range(0, 6.28), color: tint() });

    for (let c = 0; c < 360; c++) {
      const cx = rng.range(-ctx.half + 80, ctx.half - 80), cz = rng.range(-ctx.half + 80, ctx.half - 80);
      const h = ctx.heightAt(cx, cz);
      if (h < ctx.waterY + 0.6 || h > 95) continue;
      const biome = ctx.biome(cx, cz).name, mix = MIX[biome];
      if (!rng.chance(mix.accept)) continue;
      const n = rng.int(mix.n[0], mix.n[1]), rad = rng.range(mix.rad[0], mix.rad[1]);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * rad;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!ctx.okSpot(x, z, { minTrail: 4.5, maxSlope: 0.75 })) continue;
        const hh = ctx.heightAt(x, z);
        if (hh > 95) continue;
        add(pickSpecies(biome, hh), x, z, hh);
      }
    }
    // trail-side trees so the ride always has scenery
    for (let s = 0; s < ctx.trackLength; s += 8) {
      const side = rng.chance(0.5) ? 1 : -1;
      const p = ctx.besideTrail(s, side * rng.range(5, 16));
      const biome = ctx.biome(p.x, p.z).name;
      if (!rng.chance(Math.max(0.45, MIX[biome].accept * 0.8))) continue;
      if (!ctx.okSpot(p.x, p.z, { minTrail: 4.2, maxSlope: 0.8 })) continue;
      add(pickSpecies(biome, p.y), p.x, p.z, p.y);
    }
    // palms along warm shorelines
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(-ctx.half + 60, ctx.half - 60), z = rng.range(-ctx.half + 60, ctx.half - 60);
      const h = ctx.heightAt(x, z);
      if (h < ctx.waterY + 0.5 || h > ctx.waterY + 2.6) continue;
      if (ctx.trailDist(x, z) < 4.5) continue;
      const b = ctx.biome(x, z).name;
      if (b === 'alpine' || b === 'forest' || b === 'volcanic' || b === 'autumn') continue;
      add('palm', x, z, h + 0.05);
    }

    let total = 0;
    for (const k of Object.keys(species)) {
      if (place[k].length) { Util.thinInstances(species[k], place[k]); species[k].freezeWorldMatrix(); ctx.shadow(species[k]); total += place[k].length; }
      else species[k].setEnabled(false);
    }
    console.log('trees placed', total);
  },
});
