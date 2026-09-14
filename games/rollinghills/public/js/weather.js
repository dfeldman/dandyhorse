// Fast-cycling cartoon weather: sunny / cloudy / rain / snow. Blends light,
// fog, sky tint and cloud color between states and runs a camera-following
// particle system for precipitation.
const Weather = (() => {
  const STATES = {
    sunny:  { sun: 1.05, hemi: 0.55, fog: 0.00075, fogColor: '#a9d8fb', sky: 1.0, cloud: 1.0, sunDisc: 1, precip: null },
    cloudy: { sun: 0.62, hemi: 0.5, fog: 0.0011, fogColor: '#b9c6d3', sky: 0.74, cloud: 0.8, sunDisc: 0, precip: null },
    rain:   { sun: 0.42, hemi: 0.45, fog: 0.0017, fogColor: '#8f9daa', sky: 0.55, cloud: 0.58, sunDisc: 0, precip: 'rain' },
    snow:   { sun: 0.72, hemi: 0.62, fog: 0.0015, fogColor: '#d8dfe7', sky: 0.82, cloud: 0.92, sunDisc: 0, precip: 'snow' },
  };
  const CYCLE = ['sunny', 'cloudy', 'rain', 'cloudy', 'sunny', 'snow', 'sunny'];
  const LABELS = { sunny: '☀ Sunny', cloudy: '☁ Cloudy', rain: '🌧 Rain', snow: '❄ Snow' };
  let scene, refs, rng;
  let idx = 0, current = 'sunny', target = 'sunny', blend = 1, timer = 0, hold = 90;
  const cur = {};   // blended numeric parameters
  const c1 = new BABYLON.Color3(), c2 = new BABYLON.Color3();
  let rain = null, snow = null;
  let onChange = null;

  function precipTexture(kind) {
    const tex = new BABYLON.DynamicTexture('precip_' + kind, { width: 32, height: 64 }, scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 32, 64);
    if (kind === 'rain') {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(210,230,255,0)'); g.addColorStop(0.5, 'rgba(210,230,255,0.9)'); g.addColorStop(1, 'rgba(210,230,255,0)');
      ctx.fillStyle = g; ctx.fillRect(13, 0, 6, 64);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(16, 32, 11, 0, Math.PI * 2); ctx.fill();
    }
    tex.update(); tex.hasAlpha = true;
    return tex;
  }
  function makeSystem(kind) {
    const ps = new BABYLON.ParticleSystem(kind, kind === 'rain' ? 4000 : 2500, scene);
    ps.particleTexture = precipTexture(kind);
    ps.emitter = new BABYLON.Vector3(0, 0, 0);
    ps.minEmitBox = new BABYLON.Vector3(-18, 0, -18); ps.maxEmitBox = new BABYLON.Vector3(18, 4, 18);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    if (kind === 'rain') {
      ps.minSize = 0.12; ps.maxSize = 0.2; ps.minScaleY = 6; ps.maxScaleY = 9;
      ps.direction1 = new BABYLON.Vector3(-1.5, -22, -1); ps.direction2 = new BABYLON.Vector3(1.5, -26, 1);
      ps.minLifeTime = 0.9; ps.maxLifeTime = 1.1; ps.emitRate = 2600;
      ps.color1 = new BABYLON.Color4(0.8, 0.9, 1, 0.55); ps.color2 = new BABYLON.Color4(0.8, 0.9, 1, 0.55); ps.colorDead = new BABYLON.Color4(0.8, 0.9, 1, 0);
    } else {
      ps.minSize = 0.18; ps.maxSize = 0.34;
      ps.direction1 = new BABYLON.Vector3(-1.2, -2.2, -1.2); ps.direction2 = new BABYLON.Vector3(1.2, -3.2, 1.2);
      ps.minLifeTime = 5; ps.maxLifeTime = 7; ps.emitRate = 900;
      ps.minAngularSpeed = -1; ps.maxAngularSpeed = 1;
      ps.color1 = new BABYLON.Color4(1, 1, 1, 0.95); ps.color2 = new BABYLON.Color4(1, 1, 1, 0.95); ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    }
    ps.updateSpeed = 0.016;
    ps.isLocal = false;
    return ps;
  }

  function init(_scene, _refs) {
    scene = _scene; refs = _refs; rng = Rng.stream('weather:' + Date.now());
    Object.assign(cur, STATES.sunny);
    hold = rng.range(70, 140);
    rain = makeSystem('rain'); snow = makeSystem('snow');
  }

  function set(name) { if (!STATES[name] || name === target) return; current = target; target = name; blend = 0; if (onChange) onChange(name, LABELS[name]); }

  function update(dt, camPos, forward) {
    timer += dt;
    if (timer > hold) { timer = 0; hold = rng.range(60, 150); idx = (idx + 1) % CYCLE.length; set(CYCLE[idx]); }
    if (blend < 1) blend = Math.min(1, blend + dt / 7);
    const A = STATES[current], B = STATES[target];
    for (const k of ['sun', 'hemi', 'fog', 'sky', 'cloud', 'sunDisc']) cur[k] = A[k] + (B[k] - A[k]) * blend;
    c1.copyFrom(BABYLON.Color3.FromHexString(A.fogColor)); c2.copyFrom(BABYLON.Color3.FromHexString(B.fogColor));
    const fogC = BABYLON.Color3.Lerp(c1, c2, blend);
    refs.sun.intensity = cur.sun; refs.hemi.intensity = cur.hemi;
    scene.fogDensity = cur.fog; scene.fogColor.copyFrom(fogC);
    refs.skyMat.emissiveColor.set(cur.sky, cur.sky, cur.sky);
    refs.sunMat.alpha = cur.sunDisc;
    if (refs.cloudMat) { refs.cloudMat.diffuseColor.set(cur.cloud, cur.cloud, cur.cloud); const e = 0.4 * cur.cloud; refs.cloudMat.emissiveColor.set(e * 0.9, e * 0.95, e); }
    // precipitation follows the camera, a little ahead so drops fall through the view
    const ex = camPos.x + forward.x * 10, ez = camPos.z + forward.z * 10;
    for (const [ps, kind] of [[rain, 'rain'], [snow, 'snow']]) {
      const want = (B.precip === kind ? blend : 0) + (A.precip === kind ? 1 - blend : 0);
      ps.emitter.set(ex, camPos.y + (kind === 'rain' ? 16 : 12), ez);
      if (!ps.isStarted()) ps.start();   // always running; rate does the on/off
      ps.emitRate = want > 0.02 ? (kind === 'rain' ? 2600 : 900) * want : 0;
    }
  }

  return { init, update, set, STATES, LABELS, get name() { return target; }, set onChange(f) { onChange = f; } };
})();
