// Ambient camera-following particles keyed by the area the bike is in:
// falling leaves (forest), dust wisps (desert), snow sparkle (alpine),
// pollen (meadow). One system per kind, rates blended by biome weight.
const Ambient = (() => {
  let scene; const systems = {};
  function tex(kind) {
    const t = new BABYLON.DynamicTexture('amb_' + kind, { width: 32, height: 32 }, scene, false);
    const c = t.getContext(); c.clearRect(0, 0, 32, 32);
    if (kind === 'leaf') { c.fillStyle = '#ffb347'; c.beginPath(); c.ellipse(16, 16, 12, 6, 0.6, 0, Math.PI * 2); c.fill(); }
    else if (kind === 'dust') { const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(240,200,140,0.5)'); g.addColorStop(1, 'rgba(240,200,140,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); }
    else { const g = c.createRadialGradient(16, 16, 0, 16, 16, 10); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); }
    t.update(); t.hasAlpha = true; return t;
  }
  function make(kind, cfg) {
    const ps = new BABYLON.ParticleSystem('amb_' + kind, 1200, scene);
    ps.particleTexture = tex(cfg.tex);
    ps.emitter = new BABYLON.Vector3();
    ps.minEmitBox = new BABYLON.Vector3(-16, -2, -16); ps.maxEmitBox = new BABYLON.Vector3(16, cfg.top, 16);
    ps.blendMode = cfg.add ? BABYLON.ParticleSystem.BLENDMODE_ADD : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = cfg.size[0]; ps.maxSize = cfg.size[1];
    ps.direction1 = cfg.dir[0]; ps.direction2 = cfg.dir[1];
    ps.minLifeTime = cfg.life[0]; ps.maxLifeTime = cfg.life[1];
    ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2;
    ps.color1 = cfg.color; ps.color2 = cfg.color; ps.colorDead = new BABYLON.Color4(cfg.color.r, cfg.color.g, cfg.color.b, 0);
    ps.updateSpeed = 0.016; ps.emitRate = 0;
    if (cfg.noise) { ps.noiseStrength = new BABYLON.Vector3(2, 0.5, 2); }
    systems[kind] = { ps, base: cfg.rate, weightOf: cfg.weight };
  }
  function init(_scene) {
    scene = _scene;
    const V = (x, y, z) => new BABYLON.Vector3(x, y, z);
    make('leaf', { tex: 'leaf', top: 10, size: [0.18, 0.32], dir: [V(-1.5, -1.2, -1.5), V(1.5, -2.2, 1.5)], life: [5, 8], color: new BABYLON.Color4(1, 0.75, 0.35, 1), rate: 60, weight: 'leaves' });
    make('dust', { tex: 'dust', top: 3, size: [2.5, 5], dir: [V(3, 0.2, -1), V(6, 0.8, 1)], life: [3, 5], color: new BABYLON.Color4(1, 0.9, 0.7, 0.35), rate: 14, weight: 'dust' });
    make('sparkle', { tex: 'spark', top: 6, size: [0.08, 0.16], dir: [V(-0.3, -0.4, -0.3), V(0.3, -0.9, 0.3)], life: [2, 4], color: new BABYLON.Color4(1, 1, 1, 1), rate: 120, weight: 'sparkle', add: true });
    make('pollen', { tex: 'spark', top: 4, size: [0.05, 0.1], dir: [V(-0.5, -0.2, -0.5), V(0.5, 0.4, 0.5)], life: [3, 6], color: new BABYLON.Color4(1, 0.95, 0.6, 0.9), rate: 40, weight: 'butterflies' });
    make('petal', { tex: 'leaf', top: 10, size: [0.14, 0.24], dir: [V(-1.2, -0.6, -1.2), V(1.2, -1.4, 1.2)], life: [6, 9], color: new BABYLON.Color4(1, 0.7, 0.85, 1), rate: 70, weight: 'petals' });
  }
  function update(dt, camPos, forward, pose) {
    const w = Biome.weights(pose.x, pose.z);
    for (const k of Object.keys(systems)) {
      const s = systems[k];
      let f = 0; for (const n of Biome.NAMES) { const v = Biome.DEF[n][s.weightOf]; f += (v === true ? 1 : (v || 0)) * w[n]; }
      const want = s.base * f;
      s.ps.emitter.set(camPos.x + forward.x * 24, pose.y + 2, camPos.z + forward.z * 24);   // 8-40 m ahead: never right in the lens
      if (!s.ps.isStarted()) s.ps.start();   // always running; rate does the on/off
      s.ps.emitRate = want > 1 ? want : 0;
    }
  }
  return { init, update };
})();
