import * as BABYLON from '@babylonjs/core'
import { Config } from '../config.js'
import { Decor } from '../decor.js'
import { Loop } from '../loop.js'
import { Util } from '../util.js'

// Moving things that aren't riders: a monorail train looping beside the
// trail on pylons, boats circling the central lake, a blimp, and planes
// crossing the map. All animated, none interactive.
Decor.register({
  name: 'vehicles',
  build(scene, ctx) {
    const rng = ctx.rng('vehicles');
    const mat = Util.matte(scene);
    const movers = [];

    // ---- monorail: a loop 48 m inside the trail, elevated above whatever is below ----
    const OFF = -48;
    const N = 720;
    const rail = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = Loop.radiusAt(th) + OFF;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      rail.push({ x, z, y: Math.max(ctx.heightAt(x, z), ctx.waterY) + 7 });
    }
    for (let pass = 0; pass < 6; pass++) {   // smooth the elevation
      const ys = rail.map((p, i) => (rail[(i + N - 1) % N].y + p.y + rail[(i + 1) % N].y) / 3);
      rail.forEach((p, i) => { p.y = Math.max(ys[i], Math.max(ctx.heightAt(p.x, p.z), ctx.waterY) + 4); });
    }
    let railLen = 0; const cum = [0];
    for (let i = 1; i <= N; i++) { const a = rail[i - 1], b = rail[i % N]; railLen += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); cum.push(railLen); }
    const railAt = (s) => {
      s = ((s % railLen) + railLen) % railLen;
      let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const a = rail[lo], b = rail[(lo + 1) % N], f = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
    };
    {
      const path = rail.map(p => new BABYLON.Vector3(p.x, p.y - 0.3, p.z)); path.push(path[0].clone());
      const beam = BABYLON.MeshBuilder.CreateTube('monorail', { path, radius: 0.45, tessellation: 6 }, scene);
      Util.colorize(beam, '#e8ecf2'); beam.material = mat; Util.freeze(beam);
      const pylons = [];
      for (let i = 0; i < N; i += 6) {
        const p = rail[i]; const ground = Math.min(ctx.heightAt(p.x, p.z), ctx.waterY < ctx.heightAt(p.x, p.z) ? ctx.heightAt(p.x, p.z) : ctx.waterY - 2);
        const h = p.y - 0.3 - ground;
        const py = BABYLON.MeshBuilder.CreateCylinder('pyl', { height: h, diameterTop: 0.7, diameterBottom: 1.1, tessellation: 6 }, scene);
        py.position.set(p.x, ground + h / 2, p.z); Util.colorize(py, '#c8ccd4'); pylons.push(py);
      }
      const pm = Util.merge(pylons, 'monorailPylons'); pm.material = mat; Util.freeze(pm);
      // train: 4 cars
      const cars = [];
      for (let c = 0; c < 4; c++) {
        const body = BABYLON.MeshBuilder.CreateBox('car', { width: 2.4, height: 2.4, depth: 7 }, scene);
        Util.colorize(body, c === 0 ? '#ff5a5a' : '#ffd42a');
        const roof = BABYLON.MeshBuilder.CreateBox('roof', { width: 2.5, height: 0.4, depth: 7.1 }, scene);
        roof.position.y = 1.4; Util.colorize(roof, '#ffffff');
        const wins = [];
        for (const side of [1, -1]) for (let k = 0; k < 3; k++) {
          const w = BABYLON.MeshBuilder.CreateBox('w', { width: 0.1, height: 1, depth: 1.4 }, scene);
          w.position.set(side * 1.2, 0.3, -2.2 + k * 2.2); Util.colorize(w, '#9fe7ff'); wins.push(w);
        }
        const m = Util.merge([body, roof, ...wins], 'trainCar'); m.material = mat; ctx.shadow(m);
        cars.push(m);
      }
      let s0 = rng.range(0, railLen);
      movers.push({ update(dt) { s0 += 22 * dt; cars.forEach((m, i) => { const p = railAt(s0 - i * 8); m.position.set(p.x, p.y + 1.2, p.z); m.rotation.y = p.yaw; }); } });
    }

    // ---- boats on the central lake ----
    {
      const boats = [];
      for (let i = 0; i < 4; i++) {
        const hull = BABYLON.MeshBuilder.CreateBox('hull', { width: 2.2, height: 1, depth: 6 }, scene);
        Util.colorize(hull, rng.pick(['#ffffff', '#ff5a5a', '#3d8bff', '#ffd42a']));
        const bow = BABYLON.MeshBuilder.CreateCylinder('bow', { height: 2.2, diameterTop: 0, diameterBottom: 2.2, tessellation: 4 }, scene);
        bow.rotation.x = Math.PI / 2; bow.position.z = 4; bow.scaling.y = 1; Util.colorize(bow, '#ffffff');
        const cabin = BABYLON.MeshBuilder.CreateBox('cab', { width: 1.6, height: 1.2, depth: 2 }, scene);
        cabin.position.set(0, 1.1, -0.5); Util.colorize(cabin, '#ffffff');
        const mast = BABYLON.MeshBuilder.CreateCylinder('mast', { height: 6, diameter: 0.12 }, scene);
        mast.position.set(0, 3.5, 0.5); Util.colorize(mast, '#8a5a2b');
        const sail = BABYLON.MeshBuilder.CreateCylinder('sail', { height: 4.5, diameterTop: 0, diameterBottom: 3, tessellation: 3 }, scene);
        sail.position.set(0, 3.8, 1.2); sail.rotation.z = Math.PI; sail.scaling.x = 0.15; sail.rotation.x = 0; Util.colorize(sail, rng.pick(['#ffffff', '#ff8ac9', '#ffe36e']));
        const m = Util.merge([hull, bow, cabin, mast, sail], 'boat'); m.material = mat;
        boats.push({ m, r: rng.range(60, 120), ph: rng.range(0, 6.28), w: rng.range(0.03, 0.06) * (rng.chance(0.5) ? 1 : -1) });
      }
      movers.push({ update(dt, t) { for (const b of boats) { const a = b.ph + t * b.w; b.m.position.set(Math.cos(a) * b.r, ctx.waterY + 0.3 + Math.sin(t * 1.3 + b.ph) * 0.15, Math.sin(a) * b.r); b.m.rotation.y = -a + (b.w > 0 ? 0 : Math.PI); b.m.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.06; } } });
    }

    // ---- blimp ----
    {
      const env = BABYLON.MeshBuilder.CreateSphere('blimp', { diameter: 14, segments: 10 }, scene);
      env.scaling.z = 2.6; Util.colorize(env, '#ffffff');
      const stripe = BABYLON.MeshBuilder.CreateSphere('stripe', { diameter: 14.2, segments: 10 }, scene);
      stripe.scaling.set(1, 0.35, 2.6); Util.colorize(stripe, '#ff5a5a');
      const gondola = BABYLON.MeshBuilder.CreateBox('gon', { width: 2.4, height: 1.6, depth: 6 }, scene);
      gondola.position.y = -7; Util.colorize(gondola, '#3a3a44');
      const fin1 = BABYLON.MeshBuilder.CreateBox('fin', { width: 0.3, height: 7, depth: 5 }, scene); fin1.position.z = -15; Util.colorize(fin1, '#ffd42a');
      const fin2 = BABYLON.MeshBuilder.CreateBox('fin', { width: 7, height: 0.3, depth: 5 }, scene); fin2.position.z = -15; Util.colorize(fin2, '#ffd42a');
      const m = Util.merge([env, stripe, gondola, fin1, fin2], 'blimp'); m.material = mat;
      const r = Config.TRAIL_RADIUS * 0.75, ph = rng.range(0, 6.28);
      movers.push({ update(dt, t) { const a = ph + t * 0.012; m.position.set(Math.cos(a) * r, 120 + Math.sin(t * 0.2) * 4, Math.sin(a) * r); m.rotation.y = -a + Math.PI / 2; } });
    }

    // ---- planes crossing the map ----
    {
      const planes = [];
      for (let i = 0; i < 3; i++) {
        const fus = BABYLON.MeshBuilder.CreateCylinder('fus', { height: 10, diameterTop: 0.6, diameterBottom: 1.6, tessellation: 8 }, scene);
        fus.rotation.x = Math.PI / 2; Util.colorize(fus, '#ffffff');
        const wing = BABYLON.MeshBuilder.CreateBox('wing', { width: 12, height: 0.25, depth: 2.2 }, scene); Util.colorize(wing, rng.pick(['#ff5a5a', '#3d8bff', '#ffd42a']));
        const tail = BABYLON.MeshBuilder.CreateBox('tail', { width: 0.25, height: 2.6, depth: 2 }, scene); tail.position.set(0, 1.2, -4.5); Util.colorize(tail, '#ff5a5a');
        const htail = BABYLON.MeshBuilder.CreateBox('htail', { width: 4.5, height: 0.2, depth: 1.6 }, scene); htail.position.set(0, 0.3, -4.5); Util.colorize(htail, '#ffffff');
        const m = Util.merge([fus, wing, tail, htail], 'plane'); m.material = mat;
        const a = rng.range(0, 6.28);
        planes.push({ m, dx: Math.sin(a), dz: Math.cos(a), t0: rng.range(0, 60), y: rng.range(150, 220), speed: rng.range(45, 65), off: rng.range(-300, 300) });
      }
      const span = ctx.half * 2 + 400;
      movers.push({ update(dt, t) { for (const p of planes) { const d = ((t + p.t0) * p.speed) % span - span / 2; p.m.position.set(p.dx * d - p.dz * p.off, p.y, p.dz * d + p.dx * p.off); p.m.rotation.y = Math.atan2(p.dx, p.dz); p.m.rotation.z = Math.sin(t * 0.5) * 0.08; } } });
    }

    return { update(dt, t) { for (const m of movers) m.update(dt, t); } };
  },
});
