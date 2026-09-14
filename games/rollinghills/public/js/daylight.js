// Day / dusk / night / dawn cycle. Modulates whatever Weather set this
// frame (sun, sky fill, fog, sky dome colors), fades in stars and a moon,
// and drives the "glow" material used by windows, lamps and lanterns.
//   Daylight.night (0..1), Daylight.dusk (0..1 orange peak at the transitions)
const Daylight = (() => {
  const H = Util.hex;
  let scene, refs, elapsed = 0, phase = 0;
  let night = 0, dusk = 0, label = '';
  const CYCLE = () => Config.DAY_CYCLE;
  // sky gradients (top, mid, horizon) for day / dusk / night
  const SKY = {
    day:   [H('#3f8ff0'), H('#7ec2f7'), H('#d6f0ff')],
    dusk:  [H('#3a2d6e'), H('#c85a7a'), H('#ffb35a')],
    night: [H('#060a1c'), H('#101a3c'), H('#22305c')],
  };
  const NIGHT_FOG = H('#141c34'), DUSK_FOG = H('#d98a6a');
  const tmpA = new BABYLON.Color3(), tmpB = new BABYLON.Color3();
  let skyPos = null, skyCols = null;

  function phaseFor(name) { return { day: 0.1, dusk: 0.48, night: 0.7, dawn: 0.92 }[name] ?? 0.1; }

  function init(_scene, _refs) {
    scene = _scene; refs = _refs;
    phase = phaseFor(Config.START_TIME);
    skyPos = refs.sky.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    skyCols = new Float32Array((skyPos.length / 3) * 4);
    refs.sky.setVerticesData(BABYLON.VertexBuffer.ColorKind, skyCols, true, 4);
    // stars: dots on a dome just inside the sky sphere
    const tex = new BABYLON.DynamicTexture('stars', { width: 1024, height: 512 }, scene, false);
    const c = tex.getContext(); c.clearRect(0, 0, 1024, 512);
    const r = Rng.stream('stars');
    for (let i = 0; i < 900; i++) { const s = r.range(0.6, 2.2); c.fillStyle = `rgba(255,255,${r.int(200, 255)},${r.range(0.5, 1)})`; c.beginPath(); c.arc(r.range(0, 1024), r.range(0, 256), s, 0, Math.PI * 2); c.fill(); }
    tex.update(); tex.hasAlpha = true;
    const stars = BABYLON.MeshBuilder.CreateSphere('stars', { diameter: 5000, segments: 12, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const sm = new BABYLON.StandardMaterial('starMat', scene);
    sm.diffuseTexture = tex; sm.opacityTexture = tex; sm.emissiveColor = new BABYLON.Color3(1, 1, 1); sm.disableLighting = true; sm.fogEnabled = false; sm.backFaceCulling = false; sm.alpha = 0;
    stars.material = sm; stars.infiniteDistance = true; stars.applyFog = false; stars.isPickable = false; stars.rotation.x = 0.4;
    refs.stars = stars;
    const moon = BABYLON.MeshBuilder.CreateDisc('moon', { radius: 70, tessellation: 24 }, scene);
    moon.position = new BABYLON.Vector3(-1300, 1500, 900); moon.lookAt(BABYLON.Vector3.Zero()); moon.rotation.y += Math.PI;
    const mm = new BABYLON.StandardMaterial('moonMat', scene);
    mm.disableLighting = true; mm.emissiveColor = H('#f4f1dc'); mm.fogEnabled = false; mm.backFaceCulling = false; mm.alpha = 0;
    moon.material = mm; moon.infiniteDistance = true; moon.applyFog = false;
    refs.moon = moon;
  }

  function set(name) { phase = phaseFor(name); }

  // phase -> night/dusk factors. 0..0.45 day, 0.45..0.55 dusk, 0.55..0.88 night, 0.88..0.98 dawn
  function factors(p) {
    let n = 0, d = 0;
    if (p >= 0.45 && p < 0.55) { const t = (p - 0.45) / 0.1; n = Util.smoothstep(0, 1, t); d = Math.sin(t * Math.PI); }
    else if (p >= 0.55 && p < 0.88) n = 1;
    else if (p >= 0.88 && p < 0.98) { const t = (p - 0.88) / 0.1; n = 1 - Util.smoothstep(0, 1, t); d = Math.sin(t * Math.PI) * 0.8; }
    return { n, d };
  }

  function update(dt) {
    elapsed += dt;
    phase = (phase + dt / CYCLE()) % 1;
    const f = factors(phase); night = f.n; dusk = f.d;
    label = night > 0.6 ? '🌙 Night' : dusk > 0.4 ? (phase < 0.6 ? '🌇 Dusk' : '🌅 Dawn') : '';
    // lights: Weather already wrote its values this frame; scale them
    refs.sun.intensity *= (1 - 0.88 * night) * (1 - 0.45 * dusk);
    refs.hemi.intensity *= 1 - 0.3 * dusk;
    BABYLON.Color3.LerpToRef(refs.sun.diffuse, H('#ff9a4a'), dusk * 0.7, tmpA);
    BABYLON.Color3.LerpToRef(tmpA, H('#9fb4ff'), night, refs.sun.diffuse);
    refs.hemi.intensity *= 1 - 0.65 * night;
    BABYLON.Color3.LerpToRef(refs.hemi.diffuse, H('#5a6aa8'), night, refs.hemi.diffuse);
    scene.ambientColor.set(0.55 - 0.4 * night, 0.6 - 0.45 * night, 0.7 - 0.45 * night);
    // fog + clear color
    BABYLON.Color3.LerpToRef(scene.fogColor, DUSK_FOG, dusk * 0.5, tmpA);
    BABYLON.Color3.LerpToRef(tmpA, NIGHT_FOG, night, scene.fogColor);
    scene.clearColor.set(scene.fogColor.r, scene.fogColor.g, scene.fogColor.b, 1);
    // sky dome vertex colors: day -> dusk -> night gradients
    const skyMul = refs.skyMat.emissiveColor.r;   // weather darkening (gray in rain)
    for (let i = 0; i < skyPos.length / 3; i++) {
      const y = skyPos[i * 3 + 1] / 2600;
      const grad = (g) => { if (y > 0.25) return BABYLON.Color3.Lerp(g[1], g[0], Util.smoothstep(0.25, 1, y)); return BABYLON.Color3.Lerp(g[2], g[1], Util.smoothstep(-0.1, 0.25, y)); };
      const dayC = grad(SKY.day), duskC = grad(SKY.dusk), nightC = grad(SKY.night);
      BABYLON.Color3.LerpToRef(dayC, duskC, dusk, tmpA);
      BABYLON.Color3.LerpToRef(tmpA, nightC, night, tmpB);
      skyCols[i * 4] = tmpB.r; skyCols[i * 4 + 1] = tmpB.g; skyCols[i * 4 + 2] = tmpB.b; skyCols[i * 4 + 3] = 1;
    }
    refs.sky.updateVerticesData(BABYLON.VertexBuffer.ColorKind, skyCols);
    refs.skyMat.emissiveColor.set(skyMul, skyMul, skyMul);
    refs.sunMat.alpha *= 1 - night;
    BABYLON.Color3.LerpToRef(H('#fff4b0'), H('#ff7a3a'), dusk, refs.sunMat.emissiveColor);
    refs.stars.material.alpha = night * (0.4 + 0.6 * refs.skyMat.emissiveColor.r);
    refs.moon.material.alpha = night;
    refs.stars.rotation.y = elapsed * 0.004;
    // clouds go dark
    if (refs.cloudMat) { const e = refs.cloudMat.emissiveColor; e.set(e.r * (1 - 0.8 * night), e.g * (1 - 0.8 * night), e.b * (1 - 0.7 * night)); refs.cloudMat.diffuseColor.scaleInPlace(1 - 0.7 * night); }
    // glow material: windows / lamps / lanterns light up
    const g = Math.max(night, dusk * 0.5);
    Util.glowMat(scene).emissiveColor.set(1.0 * g, 0.82 * g, 0.45 * g);
    if (refs.glow) refs.glow.intensity = 0.9 * g;
    if (refs.poolMat) refs.poolMat.alpha = 0.55 * g;
    // post: keep exposure up a touch at night so it's readable, more vignette
    const ip = scene.imageProcessingConfiguration;
    ip.exposure = 1.02 + 0.2 * night; ip.vignetteWeight = 1.6 + 1.2 * night;
  }

  return { init, update, set, get night() { return night; }, get dusk() { return dusk; }, get label() { return label; }, get phase() { return phase; } };
})();
