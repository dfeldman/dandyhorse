// A few hillside windmills with turning sails (animated decorator).
Decor.register({
  name: 'windmills',
  build(scene, ctx) {
    const rng = ctx.rng('windmills');
    const mat = Util.matte(scene);
    const mills = [];
    let tries = 0;
    while (mills.length < 3 && tries++ < 300) {
      const s = rng.range(0, ctx.trackLength);
      const p = ctx.besideTrail(s, (rng.chance(0.5) ? 1 : -1) * rng.range(22, 60));
      if (!ctx.okSpot(p.x, p.z, { minTrail: 14, maxSlope: 0.35 }) || p.y > 90) continue;
      const root = new BABYLON.TransformNode('mill', scene);
      root.position.set(p.x, p.y - 0.2, p.z);
      root.rotation.y = Math.atan2(p.pose.x - p.x, p.pose.z - p.z);
      const body = BABYLON.MeshBuilder.CreateCylinder('mb', { height: 9, diameterTop: 3.2, diameterBottom: 4.4, tessellation: 8 }, scene);
      body.position.y = 4.5; Util.colorize(body, '#fff1c9'); body.material = mat; body.parent = root; ctx.shadow(body);
      const cap = BABYLON.MeshBuilder.CreateCylinder('mc', { height: 2.6, diameterTop: 0.4, diameterBottom: 3.6, tessellation: 8 }, scene);
      cap.position.y = 10.2; Util.colorize(cap, '#ff5a5a'); cap.material = mat; cap.parent = root;
      const hub = new BABYLON.TransformNode('hub', scene);
      hub.parent = root; hub.position.set(0, 9.4, 2.0);
      const sails = [];
      for (let i = 0; i < 4; i++) {
        const arm = BABYLON.MeshBuilder.CreateBox('arm', { width: 0.25, height: 5.5, depth: 0.15 }, scene);
        arm.position.y = 2.75; Util.colorize(arm, '#8a5a2b');
        const cloth = BABYLON.MeshBuilder.CreateBox('cloth', { width: 1.3, height: 4.2, depth: 0.06 }, scene);
        cloth.position.set(0.75, 3.2, 0); Util.colorize(cloth, i % 2 ? '#ffffff' : '#8fe0ff');
        const sail = Util.merge([arm, cloth], 'sail');
        sail.material = mat; sail.parent = hub; sail.rotation.z = i * Math.PI / 2; ctx.shadow(sail);
        sails.push(sail);
      }
      mills.push({ hub, speed: rng.range(0.4, 0.9) });
    }
    return { update(dt) { for (const m of mills) m.hub.rotation.z += m.speed * dt; } };
  },
});
