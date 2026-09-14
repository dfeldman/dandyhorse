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
      // fountain
      const basin = BABYLON.MeshBuilder.CreateCylinder('basin', { height: 0.9, diameter: 6, tessellation: 14 }, scene);
      basin.position.y = 0.45; Util.colorize(basin, '#cfd8e6'); basin.parent = root;
      const waterM = new BABYLON.StandardMaterial('fountainWater', scene);
      waterM.diffuseColor = Util.hex('#3fbdf3'); waterM.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.45); waterM.specularColor = BABYLON.Color3.Black(); waterM.alpha = 0.85;
      const pool = BABYLON.MeshBuilder.CreateCylinder('pool', { height: 0.1, diameter: 5.4, tessellation: 14 }, scene);
      pool.position.y = 0.9; pool.material = waterM; pool.parent = root;
      const col = BABYLON.MeshBuilder.CreateCylinder('col', { height: 2.2, diameterTop: 0.5, diameterBottom: 0.9, tessellation: 10 }, scene);
      col.position.y = 1.9; Util.colorize(col, '#cfd8e6'); col.parent = root;
      const tier = BABYLON.MeshBuilder.CreateCylinder('tier', { height: 0.3, diameter: 2.4, tessellation: 12 }, scene);
      tier.position.y = 2.6; Util.colorize(tier, '#cfd8e6'); tier.parent = root;
      const jet = BABYLON.MeshBuilder.CreateSphere('jet', { diameter: 1.2, segments: 6 }, scene);
      jet.position.y = 3.4; jet.scaling.y = 1.6; jet.material = waterM; jet.parent = root;
      const drops = [];
      for (let i = 0; i < 6; i++) {
        const d = BABYLON.MeshBuilder.CreateSphere('drop', { diameter: 0.35, segments: 4 }, scene);
        d.material = waterM; d.parent = root; drops.push({ m: d, ph: i / 6 * Math.PI * 2 });
      }
      anim.push({ jet, drops, ph: rng.range(0, 6.28) });
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
        if (m.material === waterM) { continue; }   // animated pieces stay live
        m.computeWorldMatrix(true); m.bakeCurrentTransformIntoVertices(); m.parent = null; parts.push(m);
      }
      placed++;
    }
    const merged = Util.merge(parts, 'park');
    if (merged) { merged.material = mat; Util.freeze(merged); ctx.shadow(merged); }
    return {
      update(dt, t) {
        for (const a of anim) {
          a.jet.scaling.y = 1.6 + Math.sin(t * 6 + a.ph) * 0.25;
          for (const d of a.drops) { const f = ((t * 0.8 + d.ph / 6.28) % 1); const r = 0.6 + f * 1.6; d.m.position.set(Math.cos(d.ph) * r, 3.6 + Math.sin(f * Math.PI) * 1.4 - f * 1.2, Math.sin(d.ph) * r); }
        }
      },
    };
  },
});
