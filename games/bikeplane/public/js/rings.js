// Rings and pickups on fixed slots around the circle. Only altitude varies —
// the plane is on rails, so everything sits exactly on the track in x/z.
//
// Rings (one per slot, 25/lap): gold = 100 pts, red = rarer, smaller, 300 pts.
// Pickups (between rings, random): star = +1 miss-pass, balloon = 10 s float.
// After a ring/pickup is passed it regenerates via a bounded random walk, but
// stays hidden until the camera is past so it never teleports mid-screen.
const Rings = (() => {
  const rings = [];       // { mesh, alt, s, slot, type, baseScale, reappearS }
  const pickups = [];     // { node, alt, s, slot, kind, reappearS }  kind: null|'star'|'balloon'
  let scene, particles;
  const mats = {};
  let onRing = null, onPickup = null;

  function slotS(i) { return (i + Config.RING_PHASE) * Config.RING_SPACING; }
  function pickupS(i) { return (i + Config.RING_PHASE - 0.5) * Config.RING_SPACING; }

  function rollRingType() { return Math.random() < Config.RED_RING_CHANCE ? 'red' : 'gold'; }
  function rollPickupKind() {
    const r = Math.random();
    if (r < Config.STAR_CHANCE) return 'star';
    if (r < Config.STAR_CHANCE + Config.BALLOON_CHANCE) return 'balloon';
    if (r < Config.STAR_CHANCE + Config.BALLOON_CHANCE + Config.TAILWIND_CHANCE) return 'wind';
    return null;
  }

  function walkFrom(prevAlt) {
    let step = (Math.random() * 2 - 1) * Config.RING_STEP_MAX;
    if (prevAlt > 140) step -= Math.random() * 12;   // mild mean reversion
    if (prevAlt < 60) step += Math.random() * 12;
    return Math.max(Config.RING_MIN_ALT, Math.min(Config.RING_MAX_ALT, prevAlt + step));
  }

  function firstLapAltitudes() {
    const alts = [];
    let a = Config.RING_MIN_ALT;
    for (let i = 0; i < Config.NUM_RINGS; i++) {
      if (i === 0) {
        a = Config.RING_MIN_ALT;   // first ring ever: as low as possible, right after climb-out
      } else if (i < Config.RING_LOW_COUNT) {
        a = Config.RING_MIN_ALT + Math.random() * (Config.RING_LOW_MAX - Config.RING_MIN_ALT);
      } else {
        a = walkFrom(a);
      }
      alts.push(a);
    }
    return alts;
  }

  function orientOnTrack(node, s) {
    const p = Track.poseAt(s);
    node.position.x = p.x; node.position.z = p.z;
    const tangent = new BABYLON.Vector3(p.tx, 0, p.tz);
    node.rotationQuaternion = quatFromTo(BABYLON.Vector3.Up(), tangent);
  }

  function placeRing(r) {
    orientOnTrack(r.mesh, r.s);
    r.mesh.position.y = r.alt;
    r.baseScale = r.type === 'red' ? Config.RED_RING_RADIUS / Config.RING_RADIUS : 1;
    r.mesh.material = r.type === 'red' ? mats.red : mats.gold;
    if (r.halo) r.halo.material = r.type === 'red' ? mats.haloRed : mats.haloGold;
  }

  function placePickup(p) {
    const pose = Track.poseAt(p.s);
    p.node.position.set(pose.x, p.alt, pose.z);
    p.starNode.setEnabled(p.kind === 'star');
    p.balloonNode.setEnabled(p.kind === 'balloon');
    p.windNode.setEnabled(p.kind === 'wind');
  }

  function makeMats(s) {
    const gold = new BABYLON.StandardMaterial('ringGold', s);
    gold.diffuseColor = new BABYLON.Color3(1.0, 0.78, 0.1);
    gold.emissiveColor = new BABYLON.Color3(0.55, 0.4, 0.05);
    gold.specularColor = new BABYLON.Color3(1, 1, 0.8);
    gold.specularPower = 64;
    mats.gold = gold;

    const red = new BABYLON.StandardMaterial('ringRed', s);
    red.diffuseColor = new BABYLON.Color3(1.0, 0.2, 0.25);
    red.emissiveColor = new BABYLON.Color3(0.6, 0.08, 0.1);
    red.specularColor = new BABYLON.Color3(1, 0.8, 0.8);
    red.specularPower = 64;
    mats.red = red;

    const star = new BABYLON.StandardMaterial('starMat', s);
    star.diffuseColor = new BABYLON.Color3(1, 0.9, 0.2);
    star.emissiveColor = new BABYLON.Color3(0.7, 0.6, 0.1);
    star.specularColor = BABYLON.Color3.Black();
    mats.star = star;

    const mkHalo = (name, r2, g2, b2) => {
      const hm = new BABYLON.StandardMaterial(name, s);
      hm.emissiveColor = new BABYLON.Color3(r2, g2, b2);
      hm.disableLighting = true;
      hm.alpha = 0.32;
      hm.alphaMode = BABYLON.Engine.ALPHA_ADD;
      hm.disableDepthWrite = true;   // additive aura, but still depth-TESTED
      return hm;
    };
    mats.haloGold = mkHalo('haloGold', 1, 0.82, 0.28);
    mats.haloRed = mkHalo('haloRed', 1, 0.3, 0.28);
    mats.haloStar = mkHalo('haloStar', 1, 0.9, 0.4);
    mats.haloWind = mkHalo('haloWind', 0.45, 0.9, 1);

    const wind = new BABYLON.StandardMaterial('windMat', s);
    wind.diffuseColor = new BABYLON.Color3(0.55, 0.9, 1);
    wind.emissiveColor = new BABYLON.Color3(0.3, 0.6, 0.75);
    wind.specularColor = BABYLON.Color3.Black();
    mats.wind = wind;

    const balloon = new BABYLON.StandardMaterial('balloonMat', s);
    balloon.diffuseColor = new BABYLON.Color3(0.95, 0.25, 0.3);
    balloon.emissiveColor = new BABYLON.Color3(0.3, 0.05, 0.06);
    balloon.specularColor = new BABYLON.Color3(0.8, 0.8, 0.8);
    balloon.specularPower = 32;
    mats.balloon = balloon;
  }

  function makeStarNode(i) {
    const node = new BABYLON.TransformNode('star' + i, scene);
    const aura = BABYLON.MeshBuilder.CreateSphere('starAura', { diameter: 6.5, segments: 8 }, scene);
    aura.material = mats.haloStar;
    aura.isPickable = false;
    aura.parent = node;
    // Crossed flattened boxes read as a twinkling star from a distance
    for (const rot of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) {
      const b = BABYLON.MeshBuilder.CreateBox('sb', { width: 0.7, height: 5.2, depth: 0.35 }, scene);
      b.rotation.z = rot;
      b.material = mats.star;
      b.parent = node;
    }
    return node;
  }

  function makeWindNode(i) {
    const node = new BABYLON.TransformNode('wind' + i, scene);
    const aura = BABYLON.MeshBuilder.CreateSphere('windAura', { diameter: 6.5, segments: 8 }, scene);
    aura.material = mats.haloWind;
    aura.isPickable = false;
    aura.parent = node;
    // a swirl: tapering spiral tube with a bead at the tip
    const pathPts = [];
    for (let k = 0; k <= 26; k++) {
      const th = (k / 26) * 4.6;
      const rad = 2.5 - th * 0.4;
      pathPts.push(new BABYLON.Vector3(Math.cos(th) * rad, Math.sin(th) * rad * 0.85, 0));
    }
    const swirl = BABYLON.MeshBuilder.CreateTube('windSwirl', { path: pathPts, radius: 0.34, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
    swirl.material = mats.wind;
    swirl.parent = node;
    const bead = BABYLON.MeshBuilder.CreateSphere('windBead', { diameter: 1.1, segments: 6 }, scene);
    bead.position.copyFrom(pathPts[pathPts.length - 1]);
    bead.material = mats.wind;
    bead.parent = node;
    return node;
  }

  function makeBalloonNode(i) {
    const node = new BABYLON.TransformNode('balloon' + i, scene);
    const body = BABYLON.MeshBuilder.CreateSphere('bb', { diameter: 6, segments: 12 }, scene);
    body.scaling.y = 1.15;
    body.material = mats.balloon;
    body.parent = node;
    const knot = BABYLON.MeshBuilder.CreateCylinder('bk', { height: 1, diameterTop: 0.5, diameterBottom: 1.1, tessellation: 8 }, scene);
    knot.position.y = -3.6;
    knot.material = mats.balloon;
    knot.parent = node;
    const basket = BABYLON.MeshBuilder.CreateBox('bkt', { width: 1.4, height: 1.1, depth: 1.4 }, scene);
    basket.position.y = -5.6;
    const bm = new BABYLON.StandardMaterial('basketMat', scene);
    bm.diffuseColor = new BABYLON.Color3(0.6, 0.42, 0.2);
    bm.specularColor = BABYLON.Color3.Black();
    basket.material = bm;
    basket.parent = node;
    return node;
  }

  function build(theScene, ringCb, pickupCb) {
    scene = theScene;
    onRing = ringCb;
    onPickup = pickupCb;
    makeMats(scene);

    const alts = firstLapAltitudes();
    for (let i = 0; i < Config.NUM_RINGS; i++) {
      const mesh = BABYLON.MeshBuilder.CreateTorus('ring' + i, {
        diameter: Config.RING_RADIUS * 2, thickness: 1.2, tessellation: 28,
      }, scene);
      // depth-tested glow aura (a fatter additive torus riding the ring)
      const halo = BABYLON.MeshBuilder.CreateTorus('ringHalo' + i, {
        diameter: Config.RING_RADIUS * 2, thickness: 2.6, tessellation: 28,
      }, scene);
      halo.parent = mesh;
      halo.isPickable = false;
      const r = { mesh, halo, alt: alts[i], s: slotS(i), slot: i, type: i === 0 ? 'gold' : rollRingType(), baseScale: 1, reappearS: null };
      placeRing(r);
      rings.push(r);
    }

    for (let i = 0; i < Config.NUM_RINGS; i++) {
      const node = new BABYLON.TransformNode('pickup' + i, scene);
      const p = {
        node, starNode: makeStarNode(i), balloonNode: makeBalloonNode(i), windNode: makeWindNode(i),
        // Slots 0-1 start empty: slot 0's altitude anchor (ring 24) still holds
        // its lap-1 value at build time and could be unreachable during climb-out.
        // After the first crossing every reroll anchors to an already-regenerated
        // ring, so this suppression is only needed for the very first lap.
        s: pickupS(i), slot: i, kind: i < 2 ? null : rollPickupKind(), reappearS: null,
      };
      p.starNode.parent = node;
      p.balloonNode.parent = node;
      p.windNode.parent = node;
      const behind = rings[(i - 1 + Config.NUM_RINGS) % Config.NUM_RINGS];
      p.alt = Math.max(Config.RING_MIN_ALT, Math.min(Config.RING_MAX_ALT, behind.alt + (Math.random() * 2 - 1) * 20));
      placePickup(p);
      pickups.push(p);
    }

    // Sparkle burst on collecting anything
    const ptex = new BABYLON.DynamicTexture('starTex', { width: 64, height: 64 }, scene, false);
    const ctx = ptex.getContext();
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.4, 'rgba(255,215,80,0.9)');
    g.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ptex.update();
    ptex.hasAlpha = true;
    particles = new BABYLON.ParticleSystem('burst', 220, scene);
    particles.particleTexture = ptex;
    particles.emitter = new BABYLON.Vector3(0, -1000, 0);
    particles.minSize = 0.6; particles.maxSize = 1.6;   // bursts happen AT the
    particles.minLifeTime = 0.25; particles.maxLifeTime = 0.55; // camera - keep them subtle
    particles.emitRate = 0;
    particles.manualEmitCount = 0;
    particles.createSphereEmitter(Config.RING_RADIUS * 0.9);
    particles.minEmitPower = 4; particles.maxEmitPower = 14;
    particles.gravity = new BABYLON.Vector3(0, -6, 0);
    particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    particles.color1 = new BABYLON.Color4(1, 0.9, 0.4, 1);
    particles.color2 = new BABYLON.Color4(1, 0.7, 0.1, 1);
    particles.colorDead = new BABYLON.Color4(1, 0.6, 0, 0);
    particles.start();
  }

  function burstAt(pos) {
    particles.emitter = pos.clone();
    particles.manualEmitCount = 120;
  }

  function crossed(prev, cur, sr) {
    return prev < cur ? (sr > prev && sr <= cur) : (sr > prev || sr <= cur);
  }

  // Called every frame with the plane's previous and current track params.
  function checkCrossings(sPrev, sNow, planeAlt) {
    if (sNow <= 0 || sNow === sPrev) return;
    const C = Config.CIRCUMFERENCE;
    const prev = ((sPrev % C) + C) % C;
    const cur = ((sNow % C) + C) % C;

    for (const r of rings) {
      if (!crossed(prev, cur, r.s)) continue;
      const hit = Math.abs(planeAlt - r.alt) < Config.RING_HIT_TOL;
      if (hit) burstAt(r.mesh.position);
      if (onRing) onRing(hit, r.type, r.mesh.position.clone());
      // Regenerate now (keeps the walk chain and HUD cue correct), move later.
      const prevSlot = rings[(r.slot - 1 + Config.NUM_RINGS) % Config.NUM_RINGS];
      r.alt = walkFrom(prevSlot.alt);
      r.type = rollRingType();
      r.mesh.setEnabled(false);
      r.reappearS = sNow + Config.CAM_BACK + 25;
    }

    for (const p of pickups) {
      if (!crossed(prev, cur, p.s)) continue;
      const got = p.kind && Math.abs(planeAlt - p.alt) < Config.PICKUP_TOL;
      if (got) {
        burstAt(p.node.position);
        if (onPickup) onPickup(p.kind, p.node.position.clone());
      }
      const behind = rings[(p.slot - 1 + Config.NUM_RINGS) % Config.NUM_RINGS];
      p.alt = Math.max(Config.RING_MIN_ALT, Math.min(Config.RING_MAX_ALT, behind.alt + (Math.random() * 2 - 1) * 20));
      p.kind = rollPickupKind();
      p.node.setEnabled(false);
      p.reappearS = sNow + Config.CAM_BACK + 25;
    }
  }

  // The nearest ring ahead of s — for the HUD altitude cue.
  function nextRing(s) {
    if (rings.length === 0) return null;
    const C = Config.CIRCUMFERENCE;
    const cur = s <= 0 ? 0 : ((s % C) + C) % C;
    let best = null, bestDist = Infinity;
    for (const r of rings) {
      let d = r.s - cur;
      if (d <= 0) d += C;
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return { alt: best.alt, dist: bestDist, slot: best.slot, type: best.type };
  }

  function update(t, s) {
    const nxt = nextRing(s);
    for (const r of rings) {
      if (r.reappearS != null && s >= r.reappearS) {
        placeRing(r);
        r.mesh.setEnabled(true);
        r.reappearS = null;
      }
      const isNext = nxt && r.slot === nxt.slot;
      const pulse = 1 + (isNext ? 0.12 : 0.04) * Math.sin(t * (isNext ? 5 : 2.5) + r.slot);
      r.mesh.scaling.setAll(r.baseScale * pulse);
    }
    for (const p of pickups) {
      if (p.reappearS != null && s >= p.reappearS) {
        placePickup(p);
        p.node.setEnabled(true);
        p.reappearS = null;
      }
      if (p.kind === 'star') p.starNode.rotation.y = t * 4 + p.slot;
      else if (p.kind === 'balloon') p.balloonNode.position.y = Math.sin(t * 1.2 + p.slot) * 1.2;
      else if (p.kind === 'wind') { p.windNode.rotation.z = t * 3 + p.slot; p.windNode.rotation.y = Math.sin(t * 0.9) * 0.4; }
    }
  }

  return { build, checkCrossings, nextRing, update, _rings: rings, _pickups: pickups };
})();
