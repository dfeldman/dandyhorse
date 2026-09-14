// Engine, scene, camera, game loop, scoring, workout timer, trainer
// resistance, turbo, NPC races. Level mechanics come from Levels.current.
(() => {
  Levels.apply(Config.DEFAULT_LEVEL);

  const canvas = document.getElementById('game-canvas');
  const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: false });
  const scene = new BABYLON.Scene(engine);

  let score = 0, ringsHit = 0, ringsPassed = 0, streak = 0, passes = 0;
  let elapsed = 0;
  let workoutLeft = Config.WORKOUT_SECONDS;
  let floatUntil = -1;
  let gameOver = false;

  // Trainer resistance (0-100). Displayed always; a real trainer subscribes
  // by assigning window.onResistanceChange = (r) => { ... }.
  let resistance = Config.RESIST_TAKEOFF;
  let lastSentResistance = -1;
  let tailwinds = [];   // expiry timestamps of active Tailwind boosts

  // Turbo
  let turboMeter = 0;
  let turboUntil = -1;

  // Ring-hit speed pulses
  let ringBoost = 0;

  // Races: first one on lap 2; after each, a rest lap before the next
  let raceActive = false, raceEndS = 0, nextRaceLap = 2;

  Input.init();
  Hud.init();
  World.build(scene);
  Plane.build(scene);
  Rings.build(scene, onRingResult, onPickup);
  Rivals.build(scene);

  // The plane and rivals cast sun shadows too
  for (const mesh of scene.meshes) {
    if (mesh.parent && mesh.parent.name === 'planeRoot') World.addShadowCaster(mesh);
    if (mesh.name.startsWith('rival')) World.addShadowCaster(mesh);
  }

  // Rings, stars, and beacons glow; everything else stays matte
  {
    const glow = new BABYLON.GlowLayer('glow', scene, { mainTextureSamples: 2, blurKernelSize: 16 });
    glow.intensity = 0.5;   // tight halo: additive glow can't respect occlusion,
                            // so keep the bleed subtle
    for (const mesh of scene.meshes) {
      // rings/stars now carry depth-tested halo meshes instead (no bleed);
      // the glow layer only serves far point lights
      if (mesh.name.startsWith('radioL') || mesh.name === 'sunDisc' || mesh.name === 'gateOrb') {
        glow.addIncludedOnlyMesh(mesh);
      }
    }
  }

  // Gentle grade: a little contrast and a soft vignette
  {
    const ipc = scene.imageProcessingConfiguration;
    ipc.contrast = 1.07;
    ipc.exposure = 1.12;
    ipc.vignetteEnabled = true;
    ipc.vignetteWeight = 1.0;
    ipc.vignetteColor = new BABYLON.Color4(0.02, 0.07, 0.16, 0);
    ipc.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  }

  // --- Chase camera (not parented; peeks into the turn) ---
  const camera = new BABYLON.TargetCamera('cam', new BABYLON.Vector3(0, 0, 0), scene);
  camera.maxZ = 9000;
  camera.fov = 0.9;
  {
    const f = Plane.getForward();
    camera.position.set(f.px - f.tx * Config.CAM_BACK, f.py + Config.CAM_UP, f.pz - f.tz * Config.CAM_BACK);
  }

  function updateCamera(dt, turboActive) {
    const f = Plane.getForward();
    const desired = new BABYLON.Vector3(
      f.px - f.tx * Config.CAM_BACK,
      f.py + Config.CAM_UP,
      f.pz - f.tz * Config.CAM_BACK
    );
    const k = 1 - Math.exp(-dt / Config.CAM_TAU);
    camera.position.x += (desired.x - camera.position.x) * k;
    camera.position.y += (desired.y - camera.position.y) * k;
    camera.position.z += (desired.z - camera.position.z) * k;
    let tx = f.px + f.tx * Config.CAM_LOOKAHEAD;
    let tz = f.pz + f.tz * Config.CAM_LOOKAHEAD;
    if (Plane.state.s > 0) {
      // Fade the into-the-turn bias in over the first 150 m of the circle —
      // switching it on instantly caused a visible camera snap at takeoff.
      const ramp = Math.min(1, Plane.state.s / 150);
      const ease = ramp * ramp * (3 - 2 * ramp);
      const inv = ease / Math.max(1, Math.hypot(f.px, f.pz));
      tx -= f.px * inv * Config.CAM_INWARD;
      tz -= f.pz * inv * Config.CAM_INWARD;
    }
    camera.setTarget(new BABYLON.Vector3(tx, f.py + f.y * Config.CAM_LOOKAHEAD, tz));
    // Turbo widens the view for a sense of speed
    const fovTarget = turboActive ? 1.03 : 0.9;
    camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-dt / 0.4));
  }

  // --- Turbo smoke trail ---
  const trail = (() => {
    const tex = new BABYLON.DynamicTexture('trailTex', { width: 32, height: 32 }, scene, false);
    const c = tex.getContext();
    const g = c.createRadialGradient(16, 16, 2, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(1, 'rgba(255,160,40,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    tex.update(); tex.hasAlpha = true;
    const ps = new BABYLON.ParticleSystem('turboTrail', 400, scene);
    ps.particleTexture = tex;
    ps.emitter = new BABYLON.Vector3(0, -1000, 0);
    ps.minSize = 0.8; ps.maxSize = 2.2;
    ps.minLifeTime = 0.4; ps.maxLifeTime = 1.1;
    ps.emitRate = 0;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.color1 = new BABYLON.Color4(1, 0.85, 0.4, 0.9);
    ps.color2 = new BABYLON.Color4(1, 0.5, 0.15, 0.8);
    ps.colorDead = new BABYLON.Color4(0.6, 0.6, 0.65, 0);
    ps.minEmitPower = 0.5; ps.maxEmitPower = 2;
    ps.createSphereEmitter(0.8);
    ps.start();
    return ps;
  })();

  // --- Race marshal: a little cloud holding a checkered flag, hovering
  // ahead of the player while a race is on ---
  const raceCloud = (() => {
    const node = new BABYLON.TransformNode('raceCloud', scene);
    const cm = new BABYLON.StandardMaterial('raceCloudMat', scene);
    cm.diffuseColor = new BABYLON.Color3(1, 1, 1);
    cm.emissiveColor = new BABYLON.Color3(0.42, 0.42, 0.46);
    cm.specularColor = BABYLON.Color3.Black();
    for (const [px, py, d] of [[-1.1, 0, 2.4], [0.9, 0.15, 2.9], [0.1, -0.5, 2.2], [2.2, -0.1, 1.9]]) {
      const puff = BABYLON.MeshBuilder.CreateSphere('rcPuff', { diameter: d, segments: 8 }, scene);
      puff.position.set(px, py, 0);
      puff.scaling.y = 0.8;
      puff.material = cm;
      puff.parent = node;
    }
    const pole = BABYLON.MeshBuilder.CreateCylinder('rcPole', { height: 3.4, diameter: 0.14, tessellation: 6 }, scene);
    pole.position.set(1.9, 1.9, 0);
    const pm = new BABYLON.StandardMaterial('rcPoleMat', scene);
    pm.diffuseColor = new BABYLON.Color3(0.55, 0.38, 0.22);
    pm.specularColor = BABYLON.Color3.Black();
    pole.material = pm;
    pole.parent = node;
    const ftex = new BABYLON.DynamicTexture('rcFlagTex', { width: 64, height: 64 }, scene, true);
    const fc = ftex.getContext();
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      fc.fillStyle = (cx + cy) % 2 ? '#18181c' : '#f5f5f2';
      fc.fillRect(cx * 16, cy * 16, 16, 16);
    }
    ftex.update();
    const fm = new BABYLON.StandardMaterial('rcFlagMat', scene);
    fm.diffuseTexture = ftex;
    fm.emissiveColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    fm.specularColor = BABYLON.Color3.Black();
    const flag = BABYLON.MeshBuilder.CreateBox('rcFlag', { width: 2.2, height: 1.5, depth: 0.06 }, scene);
    flag.position.set(3.05, 2.7, 0);
    flag.material = fm;
    flag.parent = node;
    node.setEnabled(false);
    return { node, flag };
  })();

  function updateRaceCloud(t) {
    raceCloud.node.setEnabled(raceActive && !gameOver);
    if (!raceActive) return;
    const f = Plane.getForward();
    raceCloud.node.position.set(
      f.px + f.tx * 40,
      f.py + 11 + Math.sin(t * 1.4) * 1.6,
      f.pz + f.tz * 40
    );
    raceCloud.node.rotation.y = Math.atan2(-f.tx, -f.tz);   // face the rider
    raceCloud.flag.rotation.y = Math.sin(t * 6) * 0.45;     // wave the flag
  }

  function turboActive() { return elapsed < turboUntil; }

  function fireTurbo() {
    turboUntil = elapsed + Config.TURBO_SECONDS;
    turboMeter = 0;
    Hud.banner('TURBO!', 1800);
    Hud.popup('🔥 2× POINTS', 'red');
    Sfx.turbo();
  }

  function addTurboMeter(n) {
    if (!Levels.mechanics.turbo || turboActive()) return;
    turboMeter = Math.min(Config.TURBO_SEGMENTS, turboMeter + n);
    if (turboMeter >= Config.TURBO_SEGMENTS) fireTurbo();
  }

  function onRingResult(hit, type, pos) {
    if (gameOver) return;
    ringsPassed++;
    const mult = turboActive() ? Config.TURBO_SCORE_MULT : 1;
    if (hit) {
      ringsHit++;
      streak++;
      const base = type === 'red' ? Config.RED_RING_SCORE : Config.RING_SCORE;
      const bonus = (streak - 1) * Config.STREAK_BONUS;
      const pts = (base + bonus) * mult;
      score += pts;
      Hud.popup('+' + pts + (streak > 1 ? '  x' + streak : ''), type === 'red' ? 'red' : 'good');
      Sfx.ding();
      ringBoost = Math.min(Config.BOOST_MAX, ringBoost + Config.BOOST_RING);
      addTurboMeter(type === 'red' ? 2 : 1);
    } else if (passes > 0) {
      passes--;
      streak++;
      Hud.popup('★ PASS USED', 'pass');
      Sfx.pop();
    } else {
      streak = 0;
      turboMeter = Math.floor(turboMeter / 2);   // a clean miss stings the meter
      Hud.popup('MISS', 'miss');
      Sfx.whiff();
    }
    Hud.setScore(score, ringsHit, ringsPassed);
  }

  function onPickup(kind) {
    if (gameOver) return;
    if (kind === 'star') {
      score += Config.STAR_SCORE;
      if (passes < Config.MAX_PASSES) {
        passes++;
        Hud.popup('★ +1 PASS', 'pass');
      } else {
        Hud.popup('★ +' + Config.STAR_SCORE, 'pass');
      }
      addTurboMeter(1);
      Sfx.star();
    } else if (kind === 'balloon') {
      floatUntil = elapsed + Config.FLOAT_SECONDS;
      Hud.popup('🎈 FLOAT!', 'balloon');
      Sfx.pop();
    } else if (kind === 'wind') {
      tailwinds.push(elapsed + Config.TAILWIND_SECONDS);
      Hud.popup('💨 TAILWIND ×' + tailwinds.length, 'wind');
      Sfx.wind();
    }
    Hud.setScore(score, ringsHit, ringsPassed);
  }

  // --- Races ---
  function maybeStartRace() {
    if (!Levels.mechanics.races || raceActive || gameOver) return;
    if (Plane.state.lap < nextRaceLap) return;
    if (workoutLeft < Config.RACE_MIN_TIME) return;
    raceActive = true;
    raceEndS = Plane.state.s + Config.RACE_LAPS * Config.CIRCUMFERENCE;
    Rivals.startRace(Plane.state.s);
    Hud.banner('RACE! ' + (Config.RACE_LAPS > 1 ? Config.RACE_LAPS + ' LAPS' : '1 LAP') + ' — GO!', 3000);
    Sfx.horn();
  }

  function finishRace() {
    raceActive = false;
    nextRaceLap = Plane.state.lap + Config.RACE_EVERY_LAPS;   // rest lap first
    const st = Rivals.standings(Plane.state.s);
    Rivals.endRace();
    const pts = Config.RACE_POINTS[st.pos - 1] || 0;
    score += pts;
    Hud.banner('🏁 FINISHED P' + st.pos + '!  +' + pts, 3500);
    Hud.popup('+' + pts, st.pos === 1 ? 'good' : 'pass');
    Sfx.fanfare();
    Hud.setScore(score, ringsHit, ringsPassed);
  }

  // --- Trainer resistance: a steady base, eased only by Tailwind stacks ---
  function updateResistance(dt) {
    const st = Plane.state;
    tailwinds = tailwinds.filter(tw => tw > elapsed);
    let target;
    if (st.phase !== 'FLYING') {
      target = Config.RESIST_TAKEOFF;
    } else if (Levels.hooks.resistance) {
      target = Levels.hooks.resistance(Config.RESIST_BASE, st);
    } else {
      target = Config.RESIST_BASE * Math.pow(Config.TAILWIND_FACTOR, tailwinds.length);
    }
    target = Math.max(Config.RESIST_MIN, Math.min(Config.RESIST_MAX, target));
    resistance += (target - resistance) * (1 - Math.exp(-dt / Config.RESIST_TAU));
    const rounded = Math.round(resistance);
    if (rounded !== lastSentResistance) {
      lastSentResistance = rounded;
      if (typeof window.onResistanceChange === 'function') {
        try { window.onResistanceChange(rounded); } catch (e) { /* trainer glue must not kill the loop */ }
      }
    }
  }

  function endWorkout() {
    gameOver = true;
    if (raceActive) { raceActive = false; Rivals.endRace(); }
    Hud.endScreen({
      score, ringsHit, ringsPassed,
      laps: Plane.state.lap,
      km: (Math.max(0, Plane.state.s) * 0.000621371).toFixed(2),
    });
  }

  // Debug/test hooks
  window.__debug = {
    timeScale: 1,
    get state() { return Plane.state; },
    get score() { return { score, ringsHit, ringsPassed, streak, passes, turboMeter }; },
    get workoutLeft() { return workoutLeft; },
    set workoutLeft(v) { workoutLeft = v; },
    get gameOver() { return gameOver; },
    get resistance() { return resistance; },
    get turboActive() { return turboActive(); },
    get raceActive() { return raceActive; },
    fps: () => engine.getFps(),
  };

  Hud.banner('PEDAL TO TAKE OFF!');
  Hud.setScore(0, 0, 0);

  const unlockOnce = () => { Sfx.unlock(); window.removeEventListener('pointerdown', unlockOnce); window.removeEventListener('keydown', unlockOnce); };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') Sfx.toggleMute();
    if ((e.key === 'r' || e.key === 'R') && gameOver) location.reload();
  });

  let tookOff = false;
  let lastLap = 1;

  engine.runRenderLoop(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000) * window.__debug.timeScale;
    elapsed += dt;

    Input.update(dt);
    const pedal = Input.getPedal();

    // Speed: decaying ring pulses + turbo
    ringBoost *= Math.exp(-dt / Config.BOOST_TAU);
    const speedBoost = ringBoost + (turboActive() ? Config.TURBO_SPEED : 0);

    const floatLeft = Math.max(0, floatUntil - elapsed);
    const wasReady = Plane.state.phase === 'READY';
    Plane.update(dt, pedal, floatLeft > 0 ? Config.FLOAT_BONUS : 0, speedBoost);
    if (wasReady && Plane.state.phase !== 'READY' && !tookOff) {
      tookOff = true;
      Hud.hideBanner();
      Hud.banner('GO!', 1500);
    }

    if (tookOff && !gameOver) {
      workoutLeft -= dt;
      if (workoutLeft <= 0) { workoutLeft = 0; endWorkout(); }
    }

    if (!gameOver) {
      Rings.checkCrossings(Plane.state.sPrev, Plane.state.s, Plane.state.alt);
      maybeStartRace();
      if (raceActive && Plane.state.s >= raceEndS) finishRace();
      // Lap celebration: fireworks around the plane as it crosses the gate
      if (Plane.state.lap > lastLap) {
        lastLap = Plane.state.lap;
        const f = Plane.getForward();
        const bursts = [];
        for (let i = 0; i < 4; i++) {
          bursts.push(new BABYLON.Vector3(
            f.px + f.tx * (55 + i * 22) + (Math.random() - 0.5) * 44,
            f.py + 8 + Math.random() * 26,
            f.pz + f.tz * (55 + i * 22) + (Math.random() - 0.5) * 44
          ));
        }
        World.fireworks(bursts, elapsed);
        Sfx.firework();
      }
    }
    Rivals.update(dt, elapsed, Plane.state.s);
    Rings.update(elapsed, Plane.state.s);
    World.update(dt, elapsed);
    updateResistance(dt);
    Sfx.update(pedal, Plane.state.phase === 'FLYING');
    updateCamera(dt, turboActive());
    updateRaceCloud(elapsed);

    // Turbo trail follows the tail of the plane
    const f = Plane.getForward();
    trail.emitter.set(f.px - f.tx * 4, f.py, f.pz - f.tz * 4);
    trail.emitRate = turboActive() ? 90 : 0;

    Hud.update(Plane.state, pedal, Rings.nextRing(Plane.state.s), {
      timeLeft: workoutLeft, passes, floatLeft,
      resistance,
      tailwindCount: tailwinds.length,
      tailwindLeft: tailwinds.length ? Math.max(...tailwinds) - elapsed : 0,
      speedKts: Plane.state.phase === 'READY' ? 0 : Plane.state.speed * 1.944,
      altFt: Plane.state.alt * 3.281,
      distMi: Math.max(0, Plane.state.s) * 0.000621371,
      turboMeter,
      turboLeft: Math.max(0, turboUntil - elapsed),
      race: raceActive ? Object.assign(Rivals.standings(Plane.state.s), {
        lapsLeft: Math.max(0, Math.round((raceEndS - Plane.state.s) / 10) * 10) + 'm to go',
      }) : null,
    });

    scene.render();
  });

  window.addEventListener('resize', () => engine.resize());
})();
