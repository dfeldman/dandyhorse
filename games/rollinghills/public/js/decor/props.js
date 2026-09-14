// Small props per area: fences, hay bales (meadow), mushrooms and logs
// (forest), snowmen (alpine), lamp posts (town), balanced rocks and
// tumbleweeds (desert), bunting on the start arch. Mostly thin instances.
Decor.register({
  name: 'props',
  build(scene, ctx) {
    const rng = ctx.rng('props');
    const mat = Util.matte(scene);
    const hw = Config.TRAIL_WIDTH / 2;
    const mk = (name, builder) => { const m = builder(); m.name = name; m.material = mat; m.isPickable = false; return m; };
    const base = {
      post: mk('fencePost', () => { const b = BABYLON.MeshBuilder.CreateBox('p', { width: 0.18, height: 1.2, depth: 0.18 }, scene); b.position.y = 0.6; b.bakeCurrentTransformIntoVertices(); return Util.colorize(b, '#c99a5b'); }),
      rail: mk('fenceRail', () => { const b = BABYLON.MeshBuilder.CreateBox('r', { width: 0.1, height: 0.12, depth: 2.6 }, scene); return Util.colorize(b, '#e0b57a'); }),
      bale: mk('hayBale', () => { const c = BABYLON.MeshBuilder.CreateCylinder('h', { height: 1.6, diameter: 1.5, tessellation: 10 }, scene); c.rotation.z = Math.PI / 2; c.position.y = 0.75; c.bakeCurrentTransformIntoVertices(); return Util.colorize(c, '#f0cd6a'); }),
      mushroom: mk('mushroom', () => {
        const st = BABYLON.MeshBuilder.CreateCylinder('s', { height: 0.5, diameter: 0.22, tessellation: 6 }, scene); st.position.y = 0.25; Util.colorize(st, '#fff4e0');
        const cap = BABYLON.MeshBuilder.CreateSphere('c', { diameter: 0.7, segments: 6, slice: 0.5 }, scene); cap.position.y = 0.45; Util.colorize(cap, '#ff4a4a');
        const dots = []; for (let i = 0; i < 4; i++) { const d = BABYLON.MeshBuilder.CreateSphere('d', { diameter: 0.12, segments: 3 }, scene); const a = i * 1.6; d.position.set(Math.cos(a) * 0.22, 0.6, Math.sin(a) * 0.22); Util.colorize(d, '#ffffff'); dots.push(d); }
        return Util.merge([st, cap, ...dots], 'm');
      }),
      log: mk('log', () => { const c = BABYLON.MeshBuilder.CreateCylinder('l', { height: 3.2, diameter: 0.7, tessellation: 7 }, scene); c.rotation.z = Math.PI / 2; c.position.y = 0.3; c.bakeCurrentTransformIntoVertices(); return Util.colorize(c, '#8a5a2b'); }),
      snowman: mk('snowman', () => {
        const a = BABYLON.MeshBuilder.CreateSphere('a', { diameter: 1.3, segments: 8 }, scene); a.position.y = 0.6; Util.colorize(a, '#ffffff');
        const b = BABYLON.MeshBuilder.CreateSphere('b', { diameter: 1.0, segments: 8 }, scene); b.position.y = 1.5; Util.colorize(b, '#ffffff');
        const c = BABYLON.MeshBuilder.CreateSphere('c', { diameter: 0.75, segments: 8 }, scene); c.position.y = 2.2; Util.colorize(c, '#ffffff');
        const nose = BABYLON.MeshBuilder.CreateCylinder('n', { height: 0.45, diameterTop: 0, diameterBottom: 0.14, tessellation: 5 }, scene); nose.rotation.x = Math.PI / 2; nose.position.set(0, 2.2, 0.5); Util.colorize(nose, '#ff8c42');
        const hat = BABYLON.MeshBuilder.CreateCylinder('h', { height: 0.5, diameter: 0.5, tessellation: 8 }, scene); hat.position.y = 2.75; Util.colorize(hat, '#222233');
        const brim = BABYLON.MeshBuilder.CreateCylinder('br', { height: 0.06, diameter: 0.85, tessellation: 8 }, scene); brim.position.y = 2.52; Util.colorize(brim, '#222233');
        const scarf = BABYLON.MeshBuilder.CreateTorus('sc', { diameter: 0.7, thickness: 0.16, tessellation: 8 }, scene); scarf.position.y = 1.88; Util.colorize(scarf, '#ff5a5a');
        return Util.merge([a, b, c, nose, hat, brim, scarf], 's');
      }),
      lamp: mk('lampPost', () => {
        const pole = BABYLON.MeshBuilder.CreateCylinder('p', { height: 4.2, diameter: 0.14, tessellation: 6 }, scene); pole.position.y = 2.1; Util.colorize(pole, '#2f3a4a');
        const arm = BABYLON.MeshBuilder.CreateBox('a', { width: 0.1, height: 0.1, depth: 0.9 }, scene); arm.position.set(0, 4.2, 0.4); Util.colorize(arm, '#2f3a4a');
        return Util.merge([pole, arm], 'l');
      }),
      lampHead: mk('lampHead', () => { const head = BABYLON.MeshBuilder.CreateSphere('h', { diameter: 0.5, segments: 6 }, scene); head.position.set(0, 4.05, 0.8); head.bakeCurrentTransformIntoVertices(); return Util.colorize(head, '#fff2a8'); }),
      lanternBox: mk('lanternBox', () => { const box = BABYLON.MeshBuilder.CreateBox('lb', { width: 0.5, height: 0.6, depth: 0.5 }, scene); box.position.y = 2.4; box.bakeCurrentTransformIntoVertices(); return Util.colorize(box, '#ff4a4a'); }),
      pool: mk('lightPool', () => { const d = BABYLON.MeshBuilder.CreateDisc('lp', { radius: 3.2, tessellation: 16 }, scene); d.rotation.x = Math.PI / 2; d.position.y = 0.1; d.bakeCurrentTransformIntoVertices(); return Util.colorize(d, '#ffffff'); }),
      stack: mk('balancedRock', () => {
        const parts = []; let y = 0;
        for (const [d, h] of [[2.2, 0.9], [1.6, 0.8], [1.9, 0.7], [1.1, 0.6]]) { const s = BABYLON.MeshBuilder.CreateSphere('r', { diameter: d, segments: 5 }, scene); s.scaling.y = h / d; s.position.y = y + h / 2; y += h * 0.9; Util.colorize(s, '#c95a3a'); parts.push(s); }
        return Util.merge(parts, 'b');
      }),
      tumble: mk('tumbleweed', () => { const s = BABYLON.MeshBuilder.CreatePolyhedron('t', { type: 3, size: 0.5 }, scene); s.position.y = 0.5; s.bakeCurrentTransformIntoVertices(); return Util.colorize(s, '#c9b27a'); }),
      pumpkin: mk('pumpkin', () => { const s = BABYLON.MeshBuilder.CreateSphere('p', { diameter: 0.7, segments: 8 }, scene); s.scaling.y = 0.7; s.position.y = 0.25; s.bakeCurrentTransformIntoVertices(); Util.colorize(s, '#ff8c1a'); const st = BABYLON.MeshBuilder.CreateCylinder('ps', { height: 0.2, diameter: 0.1 }, scene); st.position.y = 0.55; Util.colorize(st, '#4a7a2a'); return Util.merge([s, st], 'pk'); }),
      lantern: mk('lantern', () => { const post = BABYLON.MeshBuilder.CreateCylinder('lp', { height: 2.2, diameter: 0.1 }, scene); post.position.y = 1.1; Util.colorize(post, '#3a2a2a'); const cap = BABYLON.MeshBuilder.CreateCylinder('lc', { height: 0.15, diameterTop: 0.2, diameterBottom: 0.75, tessellation: 4 }, scene); cap.position.y = 2.78; Util.colorize(cap, '#3a2a2a'); return Util.merge([post, cap], 'ln'); }),
      umbrella: mk('umbrella', () => { const pole = BABYLON.MeshBuilder.CreateCylinder('up', { height: 2.2, diameter: 0.06 }, scene); pole.position.y = 1.1; Util.colorize(pole, '#ffffff'); const top = BABYLON.MeshBuilder.CreateCylinder('ut', { height: 0.5, diameterTop: 0.05, diameterBottom: 2.2, tessellation: 8 }, scene); top.position.y = 2.2; Util.colorize(top, '#ffffff'); return Util.merge([pole, top], 'um'); }),
      flag: mk('bunting', () => { const c = BABYLON.MeshBuilder.CreateCylinder('f', { height: 0.3, diameterTop: 0, diameterBottom: 0.24, tessellation: 3 }, scene); c.rotation.z = Math.PI; c.bakeCurrentTransformIntoVertices(); return Util.colorize(c, '#ffffff'); }),
    };
    const L = {}; for (const k of Object.keys(base)) L[k] = [];
    const L_ = ctx.trackLength;

    // ---- fences in the meadow (and a few in forest/alpine) ----
    for (let s = 0; s < L_; s += 12) {
      const pose = ctx.poseAt(s);
      const biome = ctx.biome(pose.x, pose.z).name;
      const chance = biome === 'meadow' ? 0.22 : biome === 'alpine' || biome === 'forest' || biome === 'autumn' ? 0.08 : 0;
      if (!rng.chance(chance)) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const run = rng.int(4, 12);
      let ok = true;
      for (let i = 0; i <= run && ok; i++) {
        const p = ctx.besideTrail(s + i * 2.6, side * (hw + 2.4));
        if (p.pose.bridge || p.y < ctx.waterY + 0.5) { ok = false; break; }
        const yaw = Math.atan2(p.pose.hx, p.pose.hz);
        L.post.push({ x: p.x, y: p.y - 0.05, z: p.z, ry: yaw });
        if (i < run) {
          const q = ctx.besideTrail(s + (i + 1) * 2.6, side * (hw + 2.4));
          const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
          const pitch = -Math.atan2(q.y - p.y, 2.6);
          for (const h of [0.45, 0.95]) L.rail.push({ x: mx, y: (p.y + q.y) / 2 + h, z: mz, ry: yaw, rx: pitch });
        }
      }
      s += run * 2.6 + 30;
    }
    // ---- scattered props by biome ----
    for (let s = 0; s < L_; s += 4) {
      const pose = ctx.poseAt(s);
      if (pose.bridge) continue;
      const biome = ctx.biome(pose.x, pose.z).name;
      const side = rng.chance(0.5) ? 1 : -1;
      if (biome === 'meadow' && rng.chance(0.06)) {
        const c = ctx.besideTrail(s, side * rng.range(14, 45));
        if (ctx.okSpot(c.x, c.z, { minTrail: 8, maxSlope: 0.3 })) for (let i = 0; i < rng.int(2, 5); i++) { const x = c.x + rng.range(-5, 5), z = c.z + rng.range(-5, 5); if (ctx.trailDist(x, z) > 7) L.bale.push({ x, y: ctx.heightAt(x, z), z, ry: rng.range(0, 6.28), s: rng.range(0.9, 1.2) }); }
      }
      if (biome === 'forest') {
        if (rng.chance(0.35)) { const c = ctx.besideTrail(s, side * rng.range(3, 12)); if (ctx.okSpot(c.x, c.z, { minTrail: 2.8, maxSlope: 0.7 })) for (let i = 0; i < rng.int(1, 4); i++) { const x = c.x + rng.range(-1.2, 1.2), z = c.z + rng.range(-1.2, 1.2); L.mushroom.push({ x, y: ctx.heightAt(x, z), z, ry: rng.range(0, 6.28), s: rng.range(0.6, 1.4) }); } }
        if (rng.chance(0.05)) { const c = ctx.besideTrail(s, side * rng.range(5, 14)); if (ctx.okSpot(c.x, c.z, { minTrail: 4, maxSlope: 0.5 })) L.log.push({ x: c.x, y: c.y, z: c.z, ry: rng.range(0, 6.28), s: rng.range(0.8, 1.3) }); }
      }
      if (biome === 'alpine' && rng.chance(0.035)) { const c = ctx.besideTrail(s, side * rng.range(4, 12)); if (ctx.okSpot(c.x, c.z, { minTrail: 3.5, maxSlope: 0.45 })) L.snowman.push({ x: c.x, y: c.y, z: c.z, ry: Math.atan2(c.pose.x - c.x, c.pose.z - c.z) + rng.range(-0.5, 0.5), s: rng.range(0.8, 1.2) }); }
      if (biome === 'autumn' && rng.chance(0.05)) { const c = ctx.besideTrail(s, side * rng.range(4, 14)); if (ctx.okSpot(c.x, c.z, { minTrail: 3.2, maxSlope: 0.4 })) for (let i = 0; i < rng.int(2, 6); i++) { const x = c.x + rng.range(-1.5, 1.5), z = c.z + rng.range(-1.5, 1.5); if (ctx.trailDist(x, z) > 3) L.pumpkin.push({ x, y: ctx.heightAt(x, z), z, ry: rng.range(0, 6.28), s: rng.range(0.7, 1.4) }); } }
      if (biome === 'blossom' && s % 24 < 4) { for (const sd of [1, -1]) { const c = ctx.besideTrail(s, sd * (hw + 1.4)); if (c.y > ctx.waterY + 0.5) { const ry = Math.atan2(c.pose.hx, c.pose.hz); L.lantern.push({ x: c.x, y: c.y - 0.05, z: c.z, ry }); L.lanternBox.push({ x: c.x, y: c.y - 0.05, z: c.z, ry }); L.pool.push({ x: c.x, y: c.y, z: c.z, s: 0.6, color: Util.hex('#ff9a7a') }); } } }
      if (biome === 'tropical' && rng.chance(0.3)) { const c = ctx.besideTrail(s, side * rng.range(4, 30)); const h = ctx.heightAt(c.x, c.z); if (h > ctx.waterY + 0.4 && h < ctx.waterY + 2.2 && ctx.trailDist(c.x, c.z) > 3.5) L.umbrella.push({ x: c.x, y: h, z: c.z, ry: rng.range(0, 6.28), rx: rng.range(-0.15, 0.15), color: Util.hex(rng.pick(['#ff5a5a', '#ffd42a', '#3d8bff', '#ff8ac9', '#38c172'])) }); }
      if (biome === 'desert') {
        if (rng.chance(0.04)) { const c = ctx.besideTrail(s, side * rng.range(8, 30)); if (ctx.okSpot(c.x, c.z, { minTrail: 6, maxSlope: 0.4 })) L.stack.push({ x: c.x, y: c.y, z: c.z, ry: rng.range(0, 6.28), s: rng.range(0.9, 1.8) }); }
        if (rng.chance(0.08)) { const c = ctx.besideTrail(s, side * rng.range(3, 16)); if (ctx.okSpot(c.x, c.z, { minTrail: 2.8, maxSlope: 0.6 })) L.tumble.push({ x: c.x, y: c.y, z: c.z, ry: rng.range(0, 6.28), s: rng.range(0.6, 1.3) }); }
      }
    }
    // ---- lamp posts through town, both sides, regular spacing ----
    for (let s = 0; s < L_; s += 22) {
      const pose = ctx.poseAt(s);
      if (pose.bridge || ctx.biome(pose.x, pose.z).name !== 'town') continue;
      for (const side of [1, -1]) {
        const c = ctx.besideTrail(s, side * (hw + 1.6));
        if (c.y < ctx.waterY + 0.5) continue;
        const ry = Math.atan2(c.pose.x - c.x, c.pose.z - c.z);
        L.lamp.push({ x: c.x, y: c.y - 0.05, z: c.z, ry });
        L.lampHead.push({ x: c.x, y: c.y - 0.05, z: c.z, ry });
        L.pool.push({ x: c.x + Math.sin(ry) * 0.8, y: c.y, z: c.z + Math.cos(ry) * 0.8, ry, color: Util.hex('#ffe9a0') });
      }
    }
    // ---- bunting from the start arch ----
    {
      const p0 = ctx.poseAt(0);
      const colors = ['#ff5a5a', '#ffd42a', '#3d8bff', '#38c172', '#ff8ac9'].map(Util.hex);
      for (const side of [1, -1]) for (let k = 0; k < 2; k++) {
        const s1 = 18 + k * 18;
        const a = ctx.besideTrail(0, side * (Config.TRAIL_WIDTH / 2 + 1)), b = ctx.besideTrail(s1, side * (hw + 2.4));
        const ya = p0.y + 5.0, yb = b.y + 1.2;
        L.post.push({ x: b.x, y: b.y - 0.05, z: b.z, ry: 0, sy: 1.6 });
        const rope = [];
        for (let i = 0; i <= 16; i++) { const f = i / 16, sag = Math.sin(f * Math.PI) * 0.8; rope.push(new BABYLON.Vector3(a.x + (b.x - a.x) * f, ya + (yb - ya) * f - sag, a.z + (b.z - a.z) * f)); }
        const tube = BABYLON.MeshBuilder.CreateTube('rope', { path: rope, radius: 0.025, tessellation: 4 }, scene);
        Util.colorize(tube, '#ffffff'); tube.material = mat; Util.freeze(tube);
        for (let i = 1; i < 16; i++) {
          const f = i / 16, sag = Math.sin(f * Math.PI) * 0.8;
          L.flag.push({ x: a.x + (b.x - a.x) * f, y: ya + (yb - ya) * f - sag - 0.16, z: a.z + (b.z - a.z) * f, ry: Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2, color: colors[i % colors.length] });
        }
      }
    }
    // glowing bits use the shared glow material; light pools are additive discs
    base.lampHead.material = Util.glowMat(scene); base.lanternBox.material = Util.glowMat(scene);
    const poolMat = new BABYLON.StandardMaterial('lightPool', scene);
    poolMat.diffuseColor = BABYLON.Color3.Black(); poolMat.emissiveColor = new BABYLON.Color3(1, 1, 1); poolMat.disableLighting = true;
    poolMat.alpha = 0; poolMat.alphaMode = BABYLON.Engine.ALPHA_ADD; poolMat.backFaceCulling = false;
    {   // soft radial falloff
      const t = new BABYLON.DynamicTexture('poolTex', { width: 64, height: 64 }, scene, false);
      const c = t.getContext(); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); t.update();
      poolMat.opacityTexture = t; poolMat.emissiveTexture = t;
    }
    base.pool.material = poolMat; ctx.poolMat(poolMat);
    let n = 0;
    for (const k of Object.keys(base)) {
      if (L[k].length) { Util.thinInstances(base[k], L[k]); base[k].freezeWorldMatrix(); if (!['flag', 'mushroom', 'rail', 'pool', 'lampHead', 'lanternBox'].includes(k)) ctx.shadow(base[k]); if (k === 'lampHead' || k === 'lanternBox') ctx.glow(base[k]); n += L[k].length; }
      else base[k].setEnabled(false);
    }
    console.log('props placed', n);
  },
});
