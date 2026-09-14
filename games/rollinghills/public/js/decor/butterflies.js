// Butterflies fluttering over the meadow flowers (animated decorator).
Decor.register({
  name: 'butterflies',
  build(scene, ctx) {
    const rng = ctx.rng('butterflies');
    const mat = Util.matte(scene);
    const list = [];
    const colors = ['#ff8ac9', '#ffd42a', '#5fb3ff', '#ff8c42', '#ffffff'];
    let tries = 0;
    while (list.length < 26 && tries++ < 400) {
      const s = rng.range(0, ctx.trackLength);
      const c = ctx.besideTrail(s, (rng.chance(0.5) ? 1 : -1) * rng.range(3, 12));
      if (!Biome.DEF[ctx.biome(c.x, c.z).name].butterflies || c.pose.bridge || c.y < ctx.waterY + 0.5) continue;
      const root = new BABYLON.TransformNode('bfly', scene);
      const wings = [];
      const col = rng.pick(colors);
      for (const side of [1, -1]) {
        const w = BABYLON.MeshBuilder.CreateDisc('w', { radius: 0.16, tessellation: 6 }, scene);
        w.rotation.x = Math.PI / 2; w.bakeCurrentTransformIntoVertices();
        w.setPivotPoint(new BABYLON.Vector3(0, 0, 0)); w.position.x = side * 0.15; w.scaling.x = 1.2;
        Util.colorize(w, col); w.material = mat; w.parent = root; wings.push({ m: w, side });
      }
      list.push({ root, wings, cx: c.x, cz: c.z, cy: c.y + rng.range(0.8, 1.8), r: rng.range(1, 3.5), ph: rng.range(0, 6.28), sp: rng.range(0.4, 0.9), fl: rng.range(9, 14) });
    }
    return {
      update(dt, t) {
        for (const b of list) {
          const a = b.ph + t * b.sp;
          const x = b.cx + Math.cos(a) * b.r + Math.sin(t * 1.7 + b.ph) * 0.5, z = b.cz + Math.sin(a * 1.3) * b.r;
          b.root.position.set(x, b.cy + Math.sin(t * 2.3 + b.ph) * 0.35, z);
          b.root.rotation.y = -a;
          const fl = Math.abs(Math.sin(t * b.fl + b.ph)) * 1.2;
          for (const w of b.wings) w.m.rotation.z = -w.side * fl;
        }
      },
    };
  },
});
