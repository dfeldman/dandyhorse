import { Biome } from './biome.js'
import { Config } from './config.js'
import { Loop } from './loop.js'
import { Rng } from './rng.js'
import { Terrain } from './terrain.js'
import { Track } from './track.js'

// Decorator registry. Each decorator is a small module that registers
//   Decor.register({ name, build(scene, ctx), update(dt, t) })
// ctx exposes the generated world so decorators can place themselves
// sensibly (off the trail, out of the water, on gentle ground).
// Add a new file under js/decor/, include it in index.html, done.
const Decor = (() => {
  const defs = [];
  const live = [];
  const casters = [];   // meshes that should cast sun shadows (main wires them up)
  const glowers = [];   // meshes that light up at night (bloom layer)
  let poolMat = null;   // lamp light-pool material (Daylight fades it)

  function register(def) { defs.push(def); }

  function makeCtx(scene) {
    const HALF = Terrain.HALF;
    const ctx = {
      scene,
      rng: (name) => Rng.stream('decor:' + name),
      heightAt: Terrain.heightAt,
      rawHeight: Terrain.rawHeight,
      isWater: Terrain.isWater,
      waterY: Config.WATER_Y,
      half: HALF,
      poseAt: Track.poseAt,
      nearest: Track.nearest,
      trackLength: Track.length,
      bridges: Track.bridges,
      basins: Terrain.basins,
      shadow: (mesh) => { if (mesh) for (const m of (mesh.__chunks || [mesh])) casters.push(m); return mesh; },
      glow: (mesh) => { if (mesh) for (const m of (mesh.__chunks || [mesh])) glowers.push(m); return mesh; },
      poolMat: (m) => { poolMat = m; },
      biome: Biome.dominant,          // (x,z) -> {name, w}
      biomeWeights: Biome.weights,
      sectors: Biome.sectors,
      // trail arc-length at a fraction (0..1) through the given biome sector
      sectorS: (name, frac) => {
        const sec = Biome.sectors.find(s => s.name === name);
        const th = sec.a0 + (sec.a1 - sec.a0) * frac;
        const r = Loop.radiusAt(th);
        const n = Track.nearest(Math.cos(th) * r, Math.sin(th) * r);
        return n ? n.s : 0;
      },
      // slope (0 = flat) from finite differences
      slopeAt: (x, z) => {
        const e = 2;
        const dx = Terrain.heightAt(x + e, z) - Terrain.heightAt(x - e, z);
        const dz = Terrain.heightAt(x, z + e) - Terrain.heightAt(x, z - e);
        return Math.hypot(dx, dz) / (2 * e);
      },
      // distance to the trail (30+ means "far")
      trailDist: (x, z) => { const n = Track.nearest(x, z); return n ? n.d : 999; },
      // common placement filter: on land, off the trail, not too steep, in bounds
      okSpot: (x, z, { minTrail = 4, maxSlope = 0.5, margin = 40, aboveWater = 0.6 } = {}) => {
        if (Math.abs(x) > HALF - margin || Math.abs(z) > HALF - margin) return false;
        const h = Terrain.heightAt(x, z);
        if (h < Config.WATER_Y + aboveWater) return false;
        if (ctx.trailDist(x, z) < minTrail) return false;
        if (ctx.slopeAt(x, z) > maxSlope) return false;
        return true;
      },
      // a point beside the trail at arc-length s, offset meters to the left (+) or right (-)
      besideTrail: (s, offset) => {
        const p = Track.poseAt(s);
        const x = p.x - p.hz * offset, z = p.z + p.hx * offset;
        return { x, z, y: Terrain.heightAt(x, z), pose: p };
      },
    };
    return ctx;
  }

  function buildAll(scene) {
    const ctx = makeCtx(scene);
    for (const d of defs) {
      const t0 = performance.now();
      try {
        const inst = d.build(scene, ctx) || {};
        live.push({ name: d.name, update: inst.update || d.update || null });
      } catch (e) { console.error('decor ' + d.name + ' failed', e); }
      console.log(`decor ${d.name}: ${(performance.now() - t0).toFixed(0)} ms`);
    }
  }

  function update(dt, t) { for (const l of live) if (l.update) l.update(dt, t); }

  return { register, buildAll, update, casters, glowers, get poolMat() { return poolMat; } };
})();

export { Decor }
