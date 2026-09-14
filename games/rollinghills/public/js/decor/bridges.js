// Bridges over every water span of the trail: deck, railings, pylons.
Decor.register({
  name: 'bridges',
  build(scene, ctx) {
    const parts = [];
    const W = Config.TRAIL_WIDTH + 1.2;
    for (const b of ctx.bridges) {
      // deck as a ribbon following the trail (so ramped bridges still fit)
      const a = [], c = [], lo = [], ro = [];
      for (let n = 0; n <= b.len; n += 2) {
        const p = ctx.poseAt(b.s0 + n);
        const nx = -p.hz, nz = p.hx;
        a.push(new BABYLON.Vector3(p.x + nx * W / 2, p.y - 0.05, p.z + nz * W / 2));
        c.push(new BABYLON.Vector3(p.x - nx * W / 2, p.y - 0.05, p.z - nz * W / 2));
        lo.push(new BABYLON.Vector3(p.x + nx * W / 2, p.y - 0.65, p.z + nz * W / 2));
        ro.push(new BABYLON.Vector3(p.x - nx * W / 2, p.y - 0.65, p.z - nz * W / 2));
      }
      const deck = BABYLON.MeshBuilder.CreateRibbon('deck', { pathArray: [lo, a, c, ro], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
      Util.colorize(deck, '#c98a4b'); parts.push(deck);
      // railings
      for (const side of [1, -1]) {
        const rail = [];
        for (let n = 0; n <= b.len; n += 2) {
          const p = ctx.poseAt(b.s0 + n);
          rail.push(new BABYLON.Vector3(p.x - p.hz * side * W / 2, p.y + 1.05, p.z + p.hx * side * W / 2));
        }
        const tube = BABYLON.MeshBuilder.CreateTube('rail', { path: rail, radius: 0.08, tessellation: 5 }, scene);
        Util.colorize(tube, '#ff5a5a'); parts.push(tube);
        for (let n = 0; n <= b.len; n += 4) {
          const p = ctx.poseAt(b.s0 + n);
          const post = BABYLON.MeshBuilder.CreateBox('post', { width: 0.14, height: 1.1, depth: 0.14 }, scene);
          post.position.set(p.x - p.hz * side * W / 2, p.y + 0.5, p.z + p.hx * side * W / 2);
          Util.colorize(post, '#ffffff'); parts.push(post);
        }
      }
      // pylons down to the lake bed
      for (let n = 6; n < b.len - 4; n += 12) {
        const p = ctx.poseAt(b.s0 + n);
        const bed = Math.min(ctx.rawHeight(p.x, p.z), ctx.waterY) - 1;
        const h = p.y - bed;
        for (const side of [1, -1]) {
          const py = BABYLON.MeshBuilder.CreateCylinder('pylon', { height: h, diameter: 0.6, tessellation: 8 }, scene);
          py.position.set(p.x - p.hz * side * (W / 2 - 0.4), bed + h / 2, p.z + p.hx * side * (W / 2 - 0.4));
          Util.colorize(py, '#8a5a2b'); parts.push(py);
        }
        const beam = BABYLON.MeshBuilder.CreateBox('beam', { width: W, height: 0.3, depth: 0.5 }, scene);
        beam.position.set(p.x, p.y - 0.75, p.z); beam.rotation.y = Math.atan2(p.hx, p.hz);
        Util.colorize(beam, '#8a5a2b'); parts.push(beam);
      }
    }
    const merged = Util.merge(parts, 'bridges');
    if (merged) { merged.material = Util.matte(scene); Util.freeze(merged); ctx.shadow(merged); }
    console.log('bridges', ctx.bridges.map(b => b.len + 'm').join(', '));
  },
});
