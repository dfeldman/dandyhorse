import * as BABYLON from '@babylonjs/core'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Hot-air balloons drifting and bobbing over the trail (animated).

// The envelope: a teardrop of revolution whose gores are alternating colors. Built by hand rather than as a
// sphere with colored slabs pushed through it, which is what made them read as cylinders with fins.
const PROFILE = [   // [radius, height] from the neck up to the crown
  [0.55, -3.9], [1.5, -3.25], [2.45, -2.3], [3.15, -1.1], [3.5, 0.3], [3.4, 1.6], [2.9, 2.8], [2.0, 3.7], [1.0, 4.3], [0, 4.6],
];
const GORES = 16;

function envelope(scene, c1, c2) {
  const cols = [Util.hex(c1), Util.hex(c2)];
  const positions = [], colors = [], indices = [], uvs = [];   // uvs unused, but the merge needs every part to carry them
  for (let j = 0; j < GORES; j++) {
    const a0 = (j / GORES) * Math.PI * 2, a1 = ((j + 1) / GORES) * Math.PI * 2;
    const c = cols[j % 2];
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const [r0, y0] = PROFILE[i], [r1, y1] = PROFILE[i + 1];
      const base = positions.length / 3;
      for (const [r, y, a, u, v] of [[r0, y0, a0, 0, 0], [r0, y0, a1, 1, 0], [r1, y1, a1, 1, 1], [r1, y1, a0, 0, 1]]) {
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
        colors.push(c.r, c.g, c.b, 1);
        uvs.push(u, v);
      }
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const vd = new BABYLON.VertexData();
  vd.positions = positions; vd.colors = colors; vd.indices = indices; vd.uvs = uvs;
  vd.normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, vd.normals);
  const m = new BABYLON.Mesh('env', scene);
  vd.applyToMesh(m);
  return m;
}

Decor.register({
  name: 'balloons',
  build(scene, ctx) {
    const rng = ctx.rng('balloons');
    const mat = Util.matte(scene);
    const list = [];
    const palettes = [['#ff5a5a', '#ffd42a'], ['#3d8bff', '#ffffff'], ['#a86bff', '#ff8ac9'], ['#38c172', '#ffe36e'], ['#ff8c42', '#5fb3ff']];
    for (let i = 0; i < 6; i++) {
      const [c1, c2] = rng.pick(palettes);
      const parts = [envelope(scene, c1, c2)];
      const neck = BABYLON.MeshBuilder.CreateCylinder('neck', { height: 1.0, diameterTop: 1.1, diameterBottom: 0.7, tessellation: 8 }, scene);
      neck.position.y = -4.3; Util.colorize(neck, c1, 0.8); parts.push(neck);
      const burner = BABYLON.MeshBuilder.CreateBox('bn', { width: 0.5, height: 0.35, depth: 0.5 }, scene);
      burner.position.y = -5.0; Util.colorize(burner, '#d8d8d8'); parts.push(burner);
      const basket = BABYLON.MeshBuilder.CreateBox('bk', { width: 1.6, height: 1.2, depth: 1.6 }, scene);
      basket.position.y = -6.4; Util.colorize(basket, '#8a5a2b'); parts.push(basket);
      const lip = BABYLON.MeshBuilder.CreateBox('lp', { width: 1.75, height: 0.18, depth: 1.75 }, scene);
      lip.position.y = -5.85; Util.colorize(lip, '#6f4520'); parts.push(lip);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const rope = BABYLON.MeshBuilder.CreateCylinder('rp', { height: 1.5, diameter: 0.06 }, scene);
        rope.position.set(sx * 0.68, -5.15, sz * 0.68); Util.colorize(rope, '#444444'); parts.push(rope);
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
          b.m.rotation.z = Math.sin(t * 0.3 + b.ph) * 0.03;   // a lazy sway under the envelope
        }
      },
    };
  },
});
