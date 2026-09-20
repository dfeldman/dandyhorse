import * as BABYLON from '@babylonjs/core'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// Town plaza: fountain (animated), hedges, benches, ice cream stand.
// A low-poly nod to the art museum's courtyard gardens.
Decor.register({
  name: 'park',
  build(scene, ctx) {
    const rng = ctx.rng('park');
    const mat = Util.matte(scene);
    const parts = [], anim = [];
    const sec = ctx.sectors.find(s => s.name === 'town');
    if (!sec) return;
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < 2; tries++) {
      const s = ctx.sectorS('town', rng.range(0.15, 0.85));
      const side = rng.chance(0.5) ? 1 : -1;
      const c = ctx.besideTrail(s, side * 20);
      if (c.pose.bridge || !ctx.okSpot(c.x, c.z, { minTrail: 12, maxSlope: 0.3 })) continue;
      const y = c.y - 0.05;
      const yaw = Math.atan2(c.pose.x - c.x, c.pose.z - c.z);
      const root = new BABYLON.TransformNode('plaza', scene); root.position.set(c.x, y, c.z); root.rotation.y = yaw;
      const pad = BABYLON.MeshBuilder.CreateCylinder('pad', { height: 0.4, diameter: 26, tessellation: 16 }, scene);
      pad.position.y = -0.1; Util.colorize(pad, '#e6dcc4'); pad.parent = root;
      // fountain: a stepped stone basin, a raised bowl spilling a sheet of water into it, and a jet on top
      const stone = '#cfd8e6', shade = '#b3bed2';
      const live = (m) => { m.metadata = { live: true }; return m; };   // animated: stays out of the merge
      const stoneAt = (mesh, y) => { mesh.position.y = y; Util.colorize(mesh, stone); mesh.parent = root; return mesh };
      stoneAt(BABYLON.MeshBuilder.CreateCylinder('step', { height: 0.3, diameter: 7.2, tessellation: 20 }, scene), 0.15);
      stoneAt(BABYLON.MeshBuilder.CreateCylinder('basin', { height: 0.95, diameter: 5.9, tessellation: 20 }, scene), 0.68);
      const rim = BABYLON.MeshBuilder.CreateTorus('rim', { diameter: 5.85, thickness: 0.4, tessellation: 20 }, scene);
      rim.position.y = 1.13; Util.colorize(rim, shade); rim.parent = root;
      const waterM = new BABYLON.StandardMaterial('fountainWater', scene);
      waterM.diffuseColor = Util.hex('#2aa6e6'); waterM.emissiveColor = new BABYLON.Color3(0.06, 0.22, 0.36); waterM.specularColor = BABYLON.Color3.Black(); waterM.alpha = 0.78;
      const fallM = new BABYLON.StandardMaterial('fountainFall', scene);
      fallM.diffuseColor = Util.hex('#bfe9fb'); fallM.emissiveColor = new BABYLON.Color3(0.22, 0.4, 0.5); fallM.specularColor = BABYLON.Color3.Black();
      fallM.alpha = 0.22; fallM.backFaceCulling = false;
      const pool = BABYLON.MeshBuilder.CreateCylinder('pool', { height: 0.1, diameter: 5.4, tessellation: 20 }, scene);
      // the water fills the ring, just clear of the basin's stone cap at 1.155
      pool.position.y = 1.17; pool.material = waterM; pool.parent = root; live(pool);
      // pedestal and column
      stoneAt(BABYLON.MeshBuilder.CreateCylinder('plinth', { height: 0.45, diameterTop: 1.15, diameterBottom: 1.6, tessellation: 12 }, scene), 1.15);
      stoneAt(BABYLON.MeshBuilder.CreateCylinder('col', { height: 1.5, diameterTop: 0.62, diameterBottom: 0.8, tessellation: 12 }, scene), 2.1);
      const collar = BABYLON.MeshBuilder.CreateTorus('collar', { diameter: 0.95, thickness: 0.2, tessellation: 12 }, scene);
      collar.position.y = 2.78; Util.colorize(collar, shade); collar.parent = root;
      // upper bowl
      stoneAt(BABYLON.MeshBuilder.CreateCylinder('bowl', { height: 0.55, diameterTop: 3.1, diameterBottom: 0.85, tessellation: 18 }, scene), 3.1);
      const bowlRim = BABYLON.MeshBuilder.CreateTorus('bowlRim', { diameter: 3.05, thickness: 0.18, tessellation: 18 }, scene);
      bowlRim.position.y = 3.37; Util.colorize(bowlRim, shade); bowlRim.parent = root;
      const bowlWater = BABYLON.MeshBuilder.CreateCylinder('bowlWater', { height: 0.06, diameter: 2.85, tessellation: 18 }, scene);
      bowlWater.position.y = 3.36; bowlWater.material = waterM; bowlWater.parent = root; live(bowlWater);
      // the skirt of water spilling over the bowl's lip: a short fall, not a glass case around the whole fountain
      const fall = BABYLON.MeshBuilder.CreateCylinder('fall', { height: 0.95, diameterTop: 3.02, diameterBottom: 2.55, tessellation: 18 }, scene);
      fall.position.y = 2.9; fall.material = fallM; fall.parent = root; live(fall);
      // the jet
      const jet = BABYLON.MeshBuilder.CreateCylinder('jet', { height: 1.05, diameterTop: 0.08, diameterBottom: 0.34, tessellation: 8 }, scene);
      jet.position.y = 3.92; jet.material = waterM; jet.parent = root; live(jet);
      const crown = BABYLON.MeshBuilder.CreateSphere('crown', { diameter: 0.26, segments: 6 }, scene);
      crown.position.y = 4.5; crown.material = waterM; crown.parent = root; live(crown);
      const drops = [];
      for (let i = 0; i < 10; i++) {
        const d = BABYLON.MeshBuilder.CreateSphere('drop', { diameter: 0.15, segments: 4 }, scene);
        d.material = waterM; d.parent = root; live(d);
        drops.push({ m: d, ph: (i / 10) * Math.PI * 2, reach: 0.9 + (i % 3) * 0.35 });
      }
      // rings spreading where the sheet lands
      const ripples = [];
      for (let i = 0; i < 3; i++) {
        const rm = new BABYLON.StandardMaterial('ripple' + i, scene);
        rm.diffuseColor = Util.hex('#dff4ff'); rm.specularColor = BABYLON.Color3.Black(); rm.disableLighting = true;
        rm.emissiveColor = Util.hex('#cdeeff'); rm.alpha = 0.35; rm.backFaceCulling = false;
        const r = BABYLON.MeshBuilder.CreateTorus('ripple', { diameter: 2, thickness: 0.06, tessellation: 20 }, scene);
        r.position.y = 1.24; r.material = rm; r.parent = root; live(r);
        ripples.push({ m: r, mat: rm, ph: i / 3 });
      }
      anim.push({ jet, crown, drops, ripples, ph: rng.range(0, 6.28) });
      // hedges ringing the plaza
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        if (Math.abs(((a - Math.PI) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.35) continue;   // gap toward the trail
        const hd = BABYLON.MeshBuilder.CreateBox('hedge', { width: 4.2, height: 1.2, depth: 1.1 }, scene);
        hd.position.set(Math.sin(a) * 11.5, 0.6, Math.cos(a) * 11.5); hd.rotation.y = a; Util.colorize(hd, '#2f9a45'); hd.parent = root;
        const hh = BABYLON.MeshBuilder.CreateBox('hedgeTop', { width: 4.3, height: 0.25, depth: 1.2 }, scene);
        hh.position.set(Math.sin(a) * 11.5, 1.25, Math.cos(a) * 11.5); hh.rotation.y = a; Util.colorize(hh, '#4fcf5f'); hh.parent = root;
      }
      // benches
      for (const a of [0.9, 2.2, 4.1, 5.4]) {
        const seat = BABYLON.MeshBuilder.CreateBox('seat', { width: 2, height: 0.12, depth: 0.6 }, scene);
        seat.position.set(Math.sin(a) * 6.5, 0.5, Math.cos(a) * 6.5); seat.rotation.y = a; Util.colorize(seat, '#c98a4b'); seat.parent = root;
        const back = BABYLON.MeshBuilder.CreateBox('back', { width: 2, height: 0.6, depth: 0.1 }, scene);
        back.position.set(Math.sin(a) * 6.8, 0.85, Math.cos(a) * 6.8); back.rotation.y = a; Util.colorize(back, '#c98a4b'); back.parent = root;
      }
      // ice cream stand
      {
        const st = new BABYLON.TransformNode('stand', scene); st.parent = root; st.position.set(8.5, 0, -7); st.rotation.y = -0.6;
        const body = BABYLON.MeshBuilder.CreateBox('sb', { width: 3, height: 1.4, depth: 1.6 }, scene); body.position.y = 0.7; Util.colorize(body, '#fff1c9'); body.parent = st;
        const roof = BABYLON.MeshBuilder.CreateBox('sr', { width: 3.6, height: 0.15, depth: 2.2 }, scene); roof.position.y = 2.5; Util.colorize(roof, '#ff5a5a'); roof.parent = st;
        for (let i = 0; i < 5; i++) { const stripe = BABYLON.MeshBuilder.CreateBox('ss', { width: 0.6, height: 0.16, depth: 2.25 }, scene); stripe.position.set(-1.4 + i * 0.7, 2.5, 0); Util.colorize(stripe, i % 2 ? '#ffffff' : '#ff5a5a'); stripe.parent = st; }
        for (const sx of [-1.3, 1.3]) { const pole = BABYLON.MeshBuilder.CreateCylinder('sp', { height: 1.1, diameter: 0.08 }, scene); pole.position.set(sx, 1.95, 0.7); Util.colorize(pole, '#ffffff'); pole.parent = st; }
        const cone = BABYLON.MeshBuilder.CreateCylinder('cone', { height: 1.1, diameterTop: 0.6, diameterBottom: 0, tessellation: 8 }, scene); cone.position.y = 3.15; Util.colorize(cone, '#e0a060'); cone.parent = st;
        const scoop = BABYLON.MeshBuilder.CreateSphere('scoop', { diameter: 0.8, segments: 6 }, scene); scoop.position.y = 3.9; Util.colorize(scoop, '#ff8ac9'); scoop.parent = st;
        const scoop2 = BABYLON.MeshBuilder.CreateSphere('scoop2', { diameter: 0.7, segments: 6 }, scene); scoop2.position.y = 4.4; Util.colorize(scoop2, '#fff2a8'); scoop2.parent = st;
      }
      root.computeWorldMatrix(true);
      for (const m of root.getChildMeshes()) {
        if (m.metadata?.live) { continue; }   // animated pieces stay live
        m.computeWorldMatrix(true); m.bakeCurrentTransformIntoVertices(); m.parent = null; parts.push(m);
      }
      placed++;
    }
    const merged = Util.merge(parts, 'park');
    if (merged) { merged.material = mat; Util.freeze(merged); ctx.shadow(merged); }
    return {
      update(dt, t) {
        for (const a of anim) {
          const pulse = Math.sin(t * 6 + a.ph);
          a.jet.scaling.y = 1 + pulse * 0.12;
          a.crown.position.y = 4.5 + pulse * 0.12;
          a.crown.scaling.setAll(1 + pulse * 0.1);
          // drops leave the top of the jet, arc outward and fall past the bowl into the pool
          for (const d of a.drops) {
            const f = (t * 0.7 + d.ph / 6.28) % 1;
            const r = 0.25 + f * d.reach;
            d.m.position.set(Math.cos(d.ph) * r, 4.5 + Math.sin(f * Math.PI) * 0.5 - f * f * 3.9, Math.sin(d.ph) * r);
          }
          // rings spread from where the sheet lands and fade as they go
          for (const rp of a.ripples) {
            const f = (t * 0.5 + rp.ph) % 1;
            rp.m.scaling.setAll(1.35 + f * 0.4);
            rp.mat.alpha = 0.3 * (1 - f);
          }
        }
      },
    };
  },
});
