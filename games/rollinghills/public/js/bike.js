// Procedural cartoon bicycle (no rider). Factory so future competitors can
// each get their own: Bike.create(scene, {color}) -> {root, update(...)}.
// Local frame: +Z forward, +Y up. Wheels spin from ground speed; cranks
// spin from pedal input (they stop when coasting).
const Bike = (() => {
  function tube(scene, a, b, r, color) {
    const t = BABYLON.MeshBuilder.CreateTube('tube', { path: [a, b], radius: r, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
    return Util.colorize(t, color);
  }
  const V = (x, y, z) => new BABYLON.Vector3(x, y, z);

  function wheel(scene, R, rimColor) {
    const parts = [];
    const tire = BABYLON.MeshBuilder.CreateTorus('tire', { diameter: R * 2, thickness: 0.075, tessellation: 24 }, scene);
    tire.rotation.z = Math.PI / 2; Util.colorize(tire, '#2b2b33'); parts.push(tire);
    const rim = BABYLON.MeshBuilder.CreateTorus('rim', { diameter: R * 2 - 0.08, thickness: 0.035, tessellation: 24 }, scene);
    rim.rotation.z = Math.PI / 2; Util.colorize(rim, rimColor || '#e8ecf2'); parts.push(rim);
    const hub = BABYLON.MeshBuilder.CreateCylinder('hub', { height: 0.09, diameter: 0.09, tessellation: 8 }, scene);
    hub.rotation.z = Math.PI / 2; Util.colorize(hub, '#b8bec8'); parts.push(hub);
    for (let i = 0; i < 5; i++) {
      const sp = BABYLON.MeshBuilder.CreateBox('spoke', { width: 0.02, height: R * 2 - 0.1, depth: 0.05 }, scene);
      sp.rotation.x = i * Math.PI / 5; Util.colorize(sp, '#ffffff'); parts.push(sp);
    }
    return Util.merge(parts, 'wheel');
  }

  function create(scene, opts = {}) {
    const color = opts.color || '#ff5a5a';
    const R = Config.WHEEL_RADIUS;
    const mat = Util.matte(scene);
    const root = new BABYLON.TransformNode('bike', scene);
    root.rotationQuaternion = BABYLON.Quaternion.Identity();
    const SCALE = opts.scale || Config.BIKE_SCALE || 1;
    root.scaling.setAll(SCALE);
    const body = new BABYLON.TransformNode('bikeBody', scene);   // lean/pitch happen here
    body.parent = root;

    // frame points
    const rearHub = V(0, R, -0.52), frontHub = V(0, R, 0.53), bb = V(0, 0.27, -0.03);
    const seatTop = V(0, 0.86, -0.20), headTop = V(0, 0.90, 0.36), headBot = V(0, 0.70, 0.42);
    const parts = [];
    const fr = 0.03;
    parts.push(tube(scene, bb, headBot, fr, color));                // down tube
    parts.push(tube(scene, bb, seatTop, fr, color));                // seat tube
    parts.push(tube(scene, seatTop, headTop, fr, color));           // top tube
    parts.push(tube(scene, headBot, headTop, fr * 1.2, color));     // head tube
    for (const sx of [-0.045, 0.045]) {
      parts.push(tube(scene, V(sx, bb.y, bb.z), V(sx, rearHub.y, rearHub.z), 0.018, color));      // chainstays
      parts.push(tube(scene, V(sx, seatTop.y, seatTop.z), V(sx, rearHub.y, rearHub.z), 0.018, color)); // seatstays
      parts.push(tube(scene, V(sx, headBot.y, headBot.z), V(sx, frontHub.y, frontHub.z), 0.02, '#f4f4f8'));  // fork
    }
    parts.push(tube(scene, seatTop, V(0, 0.98, -0.24), 0.02, '#c8ccd4'));   // seat post
    const saddle = BABYLON.MeshBuilder.CreateBox('saddle', { width: 0.14, height: 0.05, depth: 0.28 }, scene);
    saddle.position.set(0, 1.0, -0.26); Util.colorize(saddle, '#2b2b33'); parts.push(saddle);
    parts.push(tube(scene, headTop, V(0, 0.98, 0.42), 0.02, '#c8ccd4'));     // stem
    const bar = BABYLON.MeshBuilder.CreateCylinder('bar', { height: 0.52, diameter: 0.035 }, scene);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.98, 0.42); Util.colorize(bar, '#c8ccd4'); parts.push(bar);
    for (const sx of [-0.23, 0.23]) {
      const grip = BABYLON.MeshBuilder.CreateCylinder('grip', { height: 0.1, diameter: 0.05 }, scene);
      grip.rotation.z = Math.PI / 2; grip.position.set(sx, 0.98, 0.42); Util.colorize(grip, '#2b2b33'); parts.push(grip);
    }
    const ring = BABYLON.MeshBuilder.CreateCylinder('chainring', { height: 0.02, diameter: 0.2, tessellation: 16 }, scene);
    ring.rotation.z = Math.PI / 2; ring.position.set(0.06, bb.y, bb.z); Util.colorize(ring, '#b8bec8'); parts.push(ring);
    const cog = BABYLON.MeshBuilder.CreateCylinder('cog', { height: 0.02, diameter: 0.09, tessellation: 12 }, scene);
    cog.rotation.z = Math.PI / 2; cog.position.set(0.06, rearHub.y, rearHub.z); Util.colorize(cog, '#b8bec8'); parts.push(cog);
    const frame = Util.merge(parts, 'frame'); frame.material = mat; frame.parent = body;

    // wheels
    const rimColor = opts.rimColor || '#ffd42a';
    const rear = wheel(scene, R, rimColor); rear.material = mat; rear.parent = body; rear.position.copyFrom(rearHub);
    const front = wheel(scene, R, rimColor); front.material = mat; front.parent = body; front.position.copyFrom(frontHub);
    // translucent spinning disc that reads as blurred spokes
    const discMat = new BABYLON.StandardMaterial('spokeDisc', scene);
    discMat.diffuseColor = new BABYLON.Color3(1, 1, 1); discMat.specularColor = BABYLON.Color3.Black(); discMat.alpha = 0.18; discMat.backFaceCulling = false;
    for (const wh of [rear, front]) {
      const disc = BABYLON.MeshBuilder.CreateDisc('spokeDisc', { radius: R - 0.05, tessellation: 20 }, scene);
      disc.rotation.y = Math.PI / 2; disc.material = discMat; disc.parent = wh; disc.isPickable = false;
    }
    // water bottle on the down tube
    const bottle = BABYLON.MeshBuilder.CreateCylinder('bottle', { height: 0.2, diameter: 0.07, tessellation: 8 }, scene);
    bottle.position.set(0, 0.5, 0.18); bottle.rotation.x = -0.55; Util.colorize(bottle, '#3d8bff'); bottle.material = mat; bottle.parent = body;

    // cranks: rotate about the bottom-bracket X axis; pedals stay level
    const crank = new BABYLON.TransformNode('crank', scene); crank.parent = body; crank.position.copyFrom(bb);
    const axle = BABYLON.MeshBuilder.CreateCylinder('axle', { height: 0.24, diameter: 0.035 }, scene);
    axle.rotation.z = Math.PI / 2; Util.colorize(axle, '#b8bec8'); axle.material = mat; axle.parent = crank;
    const pedals = [];
    for (const side of [1, -1]) {
      const arm = BABYLON.MeshBuilder.CreateBox('arm', { width: 0.03, height: 0.17, depth: 0.04 }, scene);
      arm.position.set(side * 0.11, side * 0.085, 0); Util.colorize(arm, '#2b2b33'); arm.material = mat; arm.parent = crank;
      const pedal = BABYLON.MeshBuilder.CreateBox('pedal', { width: 0.1, height: 0.02, depth: 0.08 }, scene);
      Util.colorize(pedal, '#ffd42a'); pedal.material = mat; pedal.parent = crank;
      pedal.position.set(side * 0.16, side * 0.17, 0);
      pedals.push(pedal);
    }

    // headlight (spot lights the trail at night) and tail light
    const headLamp = BABYLON.MeshBuilder.CreateSphere('headLamp', { diameter: 0.09, segments: 6 }, scene);
    headLamp.position.set(0, 0.95, 0.5); headLamp.material = Util.glowMat(scene); headLamp.parent = body; Util.colorize(headLamp, '#ffffff');
    const tailLamp = BABYLON.MeshBuilder.CreateBox('tailLamp', { width: 0.06, height: 0.04, depth: 0.03 }, scene);
    tailLamp.position.set(0, 0.92, -0.33); tailLamp.parent = body;
    const tailMat = new BABYLON.StandardMaterial('tailMat', scene); tailMat.diffuseColor = Util.hex('#ff2a2a'); tailMat.emissiveColor = new BABYLON.Color3(0, 0, 0); tailMat.specularColor = BABYLON.Color3.Black();
    tailLamp.material = tailMat;
    const spot = new BABYLON.SpotLight('headlight', new BABYLON.Vector3(0, 0.95, 0.5), new BABYLON.Vector3(0, -0.3, 1), 0.75, 14, scene);
    spot.parent = body; spot.intensity = 0; spot.diffuse = Util.hex('#fff2c0'); spot.specular = BABYLON.Color3.Black(); spot.range = 28;
    spot.innerAngle = 0.25;   // soft edge instead of a hard-cut cone

    // blob shadow
    const shadow = BABYLON.MeshBuilder.CreateDisc('shadow', { radius: 0.9, tessellation: 16 }, scene);
    shadow.setEnabled(!Config.SHADOWS);   // real sun shadows replace the blob
    shadow.rotation.x = Math.PI / 2; shadow.position.y = 0.04; shadow.scaling.z = 1.4; shadow.parent = root;
    const smat = new BABYLON.StandardMaterial('shadowMat', scene);
    smat.diffuseColor = BABYLON.Color3.Black(); smat.specularColor = BABYLON.Color3.Black(); smat.alpha = 0.28; smat.disableLighting = true;
    shadow.material = smat;

    // dust puffs kicked up behind the rear wheel
    const dust = new BABYLON.ParticleSystem('bikeDust', 400, scene);
    {
      const t = new BABYLON.DynamicTexture('dustTex', { width: 32, height: 32 }, scene, false);
      const c = t.getContext(); const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(230,200,150,0.55)'); g.addColorStop(1, 'rgba(230,200,150,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); t.update(); t.hasAlpha = true;
      dust.particleTexture = t; dust.emitter = new BABYLON.Vector3();
      dust.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1); dust.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1);
      dust.minSize = 0.18; dust.maxSize = 0.36; dust.minLifeTime = 0.45; dust.maxLifeTime = 0.8;
      dust.direction1 = new BABYLON.Vector3(-0.6, 0.6, -1.5); dust.direction2 = new BABYLON.Vector3(0.6, 1.4, -2.5);
      dust.color1 = new BABYLON.Color4(0.85, 0.72, 0.5, 0.16); dust.color2 = new BABYLON.Color4(0.8, 0.68, 0.48, 0.16); dust.colorDead = new BABYLON.Color4(0.8, 0.68, 0.48, 0);
      dust.addSizeGradient(0, 0.5); dust.addSizeGradient(1, 1.4);
      dust.updateSpeed = 0.016; dust.emitRate = 0; dust.start();
    }
    const dustPos = new BABYLON.Vector3();
    let wheelAngle = 0, crankAngle = 0, lean = 0;

    // pose: Track pose; speed m/s; pedal 0..100
    function update(pose, speed, pedal, dt) {
      root.position.set(pose.x, pose.y, pose.z);
      const yaw = Math.atan2(pose.tx, pose.tz);
      const pitch = -Math.asin(Math.max(-1, Math.min(1, pose.ty)));
      BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, root.rotationQuaternion);
      // lean into turns (curvature * v^2 ~ lateral accel)
      const target = Util.clamp(-pose.k * speed * speed * 0.28, -0.45, 0.45);
      lean += (target - lean) * (1 - Math.exp(-dt / 0.25));
      body.rotation.z = lean;
      wheelAngle += (speed / (R * SCALE)) * dt;   // spin matches ground speed at the scaled radius
      rear.rotation.x = wheelAngle; front.rotation.x = wheelAngle;
      if (pedal > 6) crankAngle += (speed / R) / Config.GEAR_RATIO * dt;
      crank.rotation.x = crankAngle;
      for (const p of pedals) p.rotation.x = -crankAngle;
      // dust: contact point of the rear wheel, thrown backwards along the trail
      dustPos.set(pose.x - pose.hx * 0.55 * SCALE, pose.y + 0.05, pose.z - pose.hz * 0.55 * SCALE);
      dust.emitter.copyFrom(dustPos);
      dust.direction1.set(-pose.hx * 1.5 - pose.hz * 0.6, 0.6, -pose.hz * 1.5 + pose.hx * 0.6);
      dust.direction2.set(-pose.hx * 2.5 + pose.hz * 0.6, 1.4, -pose.hz * 2.5 - pose.hx * 0.6);
      dust.emitRate = (pose.bridge || speed < 3) ? 0 : Math.min(28, speed * 2);
    }

    // night: 0..1 from Daylight
    function setNight(n) { spot.intensity = 15 * n; tailMat.emissiveColor.set(n, 0.05 * n, 0.05 * n); }
    return { root, body, update, setNight, get lean() { return lean; } };
  }

  return { create };
})();
