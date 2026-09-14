// Procedural Stearman-style biplane (nose facing +Z) and the flight model.
const Plane = (() => {
  let root;           // TransformNode positioned/oriented on the rail
  let propNode;       // spins with pedal
  let propDisc;       // semi-transparent blur disc, fades in with RPM
  let exhaustPS = null;
  let propRpm = 0;

  // Flight state
  const state = {
    phase: 'READY',       // READY -> TAKEOFF -> FLYING
    s: -Config.RUNWAY_LEN,
    sPrev: -Config.RUNWAY_LEN,
    alt: 0,
    speed: 0,
    pitch: 0,             // radians, positive = nose up
    roll: 0,
    lap: 1,
  };

  function mat(scene, name, r, g, b, opts = {}) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = new BABYLON.Color3(r, g, b);
    m.specularColor = opts.spec ? new BABYLON.Color3(0.6, 0.6, 0.6) : new BABYLON.Color3(0.1, 0.1, 0.1);
    if (opts.emissive) m.emissiveColor = new BABYLON.Color3(r * 0.25, g * 0.25, b * 0.25);
    return m;
  }

  // Teardrop airfoil cross-section in the XY plane (chord along X, thickness Y).
  function airfoilShape(chord, thick) {
    const pts = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {          // top surface, leading -> trailing
      const t = i / n;
      const x = t * chord;
      const y = thick * 1.4 * (Math.sqrt(t) * (1 - t));
      pts.push(new BABYLON.Vector3(x - chord * 0.3, y, 0));
    }
    for (let i = n - 1; i > 0; i--) {       // bottom surface
      const t = i / n;
      const x = t * chord;
      const y = -thick * 0.7 * (Math.sqrt(t) * (1 - t));
      pts.push(new BABYLON.Vector3(x - chord * 0.3, y, 0));
    }
    return pts;
  }

  // A wing spanning local X (after rotation), chord along Z.
  function makeWing(scene, name, span, chord, thick, material) {
    const shape = airfoilShape(chord, thick);
    const path = [new BABYLON.Vector3(0, 0, -span / 2), new BABYLON.Vector3(0, 0, span / 2)];
    const wing = BABYLON.MeshBuilder.ExtrudeShape(name, {
      shape, path, cap: BABYLON.Mesh.CAP_ALL, sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    wing.rotation.y = Math.PI / 2;   // span -> X, chord -> Z
    wing.material = material;
    return wing;
  }

  function strut(scene, name, a, b, material, dia = 0.07) {
    const len = BABYLON.Vector3.Distance(a, b);
    const c = BABYLON.MeshBuilder.CreateCylinder(name, { height: len, diameter: dia, tessellation: 8 }, scene);
    c.position = a.add(b).scale(0.5);
    const dir = b.subtract(a).normalize();
    c.rotationQuaternion = quatFromTo(BABYLON.Vector3.Up(), dir);
    c.material = material;
    return c;
  }

  function build(scene) {
    root = new BABYLON.TransformNode('planeRoot', scene);
    root.rotationQuaternion = BABYLON.Quaternion.Identity();

    const blue = mat(scene, 'pBlue', 0.12, 0.35, 0.85, { spec: true });
    const yellow = mat(scene, 'pYellow', 1.0, 0.8, 0.1, { spec: true });
    const red = mat(scene, 'pRed', 0.9, 0.15, 0.12, { spec: true });
    const gray = mat(scene, 'pGray', 0.45, 0.45, 0.5);
    const dark = mat(scene, 'pDark', 0.15, 0.15, 0.17);
    const tan = mat(scene, 'pTan', 0.95, 0.75, 0.55);

    // --- Fuselage: lathe profile, nose at +Z after rotation ---
    // Profile: x = radius, y = station along length (0 = tail, L = nose).
    const L = 7.6;
    const prof = [
      [0.06, 0], [0.14, 0.6], [0.26, 1.6], [0.38, 2.8], [0.48, 4.2],
      [0.55, 5.4], [0.58, 6.3], [0.56, 7.0], [0.50, 7.4], [0.40, L],
    ].map(([r, y]) => new BABYLON.Vector3(r, y, 0));
    const fus = BABYLON.MeshBuilder.CreateLathe('fuselage', { shape: prof, tessellation: 20, cap: BABYLON.Mesh.CAP_ALL }, scene);
    fus.rotation.x = Math.PI / 2;          // lathe axis Y -> Z; y=L (nose) maps to +Z
    fus.position.z = -L * 0.45;            // center it so nose is ~ +4.2, tail ~ -3.4
    fus.material = blue;
    fus.parent = root;
    const noseZ = -L * 0.45 + L;           // ~ +4.18
    const tailZ = -L * 0.45;               // ~ -3.42

    // Engine cowl ring
    const cowl = BABYLON.MeshBuilder.CreateCylinder('cowl', { height: 0.5, diameterTop: 0.98, diameterBottom: 1.06, tessellation: 20 }, scene);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.z = noseZ - 0.1;
    cowl.material = red;
    cowl.parent = root;

    // --- Wings (upper staggered forward) ---
    const span = 9.8, chord = 1.5, gap = 1.5;
    const lower = makeWing(scene, 'wingLow', span, chord, 0.16, yellow);
    lower.position.set(0, -0.42, 0.5);
    lower.parent = root;
    const upper = makeWing(scene, 'wingUp', span, chord, 0.16, yellow);
    upper.position.set(0, -0.42 + gap, 0.5 + 0.35);
    upper.parent = root;

    // Interplane N-struts + cabane struts
    for (const sx of [-3.4, 3.4]) {
      strut(scene, 's1', new BABYLON.Vector3(sx, -0.35, 0.35), new BABYLON.Vector3(sx, 1.0, 0.7), gray).parent = root;
      strut(scene, 's2', new BABYLON.Vector3(sx, -0.35, 0.95), new BABYLON.Vector3(sx, 1.0, 1.15), gray).parent = root;
    }
    for (const sx of [-0.6, 0.6]) {
      strut(scene, 'cab', new BABYLON.Vector3(sx * 0.7, 0.45, 0.6), new BABYLON.Vector3(sx, 1.05, 0.9), gray, 0.06).parent = root;
    }

    // --- Tail ---
    const hstab = makeWing(scene, 'hstab', 3.4, 1.1, 0.1, red);
    hstab.position.set(0, 0.1, tailZ + 0.7);
    hstab.parent = root;
    // Vertical fin: a small wing stood upright (span becomes height)
    const finPivot = new BABYLON.TransformNode('finPivot', scene);
    finPivot.parent = root;
    finPivot.position.set(0, 0.3, tailZ + 0.7);
    finPivot.rotation.z = Math.PI / 2;
    const fin = makeWing(scene, 'fin', 1.2, 1.1, 0.08, red);
    fin.parent = finPivot;
    fin.position.x = 0.6;   // base at the spine, tip 1.2 m up
    const finStripe = BABYLON.MeshBuilder.CreateBox('finStripe', { width: 0.07, height: 0.85, depth: 0.24 }, scene);
    finStripe.position.set(0, 0.85, tailZ + 0.55);
    finStripe.material = mat(scene, 'pWhite', 0.97, 0.97, 0.95);
    finStripe.parent = root;

    // --- Cockpit: windshield + pilot head ---
    const shield = BABYLON.MeshBuilder.CreateBox('shield', { width: 0.7, height: 0.35, depth: 0.05 }, scene);
    shield.position.set(0, 0.62, 1.65);
    shield.rotation.x = -0.35;
    const glass = mat(scene, 'pGlass', 0.7, 0.9, 1.0); glass.alpha = 0.5;
    shield.material = glass;
    shield.parent = root;
    const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.5, segments: 10 }, scene);
    head.position.set(0, 0.62, 1.2);
    head.material = tan;
    head.parent = root;
    const cap = BABYLON.MeshBuilder.CreateSphere('cap', { diameter: 0.54, segments: 10, slice: 0.5 }, scene);
    cap.position.set(0, 0.68, 1.2);
    cap.material = mat(scene, 'pLeather', 0.45, 0.28, 0.15);
    cap.parent = root;
    const goggles = BABYLON.MeshBuilder.CreateTorus('goggles', { diameter: 0.4, thickness: 0.07, tessellation: 12 }, scene);
    goggles.rotation.x = Math.PI / 2 - 0.2;
    goggles.position.set(0, 0.62, 1.42);
    goggles.material = dark;
    goggles.parent = root;

    // --- Landing gear ---
    for (const sx of [-1.0, 1.0]) {
      strut(scene, 'leg', new BABYLON.Vector3(sx * 0.4, -0.5, 0.9), new BABYLON.Vector3(sx, -1.25, 0.9), gray).parent = root;
      const wheel = BABYLON.MeshBuilder.CreateCylinder('wheel', { height: 0.22, diameter: 0.72, tessellation: 16 }, scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, -1.25, 0.9);
      wheel.material = dark;
      wheel.parent = root;
      const hub = BABYLON.MeshBuilder.CreateCylinder('hub', { height: 0.24, diameter: 0.3, tessellation: 12 }, scene);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(sx, -1.25, 0.9);
      hub.material = yellow;
      hub.parent = root;
    }
    strut(scene, 'axle', new BABYLON.Vector3(-1.0, -1.25, 0.9), new BABYLON.Vector3(1.0, -1.25, 0.9), gray, 0.06).parent = root;
    strut(scene, 'skid', new BABYLON.Vector3(0, -0.1, tailZ + 0.3), new BABYLON.Vector3(0, -0.55, tailZ + 0.05), gray, 0.05).parent = root;

    // --- Wing roundels (blue/white/red) on the upper wing ---
    for (const sx of [-3.1, 3.1]) {
      const specs = [[1.15, 0.14, 0.35, 0.85], [0.75, 0.97, 0.97, 0.95], [0.35, 0.9, 0.15, 0.12]];
      specs.forEach(([dia, cr, cg, cb], i) => {
        const disc = BABYLON.MeshBuilder.CreateCylinder('roundel', { height: 0.03, diameter: dia, tessellation: 16 }, scene);
        disc.position.set(sx, -0.42 + gap + 0.12 + i * 0.012, 0.85);
        disc.material = mat(scene, 'rdl' + sx + i, cr, cg, cb);
        disc.parent = root;
      });
    }

    // --- Exhaust puffs when working hard ---
    exhaustPS = new BABYLON.ParticleSystem('exhaust', 60, scene);
    const etex = new BABYLON.DynamicTexture('exTex', { width: 32, height: 32 }, scene, false);
    const ectx = etex.getContext();
    const eg = ectx.createRadialGradient(16, 16, 2, 16, 16, 15);
    eg.addColorStop(0, 'rgba(200,200,205,0.9)');
    eg.addColorStop(1, 'rgba(180,180,185,0)');
    ectx.fillStyle = eg; ectx.fillRect(0, 0, 32, 32);
    etex.update(); etex.hasAlpha = true;
    exhaustPS.particleTexture = etex;
    exhaustPS.emitter = root;
    exhaustPS.minEmitBox = new BABYLON.Vector3(0.4, -0.35, noseZ - 0.6);
    exhaustPS.maxEmitBox = new BABYLON.Vector3(0.5, -0.3, noseZ - 0.4);
    exhaustPS.minSize = 0.2; exhaustPS.maxSize = 0.55;
    exhaustPS.minLifeTime = 0.25; exhaustPS.maxLifeTime = 0.6;
    exhaustPS.emitRate = 0;
    exhaustPS.direction1 = new BABYLON.Vector3(0.5, -0.1, -2);
    exhaustPS.direction2 = new BABYLON.Vector3(0.8, 0.1, -3);
    exhaustPS.minEmitPower = 1; exhaustPS.maxEmitPower = 2;
    exhaustPS.color1 = new BABYLON.Color4(0.75, 0.75, 0.78, 0.5);
    exhaustPS.color2 = new BABYLON.Color4(0.6, 0.6, 0.62, 0.4);
    exhaustPS.colorDead = new BABYLON.Color4(0.6, 0.6, 0.62, 0);
    exhaustPS.start();

    // --- Propeller ---
    propNode = new BABYLON.TransformNode('prop', scene);
    propNode.position.z = noseZ + 0.15;
    propNode.parent = root;
    const spinner = BABYLON.MeshBuilder.CreateCylinder('spinner', { height: 0.4, diameterBottom: 0.34, diameterTop: 0.05, tessellation: 12 }, scene);
    spinner.rotation.x = Math.PI / 2;
    spinner.position.z = 0.2;
    spinner.material = gray;
    spinner.parent = propNode;
    for (const sgn of [1, -1]) {
      const blade = BABYLON.MeshBuilder.CreateBox('blade', { width: 0.24, height: 1.35, depth: 0.05 }, scene);
      blade.position.y = sgn * 0.75;
      blade.rotation.y = sgn * 0.4;   // blade twist
      blade.material = mat(scene, 'pWood', 0.55, 0.35, 0.18);
      blade.parent = propNode;
    }
    propDisc = BABYLON.MeshBuilder.CreateDisc('propDisc', { radius: 1.45, tessellation: 24 }, scene);
    propDisc.position.z = 0.05;
    const discMat = new BABYLON.StandardMaterial('discMat', scene);
    discMat.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.85);
    discMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.55);
    discMat.alpha = 0;
    discMat.backFaceCulling = false;
    propDisc.material = discMat;
    propDisc.parent = propNode;

    // Start pose
    applyPose(0);
    return root;
  }

  // Soft floor/ceiling: scale away pitch that would push past the limits,
  // and below MIN_ALT actively push the nose up (covers climb-out too).
  function softLimits(targetPitch, alt) {
    const tCeil = clamp01((Config.MAX_ALT - alt) / Config.ALT_BLEND);
    if (targetPitch > 0) targetPitch *= tCeil;
    const tFloor = clamp01((alt - Config.MIN_ALT) / Config.ALT_BLEND);
    if (targetPitch < 0) targetPitch *= tFloor;
    if (alt < Config.MIN_ALT) {
      targetPitch += clamp01((Config.MIN_ALT - alt) / Config.ALT_BLEND) * Config.MAX_PITCH * 0.6;
    }
    return targetPitch;
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function update(dt, pedal, floatBonus = 0, speedBoost = 0) {
    state.sPrev = state.s;
    const groundY = Config.PLATEAU_H + 1.4;   // wheels on runway

    let targetPitch = 0;
    let targetRoll = 0;
    const prevPitch = state.pitch;

    if (state.phase === 'READY') {
      state.alt = groundY;
      propRpm = 2 + pedal * 0.05;
      if (pedal > 20) { state.phase = 'TAKEOFF'; if (typeof Sfx !== 'undefined') Sfx.engineOn(); }
    } else if (state.phase === 'TAKEOFF') {
      state.speed = Math.min(Config.SPEED, state.speed + Config.TAKEOFF_ACCEL * dt);
      state.s += state.speed * dt;
      propRpm = 10 + state.speed * 2.5;
      if (state.s > Config.LIFTOFF_S) {
        targetPitch = Config.TAKEOFF_PITCH;
      }
      // Climb only once the nose is actually up
      if (state.pitch > 0.02) {
        state.alt += state.speed * Math.tan(state.pitch) * dt;
      } else {
        state.alt = groundY;
      }
      if (state.s >= 0) state.phase = 'FLYING';
    } else { // FLYING
      state.speed = Config.SPEED * (1 + speedBoost);   // ring pulses + turbo
      state.s += state.speed * dt;
      propRpm = 10 + pedal * 0.5;
      const effort = (pedal - Config.NEUTRAL_INPUT) / Config.NEUTRAL_INPUT + floatBonus; // -1..1 (+balloon float)
      targetPitch = softLimits(effort * Config.MAX_PITCH, state.alt);
      state.alt += state.speed * Math.tan(state.pitch) * dt;
      state.alt = Math.max(groundY, Math.min(Config.MAX_ALT + 5, state.alt));
    }

    // Smooth pitch toward target
    const kp = 1 - Math.exp(-dt / Config.PITCH_TAU);
    state.pitch += (targetPitch - state.pitch) * kp;

    // Bank follows the local curvature of the waving track (briefly banking
    // RIGHT at the outward crests), plus a bit of pitch-rate roll
    if (state.s >= 0 && state.phase === 'FLYING') {
      const pitchRate = dt > 0 ? (state.pitch - prevPitch) / dt : 0;
      const k = Track.poseAt(state.s).k || 0;
      const lean = Math.max(-0.8, Math.min(2.1, k * Config.TRACK_RADIUS));
      targetRoll = Config.BANK_RAD * lean + pitchRate * 0.8;
    }
    const kr = 1 - Math.exp(-dt / Config.ROLL_TAU);
    state.roll += (targetRoll - state.roll) * kr;

    // Lap counting
    const lapNow = Math.floor(state.s / Config.CIRCUMFERENCE) + 1;
    if (state.s >= 0 && lapNow > state.lap) {
      state.lap = lapNow;
      if (typeof Hud !== 'undefined') Hud.lapBanner(state.lap);
    }

    // Prop spin + blur disc
    propNode.rotation.z += propRpm * dt;
    propDisc.material.alpha = clamp01((propRpm - 12) / 30) * 0.3;
    if (exhaustPS) exhaustPS.emitRate = pedal > 68 ? 10 + (pedal - 68) : 0;

    applyPose(dt);
  }

  function applyPose() {
    const p = Track.poseAt(state.s);
    root.position.set(p.x, state.alt, p.z);
    const yaw = Math.atan2(p.tx, p.tz);
    // Babylon: positive pitch about X is nose-down, so negate. Positive roll
    // raises the right wing (left lean) — the correct inward lean for this
    // CCW circle — so roll passes through unnegated.
    BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, -state.pitch, state.roll, root.rotationQuaternion);
  }

  // Pitched forward direction for the camera look-target
  function getForward() {
    const p = Track.poseAt(state.s);
    return {
      x: p.tx, z: p.tz,
      y: Math.tan(state.pitch),
      px: p.x, py: state.alt, pz: p.z,
      tx: p.tx, tz: p.tz,
    };
  }

  return { build, update, state, getForward };
})();
