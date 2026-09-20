import * as BABYLON from '@babylonjs/core'
import { Biome } from '../biome.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Settlements per biome: cottages (meadow/forest), adobe (desert), chalets
// (alpine), tall bright blocks (town), plus hilltop towers.
Decor.register({
  name: 'buildings',
  build(scene, ctx) {
    const rng = ctx.rng('buildings');
    const mat = Util.matte(scene);
    const parts = [], winParts = [];
    const STYLES = {
      cottage: { walls: ['#fff1c9', '#ffd9a8', '#ffc6d9', '#cde9ff', '#d9f5c9', '#ffffff'], roofs: ['#ff5a5a', '#ff8c42', '#3d8bff', '#38c172', '#a86bff', '#ff4fa3'], roof: 'gable', pad: '#d8c48f' },
      cabin:   { walls: ['#8a5a2b', '#a06a35', '#7a4a22'], roofs: ['#5a3a1a', '#5a7f3a', '#8a4a2b'], roof: 'gable', pad: '#b9a276' },
      adobe:   { walls: ['#e6b57c', '#d99a5e', '#f0c896', '#c98b57'], roofs: ['#b8763f'], roof: 'flat', pad: '#d9a86a' },
      chalet:  { walls: ['#8a5a2b', '#a06a35', '#f4ead8'], roofs: ['#f4f7ff', '#e8eef8'], roof: 'steep', pad: '#c8c8c8' },
      block:   { walls: ['#ff7b7b', '#ffb84d', '#5fb3ff', '#7ddc8a', '#c78bff', '#ff8ac9', '#ffe36e'], roofs: ['#ffffff'], roof: 'block', pad: '#c9c9c9' },
      hut:     { walls: ['#e8c48a', '#d9b070', '#f2d6a0'], roofs: ['#c9a24a', '#b8903a'], roof: 'thatch', pad: '#f2dc9a' },
      pagoda:  { walls: ['#f4e4c6', '#fff6e8', '#f2d6c9'], roofs: ['#c0392b', '#8e2f3a', '#2f5f8e'], roof: 'pagoda', pad: '#d9cbb0' },
    };

    function bake(root) {
      root.computeWorldMatrix(true);
      for (const m of root.getChildMeshes()) { m.computeWorldMatrix(true); m.bakeCurrentTransformIntoVertices(); m.parent = null; (m.name === 'w' ? winParts : parts).push(m); }
      root.dispose();
    }
    function gableRoof(root, w, d, h, color, steep) {
      const rr = (w * 1.15) / (2 * 0.866);
      const roof = BABYLON.MeshBuilder.CreateCylinder('r', { height: d + 0.8, diameter: rr * 2, tessellation: 3 }, scene);
      roof.bakeTransformIntoVertices(BABYLON.Matrix.FromValues(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));
      const sy = steep ? 0.95 : 0.55;
      roof.scaling.y = sy; roof.position.y = h + rr * 0.5 * sy - 0.05;
      Util.colorize(roof, color); roof.parent = root;
    }
    function house(x, y, z, ry, scale, st) {
      const w = rng.range(4, 6) * scale, d = rng.range(4, 7) * scale, h = rng.range(2.6, 3.6) * scale;
      const root = new BABYLON.TransformNode('h', scene);
      root.position.set(x, y, z); root.rotation.y = ry;
      const pad = BABYLON.MeshBuilder.CreateCylinder('pad', { height: 0.5, diameter: Math.max(w, d) * 1.7, tessellation: 12 }, scene);
      pad.position.y = -0.1; Util.colorize(pad, st.pad); pad.parent = root;
      const body = BABYLON.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
      body.position.y = h / 2; Util.colorize(body, rng.pick(st.walls)); body.parent = root;
      if (st.roof === 'thatch') {
        const body2 = BABYLON.MeshBuilder.CreateCylinder('hb', { height: h, diameter: Math.max(w, d), tessellation: 10 }, scene);
        body2.position.y = h / 2; Util.colorize(body2, rng.pick(st.walls)); body2.parent = root; body.dispose();
        const cone = BABYLON.MeshBuilder.CreateCylinder('hr', { height: h * 0.9, diameterTop: 0.3, diameterBottom: Math.max(w, d) * 1.4, tessellation: 10 }, scene);
        cone.position.y = h + h * 0.45 - 0.1; Util.colorize(cone, rng.pick(st.roofs)); cone.parent = root;
      } else if (st.roof === 'pagoda') {
        gableRoof(root, w * 1.3, d * 1.3, h, st.roofs[0], false);
        const upper = BABYLON.MeshBuilder.CreateBox('u', { width: w * 0.6, height: h * 0.7, depth: d * 0.6 }, scene);
        upper.position.y = h + h * 0.35 + 0.6; Util.colorize(upper, rng.pick(st.walls)); upper.parent = root;
        gableRoof(root, w * 0.85, d * 0.85, h + h * 0.7 + 0.6, st.roofs[0], false);
        const finial = BABYLON.MeshBuilder.CreateSphere('fi', { diameter: 0.5, segments: 5 }, scene);
        finial.position.y = h + h * 0.7 + 0.6 + w * 0.5; Util.colorize(finial, '#ffd42a'); finial.parent = root;
      } else if (st.roof === 'flat') {
        const par = BABYLON.MeshBuilder.CreateBox('p', { width: w + 0.3, height: 0.5, depth: d + 0.3 }, scene);
        par.position.y = h + 0.1; Util.colorize(par, rng.pick(st.roofs)); par.parent = root;
        for (let i = 0; i < 3; i++) {   // vigas
          const v = BABYLON.MeshBuilder.CreateCylinder('v', { height: d + 1.2, diameter: 0.25, tessellation: 5 }, scene);
          v.rotation.x = Math.PI / 2; v.position.set(-w * 0.3 + i * w * 0.3, h - 0.3, 0); Util.colorize(v, '#7a4a22'); v.parent = root;
        }
      } else gableRoof(root, w, d, h, rng.pick(st.roofs), st.roof === 'steep');
      const door = BABYLON.MeshBuilder.CreateBox('d', { width: 0.9 * scale, height: 1.6 * scale, depth: 0.12 }, scene);
      door.position.set(0, 0.8 * scale, d / 2 + 0.05); Util.colorize(door, st.roof === 'thatch' ? '#5a3a1a' : '#7a4a22'); door.parent = root;
      for (const sx of [-1, 1]) {
        const win = BABYLON.MeshBuilder.CreateBox('w', { width: 0.9 * scale, height: 0.9 * scale, depth: 0.12 }, scene);
        win.position.set(sx * w * 0.3, h * 0.6, d / 2 + 0.05); Util.colorize(win, '#8fe0ff'); win.parent = root;
      }
      if (st.roof !== 'flat' && rng.chance(0.6)) {
        const ch = BABYLON.MeshBuilder.CreateBox('c', { width: 0.6, height: 1.4, depth: 0.6 }, scene);
        ch.position.set(w * 0.25, h + 0.9, -d * 0.2); Util.colorize(ch, '#b34a3a'); ch.parent = root;
      }
      bake(root);
    }
    function block(x, y, z, ry, st) {
      const w = rng.range(7, 13), d = rng.range(7, 13), floors = rng.int(3, 11), fh = 3.2, h = floors * fh;
      const root = new BABYLON.TransformNode('blk', scene);
      root.position.set(x, y, z); root.rotation.y = ry;
      const pad = BABYLON.MeshBuilder.CreateBox('pad', { width: w + 6, height: 0.5, depth: d + 6 }, scene);
      pad.position.y = -0.1; Util.colorize(pad, st.pad); pad.parent = root;
      const body = BABYLON.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
      body.position.y = h / 2; Util.colorize(body, rng.pick(st.walls)); body.parent = root;
      const cols = Math.max(2, Math.floor(w / 2.6));
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) for (const face of [1, -1]) {
        const win = BABYLON.MeshBuilder.CreateBox('w', { width: 1.3, height: 1.5, depth: 0.15 }, scene);
        win.position.set(-w / 2 + (c + 0.5) * (w / cols), f * fh + 1.7, face * (d / 2 + 0.05));
        Util.colorize(win, rng.chance(0.8) ? '#9fe7ff' : '#fff2a8'); win.parent = root;
      }
      const top = BABYLON.MeshBuilder.CreateBox('t', { width: w * 0.4, height: 1.6, depth: d * 0.4 }, scene);
      top.position.y = h + 0.8; Util.colorize(top, '#ffffff'); top.parent = root;
      if (rng.chance(0.5)) {
        const ant = BABYLON.MeshBuilder.CreateCylinder('a', { height: 4, diameter: 0.25 }, scene);
        ant.position.y = h + 3.5; Util.colorize(ant, '#ff5a5a'); ant.parent = root;
      }
      bake(root);
    }
    function tower(x, y, z) {
      const t = BABYLON.MeshBuilder.CreateCylinder('tw', { height: 14, diameter: 5, tessellation: 10 }, scene);
      t.position.set(x, y + 7, z); Util.colorize(t, '#f2e6d2'); parts.push(t);
      const cap = BABYLON.MeshBuilder.CreateCylinder('cap', { height: 5, diameterTop: 0, diameterBottom: 6.2, tessellation: 10 }, scene);
      cap.position.set(x, y + 16.4, z); Util.colorize(cap, '#3d8bff'); parts.push(cap);
      const flag = BABYLON.MeshBuilder.CreateBox('fl', { width: 2, height: 1.2, depth: 0.08 }, scene);
      flag.position.set(x + 1, y + 20, z); Util.colorize(flag, '#ffd42a'); parts.push(flag);
      const pole = BABYLON.MeshBuilder.CreateCylinder('po', { height: 3, diameter: 0.2 }, scene);
      pole.position.set(x, y + 19.9, z); Util.colorize(pole, '#555555'); parts.push(pole);
    }

    // settlements: a couple per sector, sized by biome
    for (const sec of ctx.sectors) {
      const def = Biome.DEF[sec.name];
      if (!def.house) continue;
      const count = def.settlements;
      for (let v = 0; v < count; v++) {
        const s0 = ctx.sectorS(sec.name, (v + 0.5) / count + rng.range(-0.12, 0.12));
        const st = STYLES[def.house];
        const n = sec.name === 'town' ? rng.int(8, 14) : rng.int(4, 9);
        let placed = 0, tries = 0;
        while (placed < n && tries++ < 80) {
          const s = s0 + rng.range(-90, 90);
          const side = rng.chance(0.5) ? 1 : -1;
          const far = sec.name === 'town' ? rng.range(14, 40) : rng.range(9, 26);
          const p = ctx.besideTrail(s, side * far);
          if (p.pose.bridge) continue;
          if (!ctx.okSpot(p.x, p.z, { minTrail: sec.name === 'town' ? 11 : 7.5, maxSlope: 0.45 })) continue;
          const face = Math.atan2(p.pose.x - p.x, p.pose.z - p.z);
          if (sec.name === 'town') block(p.x, p.y - 0.1, p.z, face + rng.range(-0.2, 0.2), st);
          else house(p.x, p.y - 0.1, p.z, face + rng.range(-0.3, 0.3), rng.range(0.85, 1.2), st);
          placed++;
        }
      }
    }
    let towers = 0;
    for (let i = 0; i < 400 && towers < 3; i++) {
      const s = rng.range(0, ctx.trackLength);
      const p = ctx.besideTrail(s, (rng.chance(0.5) ? 1 : -1) * rng.range(40, 90));
      if (p.y > 40 && p.y < 95 && ctx.slopeAt(p.x, p.z) < 0.35 && !ctx.isWater(p.x, p.z)) { tower(p.x, p.y - 0.3, p.z); towers++; }
    }
    const merged = Util.merge(parts, 'buildings');
    if (merged) { merged.material = mat; Util.freeze(merged); ctx.shadow(merged); }
    const wins = Util.merge(winParts, 'windows');
    if (wins) { wins.material = Util.glowMat(scene); Util.freeze(wins); ctx.glow(wins); }
  },
});
