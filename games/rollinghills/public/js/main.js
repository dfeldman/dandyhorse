// Engine, scene, lights, sky, build order, and the game loop.
// Nothing runs at load: the platform adapter (src/main.ts) starts the Dandyhorse session, loads
// these scripts, then calls window.RollingHills.boot(platform). `platform` is the only thing the
// game reads from outside (measured values, pause state, clocks, save state); the returned handle
// is the only thing the adapter reads back (what to ask the machine for, position, score, image).
window.RollingHills = (() => {
  function boot(platform) {
    const canvas = document.getElementById('game-canvas');
    // preserveDrawingBuffer so the session image can read the frame back after a render
    const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: false, stencil: false, preserveDrawingBuffer: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = Util.hex4('#7ec2f7');
    scene.ambientColor = new BABYLON.Color3(0.55, 0.6, 0.7);

    // lights: low cartoon sun (so flat-shaded facets read as relief) + sky fill
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.62, -0.5, 0.45), scene);
    sun.intensity = 1.05; sun.diffuse = new BABYLON.Color3(1, 0.97, 0.9);
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55; hemi.diffuse = new BABYLON.Color3(0.85, 0.92, 1); hemi.groundColor = new BABYLON.Color3(0.45, 0.5, 0.4);

    // gentle grade: a little contrast + saturation and a soft vignette (applied in-shader, no extra pass)
    {
      const ip = scene.imageProcessingConfiguration;
      ip.contrast = 1.12; ip.exposure = 1.02;
      ip.vignetteEnabled = true; ip.vignetteWeight = 1.6; ip.vignetteStretch = 0.4;
      ip.vignetteColor = new BABYLON.Color4(0.05, 0.08, 0.16, 0);
      ip.vignetteCameraFov = 1.0;
      const curves = new BABYLON.ColorCurves(); curves.globalSaturation = 18;
      ip.colorCurves = curves; ip.colorCurvesEnabled = true;
    }

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00075;
    scene.fogColor = Util.hex('#a9d8fb');

    // gradient sky dome + sun disc (Daylight recolors the dome each frame)
    let skyMat, sunMat, skyMesh;
    {
      const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 5200, segments: 12, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
      const pos = sky.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const cols = new Float32Array((pos.length / 3) * 4);
      const top = Util.hex('#3f8ff0'), mid = Util.hex('#7ec2f7'), low = Util.hex('#d6f0ff');
      for (let i = 0; i < pos.length / 3; i++) {
        const y = pos[i * 3 + 1] / 2600;
        const c = y > 0.25 ? BABYLON.Color3.Lerp(mid, top, Util.smoothstep(0.25, 1, y)) : BABYLON.Color3.Lerp(low, mid, Util.smoothstep(-0.1, 0.25, y));
        cols[i * 4] = c.r; cols[i * 4 + 1] = c.g; cols[i * 4 + 2] = c.b; cols[i * 4 + 3] = 1;
      }
      sky.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
      skyMat = new BABYLON.StandardMaterial('skyMat', scene);
      skyMat.disableLighting = true; skyMat.emissiveColor = new BABYLON.Color3(1, 1, 1); skyMat.diffuseColor = BABYLON.Color3.Black();
      skyMat.fogEnabled = false; skyMat.backFaceCulling = false;
      sky.material = skyMat; sky.isPickable = false; sky.infiniteDistance = true; sky.applyFog = false; skyMesh = sky;
      const sunDisc = BABYLON.MeshBuilder.CreateDisc('sunDisc', { radius: 110, tessellation: 24 }, scene);
      sunDisc.position = new BABYLON.Vector3(1100, 1650, -900);
      sunDisc.lookAt(BABYLON.Vector3.Zero()); sunDisc.rotation.y += Math.PI;
      sunMat = new BABYLON.StandardMaterial('sunMat', scene);
      sunMat.disableLighting = true; sunMat.emissiveColor = Util.hex('#fff4b0'); sunMat.fogEnabled = false; sunMat.backFaceCulling = false;
      sunDisc.material = sunMat; sunDisc.infiniteDistance = true; sunDisc.applyFog = false;
    }

    const t0 = performance.now();
    Terrain.build(scene);
    console.log('terrain', (performance.now() - t0).toFixed(0), 'ms; trail', Track.length, 'm; route', Config.ROUTE_NAME, '; device', Config.DEVICE_TYPE);
    Decor.buildAll(scene);
    Segments.bests = platform.bests;
    Segments.onBest = platform.saveBest;
    Segments.build();
    console.log('segments', Segments.list.map(s => `${s.name} ${s.s0}-${s.s1} (${s.len} m, +${s.gain.toFixed(0)} m)`).join('; '));
    Hud.init(platform);
    const bike = Bike.create(scene, { color: '#ff5a5a' });
    Camera.init(scene);
    scene.activeCamera = Camera.camera;
    Weather.init(scene, { sun, hemi, skyMat, sunMat, cloudMat: scene.getMaterialByName('cloudMat') });
    Ambient.init(scene);
    // night bloom on windows / lamps / lanterns only
    const glowLayer = new BABYLON.GlowLayer('nightGlow', scene, { mainTextureSamples: 1, blurKernelSize: 24, mainTextureRatio: 0.5 });
    glowLayer.intensity = 0;
    for (const m of Decor.glowers) glowLayer.addIncludedOnlyMesh(m);
    for (const m of bike.root.getChildMeshes()) if (m.name === 'headLamp' || m.name === 'tailLamp') glowLayer.addIncludedOnlyMesh(m);
    Daylight.init(scene, { sun, hemi, sky: skyMesh, skyMat, sunMat, cloudMat: scene.getMaterialByName('cloudMat'), glow: glowLayer, poolMat: Decor.poolMat });

    // cascaded sun shadows near the bike; terrain only receives
    let shadowGen = null;
    if (Config.SHADOWS) {
      shadowGen = new BABYLON.CascadedShadowGenerator(Config.SHADOW_MAP, sun);
      shadowGen.numCascades = 2; shadowGen.shadowMaxZ = Config.SHADOW_MAX_Z; shadowGen.lambda = 0.8;
      shadowGen.stabilizeCascades = true; shadowGen.depthClamp = true; shadowGen.autoCalcDepthBounds = false;
      shadowGen.filter = BABYLON.ShadowGenerator.FILTER_PCF; shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_LOW;
      shadowGen.bias = 0.01; shadowGen.normalBias = 0.02;
      shadowGen.cascadeBlendPercentage = 0.1;
      for (const m of Decor.casters) shadowGen.addShadowCaster(m, false);
      for (const m of bike.root.getChildMeshes()) if (m.name !== 'shadow' && m.name !== 'spokeDisc') shadowGen.addShadowCaster(m, false);
      sun.shadowMinZ = 1; sun.shadowMaxZ = Config.SHADOW_MAX_Z;
    }
    // per-area atmosphere tint, applied after Weather writes the fog color
    const areaFog = {}; for (const n of Biome.NAMES) areaFog[n] = Biome.DEF[n].fogC;
    const fogTmp = new BABYLON.Color3();

    // --- ride state machine: waiting -> riding (<-> paused) -> finished -> ended ---
    const isBike = Config.DEVICE_TYPE === 'bike';
    let elapsed = 0, started = false, lastLap = 0, gameOver = false, endedShown = false, pausedShown = false;
    let state = Ride.update({ power: null, speed: null }, 0, false);
    let area = Biome.dominant(Track.poseAt(0).x, Track.poseAt(0).z).name;
    Hud.setArea(Biome.LABELS[area]);
    Hud.setWeather(Weather.LABELS.sunny);
    Hud.banner(isBike ? 'PEDAL TO START' : 'START WALKING', 1e9);
    Weather.onChange = (name, label) => { Hud.setWeather(label); if (started) Hud.banner(label, 1600); };
    Segments.onEvent = (type, seg, t, isBest) => {
      if (type === 'start') Hud.banner(seg.name + ' START', 1500);
      else {
        Hud.banner(`${seg.name} ${Hud.fmtSeg(t)}${isBest ? '  NEW BEST!' : ''}`, 2600);
        if (seg.kind === 'kom') platform.achievement('kom');
        if (seg.kind === 'sprint') platform.achievement('sprint');
      }
    };

    const fwd = new BABYLON.Vector3();
    let frames = 0, simTime = 0;

    // The ride keeps wall-clock time even when frames are slow (throttled tab, weak GPU): the
    // simulation runs in substeps of at most 50 ms, catching up at most 2 s per frame.
    function simulate(dt) {
      const m = platform.measured();
      const ended = platform.ended();
      const paused = !ended && !gameOver && platform.paused();
      const drive = isBike ? m.power : m.speed;
      const threshold = isBike ? Config.START_POWER : Config.START_SPEED;
      if (!started && !paused && !ended && drive != null && drive > threshold) { started = true; Hud.banner('GO!', 1200); }
      if (paused !== pausedShown) { pausedShown = paused; Hud.setPaused(paused, platform.pauseMessage()); }
      const active = started && !gameOver && !paused && !ended;
      const prevS = Ride.s;
      state = Ride.update(m, dt, active);
      if (active) {
        elapsed += dt; simTime += dt;
        if (state.laps !== lastLap) { lastLap = state.laps; Hud.banner('LAP ' + (state.laps + 1) + '!', 1500); platform.achievement('first-lap'); }
        Segments.update(prevS, state.s, dt);
        // area banner with hysteresis so it doesn't flicker across blends
        const d = Biome.dominant(state.pose.x, state.pose.z);
        if (d.name !== area && d.w > 0.6) { area = d.name; Hud.setArea(Biome.LABELS[area]); Hud.banner(Biome.LABELS[area], 2000); }
      }
      // the countdown runs on the platform's active clock, so it can run out before the first pedal stroke too
      if (!gameOver && !ended && Config.WORKOUT_SECONDS - platform.activeSeconds() <= 0) {
        gameOver = true;
        if (started) platform.achievement('full-ride');
        const dist = platform.fmt.distance(state.dist);
        Hud.banner(`RIDE COMPLETE  ${dist.value} ${dist.unit}`, 8000);
        platform.finish();   // ends the session (with the session image); platform.ended() reports back
      }
      if (ended && !endedShown) {
        endedShown = true;
        const dist = platform.fmt.distance(state.dist);
        if (ended.status === 'complete') Hud.showEnded('RIDE COMPLETE', `${dist.value} ${dist.unit} · ${state.laps} lap${state.laps === 1 ? '' : 's'} · saved to your history`);
        else Hud.showEnded('RIDE ENDED', ended.reason ? `The session ended (${ended.reason}).` : 'The session ended on another screen.');
      }
      return m;
    }

    function frame(dtReal) {
      frames++;
      let rem = Math.min(2, dtReal), m = null;
      while (rem > 1e-6) { const h = Math.min(0.05, rem); m = simulate(h); rem -= h; }
      if (!m) m = platform.measured();
      const dt = Math.min(0.05, dtReal);
      // the bike and camera smooth exponentially, so they may take the real frame time and stay put at low fps
      const dtVis = Math.min(1, dtReal);
      bike.update(state.pose, state.v, state.pedaling ? 100 : 0, dtVis);
      Camera.update(state.pose, state.v, dtVis, state.laps % 2 ? -1 : 1);
      fwd.set(state.pose.hx, 0, state.pose.hz);
      Weather.update(dt, Camera.camera.position, fwd);
      {
        const w = Biome.weights(state.pose.x, state.pose.z);
        fogTmp.set(0, 0, 0);
        for (const n of Biome.NAMES) { const c = areaFog[n]; fogTmp.r += c.r * w[n]; fogTmp.g += c.g * w[n]; fogTmp.b += c.b * w[n]; }
        BABYLON.Color3.LerpToRef(scene.fogColor, fogTmp, 0.35 * (Weather.name === 'sunny' ? 1 : 0.5), scene.fogColor);
      }
      Daylight.update(dt);
      bike.setNight(Daylight.night);
      Hud.setTime(Daylight.label);
      Ambient.update(dt, Camera.camera.position, fwd, state.pose);
      Terrain.update(elapsed);
      Decor.update(dt, elapsed);
      Hud.update(state, m, Config.WORKOUT_SECONDS - platform.activeSeconds());
    }
    // wall-clock frame time (the engine's own delta is not reliable when the browser throttles frames)
    let lastFrameAt = performance.now();
    engine.runRenderLoop(() => { const now = performance.now(); frame((now - lastFrameAt) / 1000); lastFrameAt = now; scene.render(); });
    window.addEventListener('resize', () => engine.resize());
    if (Config.DEBUG) {
      // debug sessions only: force weather / time of day
      window.addEventListener('keydown', (e) => {
        if (e.key === '1') Weather.set('sunny'); if (e.key === '2') Weather.set('cloudy'); if (e.key === '3') Weather.set('rain'); if (e.key === '4') Weather.set('snow');
        if (e.key === '5') Daylight.set('day'); if (e.key === '6') Daylight.set('dusk'); if (e.key === '7') Daylight.set('night'); if (e.key === '8') Daylight.set('dawn');
      });
    }

    // The picture History keeps: the last frame with the profile strip and the numbers on it.
    function snapshot(W = 640, H = 360) {
      scene.render();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const sw = canvas.width, sh = canvas.height, sc = Math.max(W / sw, H / sh), dw = sw * sc, dh = sh * sc;
      g.drawImage(canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return { canvas: c, g };
    }
    function sessionImage() {
      try {
        const { canvas: c, g } = snapshot();
        const W = c.width, H = c.height;
        g.fillStyle = 'rgba(20,40,80,.55)'; g.beginPath(); g.roundRect(16, H - 96, W - 32, 80, 12); g.fill();
        Hud.drawProfileTo(g, 24, H - 90, W - 48, 44, state.s);
        const dist = platform.fmt.distance(state.dist);
        const kom = Segments.list.find(s => s.kind === 'kom');
        const line = [`${dist.value} ${dist.unit}`, `${state.laps} lap${state.laps === 1 ? '' : 's'}`, Hud.fmtTime(platform.activeSeconds()),
          kom && kom.best != null ? `KOM ${Hud.fmtSeg(kom.best)}` : null, Config.ROUTE.label.toLowerCase(), `seed ${Config.SEED}`].filter(Boolean).join('  ·  ');
        g.font = '800 18px "Baloo 2", "Comic Sans MS", sans-serif'; g.fillStyle = '#fff'; g.textBaseline = 'bottom';
        g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
        g.fillText(line, 28, H - 22);
        return c.toDataURL('image/jpeg', 0.85);
      } catch (e) { console.warn('session image failed', e); return null; }
    }

    // debug handles; step(dt, n) advances the simulation without waiting for frames
    window.__game = {
      scene, engine, bike, Ride, Track, Terrain, Biome, Weather, Daylight, Segments, Config, shadowGen, platform,
      step: (dt, n = 1) => { for (let i = 0; i < n; i++) frame(dt); scene.render(); },
      jump: (name, back = 40) => { const th = Biome.sectorMid(name); const r = Loop.radiusAt(th); const n = Track.nearest(Math.cos(th) * r, Math.sin(th) * r); Ride.setS(n.s - back); for (let i = 0; i < 120; i++) frame(1 / 60); scene.render(); return n.s; },
      timeFrames: (n = 30) => { const gl = engine._gl; const t0 = performance.now(); for (let i = 0; i < n; i++) { frame(1 / 60); scene.render(); if (gl && gl.finish) gl.finish(); } return (performance.now() - t0) / n; },
      snapshot: (w, h) => snapshot(w, h).canvas.toDataURL('image/png'),
      stats: () => ({ frames, simTime, elapsed, started, gameOver, s: Ride.s, dist: Ride.dist, v: Ride.v }),
      sessionImage,
    };

    // the handle the platform adapter polls once a second
    return {
      tick: () => ({
        request: state.request, v: state.v, grade: state.grade,
        pos: { x: state.pose.x, y: state.pose.y, z: state.pose.z },
        dist: state.dist, laps: state.laps, started, finished: gameOver,
        area: Biome.LABELS[area], weather: Weather.name, segment: Segments.active ? Segments.active.seg.kind : null,
      }),
      sessionImage,
    };
  }

  return { boot };
})();
