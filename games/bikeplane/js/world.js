// Procedural island world: mountainous terrain with a lagoon and varied
// coastline, a dense district-based cartoon city (streets, plazas, parking
// lots, billboards, varied vehicles), landmarks, forests, farmland, and a
// living ocean (translucent shallows, islets, whale, ships, blimp).
const World = (() => {
  let waterMesh, waterPos = null, waterBase = null, waterNormals = null, waterDamp = null;
  const clouds = [];
  const cars = [];          // moving: { inst, seg, t, dir, speed }
  const roadSegs = [];      // { axis: 'x'|'z', fixed, a, b }
  const parkingSpots = [];  // { x, z, rot } for static parked cars
  const aiPlanes = [];
  const flocks = [];
  const propParts = [];     // static vertex-colored clutter, merged once
  const treeParts = [];     // trees/palms/pines, merged once
  const sailboats = [];     // { node, phase }
  const ships = [];         // circling water craft: { node, radius, speed, dir, phase, bob }
  const smokePuffs = [];
  const hotAirs = [];
  const rotors = [];        // windmill rotors
  const trainCars = [];
  const railPuffs = [];     // { node, offset }
  let ferris = null;
  let shadowGen = null;
  let whale = null;
  let blimp = null;
  const ROAD_Y = Config.PLATEAU_H + 0.6;
  const TRAIN_R = 242;

  // --- Tiny value-noise ---
  function hash(ix, iz) {
    let h = ix * 374761393 + iz * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }
  function smoothstep(a, b, v) {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function gauss(x, z, cx, cz, amp, sigma) {
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    return amp * Math.exp(-d2 / (2 * sigma * sigma));
  }

  // Civic sites: aerial-visible town features, each carved out of the block
  // fabric like the parks are.
  const MALL = { x: 102, z: 459, r: 48 };
  const SCHOOL = { x: -163, z: -441, r: 40 };
  const LIBRARY = { x: 85, z: -289, r: 24 };
  const POOL = { x: 333, z: -332, r: 24 };
  const SOCCER = [{ x: -283, z: 388, r: 26 }, { x: -355, z: -308, r: 26 }];
  const MONUMENT = { x: -117, z: 340, r: 16 };
  const VIADUCT = { ax: 180, az: -120, bx: 400, bz: -260 };   // clear of the lagoon
  function distToSeg(x, z, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  }

  // City parks: green circles the streets and blocks flow around; two have
  // ponds (terrain dips below sea level, showing through the water plane).
  const CITY_PARKS = [
    { x: 145, z: 329, r: 38, pond: true },
    { x: -397, z: 165, r: 35, pond: false },
    { x: -39, z: -348, r: 40, pond: true },
    { x: 298, z: 376, r: 30, pond: false },
  ];

  // Analytic island height, shared by terrain mesh and object placement.
  function terrainHeight(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    let h = Config.PLATEAU_H
      + 1.5 * (noise(x * 0.012, z * 0.012) - 0.5)
      + 3.0 * (noise(x * 0.004 + 7, z * 0.004 + 3) - 0.5);
    // Park hills + lagoon; the big snow mountain is a COASTAL headland —
    // interior points are always ~80° off the tangential chase view, so
    // anything meant to be seen must sit near or outside the flight circle.
    h += gauss(x, z, -80, 60, 40, 60);
    h += gauss(x, z, 90, -50, 32, 60);
    h += gauss(x, z, -20, -130, 24, 55);
    h += gauss(x, z, 60, 190, -16, 50);      // lagoon (below sea level)
    h += gauss(x, z, -258, 497, 88, 92);     // snow-capped volcano headland
    // Flatten the city annulus so streets and blocks sit clean
    const cityZone = smoothstep(Config.CITY_R_MIN - 60, Config.CITY_R_MIN, r)
      * (1 - smoothstep(Config.CITY_R_MAX, Config.CITY_R_MAX + 60, r));
    const cityTarget = Config.PLATEAU_H + (noise(x * 0.0045 + 13, z * 0.0045 + 5) - 0.5) * 5.5;
    h = h * (1 - cityZone * 0.85) + cityTarget * cityZone * 0.85;
    for (const p of CITY_PARKS) {
      if (p.pond) h += gauss(x, z, p.x, p.z, -9, p.r * 0.38);
    }
    // Wavy coastline: coves and headlands instead of a perfect circle
    let edgeStart = 540 + 30 * Math.sin(3 * a + 1.7) + 15 * Math.sin(7 * a + 0.4);
    // The volcano stands on its own peninsula — foothills run down to the
    // sea instead of being sliced off at the island edge.
    edgeStart += 150 * Math.exp(-Math.pow(angDist(a, 2.05), 2) / (2 * 0.3 * 0.3));
    const edge = smoothstep(edgeStart, edgeStart + 130, r);
    h = h * (1 - edge) + (-14) * edge;
    // Flatten under the runway
    const dRun = Track.distToRunway(x, z);
    const runMask = 1 - smoothstep(30, 90, dRun);
    h = h * (1 - runMask) + Config.PLATEAU_H * runMask;
    return h;
  }

  // Walk outward along an angle to find where land meets the sea.
  function shoreRadius(angle) {
    for (let r = 480; r < 700; r += 6) {
      if (terrainHeight(Math.cos(angle) * r, Math.sin(angle) * r) < 0.6) return r;
    }
    return 620;
  }

  function buildTerrain(scene) {
    const size = Config.ISLAND_SIZE, sub = 120;
    const ground = BABYLON.MeshBuilder.CreateGround('island', { width: size, height: size, subdivisions: sub, updatable: true }, scene);
    const pos = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const colors = new Float32Array((pos.length / 3) * 4);
    const sand = [0.96, 0.89, 0.6], grass = [0.45, 0.81, 0.37], dark = [0.3, 0.63, 0.34];
    const rock = [0.55, 0.53, 0.55], snow = [0.96, 0.97, 1.0];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      const h = terrainHeight(x, z);
      pos[i + 1] = h;
      let c;
      if (h >= -0.9 && h < 0.25) {
        // surf line: pale band right at the waterline
        const t = 1 - Math.abs(h + 0.32) / 0.6;
        const foam = [0.97, 0.97, 0.9];
        c = sand.map((v, k) => v + (foam[k] - v) * Math.max(0, t));
      } else if (h < 1.0) c = sand;
      else if (h < 3.0) { const t = (h - 1) / 2; c = sand.map((v, k) => v + (grass[k] - v) * t); }
      else if (h < 18) c = grass;
      else if (h < 45) { const t = (h - 18) / 27; c = grass.map((v, k) => v + (dark[k] - v) * t); }
      else if (h < 62) { const t = (h - 45) / 17; c = dark.map((v, k) => v + (rock[k] - v) * t); }
      else { const t = Math.min(1, (h - 62) / 10); c = rock.map((v, k) => v + (snow[k] - v) * t); }
      // Urban ground: the city annulus reads as pavement/blocks, not lawn
      {
        const r = Math.hypot(x, z);
        const cz = smoothstep(Config.CITY_R_MIN - 40, Config.CITY_R_MIN, r)
          * (1 - smoothstep(Config.CITY_R_MAX, Config.CITY_R_MAX + 40, r))
          * (1 - smoothstep(8, 14, h));
        let inPark = false;
        for (const p of CITY_PARKS) {
          if (Math.hypot(x - p.x, z - p.z) < p.r * 0.95) { inPark = true; break; }
        }
        if (cz > 0 && !inPark) {
          // Patchwork of paved lots and green yards, SimCity-style
          const n = noise(x * 0.05, z * 0.05);
          const n2 = smoothstep(0.35, 0.62, noise(x * 0.021 + 31, z * 0.021 + 17));
          const pav = [0.7 + n * 0.08, 0.69 + n * 0.08, 0.66 + n * 0.07];
          const lawn = [0.5 + n * 0.08, 0.76 + n * 0.06, 0.4];
          const urban = pav.map((v, k) => v + (lawn[k] - v) * n2 * 0.5);
          c = c.map((v, k) => v + (urban[k] - v) * cz * 0.72);
        }
      }
      const j = (i / 3) * 4;
      colors[j] = c[0]; colors[j + 1] = c[1]; colors[j + 2] = c[2]; colors[j + 3] = 1;
    }
    ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
    ground.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    ground.convertToFlatShadedMesh();
    const m = new BABYLON.StandardMaterial('islandMat', scene);
    m.diffuseColor = new BABYLON.Color3(1, 1, 1);
    m.specularColor = BABYLON.Color3.Black();
    ground.material = m;
    ground.freezeWorldMatrix();
  }

  // Translucent water over a dark seafloor: sandy shallows read through the
  // surface near shore, deep water blends dark.
  function buildWater(scene) {
    const floor = BABYLON.MeshBuilder.CreateGround('seafloor', { width: 12000, height: 12000 }, scene);   // far past the water edge: no visible square
    floor.position.y = -24;
    const fm = new BABYLON.StandardMaterial('seafloorMat', scene);
    fm.diffuseColor = new BABYLON.Color3(0.08, 0.28, 0.52);
    fm.specularColor = BABYLON.Color3.Black();
    floor.material = fm;
    floor.freezeWorldMatrix();

    waterMesh = BABYLON.MeshBuilder.CreateGround('water', { width: Config.WATER_SIZE, height: Config.WATER_SIZE, subdivisions: 56, updatable: true }, scene);
    waterMesh.position.y = 0;
    waterBase = waterMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind).slice();
    waterPos = waterBase.slice();
    waterNormals = waterMesh.getVerticesData(BABYLON.VertexBuffer.NormalKind).slice();
    // Inland water (lagoon + park ponds) must sit still — the big ocean sine
    // waves made small lakes look like they were sliding around.
    waterDamp = new Float32Array(waterBase.length / 3);
    const calm = [{ x: 60, z: 190, r: 70 }, { x: 145, z: 329, r: 22 }, { x: -39, z: -348, r: 24 }];
    for (let i = 0; i < waterBase.length; i += 3) {
      let damp = 1;
      for (const cl of calm) {
        const d = Math.hypot(waterBase[i] - cl.x, waterBase[i + 2] - cl.z) - cl.r;
        damp = Math.min(damp, Math.max(0, Math.min(1, d / 90)));
      }
      waterDamp[i / 3] = damp;
    }
    const m = new BABYLON.StandardMaterial('waterMat', scene);
    m.diffuseColor = new BABYLON.Color3(0.22, 0.58, 0.9);
    m.emissiveColor = new BABYLON.Color3(0.04, 0.14, 0.26);
    m.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    m.specularPower = 128;
    m.alpha = 0.78;
    waterMesh.material = m;
  }

  function updateWater(t) {
    if (!waterPos) return;
    for (let i = 0; i < waterBase.length; i += 3) {
      const x = waterBase[i], z = waterBase[i + 2];
      waterPos[i + 1] = waterDamp[i / 3] * (0.7 * Math.sin(0.02 * x + t * 1.3) + 0.6 * Math.sin(0.017 * z + 0.01 * x + t * 0.9));
    }
    waterMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, waterPos);
    BABYLON.VertexData.ComputeNormals(waterPos, waterMesh.getIndices(), waterNormals);
    waterMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, waterNormals);
  }

  function buildRunway(scene) {
    const len = Config.RUNWAY_LEN + 40;
    const run = BABYLON.MeshBuilder.CreateGround('runway', { width: 18, height: len }, scene);
    run.position.set(Track.R, Config.PLATEAU_H + 0.08, -Config.RUNWAY_LEN / 2 + 8);
    const tex = new BABYLON.DynamicTexture('runTex', { width: 128, height: 512 }, scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = '#4a4d55'; ctx.fillRect(0, 0, 128, 512);
    ctx.fillStyle = '#e8e8e8';
    for (let y = 70; y < 442; y += 48) ctx.fillRect(58, y, 12, 26);
    // threshold piano keys at both ends + aiming bars
    for (let k = 0; k < 6; k++) {
      ctx.fillRect(14 + k * 18, 6, 10, 34);
      ctx.fillRect(14 + k * 18, 472, 10, 34);
    }
    ctx.fillRect(22, 58, 24, 10); ctx.fillRect(82, 58, 24, 10);
    ctx.fillRect(22, 444, 24, 10); ctx.fillRect(82, 444, 24, 10);
    ctx.fillStyle = '#f0d020';
    ctx.fillRect(4, 0, 6, 512); ctx.fillRect(118, 0, 6, 512);
    tex.update();
    const m = new BABYLON.StandardMaterial('runMat', scene);
    m.diffuseTexture = tex;
    m.specularColor = BABYLON.Color3.Black();
    run.material = m;
    run.freezeWorldMatrix();
    // Little airfield: hangar, parked red plane, windsock
    const hx = Track.R + 22, hz = -60;
    colorBox(scene, 'hang', 14, 6, 16, hx, Config.PLATEAU_H + 3, hz, [0.85, 0.55, 0.3]);
    const roof = colorCyl(scene, 'hangR', { height: 16, diameter: 14, tessellation: 12, arc: 0.5 }, hx, Config.PLATEAU_H + 6, hz, [0.7, 0.42, 0.25]);
    roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 2;
    colorCyl(scene, 'wsp', { height: 7, diameter: 0.3, tessellation: 6 }, Track.R + 14, Config.PLATEAU_H + 3.5, 6, [0.9, 0.9, 0.9]);
    const sock = colorCyl(scene, 'ws', { height: 3, diameterBottom: 1.1, diameterTop: 0.4, tessellation: 8 }, Track.R + 14 + 1.5, Config.PLATEAU_H + 6.6, 6, [1, 0.55, 0.1]);
    sock.rotation.z = Math.PI / 2;
    // a small parked fleet on the apron
    const parkedPlane = (px, pz, yaw, bodyC, wingC, highWing) => {
      const node = mkFrame(scene, px, pz, yaw);
      fBox(scene, node, 1, 0.9, 5.2, 0, Config.PLATEAU_H + 1, 0, bodyC);
      fBox(scene, node, 7.2, 0.18, 1.4, 0, Config.PLATEAU_H + (highWing ? 1.55 : 1.3), 0.6, wingC);
      fBox(scene, node, 2.6, 0.85, 0.6, 0, Config.PLATEAU_H + 1.2, -2.4, bodyC);
      fBox(scene, node, 0.2, 1, 0.9, 0, Config.PLATEAU_H + 1.7, -2.4, wingC);
      fCyl(scene, node, { height: 0.15, diameter: 1.6, tessellation: 10 }, 0, Config.PLATEAU_H + 1, 2.85, [0.3, 0.3, 0.32]);
    };
    parkedPlane(hx, hz + 14, 0.4, [0.85, 0.2, 0.2], [0.95, 0.9, 0.3], false);
    parkedPlane(hx + 4, hz + 26, -0.5, [0.3, 0.65, 0.4], [0.95, 0.95, 0.9], true);
    parkedPlane(hx - 3, hz + 38, 0.9, [0.95, 0.6, 0.15], [0.95, 0.95, 0.9], false);
    parkedPlane(hx + 8, hz + 48, 2.2, [0.35, 0.5, 0.85], [0.95, 0.95, 0.9], true);
    parkedPlane(hx - 1, hz + 58, -1.1, [0.7, 0.3, 0.7], [0.95, 0.9, 0.3], false);
    // terminal with glass strip + control tower
    {
      const term = mkFrame(scene, hx + 12, hz + 74, 0);
      fBox(scene, term, 24, 5, 9, 0, Config.PLATEAU_H + 2.5, 0, [0.9, 0.87, 0.8]);
      fBox(scene, term, 24.2, 1.6, 9.2, 0, Config.PLATEAU_H + 3.4, 0, [0.55, 0.75, 0.9]);
      fBox(scene, term, 26, 0.5, 10.5, 0, Config.PLATEAU_H + 5.2, 0, [0.5, 0.52, 0.58]);
      fBox(scene, term, 3, 11, 3, 9, Config.PLATEAU_H + 5.5, 0, [0.9, 0.87, 0.8]);
      fBox(scene, term, 4.6, 2.4, 4.6, 9, Config.PLATEAU_H + 12.2, 0, [0.45, 0.65, 0.85]);
      fBox(scene, term, 5.2, 0.5, 5.2, 9, Config.PLATEAU_H + 13.6, 0, [0.5, 0.52, 0.58]);
      // apron pad + baggage carts
      fBox(scene, term, 30, 0.15, 26, -2, Config.PLATEAU_H + 0.3, -16, [0.62, 0.63, 0.6]);
      for (let bC = 0; bC < 3; bC++) {
        fBox(scene, term, 1.4, 0.8, 2, -8 + bC * 2.4, Config.PLATEAU_H + 0.7, -12, [0.85, 0.55 + bC * 0.1, 0.2]);
      }
    }
    // second hangar
    {
      const h2 = mkFrame(scene, hx + 3, hz - 22, 0.15);
      fBox(scene, h2, 12, 5, 13, 0, Config.PLATEAU_H + 2.5, 0, [0.65, 0.68, 0.72]);
      const r2 = gablePrism(scene, h2, 14, 6.5, 2.6, 0, Config.PLATEAU_H + 4.9, 0, [0.5, 0.54, 0.6]);
    }
    // fuel truck
    const ft = mkFrame(scene, hx + 9, hz + 6, 1.1);
    fBox(scene, ft, 1.8, 1.2, 2, 0, Config.PLATEAU_H + 1.1, 2, [0.95, 0.8, 0.2]);
    const tank = fCyl(scene, ft, { height: 3.6, diameter: 1.7, tessellation: 10 }, 0, Config.PLATEAU_H + 1.3, -0.8, [0.9, 0.9, 0.92]);
    tank.rotation.x = Math.PI / 2;
  }

  function inCorridor(x, z) {
    if (Track.distToRunway(x, z) < 50) return true;
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    if (a > -0.05 && a < 220 / Track.R && Math.abs(r - Track.radiusAt(a)) < 50) return true;
    return false;
  }

  const FERRIS_POS = { x: 218, z: 274 };
  const STADIUM_POS = { x: -394, z: 237 };   // outward: clear of the monorail orbit
  // Scenic railway: an off-center loop that weaves through the city bands
  // and the park (a concentric one was invisible from the chase cam).
  const RAIL_C = { x: 40, z: -70 };
  const RAIL_R = 340;
  function railDist(x, z) { return Math.abs(Math.hypot(x - RAIL_C.x, z - RAIL_C.z) - RAIL_R); }

  function inCityZone(x, z) {
    const r = Math.hypot(x, z);
    if (r < Config.CITY_R_MIN || r > Config.CITY_R_MAX) return false;
    if (inCorridor(x, z)) return false;
    if (Math.hypot(x - FERRIS_POS.x, z - FERRIS_POS.z) < 52) return false;   // fairground
    if (Math.hypot(x - STADIUM_POS.x, z - STADIUM_POS.z) < 68) return false;
    if (railDist(x, z) < 9) return false;                                    // railway right-of-way
    for (const p of CITY_PARKS) {
      if (Math.hypot(x - p.x, z - p.z) < p.r) return false;
    }
    for (const s2 of [MALL, SCHOOL, LIBRARY, POOL, MONUMENT, SOCCER[0], SOCCER[1]]) {
      if (Math.hypot(x - s2.x, z - s2.z) < s2.r) return false;
    }
    if (distToSeg(x, z, VIADUCT.ax, VIADUCT.az, VIADUCT.bx, VIADUCT.bz) < 11) return false;
    const gh = terrainHeight(x, z);
    return gh > 1.6 && gh < 9;
  }

  function setMeshColor(mesh, r, g, b) {
    const n = mesh.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { cols[i * 4] = r; cols[i * 4 + 1] = g; cols[i * 4 + 2] = b; cols[i * 4 + 3] = 1; }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
  }

  function colorBox(scene, name, w, h, d, x, y, z, c) {
    const b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z);
    setMeshColor(b, c[0], c[1], c[2]);
    propParts.push(b);
    return b;
  }
  function colorCyl(scene, name, opts, x, y, z, c) {
    const b = BABYLON.MeshBuilder.CreateCylinder(name, opts, scene);
    b.position.set(x, y, z);
    setMeshColor(b, c[0], c[1], c[2]);
    propParts.push(b);
    return b;
  }
  function colorSphere(scene, name, opts, x, y, z, c) {
    const b = BABYLON.MeshBuilder.CreateSphere(name, opts, scene);
    b.position.set(x, y, z);
    setMeshColor(b, c[0], c[1], c[2]);
    propParts.push(b);
    return b;
  }

  // Local-frame builders: parts placed under a rotated parent, later baked
  // into the merged meshes (MergeMeshes applies world matrices).
  const bakeNodes = [];
  function mkFrame(scene, x, z, yaw) {
    const n = new BABYLON.TransformNode('bf', scene);
    n.position.set(x, 0, z);
    n.rotation.y = yaw;
    bakeNodes.push(n);
    return n;
  }
  function fBox(scene, parent, w, h, d, lx, ly, lz, c) {
    const b = BABYLON.MeshBuilder.CreateBox('lp', { width: w, height: h, depth: d }, scene);
    b.parent = parent; b.position.set(lx, ly, lz);
    setMeshColor(b, c[0], c[1], c[2]);
    propParts.push(b);
    return b;
  }
  function fCyl(scene, parent, opts, lx, ly, lz, c) {
    const b = BABYLON.MeshBuilder.CreateCylinder('lp', opts, scene);
    b.parent = parent; b.position.set(lx, ly, lz);
    setMeshColor(b, c[0], c[1], c[2]);
    propParts.push(b);
    return b;
  }
  // Solid gable roof: an extruded triangular prism whose caps close the ends
  // (ridge along local X).
  function gablePrism(scene, parent, length, halfSpan, rise, lx, ly, lz, c) {
    const shape = [
      new BABYLON.Vector3(-halfSpan, 0, 0),
      new BABYLON.Vector3(halfSpan, 0, 0),
      new BABYLON.Vector3(0, rise, 0),
    ];
    const roof = BABYLON.MeshBuilder.ExtrudeShape('gable', {
      shape, closeShape: true, cap: BABYLON.Mesh.CAP_ALL,
      path: [new BABYLON.Vector3(0, 0, -length / 2), new BABYLON.Vector3(0, 0, length / 2)],
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    roof.rotation.y = Math.PI / 2;   // extrusion along Z -> ridge along local X
    roof.parent = parent;
    roof.position.set(lx, ly, lz);
    setMeshColor(roof, c[0], c[1], c[2]);
    propParts.push(roof);
    return roof;
  }

  // --- Streets: a WARPED polar network — wobbly ring boulevards + gently
  // curving radial avenues. Real cities are never perfect circles.
  const RING_ROADS = [270, 330, 390, 450, 510];
  const MAJOR_RADIALS = [];
  const MINOR_RADIALS = [];
  for (let k = 0; k < 12; k++) {
    MAJOR_RADIALS.push(k * (Math.PI / 6) + (hash(k, 401) - 0.5) * 0.14);
    MINOR_RADIALS.push(k * (Math.PI / 6) + Math.PI / 12 + (hash(k, 402) - 0.5) * 0.12);
  }
  function ringWarpR(baseR, th) {
    return baseR + 13 * Math.sin(2 * th + baseR * 0.13) + 6 * Math.sin(5 * th + baseR * 0.71);
  }
  function radialWarpA(a, r) {
    return a + 0.055 * Math.sin((r - 250) * 0.016 + a * 2.3);
  }
  function angDist(a, b) {
    let d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  }
  function nearRadial(a, r, margin) {
    const m = margin || 12;
    if (MAJOR_RADIALS.some(ra => angDist(a, radialWarpA(ra, r)) * r < m)) return true;
    if (r > 322 && MINOR_RADIALS.some(ra => angDist(a, radialWarpA(ra, r)) * r < Math.max(9, m - 4))) return true;
    return false;
  }
  function tangentYaw(th) { return Math.atan2(-Math.sin(th), Math.cos(th)); }
  function roadGY(x, z) { return terrainHeight(x, z) + 0.45; }

  function buildRoads(scene) {
    const asphalt = [], paint = [];

    // Ring boulevards: chunked warped arcs with sidewalk strips
    for (const r of RING_ROADS) {
      const w = r === 390 ? 13 : 10;
      // shorter chords on the tighter inner rings, or the curve looks jagged
      const step = (r <= 330 ? 15 : 24) / r;
      const chunkLen = step * r * 1.45;
      let runStart = null, k = 0;
      for (let th = 0; th <= Math.PI * 2 + step; th += step, k++) {
        const thm = th + step / 2;
        const Rm = ringWarpR(r, thm);
        const R = ringWarpR(r, th);
        const R2 = ringWarpR(r, th + step);
        const x = Math.cos(thm) * Rm, z = Math.sin(thm) * Rm;
        const xa = Math.cos(th) * R, za = Math.sin(th) * R;
        const x2 = Math.cos(th + step) * R2, z2 = Math.sin(th + step) * R2;
        const yaw = Math.atan2(-(z2 - za), x2 - xa);
        const valid = th <= Math.PI * 2 && inCityZone(x, z);
        if (valid) {
          const gy = roadGY(x, z);
          const box = BABYLON.MeshBuilder.CreateBox('rd', { width: chunkLen, depth: w, height: 2.2 }, scene);
          box.position.set(x, gy - 1.1, z);
          box.rotation.y = yaw;
          setMeshColor(box, 0.38, 0.39, 0.44);
          asphalt.push(box);
          for (const side of [-1, 1]) {
            const sr = Rm + side * (w / 2 + 1.7);
            const sw = BABYLON.MeshBuilder.CreateBox('sw', { width: chunkLen, depth: 2.6, height: 2.4 }, scene);
            sw.position.set(Math.cos(thm) * sr, gy - 1.05, Math.sin(thm) * sr);
            sw.rotation.y = yaw;
            setMeshColor(sw, 0.8, 0.79, 0.75);
            asphalt.push(sw);
          }
          if (k % 2 === 0) {
            const d = BABYLON.MeshBuilder.CreateBox('dash', { width: 3, depth: 0.7, height: 0.08 }, scene);
            d.position.set(x, gy + 0.06, z);
            d.rotation.y = yaw;
            setMeshColor(d, 0.93, 0.9, 0.6);
            paint.push(d);
          }
          if (hash(Math.round(th * 1000), Math.round(r)) < 0.14 && !nearRadial(th, R, 18)) {
            const pr = R + (hash(k, r) > 0.5 ? 1 : -1) * (w / 2 - 1.5);
            parkingSpots.push({ x: Math.cos(th) * pr, z: Math.sin(th) * pr, rot: Math.atan2(x2 - x, z2 - z) });
          }
          if (runStart === null) runStart = th;
        } else if (runStart !== null) {
          if ((th - runStart) * r >= 130) roadSegs.push({ type: 'arc', r, a0: runStart + 8 / r, a1: th - 16 / r });
          runStart = null;
        }
      }
    }

    // Radial avenues: chains of warped segments (majors wide, minors narrow)
    const buildRadial = (a, wRoad, rStart, collectSegs) => {
      let runStart = null;
      for (let rr = rStart; rr <= 560; rr += 22) {
        const aw = radialWarpA(a, rr), aw2 = radialWarpA(a, rr + 22);
        const x = Math.cos(aw) * rr, z = Math.sin(aw) * rr;
        const x2 = Math.cos(aw2) * (rr + 22), z2 = Math.sin(aw2) * (rr + 22);
        const valid = rr <= 538 && inCityZone(x, z);
        if (valid) {
          const yaw = Math.atan2(x2 - x, z2 - z);
          const len = Math.hypot(x2 - x, z2 - z);
          const gy = roadGY(x, z);
          const box = BABYLON.MeshBuilder.CreateBox('rd', { width: wRoad, depth: len + 1.2, height: 2.1 }, scene);
          box.position.set((x + x2) / 2, gy - 1.09, (z + z2) / 2);
          box.rotation.y = yaw;
          setMeshColor(box, 0.36, 0.37, 0.42);
          asphalt.push(box);
          for (const side of [-1, 1]) {
            const sx2 = (x + x2) / 2 - Math.sin(aw) * -side * (wRoad / 2 + 1.4) * 0 + Math.cos(aw + Math.PI / 2) * side * (wRoad / 2 + 1.4);
            const sz3 = (z + z2) / 2 + Math.sin(aw + Math.PI / 2) * side * (wRoad / 2 + 1.4);
            const sw = BABYLON.MeshBuilder.CreateBox('sw', { width: 2.2, depth: len + 1.2, height: 2 }, scene);
            sw.position.set(sx2, gy - 1.06, sz3);
            sw.rotation.y = yaw;
            setMeshColor(sw, 0.8, 0.79, 0.75);
            asphalt.push(sw);
          }
          if (runStart === null) runStart = rr;
        } else if (runStart !== null) {
          if (collectSegs && rr - runStart >= 110) roadSegs.push({ type: 'ray', angle: a, r0: runStart + 6, r1: rr - 16 });
          runStart = null;
        }
      }
    };
    for (const a of MINOR_RADIALS) buildRadial(a, 7, 330, true);
    for (const a of MAJOR_RADIALS) {
      buildRadial(a, 9, 254, true);
      // Crosswalks where the avenue meets each boulevard
      for (const r of RING_ROADS) {
        const aw = radialWarpA(a, r);
        const R = ringWarpR(r, aw);
        const dirx = Math.cos(aw), dirz = Math.sin(aw);
        if (!inCityZone(dirx * R, dirz * R)) continue;
        const yaw = Math.atan2(dirx, dirz);
        for (const side of [-1, 1]) {
          const rr = R + side * 8;
          for (let s2 = -1; s2 <= 1; s2++) {
            const cwx = dirx * rr - dirz * s2 * 2.3, cwz = dirz * rr + dirx * s2 * 2.3;
            const cw = BABYLON.MeshBuilder.CreateBox('cw', { width: 1.0, depth: 2.2, height: 0.09 }, scene);
            cw.position.set(cwx, roadGY(cwx, cwz) + 0.07, cwz);
            cw.rotation.y = yaw;
            setMeshColor(cw, 0.95, 0.95, 0.95);
            paint.push(cw);
          }
        }
      }
    }

    const roadMat = new BABYLON.StandardMaterial('roadMat', scene);
    roadMat.specularColor = BABYLON.Color3.Black();
    for (const [list, name] of [[asphalt, 'roads'], [paint, 'roadPaint']]) {
      const m = BABYLON.Mesh.MergeMeshes(list, true, true);
      m.name = name;
      m.material = roadMat;
      m.freezeWorldMatrix();
    }

    // Streetlamps along the radial avenues
    for (const a of MAJOR_RADIALS) {
      for (let rr = 280; rr <= 520; rr += 55) {
        const aw = radialWarpA(a, rr);
        const lx = Math.cos(aw) * rr - Math.sin(aw) * 6, lz = Math.sin(aw) * rr + Math.cos(aw) * 6;
        if (!inCityZone(lx, lz)) continue;
        const gy = roadGY(lx, lz);
        colorCyl(scene, 'lampP', { height: 5.5, diameter: 0.28, tessellation: 6 }, lx, gy + 2.75, lz, [0.35, 0.37, 0.4]);
        colorSphere(scene, 'lampG', { diameter: 0.75, segments: 5 }, lx + Math.sin(aw) * 1.2, gy + 5.25, lz - Math.cos(aw) * 1.2, [1, 0.9, 0.55]);
      }
    }
    // Streetlamps along the 330, 390, and 450 boulevards
    for (const r of [330, 390, 450]) {
      const step = 44 / r;
      for (let th = 0; th < Math.PI * 2; th += step) {
        const R = ringWarpR(r, th) + 7;
        const x = Math.cos(th) * R, z = Math.sin(th) * R;
        if (!inCityZone(x, z) || nearRadial(th, R, 16)) continue;
        const gy = roadGY(x, z);
        colorCyl(scene, 'lampP', { height: 5.5, diameter: 0.28, tessellation: 6 }, x, gy + 2.75, z, [0.35, 0.37, 0.4]);
        const arm = colorBox(scene, 'lampA', 0.16, 0.16, 1.8, x - Math.cos(th) * 0.9, gy + 5.4, z - Math.sin(th) * 0.9, [0.35, 0.37, 0.4]);
        arm.rotation.y = Math.atan2(Math.cos(th), Math.sin(th));
        colorSphere(scene, 'lampG', { diameter: 0.75, segments: 5 }, x - Math.cos(th) * 1.7, gy + 5.25, z - Math.sin(th) * 1.7, [1, 0.9, 0.55]);
      }
    }
  }

  // --- District wall textures: multi-cell atlases of VARIED window styles;
  // each building samples a random cell offset so facades differ ---
  function makeTexture(scene, name, size, draw) {
    const tex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, true);
    draw(tex.getContext());
    tex.update();
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return tex;
  }
  const GLASS = ['#a8cdf5', '#31445f', '#f2d98e', '#8fa8c0', '#bcd8ee', '#4c6584'];
  function downtownTexture(scene) {
    return makeTexture(scene, 'texDowntown', 512, (ctx) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const ox = cx * 128, oy = cy * 128;
        const g1 = GLASS[(cx * 7 + cy * 3) % GLASS.length];
        const wide = (cx + cy) % 3 === 0;
        const xs = wide ? [14, 70] : [12, 50, 88];
        const wd = wide ? 44 : 28;
        for (const x0 of xs) {
          ctx.fillStyle = '#2e3d55'; ctx.fillRect(ox + x0, oy + 20, wd, 88);
          ctx.fillStyle = g1; ctx.fillRect(ox + x0 + 3, oy + 23, wd - 6, 82);
          ctx.fillStyle = '#e8f2ff'; ctx.fillRect(ox + x0 + 3, oy + 23, wd - 6, 18);
          ctx.fillStyle = '#2e3d55'; ctx.fillRect(ox + x0 + 3, oy + 62, wd - 6, 3);
          if ((cx + 2 * cy) % 4 === 1) { ctx.fillStyle = '#f5e6a8'; ctx.fillRect(ox + x0 + 3, oy + 70, wd - 6, 16); }
        }
      }
    });
  }
  function midtownTexture(scene) {
    return makeTexture(scene, 'texMidtown', 512, (ctx) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const ox = cx * 128, oy = cy * 128;
        const g1 = GLASS[(cx * 5 + cy) % GLASS.length];
        ctx.fillStyle = '#3a4c66'; ctx.fillRect(ox + 30, oy + 30, 68, 68);
        ctx.fillStyle = g1; ctx.fillRect(ox + 36, oy + 36, 56, 56);
        if ((cx + cy) % 2 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + 61, oy + 36, 6, 56); ctx.fillRect(ox + 36, oy + 61, 56, 6); }
        if ((cx * 3 + cy) % 5 === 2) { ctx.fillStyle = '#d8b98a'; ctx.fillRect(ox + 36, oy + 36, 56, 22); }
        if ((cx + cy * 2) % 5 === 3) { ctx.fillStyle = '#f5e6a8'; ctx.fillRect(ox + 36, oy + 36, 56, 56); }
      }
    });
  }
  function houseTexture(scene) {
    return makeTexture(scene, 'texHouse', 256, (ctx) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
      const doorCols = ['#6b4326', '#7c3a2e', '#3f5a3c', '#3a4c66'];
      for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
        const ox = cx * 128, oy = cy * 128;
        const di = cx + cy * 2;
        const doorX = [52, 16, 86, 46][di];
        ctx.fillStyle = doorCols[di]; ctx.fillRect(ox + doorX, oy + 66, 26, 62);
        ctx.fillStyle = '#f4c542'; ctx.fillRect(ox + doorX + 18, oy + 94, 5, 5);
        const winXs = di === 1 ? [60, 96] : (di === 2 ? [12, 48] : [12, 92]);
        for (const x0 of winXs) {
          ctx.fillStyle = '#3a4c66'; ctx.fillRect(ox + x0, oy + 28, 26, 30);
          ctx.fillStyle = GLASS[(di + x0) % GLASS.length]; ctx.fillRect(ox + x0 + 3, oy + 31, 20, 24);
          ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + x0 + 11, oy + 31, 4, 24);
        }
      }
    });
  }

  function windowBox(scene, w, h, d, opt = {}) {
    const div = opt.div || 4;
    const cell = 1 / div;
    const cols = opt.cols != null ? opt.cols : Math.max(1, Math.round(w / 4));
    const rows = opt.rows != null ? opt.rows : Math.max(1, Math.round(h / 3.6));
    const u0 = ((opt.u0 || 0) % div) * cell;
    const v0 = ((opt.v0 || 0) % div) * cell;
    const faceUV = [];
    for (let f = 0; f < 4; f++) faceUV.push(new BABYLON.Vector4(u0, v0, u0 + cols * cell, v0 + rows * cell));
    faceUV.push(new BABYLON.Vector4(u0 + 0.002, v0 + 0.002, u0 + 0.006, v0 + 0.006));
    faceUV.push(new BABYLON.Vector4(u0 + 0.002, v0 + 0.002, u0 + 0.006, v0 + 0.006));
    return BABYLON.MeshBuilder.CreateBox('bw', { width: w, depth: d, height: h, faceUV }, scene);
  }

  // --- City: warped polar rows of buildings facing the boulevards.
  // Downtown skyline rises toward the center (only the band under the
  // flight path at r~420 keeps a height cap). Every building varies in
  // footprint, height, shape, and window-atlas offset.
  function buildCity(scene) {
    const palette = [
      [0.9, 0.6, 0.5], [0.95, 0.88, 0.7], [0.98, 0.94, 0.84], [0.88, 0.88, 0.85],
      [0.98, 0.97, 0.94], [0.76, 0.87, 0.95], [0.85, 0.85, 0.68], [0.74, 0.79, 0.85],
      [0.94, 0.72, 0.55], [0.96, 0.86, 0.8],
    ];
    const roofCols = [[0.75, 0.34, 0.28], [0.36, 0.6, 0.4], [0.48, 0.56, 0.68], [0.66, 0.48, 0.32], [0.85, 0.53, 0.35]];
    const lipCols = [[0.8, 0.4, 0.35], [0.4, 0.62, 0.58], [0.6, 0.66, 0.72], [0.82, 0.58, 0.38], [0.52, 0.58, 0.64]];
    const awningCols = [[0.8, 0.32, 0.3], [0.28, 0.5, 0.72], [0.85, 0.55, 0.2], [0.3, 0.6, 0.45]];
    const wallsDowntown = [], wallsMidtown = [], wallsHouse = [];

    const windowCyl = (list, parent, dia, h, lx, ly, lz, c, opt) => {
      const cy = BABYLON.MeshBuilder.CreateCylinder('bwc', { height: h, diameter: dia, tessellation: 16 }, scene);
      const uvs = cy.getVerticesData(BABYLON.VertexBuffer.UVKind);
      const cell = 0.25;
      const cols = Math.max(3, Math.round(Math.PI * dia / 4));
      const rows = Math.max(1, Math.round(h / 3.6));
      const u0 = ((opt.u0 || 0) % 4) * cell, v0 = ((opt.v0 || 0) % 4) * cell;
      for (let i2 = 0; i2 < uvs.length; i2 += 2) {
        uvs[i2] = u0 + uvs[i2] * cols * cell;
        uvs[i2 + 1] = v0 + uvs[i2 + 1] * rows * cell;
      }
      cy.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs);
      cy.parent = parent; cy.position.set(lx, ly, lz);
      setMeshColor(cy, c[0], c[1], c[2]);
      list.push(cy);
      return cy;
    };
    const lWall = (list, parent, w, h, d, lx, ly, lz, c, opt) => {
      const b = windowBox(scene, w, h, d, opt || {});
      b.parent = parent;
      b.position.set(lx, ly, lz);
      setMeshColor(b, c[0], c[1], c[2]);
      list.push(b);
      return b;
    };

    function foundation(node, f, d2, gh, c) {
      fBox(scene, node, f + 1.4, 2.6, (d2 || f) + 1.4, 0, gh - 1.4, 0, [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55]);
    }

    function roofClutter(node, rand, roofY, roofF) {
      const roll = rand(5);
      if (roll < 0.3) {
        fCyl(scene, node, { height: 5, diameter: 0.5, tessellation: 6 }, 0, roofY + 2.5, 0, [0.7, 0.25, 0.25]);
        fCyl(scene, node, { height: 1.2, diameter: 1.4, tessellation: 8 }, 0, roofY + 0.6, 0, [0.5, 0.5, 0.55]);
      } else if (roll < 0.6) {
        const wx = (rand(6) - 0.5) * roofF * 0.4, wz = (rand(8) - 0.5) * roofF * 0.4;
        fCyl(scene, node, { height: 3.6, diameter: 3.2, tessellation: 10 }, wx, roofY + 1.8, wz, [0.62, 0.44, 0.3]);
        fCyl(scene, node, { height: 1.6, diameterBottom: 3.6, diameterTop: 0.4, tessellation: 10 }, wx, roofY + 4.4, wz, [0.48, 0.33, 0.23]);
      } else if (roll < 0.75 && roofF > 8) {
        fCyl(scene, node, { height: 0.3, diameter: Math.min(roofF - 2, 9), tessellation: 14 }, 0, roofY + 0.2, 0, [0.4, 0.42, 0.48]);
        fBox(scene, node, 0.7, 0.12, 3.2, -1, roofY + 0.4, 0, [0.95, 0.95, 0.95]);
        fBox(scene, node, 0.7, 0.12, 3.2, 1, roofY + 0.4, 0, [0.95, 0.95, 0.95]);
        fBox(scene, node, 1.5, 0.12, 0.7, 0, roofY + 0.4, 0, [0.95, 0.95, 0.95]);
      } else {
        for (let a2 = 0; a2 < 2; a2++) {
          fBox(scene, node, 1.6, 1.1, 1.6, (rand(10 + a2) - 0.5) * roofF * 0.5, roofY + 0.55, (rand(20 + a2) - 0.5) * roofF * 0.5, [0.6, 0.62, 0.64]);
        }
      }
    }

    function gableRoof(node, f, d2, baseY, c) {
      const halfSpan = d2 / 2 + 0.7;
      const rise = halfSpan * Math.tan(0.62);
      gablePrism(scene, node, f + 1.6, halfSpan, rise, 0, baseY, 0, c);
      fBox(scene, node, f + 1.8, 0.28, 0.6, 0, baseY + rise, 0, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
    }

    function makeDowntown(node, rand, gh, c, a, opts) {
      const f = opts.w;
      fBox(scene, node, f + 5, 0.14, f + 6, 0, gh + 0.12, 0, [0.66, 0.66, 0.63]);   // parcel
      // One true CBD: towers cluster around bearing 2.4 rad, which stands
      // across the bay in view right after takeoff.
      const cf = Math.exp(-Math.pow(angDist(a, 2.4), 2) / (2 * 0.38 * 0.38));
      let h;
      if (rand(13) < 0.05 + cf * 0.25) h = 85 + rand(2) * 25 + cf * 20;
      else h = (16 + rand(2) * 50 * (1.3 - f / 50)) * (1 + cf * 0.85) * opts.hMult;
      h = Math.max(14, h);
      const uv = { u0: Math.floor(rand(21) * 4), v0: Math.floor(rand(22) * 4) };
      foundation(node, f, f, gh, c);
      const shape = rand(11);
      if (shape < 0.18) {
        windowCyl(wallsDowntown, node, f * 0.95, h * 0.7, 0, gh + h * 0.35 - 1, 0, c, uv);
        windowCyl(wallsDowntown, node, f * 0.62, h * 0.3, 0, gh + h * 0.85 - 1, 0, [c[0] * 0.82, c[1] * 0.82, c[2] * 0.85], uv);
        fCyl(scene, node, { height: 2.4, diameter: 3.5, tessellation: 10 }, 0, gh + h + 0.2 - 1, 0, [0.9, 0.86, 0.74]);
      } else if (shape < 0.42) {
        const h1 = h * 0.62;
        lWall(wallsDowntown, node, f, h1, f, 0, gh + h1 / 2 - 1, 0, c, uv);
        lWall(wallsDowntown, node, f * 0.62, h * 0.38, f * 0.62, 0, gh + h1 + h * 0.19 - 1, 0, c, uv);
        roofClutter(node, rand, gh + h - 1, f * 0.62);
      } else if (shape < 0.6) {
        // three-tier wedding cake
        const t1 = h * 0.5, t2 = h * 0.3, t3 = h * 0.2;
        lWall(wallsDowntown, node, f, t1, f, 0, gh + t1 / 2 - 1, 0, c, uv);
        lWall(wallsDowntown, node, f * 0.75, t2, f * 0.75, 0, gh + t1 + t2 / 2 - 1, 0, c, uv);
        lWall(wallsDowntown, node, f * 0.5, t3, f * 0.5, 0, gh + t1 + t2 + t3 / 2 - 1, 0, c, uv);
        if (h > 45) fCyl(scene, node, { height: 6, diameter: 0.5, tessellation: 6 }, 0, gh + h + 2, 0, [0.8, 0.25, 0.25]);
      } else if (shape < 0.78) {
        const h2 = h * (0.55 + rand(12) * 0.35);
        lWall(wallsDowntown, node, f, h, f * 0.55, 0, gh + h / 2 - 1, -f * 0.22, c, uv);
        lWall(wallsDowntown, node, f * 0.5, h2, f * 0.5, f * 0.28, gh + h2 / 2 - 1, f * 0.3, c, uv);
        roofClutter(node, rand, gh + h - 1, f * 0.5);
      } else {
        if (rand(14) < 0.5) {
          // podium base: wide low block under a slimmer tower
          lWall(wallsDowntown, node, f * 1.45, 5, f * 1.45, 0, gh + 1.5, 0, c, uv);
          lWall(wallsDowntown, node, f, h - 4, f, 0, gh + 4 + (h - 4) / 2 - 1, 0, c, uv);
        } else {
          lWall(wallsDowntown, node, f, h, f, 0, gh + h / 2 - 1, 0, c, uv);
        }
        roofClutter(node, rand, gh + h - 1, f);
      }
      // entrance canopy on the street side
      if (rand(16) < 0.6) {
        const ec = [0.35, 0.36, 0.4];
        fBox(scene, node, 4.5, 0.35, 2.6, 0, gh + 3.4, (f / 2 + 1.2) * (rand(17) < 0.5 ? 1 : -1), ec);
      }
    }

    function makeMidtown(node, rand, gh, c, streetSide, hCap, opts) {
      let h = (5 + rand(2) * 13) * opts.hMult;
      if (hCap) h = Math.min(h, hCap);
      h = Math.max(4.5, h);
      const w = opts.w, d = 9 + rand(6) * 13;
      fBox(scene, node, w + 5, 0.14, d + 6, 0, gh + 0.12, 0, [0.66, 0.66, 0.63]);   // parcel
      const uv = { u0: Math.floor(rand(21) * 4), v0: Math.floor(rand(22) * 4) };
      foundation(node, w, d, gh, c);
      lWall(wallsMidtown, node, w, h, d, 0, gh + h / 2 - 1, 0, c, uv);
      const lc = lipCols[Math.floor(rand(33) * lipCols.length) % lipCols.length];
      fBox(scene, node, w + 1, 0.7, d + 1, 0, gh + h - 1 + 0.35, 0, lc);
      if (rand(35) < 0.25) {
        // rooftop garden
        fBox(scene, node, w * 0.6, 0.25, d * 0.6, 0, gh + h - 1 + 0.5, 0, [0.4, 0.64, 0.32]);
        fBox(scene, node, 1.4, 1.2, 1.4, w * 0.15, gh + h - 1 + 1.1, d * 0.12, [0.25, 0.5, 0.24]);
      } else {
        const nAc = 1 + Math.floor(rand(9) * 2.5);
        for (let a2 = 0; a2 < nAc; a2++) {
          fBox(scene, node, 1.6, 1.1, 1.6, (rand(10 + a2) - 0.5) * (w - 4), gh + h - 1 + 0.9, (rand(20 + a2) - 0.5) * (d - 4), [0.6, 0.62, 0.64]);
        }
      }
      if (rand(30) < 0.7) {
        const ac = awningCols[Math.floor(rand(31) * awningCols.length) % awningCols.length];
        const aw = fBox(scene, node, w * 0.7, 0.3, 2.0, 0, gh + 2.9, streetSide * (d / 2 + 0.7), ac);
        aw.rotation.x = -streetSide * 0.3;
      }
    }

    function makeHall(node, rand, gh) {
      const white = [0.96, 0.95, 0.9];
      fBox(scene, node, 8, 4.5, 14, 0, gh + 2.25 - 1, 0, white);
      gablePrism(scene, node, 15, 4.6, 3, 0, gh + 3.4, 0, [0.5, 0.36, 0.3]);
      fBox(scene, node, 3.4, 8, 3.4, 0, gh + 4 - 1, 8.2, white);
      const spire = fCyl(scene, node, { height: 4.5, diameterTop: 0, diameterBottom: 4, tessellation: 4 }, 0, gh + 9.2, 8.2, [0.5, 0.36, 0.3]);
      spire.rotation.y = Math.PI / 4;
    }

    function makeHouse(node, rand, gh, c, opts) {
      if (rand(19) < 0.015) { makeHall(node, rand, gh); return; }
      const f = opts && opts.w ? opts.w : 6 + rand(3) * 7;
      fBox(scene, node, f + 3.5, 0.12, 3.5, 0, gh + 0.12, f / 2 + 2.2, [0.55, 0.72, 0.42]);   // front yard
      let h = 3 + rand(2) * 2.2;
      if (rand(18) < 0.25) h += 2.6;   // two-story
      const uv = { div: 2, cols: 1, rows: 1, u0: Math.floor(rand(21) * 2), v0: Math.floor(rand(22) * 2) };
      foundation(node, f, f, gh, c);
      lWall(wallsHouse, node, f, h, f, 0, gh + h / 2 - 1, 0, c, uv);
      fBox(scene, node, f + 0.7, 0.3, f + 0.7, 0, gh + h - 1.05, 0, [0.96, 0.95, 0.9]);   // eave trim
      const rc = roofCols[Math.floor(rand(7) * roofCols.length) % roofCols.length];
      gableRoof(node, f, f, gh + h - 1.05, rc);
      if (rand(40) < 0.4) fBox(scene, node, 0.9, 2.4, 0.9, f * 0.28, gh + h + 0.8, f * 0.2, [0.6, 0.32, 0.26]);
      if (rand(44) < 0.5) fBox(scene, node, 3.2, 2.2, 3.6, f * 0.9 + 1.6, gh + 0.7, -f * 0.4, [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85]);
      const lawnTone = 0.6 + rand(69) * 0.14;
      fBox(scene, node, f + 4, 0.15, 5, 0, gh + 0.15, -(f / 2 + 3.2), [0.42, lawnTone + 0.05, 0.32]);
      // fence styles: white picket, wood, hedge, low stone wall
      if (rand(48) < 0.8) {
        const styles = [
          { c: [0.92, 0.9, 0.85], h: 0.55 }, { c: [0.55, 0.4, 0.25], h: 0.8 },
          { c: [0.3, 0.56, 0.28], h: 0.95 }, { c: [0.66, 0.65, 0.62], h: 0.45 },
        ];
        const st2 = styles[Math.floor(rand(49) * styles.length) % styles.length];
        const gw = f + 4.4, gd = 5.4, gz = -(f / 2 + 3.2);
        fBox(scene, node, gw, st2.h, 0.22, 0, gh + st2.h / 2 + 0.1, gz - gd / 2, st2.c);
        fBox(scene, node, 0.22, st2.h, gd, -gw / 2, gh + st2.h / 2 + 0.1, gz, st2.c);
        fBox(scene, node, 0.22, st2.h, gd, gw / 2, gh + st2.h / 2 + 0.1, gz, st2.c);
      }
      // yard contents
      const FLOWERS = [[0.95, 0.3, 0.3], [0.98, 0.85, 0.25], [0.95, 0.5, 0.75], [0.7, 0.4, 0.9], [0.97, 0.97, 0.95], [0.98, 0.6, 0.2]];
      const gz2 = -(f / 2 + 3.2);
      const yard = rand(71);
      if (rand(47) < 0.16) {
        const pool = fCyl(scene, node, { height: 0.24, diameter: 3.6, tessellation: 10 }, 1, gh + 0.28, gz2 - 0.2, [0.25, 0.8, 0.9]);
        pool.scaling.x = 1.35;
      } else if (yard < 0.28) {
        // flower bed
        fBox(scene, node, 3.4, 0.18, 1.6, -1, gh + 0.28, gz2 - 0.6, [0.35, 0.28, 0.2]);
        for (let fl = 0; fl < 5; fl++) {
          const fc2 = FLOWERS[Math.floor(rand(80 + fl) * FLOWERS.length) % FLOWERS.length];
          const bloom = BABYLON.MeshBuilder.CreateSphere('flw', { diameter: 0.55, segments: 4 }, scene);
          bloom.parent = node;
          bloom.position.set(-2.2 + fl * 1.2, gh + 0.55, gz2 - 0.6 + (rand(85 + fl) - 0.5) * 0.8);
          setMeshColor(bloom, fc2[0], fc2[1], fc2[2]);
          propParts.push(bloom);
        }
      } else if (yard < 0.46) {
        // vegetable rows
        for (let vr = 0; vr < 3; vr++) {
          fBox(scene, node, f + 1.5, 0.2, 0.8, 0, gh + 0.28, gz2 - 1.4 + vr * 1.3, vr % 2 ? [0.3, 0.5, 0.24] : [0.45, 0.34, 0.22]);
        }
      } else if (yard < 0.6) {
        // patio
        fBox(scene, node, 3.2, 0.16, 3, 1.2, gh + 0.28, gz2, [0.78, 0.74, 0.68]);
        fCyl(scene, node, { height: 0.5, diameter: 1.1, tessellation: 8 }, 1.2, gh + 0.6, gz2, [0.9, 0.88, 0.82]);
      } else if (yard < 0.84) {
        // bushes
        for (const bx2 of [-f * 0.3, f * 0.32]) {
          const bush = BABYLON.MeshBuilder.CreateSphere('bsh', { diameter: 1.5 + rand(88) * 0.9, segments: 4 }, scene);
          bush.parent = node;
          bush.scaling.y = 0.75;
          bush.position.set(bx2, gh + 0.7, gz2 - 1);
          setMeshColor(bush, 0.26, 0.5 + rand(89) * 0.14, 0.26);
          propParts.push(bush);
        }
      }
      // front flower strip by the door
      if (rand(73) < 0.4) {
        for (let fl = 0; fl < 4; fl++) {
          const fc2 = FLOWERS[Math.floor(rand(90 + fl) * FLOWERS.length) % FLOWERS.length];
          const bloom = BABYLON.MeshBuilder.CreateSphere('flw', { diameter: 0.45, segments: 4 }, scene);
          bloom.parent = node;
          bloom.position.set(-f / 2 + 0.8 + fl * 1.1, gh + 0.4, f / 2 + 1.1);
          setMeshColor(bloom, fc2[0], fc2[1], fc2[2]);
          propParts.push(bloom);
        }
      }
    }

    function plazaFeature(x, z, yaw, rand) {
      const node = mkFrame(scene, x, z, yaw);
      const gy = terrainHeight(x, z) + 0.45;
      const roll = rand(60);
      if (roll < 0.3) {
        fCyl(scene, node, { height: 0.8, diameter: 9, tessellation: 14 }, 0, gy + 0.5, 0, [0.82, 0.8, 0.76]);
        fCyl(scene, node, { height: 0.5, diameter: 7, tessellation: 14 }, 0, gy + 0.8, 0, [0.35, 0.62, 0.85]);
        fCyl(scene, node, { height: 2.2, diameter: 1.1, tessellation: 8 }, 0, gy + 1.6, 0, [0.82, 0.8, 0.76]);
      } else if (roll < 0.55) {
        fBox(scene, node, 3.4, 2.6, 3, 0, gy + 1.4, 0, [0.85, 0.82, 0.72]);
        const kr = awningCols[Math.floor(rand(61) * awningCols.length) % awningCols.length];
        fBox(scene, node, 4, 0.3, 3.6, 0, gy + 2.9, 0, kr);
      } else if (roll < 0.72) {
        fBox(scene, node, 12, 0.12, 8, 0, gy + 0.1, 0, [0.36, 0.37, 0.4]);
        for (let k2 = -1; k2 <= 1; k2++) {
          if (rand(70 + k2) < 0.6) {
            parkingSpots.push({ x: x + Math.cos(yaw) * k2 * 3.4, z: z - Math.sin(yaw) * k2 * 3.4, rot: yaw });
          }
        }
      } else if (roll < 0.85) {
        // construction site
        fBox(scene, node, 13, 0.15, 10, 0, gy + 0.1, 0, [0.6, 0.48, 0.35]);
        fBox(scene, node, 4, 1.8, 3, -3, gy + 1, -2, [0.75, 0.72, 0.65]);       // materials
        fBox(scene, node, 2.5, 0.9, 2, 3.5, gy + 0.55, 2, [0.7, 0.45, 0.25]);
        fCyl(scene, node, { height: 9, diameter: 0.5, tessellation: 6 }, 2, gy + 4.6, -2.5, [0.9, 0.65, 0.15]);
        fBox(scene, node, 0.5, 0.5, 7, 2, gy + 8.8, 0.8, [0.9, 0.65, 0.15]);   // mini crane jib
        for (let b2 = -1; b2 <= 1; b2++) {
          fBox(scene, node, 1.6, 0.7, 0.15, b2 * 2.4, gy + 0.55, 5, [0.95, 0.5, 0.15]);
        }
      }
    }

    const bands = [
      { r0: 270, r1: 330, kind: 'downtown' },
      { r0: 330, r1: 390, kind: 'midtown' },
      { r0: 390, r1: 450, kind: 'mixed' },
      { r0: 450, r1: 510, kind: 'suburb' },
    ];
    // Coherence fields: neighborhoods share height and material character
    // instead of dice-rolling per building.
    const heightField = (x, z) => 0.6 + smoothstep(0.25, 0.75, noise(x * 0.006 + 4, z * 0.006 + 9)) * 0.85;
    const paletteField = (x, z) => Math.floor(noise(x * 0.0042 + 21, z * 0.0042 + 7) * palette.length * 1.7);
    for (const band of bands) {
      for (const inner of [true, false]) {
        const roadR = inner ? band.r0 : band.r1;
        const rowOff = inner ? 18 : -18;
        const streetSide = inner ? -1 : 1;
        // Sequential placement: each building's width advances the walk, so
        // facades line up into a continuous street wall with small gaps.
        let th = hash(roadR, 631) * 0.05;
        let i = 0;
        while (th < Math.PI * 2) {
          i++;
          const rand = (k) => hash(i * 31 + k, roadR * 17 + k * 5);
          let w;
          if (band.kind === 'suburb') w = 6 + rand(3) * 7;
          else if (band.kind === 'downtown') w = 10 + rand(3) * 16;
          else w = 10 + rand(3) * 14;
          const rr0 = Math.max(60, ringWarpR(roadR, th) + rowOff);
          const stepA = (w + 3 + rand(51) * 4) / rr0;
          const a = th + stepA / 2;
          th += stepA;
          const rr = ringWarpR(roadR, a) + rowOff + (rand(52) - 0.5) * 3;
          const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          if (!inCityZone(x, z)) continue;
          if (nearRadial(a, rr, w / 2 + 8)) continue;   // wide buildings need wider clearance
          const yaw = -a + Math.PI / 2 + (rand(50) - 0.5) * 0.04;
          if (rand(0) > 0.93) {
            if (rand(1) < 0.5) plazaFeature(x, z, yaw, rand);
            continue;
          }
          const gh = terrainHeight(x, z);
          const node = mkFrame(scene, x, z, yaw);
          const pi2 = (paletteField(x, z) + Math.floor(rand(1) * 2.3)) % palette.length;
          const c = palette[pi2];
          const hMult = heightField(x, z);
          if (band.kind === 'downtown') makeDowntown(node, rand, gh, c, a, { w, hMult });
          else if (band.kind === 'midtown') makeMidtown(node, rand, gh, c, streetSide, null, { w, hMult });
          else if (band.kind === 'mixed') {
            // this band sits under the flight path: keep the height cap here
            if (rand(15) < 0.55) makeMidtown(node, rand, gh, c, streetSide, Config.MIN_ALT - 6 - gh, { w, hMult });
            else makeHouse(node, rand, gh, c, { w: Math.min(13, w) });
          } else {
            makeHouse(node, rand, gh, c, { w: Math.min(13, w) });
          }
        }
      }
    }

    const sets = [
      [wallsDowntown, 'cityDowntown', downtownTexture(scene)],
      [wallsMidtown, 'cityMidtown', midtownTexture(scene)],
      [wallsHouse, 'cityHouses', houseTexture(scene)],
    ];
    for (const n of bakeNodes) n.computeWorldMatrix(true);
    for (const [list, name, tex] of sets) {
      if (list.length === 0) continue;
      for (const mesh of list) mesh.computeWorldMatrix(true);
      const mesh = BABYLON.Mesh.MergeMeshes(list, true, true);
      mesh.name = name;
      const m = new BABYLON.StandardMaterial(name + 'Mat', scene);
      m.diffuseTexture = tex;
      m.specularColor = BABYLON.Color3.Black();
      mesh.material = m;
      mesh.freezeWorldMatrix();
    }
  }

  // --- Civic sites: mall, school, library, pool, soccer, monument, radio ---
  const radioLights = [];
  const viaductCars = [];

  function soccerField(scene, x, z) {
    const gy = terrainHeight(x, z);
    const yaw = hash(Math.round(x), Math.round(z)) * Math.PI;
    const node = mkFrame(scene, x, z, yaw);
    fBox(scene, node, 46, 0.35, 30, 0, gy + 0.25, 0, [0.28, 0.68, 0.3]);
    fBox(scene, node, 40, 0.08, 0.5, 0, gy + 0.48, 12, [0.97, 0.97, 0.97]);
    fBox(scene, node, 40, 0.08, 0.5, 0, gy + 0.48, -12, [0.97, 0.97, 0.97]);
    fBox(scene, node, 0.5, 0.08, 24, 20, gy + 0.48, 0, [0.97, 0.97, 0.97]);
    fBox(scene, node, 0.5, 0.08, 24, -20, gy + 0.48, 0, [0.97, 0.97, 0.97]);
    fBox(scene, node, 0.5, 0.08, 24, 0, gy + 0.48, 0, [0.97, 0.97, 0.97]);
    const cc = BABYLON.MeshBuilder.CreateTorus('sfc', { diameter: 9, thickness: 0.4, tessellation: 18 }, scene);
    cc.scaling.y = 0.12;
    cc.parent = node; cc.position.set(0, gy + 0.48, 0);
    setMeshColor(cc, 0.97, 0.97, 0.97);
    propParts.push(cc);
    for (const gx of [-20.6, 20.6]) {
      fBox(scene, node, 0.4, 2, 6.5, gx, gy + 1.2, 0, [0.95, 0.95, 0.95]);
    }
    fBox(scene, node, 3, 2.4, 12, -26, gy + 1.4, 0, [0.75, 0.72, 0.68]);
  }

  function buildCivic(scene) {
    // --- Shopping center: big-box mall + huge parking lot + sign ---
    {
      const { x, z } = MALL;
      const gy = terrainHeight(x, z);
      const yaw = -Math.atan2(z, x) + Math.PI / 2;
      const node = mkFrame(scene, x, z, yaw);
      fBox(scene, node, 64, 8, 30, 0, gy + 4, -8, [0.88, 0.82, 0.7]);
      fBox(scene, node, 20, 9.5, 24, -18, gy + 4.7, -8, [0.72, 0.5, 0.42]);
      fBox(scene, node, 24, 2, 6, 6, gy + 6.5, 8.5, [0.85, 0.3, 0.3]);   // entry canopy
      for (let k = 0; k < 5; k++) {
        fBox(scene, node, 3, 1.4, 3, -24 + k * 11, gy + 9, -10, [0.62, 0.64, 0.66]);
      }
      fBox(scene, node, 1.2, 10, 1.2, 30, gy + 5, 16, [0.6, 0.6, 0.64]);   // sign pylon
      fBox(scene, node, 7, 3.4, 0.8, 30, gy + 11, 16, [0.95, 0.55, 0.2]);
      // parking lot in front
      fBox(scene, node, 62, 0.15, 22, 0, gy + 0.3, 22, [0.36, 0.37, 0.4]);
      for (let k = -4; k <= 4; k++) {
        fBox(scene, node, 0.4, 0.06, 5.5, k * 6, gy + 0.42, 19, [0.9, 0.9, 0.9]);
        if (hash(k + 9, 771) < 0.6) {
          const wx = x + Math.cos(yaw) * (k * 6 + 3) + Math.sin(yaw) * 19;
          const wz = z - Math.sin(yaw) * (k * 6 + 3) + Math.cos(yaw) * 19;
          parkingSpots.push({ x: wx, z: wz, rot: yaw });
        }
      }
    }
    // --- School: U-shaped, schoolyard, basketball court ---
    {
      const { x, z } = SCHOOL;
      const gy = terrainHeight(x, z);
      const yaw = -Math.atan2(z, x) + Math.PI / 2;
      const node = mkFrame(scene, x, z, yaw);
      const cream = [0.93, 0.86, 0.7];
      fBox(scene, node, 40, 7, 10, 0, gy + 3.5, -12, cream);
      fBox(scene, node, 10, 7, 20, -15, gy + 3.5, 2, cream);
      fBox(scene, node, 10, 7, 20, 15, gy + 3.5, 2, cream);
      fBox(scene, node, 41, 0.5, 11, 0, gy + 7.3, -12, [0.72, 0.35, 0.3]);
      fBox(scene, node, 11, 0.5, 21, -15, gy + 7.3, 2, [0.72, 0.35, 0.3]);
      fBox(scene, node, 11, 0.5, 21, 15, gy + 7.3, 2, [0.72, 0.35, 0.3]);
      fBox(scene, node, 26, 0.14, 18, 0, gy + 0.3, 4, [0.78, 0.7, 0.6]);   // yard
      fBox(scene, node, 12, 0.16, 8, 0, gy + 0.34, 20, [0.45, 0.48, 0.54]); // court
      fBox(scene, node, 0.3, 0.06, 7.6, 0, gy + 0.45, 20, [0.95, 0.95, 0.95]);
      for (const s of [-1, 1]) fBox(scene, node, 0.25, 2.8, 0.25, s * 5.4, gy + 1.5, 20, [0.8, 0.8, 0.82]);
      fBox(scene, node, 1.6, 4, 1.6, 18, gy + 2, 16, [0.9, 0.9, 0.92]);    // flagpole base+pole feel
    }
    // --- Library: columned civic building with dome ---
    {
      const { x, z } = LIBRARY;
      const gy = terrainHeight(x, z);
      const yaw = -Math.atan2(z, x) + Math.PI / 2;
      const node = mkFrame(scene, x, z, yaw);
      fBox(scene, node, 26, 1.2, 20, 0, gy + 0.6, 0, [0.85, 0.82, 0.75]);      // steps/base
      fBox(scene, node, 22, 7, 15, 0, gy + 4.4, -1, [0.92, 0.88, 0.78]);
      for (let k = -2; k <= 2; k++) {
        fCyl(scene, node, { height: 6, diameter: 1, tessellation: 8 }, k * 4.4, gy + 4, 7.6, [0.97, 0.95, 0.88]);
      }
      fBox(scene, node, 24, 1, 4, 0, gy + 7.6, 7.4, [0.9, 0.86, 0.76]);        // portico
      const dome = colorSphere(scene, 'libDome', { diameter: 9, segments: 8, slice: 0.5 }, x, gy + 7.9, z, [0.45, 0.7, 0.62]);
      dome.scaling.y = 0.7;
    }
    // --- Public pool complex (near the beach) ---
    {
      const { x, z } = POOL;
      const gy = terrainHeight(x, z);
      const yaw = -Math.atan2(z, x) + Math.PI / 2;
      const node = mkFrame(scene, x, z, yaw);
      fBox(scene, node, 34, 0.3, 24, 0, gy + 0.25, 0, [0.92, 0.9, 0.84]);      // deck
      fBox(scene, node, 22, 0.24, 11, -2, gy + 0.48, 0, [0.2, 0.75, 0.88]);    // main pool
      fCyl(scene, node, { height: 0.24, diameter: 6, tessellation: 12 }, 12, gy + 0.48, 6, [0.25, 0.8, 0.9]);
      fBox(scene, node, 0.5, 1.6, 2.4, -12.4, gy + 1, 0, [0.95, 0.95, 0.95]);  // diving board
      fBox(scene, node, 8, 3, 5, 12, gy + 1.6, -7, [0.95, 0.6, 0.4]);          // clubhouse
    }
    // --- Soccer fields ---
    for (const f of SOCCER) soccerField(scene, f.x, f.z);
    // --- Monument: obelisk on a grand fountain plaza ---
    {
      const { x, z } = MONUMENT;
      const gy = terrainHeight(x, z);
      const node = mkFrame(scene, x, z, 0.5);
      fCyl(scene, node, { height: 0.6, diameter: 26, tessellation: 18 }, 0, gy + 0.5, 0, [0.85, 0.82, 0.76]);
      fCyl(scene, node, { height: 0.6, diameter: 17, tessellation: 18 }, 0, gy + 0.95, 0, [0.35, 0.62, 0.85]); // ring pool
      fCyl(scene, node, { height: 0.7, diameter: 8, tessellation: 14 }, 0, gy + 1.2, 0, [0.85, 0.82, 0.76]);
      fBox(scene, node, 3, 2, 3, 0, gy + 2.4, 0, [0.8, 0.77, 0.7]);
      const shaft = fBox(scene, node, 1.8, 14, 1.8, 0, gy + 10.2, 0, [0.88, 0.85, 0.78]);
      shaft.scaling.x = 0.92; shaft.scaling.z = 0.92;
      const tip = fCyl(scene, node, { height: 2.2, diameterBottom: 1.9, diameterTop: 0, tessellation: 4 }, 0, gy + 18.3, 0, [0.95, 0.8, 0.3]);
      tip.rotation.y = Math.PI / 4;
    }
    // --- Radio masts: hill + coast, red/white bands, blinking beacons ---
    const radioSpots = [[70, -80], [Math.cos(1.05) * (shoreRadius(1.05) - 22), Math.sin(1.05) * (shoreRadius(1.05) - 22)]];
    radioSpots.forEach(([rx, rz], ri) => {
      const gy = Math.max(1.2, terrainHeight(rx, rz));
      for (let k = 0; k < 4; k++) {
        colorCyl(scene, 'radio' + ri + k, { height: 12, diameterBottom: 2.6 - k * 0.55, diameterTop: 2.05 - k * 0.55, tessellation: 6 },
          rx, gy + 6 + k * 12, rz, k % 2 ? [0.95, 0.95, 0.93] : [0.88, 0.25, 0.2]);
        colorBox(scene, 'radioA' + ri + k, 4 - k * 0.7, 0.25, 0.25, rx, gy + 12 * (k + 1) - 3, rz, [0.6, 0.6, 0.62]);
      }
      const lm = new BABYLON.StandardMaterial('radioLight' + ri, scene);
      lm.emissiveColor = new BABYLON.Color3(1, 0.15, 0.1);
      lm.diffuseColor = new BABYLON.Color3(0.6, 0.1, 0.1);
      const light = BABYLON.MeshBuilder.CreateSphere('radioL' + ri, { diameter: 1.6, segments: 6 }, scene);
      light.position.set(rx, gy + 49.5, rz);
      light.material = lm;
      radioLights.push({ mesh: light, phase: ri * 1.7 });
    });
  }

  function updateCivic(t) {
    for (const rl of radioLights) rl.mesh.visibility = Math.sin(t * 2.2 + rl.phase) > 0 ? 1 : 0.15;
    for (const vc of viaductCars) {
      vc.t += vc.dir * vc.speed * 0.0167;
      if (vc.t > 0.94) { vc.t = 0.94; vc.dir = -1; }
      if (vc.t < 0.06) { vc.t = 0.06; vc.dir = 1; }
      const x = VIADUCT.ax + (VIADUCT.bx - VIADUCT.ax) * vc.t + vc.lane * vc.px;
      const z = VIADUCT.az + (VIADUCT.bz - VIADUCT.az) * vc.t + vc.lane * vc.pz;
      vc.node.position.set(x, vc.yAt(vc.t) + 1.25, z);
      vc.node.rotation.y = vc.dir > 0 ? vc.yawF : vc.yawF + Math.PI;
    }
  }

  // --- Elevated freeway viaduct with its own traffic ---
  function buildViaduct(scene) {
    const { ax, az, bx, bz } = VIADUCT;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const px = -uz, pz = ux;
    const yawF = Math.atan2(ux, uz);
    // Deck clears the highest ground along the route (and the monorail)
    let gMax = 0;
    for (let t = 0; t <= 1; t += 0.05) gMax = Math.max(gMax, terrainHeight(ax + dx * t, az + dz * t));
    const deckY = gMax + 12;   // clears the monorail beam where they cross
    const segLen = 15;
    const nSeg = Math.ceil(len / segLen);
    const yAt = (t) => {
      // cosine-eased ramps over the outer 22% at each end
      const edge = Math.min(t, 1 - t) / 0.22;
      const ease = edge >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, edge));
      const gy = Math.max(1, terrainHeight(ax + dx * t, az + dz * t));
      return gy + (deckY - gy) * ease;
    };
    const yawD = Math.atan2(-uz, ux);
    for (let k = 0; k < nSeg; k++) {
      const t = (k + 0.5) / nSeg, t0 = k / nSeg, t1 = (k + 1) / nSeg;
      const x = ax + dx * t, z = az + dz * t;
      const y = yAt(t);
      const pitch = Math.atan2(yAt(t1) - yAt(t0), len / nSeg);   // deck follows the ramp slope
      const deck = colorBox(scene, 'viaD', segLen + 2.5, 1.1, 12, x, y, z, [0.55, 0.56, 0.6]);
      deck.rotation.y = yawD;
      deck.rotation.z = pitch;
      for (const side of [-1, 1]) {
        const rail = colorBox(scene, 'viaR', segLen + 2.5, 1, 0.5, x + px * side * 5.6, y + 1, z + pz * side * 5.6, [0.8, 0.8, 0.83]);
        rail.rotation.y = yawD;
        rail.rotation.z = pitch;
      }
      const dash = colorBox(scene, 'viaDash', 3.2, 0.1, 0.6, x, y + 0.62, z, [0.95, 0.9, 0.5]);
      dash.rotation.y = yawD;
      dash.rotation.z = pitch;
      const gy2 = Math.max(1, terrainHeight(x, z));
      if (k % 3 === 1 && y - gy2 > 4) {
        for (const side of [-1, 1]) {
          colorCyl(scene, 'viaP', { height: y - gy2, diameter: 1.6, tessellation: 8 }, x + px * side * 3.6, gy2 + (y - gy2) / 2 - 0.5, z + pz * side * 3.6, [0.62, 0.62, 0.66]);
        }
      }
    }
    // its own little traffic
    const vm = new BABYLON.StandardMaterial('viaCarMat', scene);
    vm.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    const cols = [[0.9, 0.25, 0.2], [0.25, 0.45, 0.9], [0.95, 0.95, 0.95], [0.95, 0.75, 0.2], [0.4, 0.75, 0.45], [0.6, 0.35, 0.75]];
    for (let i = 0; i < 6; i++) {
      const node = new BABYLON.TransformNode('viaCar' + i, scene);
      const body = BABYLON.MeshBuilder.CreateBox('vb', { width: 1.7, height: 0.7, depth: 3.6 }, scene);
      setMeshColor(body, cols[i][0], cols[i][1], cols[i][2]);
      body.material = vm; body.parent = node;
      const cab = BABYLON.MeshBuilder.CreateBox('vc', { width: 1.5, height: 0.6, depth: 1.7 }, scene);
      cab.position.y = 0.6; cab.position.z = -0.3;
      setMeshColor(cab, 0.55, 0.75, 0.9);
      cab.material = vm; cab.parent = node;
      const dir = i % 2 ? 1 : -1;
      viaductCars.push({ node, t: 0.1 + i * 0.14, dir, speed: (0.045 + hash(i, 881) * 0.02), lane: dir * 2.6, px, pz, yAt, yawF });
    }
  }

  // --- Landmarks ---
  function buildClockTower(scene) {
    const x = 95, z = -45;   // green hill (the mountain got the snow instead)
    const gh = terrainHeight(x, z);
    colorBox(scene, 'ctb', 11, 3, 11, x, gh + 1.5, z, [0.8, 0.75, 0.66]);
    colorBox(scene, 'ct', 8, 26, 8, x, gh + 13, z, [0.88, 0.83, 0.72]);
    for (const side of [-1, 1]) {
      const face = colorCyl(scene, 'ctf', { height: 0.4, diameter: 5.5, tessellation: 20 }, x, gh + 22, z + side * 4.1, [0.98, 0.97, 0.92]);
      face.rotation.x = Math.PI / 2;
      const rim = BABYLON.MeshBuilder.CreateTorus('ctr', { diameter: 5.5, thickness: 0.45, tessellation: 20 }, scene);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, gh + 22, z + side * 4.15);
      setMeshColor(rim, 0.25, 0.3, 0.4);
      propParts.push(rim);
      colorBox(scene, 'cth', 0.5, 1.8, 0.3, x, gh + 22.7, z + side * 4.35, [0.2, 0.24, 0.32]);
      colorBox(scene, 'ctm', 1.4, 0.5, 0.3, x + 0.4, gh + 22, z + side * 4.35, [0.2, 0.24, 0.32]);
    }
    const top = colorCyl(scene, 'ctt', { height: 5, diameterTop: 0, diameterBottom: 11, tessellation: 4 }, x, gh + 28.5, z, [0.35, 0.68, 0.6]);
    top.rotation.y = Math.PI / 4;
  }

  function buildStadium(scene) {
    const { x, z } = STADIUM_POS;
    const gh = terrainHeight(x, z);
    colorCyl(scene, 'stb', { height: 3.4, diameter: 112, tessellation: 28 }, x, gh - 0.6, z, [0.72, 0.74, 0.68]);
    const bowl = BABYLON.MeshBuilder.CreateTorus('stw', { diameter: 92, thickness: 17, tessellation: 28 }, scene);
    bowl.scaling.y = 0.42;
    bowl.position.set(x, gh + 4.2, z);
    setMeshColor(bowl, 0.95, 0.88, 0.78);
    propParts.push(bowl);
    const seats = BABYLON.MeshBuilder.CreateTorus('stseat', { diameter: 74, thickness: 9, tessellation: 28 }, scene);
    seats.scaling.y = 0.22;
    seats.position.set(x, gh + 3.4, z);
    setMeshColor(seats, 0.9, 0.5, 0.3);
    propParts.push(seats);
    colorCyl(scene, 'stf', { height: 0.5, diameter: 58, tessellation: 24 }, x, gh + 2.3, z, [0.3, 0.8, 0.35]);
    const line = BABYLON.MeshBuilder.CreateTorus('stl', { diameter: 20, thickness: 0.6, tessellation: 20 }, scene);
    line.scaling.y = 0.12;
    line.position.set(x, gh + 2.6, z);
    setMeshColor(line, 0.97, 0.97, 0.97);
    propParts.push(line);
    for (const [lx, lz] of [[-38, -38], [38, -38], [-38, 38], [38, 38]]) {
      colorCyl(scene, 'stp', { height: 16, diameter: 1, tessellation: 6 }, x + lx, gh + 8, z + lz, [0.6, 0.62, 0.66]);
      colorBox(scene, 'stl2', 4, 2.2, 0.8, x + lx, gh + 17, z + lz, [0.98, 0.97, 0.85]);
    }
  }

  const lightBeams = [];
  function lighthouseAt(scene, x, z, s, phase) {
    const gh = Math.max(1.5, terrainHeight(x, z));
    const rock = BABYLON.MeshBuilder.CreateSphere('lhr', { diameter: 16 * s, segments: 6 }, scene);
    rock.scaling.y = 0.4;
    rock.position.set(x, gh - 1, z);
    setMeshColor(rock, 0.6, 0.6, 0.62);
    propParts.push(rock);
    for (let k = 0; k < 4; k++) {
      colorCyl(scene, 'lh' + k, { height: 3.2 * s, diameterBottom: (5 - k * 0.55) * s, diameterTop: (5 - (k + 1) * 0.55) * s, tessellation: 12 },
        x, gh + (1.6 + k * 3.2) * s, z, k % 2 ? [0.95, 0.95, 0.93] : [0.9, 0.25, 0.22]);
    }
    colorCyl(scene, 'lhg', { height: 2.2 * s, diameter: 3.4 * s, tessellation: 10 }, x, gh + 13.6 * s, z, [0.3, 0.34, 0.4]);
    colorCyl(scene, 'lhl', { height: 1.8 * s, diameter: 2.2 * s, tessellation: 10 }, x, gh + 13.6 * s, z, [1, 0.95, 0.6]);
    colorCyl(scene, 'lht', { height: 2 * s, diameterBottom: 3.8 * s, diameterTop: 0.3 * s, tessellation: 10 }, x, gh + 15.7 * s, z, [0.9, 0.25, 0.22]);
    // rotating double beam
    const beamNode = new BABYLON.TransformNode('lhBeamNode', scene);
    beamNode.position.set(x, gh + 13.6 * s, z);
    const bm = new BABYLON.StandardMaterial('lhBeamMat', scene);
    bm.emissiveColor = new BABYLON.Color3(1, 0.95, 0.7);
    bm.disableLighting = true;
    bm.alpha = 0.4;
    for (const side of [-1, 1]) {
      const beam = BABYLON.MeshBuilder.CreateBox('lhBeam', { width: 0.5, height: 0.5, depth: 46 * s }, scene);
      beam.position.z = side * 24 * s;
      beam.material = bm;
      beam.parent = beamNode;
    }
    lightBeams.push({ node: beamNode, phase });
  }

  function buildLighthouse(scene) {
    lighthouseAt(scene, 258, -486, 1, 0);
    const i2 = { a: 0.7, r: 880 };
    lighthouseAt(scene, Math.cos(i2.a) * i2.r, Math.sin(i2.a) * i2.r, 0.85, 2.1);   // on the big islet
    const a3 = 3.05;
    const r3 = shoreRadius(a3) + 26;
    lighthouseAt(scene, Math.cos(a3) * r3, Math.sin(a3) * r3, 0.8, 4.2);            // harbor approach
  }

  function updateBeams(t) {
    for (const b of lightBeams) b.node.rotation.y = t * 0.7 + b.phase;
  }

  function buildFactory(scene) {
    const x = -395, z = 405;
    const gh = Math.max(2, terrainHeight(x, z));
    colorBox(scene, 'fac1', 26, 7, 16, x, gh + 2.5, z, [0.78, 0.74, 0.7]);
    colorBox(scene, 'fac2', 16, 5, 14, x + 20, gh + 1.5, z + 6, [0.7, 0.66, 0.62]);
    const sawtooth = colorCyl(scene, 'fac3', { height: 26, diameterTop: 0, diameterBottom: 8, tessellation: 3 }, x - 4, gh + 7.5, z, [0.6, 0.58, 0.56]);
    sawtooth.rotation.z = Math.PI / 2;
    const smokeMat = new BABYLON.StandardMaterial('smokeMat', scene);
    smokeMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.94);
    smokeMat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.37);
    smokeMat.specularColor = BABYLON.Color3.Black();
    smokeMat.alpha = 0.55;
    for (let s = 0; s < 3; s++) {
      const sx = x - 8 + s * 9, sz = z - 9;
      const hgt = 15 + s * 4;
      colorCyl(scene, 'stack' + s, { height: hgt, diameterBottom: 3.2, diameterTop: 2.4, tessellation: 10 }, sx, gh + hgt / 2, sz, [0.72, 0.4, 0.32]);
      colorCyl(scene, 'stackTop' + s, { height: 1, diameter: 2.9, tessellation: 10 }, sx, gh + hgt + 0.5, sz, [0.5, 0.28, 0.24]);
      for (let k = 0; k < 5; k++) {
        const puff = BABYLON.MeshBuilder.CreateSphere('puff', { diameter: 3, segments: 6 }, scene);
        puff.material = smokeMat;
        puff.position.set(sx, gh + hgt, sz);
        smokePuffs.push({ mesh: puff, topY: gh + hgt + 1, phase: s * 2.1 + k * 5.2, sx, sz });
      }
    }
  }

  function updateSmoke(t) {
    for (const p of smokePuffs) {
      const frac = ((t * 3.2 + p.phase) % 24) / 24;
      p.mesh.position.set(p.sx + frac * 6 + Math.sin(t + p.phase) * 0.6, p.topY + frac * 20, p.sz);
      const sc = 0.5 + frac * 2.0;
      p.mesh.scaling.setAll(sc);
      p.mesh.visibility = 0.8 * (1 - frac);
    }
  }

  function buildFerris(scene) {
    const { x, z } = FERRIS_POS, R = 20;
    const gh = terrainHeight(x, z);
    const root = new BABYLON.TransformNode('ferrisRoot', scene);
    root.position.set(x, gh, z);
    root.rotation.y = 0.9;
    const gondCols = [[1, 0.35, 0.35], [1, 0.75, 0.2], [0.35, 0.8, 0.45], [0.35, 0.6, 1], [0.8, 0.5, 1], [1, 0.55, 0.75]];
    const steel = [0.85, 0.82, 0.75];
    const legMat = new BABYLON.StandardMaterial('ferrisLegMat', scene);
    legMat.specularColor = BABYLON.Color3.Black();
    for (const sz of [-2.2, 2.2]) {
      for (const sx of [-1, 1]) {
        const leg = BABYLON.MeshBuilder.CreateCylinder('flg', { height: Math.hypot(9, R + 4), diameter: 1.0, tessellation: 8 }, scene);
        leg.position.set(sx * 4.5, (R + 4) / 2, sz);
        leg.rotation.z = sx * Math.atan2(9, R + 4);
        setMeshColor(leg, steel[0], steel[1], steel[2]);
        leg.material = legMat;
        leg.parent = root;
      }
    }
    const wheel = new BABYLON.TransformNode('ferrisWheel', scene);
    wheel.parent = root;
    wheel.position.y = R + 4;
    for (const off of [-1.6, 1.6]) {
      const rim = BABYLON.MeshBuilder.CreateTorus('frim', { diameter: R * 2, thickness: 0.7, tessellation: 26 }, scene);
      rim.rotation.x = Math.PI / 2;
      rim.position.z = off;
      setMeshColor(rim, 1, 0.8, 0.25);
      rim.parent = wheel;
    }
    for (let k = 0; k < 8; k++) {
      const spoke = BABYLON.MeshBuilder.CreateCylinder('fsp', { height: R * 2 - 1, diameter: 0.45, tessellation: 6 }, scene);
      spoke.rotation.z = (k * Math.PI) / 8;
      setMeshColor(spoke, 0.95, 0.9, 0.8);
      spoke.parent = wheel;
    }
    const hub = BABYLON.MeshBuilder.CreateCylinder('fhub', { height: 4.4, diameter: 2.4, tessellation: 10 }, scene);
    hub.rotation.x = Math.PI / 2;
    setMeshColor(hub, 0.9, 0.3, 0.3);
    hub.parent = wheel;
    const pivots = [];
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI * 2) / 10;
      const pivot = new BABYLON.TransformNode('fpiv' + k, scene);
      pivot.parent = wheel;
      pivot.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      const gc = gondCols[k % gondCols.length];
      const g = BABYLON.MeshBuilder.CreateBox('fg' + k, { width: 2.4, height: 2, depth: 1.8 }, scene);
      g.position.y = -1.6;
      setMeshColor(g, gc[0], gc[1], gc[2]);
      g.parent = pivot;
      pivots.push(pivot);
    }
    const gm = new BABYLON.StandardMaterial('ferrisMat', scene);
    gm.specularColor = BABYLON.Color3.Black();
    for (const mesh of root.getChildMeshes()) mesh.material = gm;
    ferris = { wheel, pivots, angle: 0 };
  }

  function updateFerris(dt) {
    if (!ferris) return;
    ferris.angle += dt * 0.15;
    ferris.wheel.rotation.z = ferris.angle;
    for (const p of ferris.pivots) p.rotation.z = -ferris.angle;
  }

  // --- Fairground extras around the Ferris wheel: carousel, drop tower,
  // mini coaster ---
  let carouselNode = null, dropNode = null, dropBaseY = 0, coasterCars = null;
  function buildFairground(scene) {
    const { x, z } = FERRIS_POS;
    const gh = terrainHeight(x, z);
    colorCyl(scene, 'fairpad', { height: 0.4, diameter: 98, tessellation: 24 }, x, gh + 0.15, z, [0.82, 0.74, 0.62]);
    const fm = new BABYLON.StandardMaterial('fairMat', scene);
    fm.specularColor = BABYLON.Color3.Black();
    const brights = [[0.9, 0.3, 0.3], [0.95, 0.8, 0.25], [0.35, 0.7, 0.45], [0.35, 0.55, 0.9], [0.8, 0.45, 0.85]];

    // Carousel
    const cx = x - 30, cz = z + 16;
    colorCyl(scene, 'carB', { height: 1, diameter: 13, tessellation: 14 }, cx, gh + 0.9, cz, [0.85, 0.35, 0.35]);
    colorCyl(scene, 'carPole', { height: 6.5, diameter: 0.7, tessellation: 8 }, cx, gh + 4, cz, [0.9, 0.85, 0.7]);
    colorCyl(scene, 'carCan', { height: 3, diameterBottom: 14, diameterTop: 0.6, tessellation: 14 }, cx, gh + 8.4, cz, [0.9, 0.35, 0.35]);
    colorSphere(scene, 'carTop', { diameter: 1.2, segments: 6 }, cx, gh + 10.2, cz, [0.95, 0.8, 0.25]);
    carouselNode = new BABYLON.TransformNode('carousel', scene);
    carouselNode.position.set(cx, gh + 1.7, cz);
    const plat = BABYLON.MeshBuilder.CreateCylinder('carP', { height: 0.4, diameter: 11.5, tessellation: 14 }, scene);
    setMeshColor(plat, 0.95, 0.9, 0.75);
    plat.material = fm; plat.parent = carouselNode;
    for (let k = 0; k < 6; k++) {
      const ha = (k * Math.PI * 2) / 6;
      const horse = BABYLON.MeshBuilder.CreateBox('carH', { width: 0.8, height: 1.1, depth: 1.8 }, scene);
      horse.position.set(Math.cos(ha) * 4.2, 1.2, Math.sin(ha) * 4.2);
      horse.rotation.y = -ha;
      const hc = brights[k % brights.length];
      setMeshColor(horse, hc[0], hc[1], hc[2]);
      horse.material = fm; horse.parent = carouselNode;
      const bar = BABYLON.MeshBuilder.CreateCylinder('carBr', { height: 5.5, diameter: 0.12, tessellation: 5 }, scene);
      bar.position.set(Math.cos(ha) * 4.2, 3.4, Math.sin(ha) * 4.2);
      setMeshColor(bar, 0.85, 0.8, 0.6);
      bar.material = fm; bar.parent = carouselNode;
    }

    // Drop tower
    const dx = x + 32, dz = z - 14;
    dropBaseY = gh + 2;
    colorCyl(scene, 'dropT', { height: 30, diameter: 1.6, tessellation: 8 }, dx, gh + 15, dz, [0.85, 0.82, 0.75]);
    colorSphere(scene, 'dropTop', { diameter: 2.6, segments: 6 }, dx, gh + 30.5, dz, [0.9, 0.3, 0.3]);
    dropNode = new BABYLON.TransformNode('dropCar', scene);
    dropNode.position.set(dx, dropBaseY, dz);
    for (let k = 0; k < 4; k++) {
      const da = (k * Math.PI * 2) / 4;
      const seat = BABYLON.MeshBuilder.CreateBox('dropS', { width: 1.3, height: 1.2, depth: 1.3 }, scene);
      seat.position.set(Math.cos(da) * 1.8, 0, Math.sin(da) * 1.8);
      const scc = brights[k % brights.length];
      setMeshColor(seat, scc[0], scc[1], scc[2]);
      seat.material = fm; seat.parent = dropNode;
    }

    // Mini coaster: a tilted ring the cars whip around
    const kx = x + 6, kz = z + 34;
    const tilt = new BABYLON.TransformNode('coasterTilt', scene);
    tilt.position.set(kx, gh + 6.5, kz);
    tilt.rotation.x = 0.3; tilt.rotation.y = 0.7;
    const track = BABYLON.MeshBuilder.CreateTorus('coasterTrk', { diameter: 30, thickness: 0.7, tessellation: 26 }, scene);
    setMeshColor(track, 0.75, 0.28, 0.25);
    track.material = fm; track.parent = tilt;
    for (let k = 0; k < 5; k++) {
      const sa = (k * Math.PI * 2) / 5 + 0.3;
      const sup = colorCyl(scene, 'coasterSup', { height: 6 + Math.sin(sa + tilt.rotation.y) * 4, diameter: 0.5, tessellation: 6 },
        kx + Math.cos(sa) * 14.4, gh + 3.2 + Math.sin(sa + tilt.rotation.y) * 2, kz + Math.sin(sa) * 14.4, [0.6, 0.62, 0.66]);
    }
    coasterCars = new BABYLON.TransformNode('coasterCars', scene);
    coasterCars.parent = tilt;
    for (let k = 0; k < 3; k++) {
      const ca2 = k * 0.22;
      const car = BABYLON.MeshBuilder.CreateBox('coasterCar', { width: 1.4, height: 1, depth: 2.2 }, scene);
      car.position.set(Math.cos(ca2) * 15, 0.8, Math.sin(ca2) * 15);
      car.rotation.y = -ca2;
      const ccc = brights[(k + 1) % brights.length];
      setMeshColor(car, ccc[0], ccc[1], ccc[2]);
      car.material = fm; car.parent = coasterCars;
    }
    // Flag poles around the entrance
    for (let k = 0; k < 5; k++) {
      const fa = -1.2 + k * 0.55;
      const fx2 = x + Math.cos(fa) * 46, fz2 = z + Math.sin(fa) * 46;
      colorCyl(scene, 'flagP', { height: 6, diameter: 0.2, tessellation: 5 }, fx2, gh + 3, fz2, [0.8, 0.78, 0.7]);
      const fc = brights[k % brights.length];
      const flag = colorBox(scene, 'flagF', 1.6, 0.9, 0.08, fx2 + 0.85, gh + 5.6, fz2, fc);
    }
  }

  function updateFairground(dt, t) {
    if (carouselNode) carouselNode.rotation.y += dt * 0.7;
    if (coasterCars) coasterCars.rotation.y += dt * 0.85;
    if (dropNode) {
      // slow ratchet up, pause, fast drop
      const cyc = (t % 11) / 11;
      let h;
      if (cyc < 0.55) h = (cyc / 0.55) * 26;
      else if (cyc < 0.68) h = 26;
      else if (cyc < 0.76) h = 26 * (1 - (cyc - 0.68) / 0.08);
      else h = 0;
      dropNode.position.y = dropBaseY + h;
    }
  }

  // --- Monorail on an elevated beam above the innermost boulevard ---
  const MONO_H = 10;   // low enough to duck under the freeway viaduct
  const monoCars = [];
  const tramCars = [];
  function buildMonorail(scene) {
    const base = 390;   // above the wide central boulevard: visible from the cockpit
    const step = 13 / base;
    let k = 0;
    for (let th = 0; th < Math.PI * 2; th += step, k++) {
      const thm = th + step / 2;
      const Rm = ringWarpR(base, thm);
      const R = ringWarpR(base, th), R2 = ringWarpR(base, th + step);
      const xa = Math.cos(th) * R, za = Math.sin(th) * R;
      const x2 = Math.cos(th + step) * R2, z2 = Math.sin(th + step) * R2;
      const x = Math.cos(thm) * Rm, z = Math.sin(thm) * Rm;
      const gy = terrainHeight(x, z);
      const beam = colorBox(scene, 'monoB', 17, 0.9, 1.7, x, gy + MONO_H, z, [0.88, 0.88, 0.9]);
      beam.rotation.y = Math.atan2(-(z2 - za), x2 - xa);
      if (k % 4 === 0) {
        colorCyl(scene, 'monoP', { height: MONO_H, diameterBottom: 1.1, diameterTop: 0.7, tessellation: 8 }, x, gy + MONO_H / 2, z, [0.75, 0.75, 0.78]);
      }
    }
    const mm = new BABYLON.StandardMaterial('monoMat', scene);
    mm.specularColor = BABYLON.Color3.Black();
    // three trains spread around the loop so one passes every ~55 s
    const stripeCols = [[0.3, 0.55, 0.85], [0.85, 0.35, 0.3], [0.35, 0.7, 0.45]];
    for (let g = 0; g < 3; g++) {
      for (let i = 0; i < 3; i++) {
        const node = new BABYLON.TransformNode('monoCar' + (g * 3 + i), scene);
        const body = BABYLON.MeshBuilder.CreateBox('mono', { width: 2, height: 2, depth: 7.5 }, scene);
        setMeshColor(body, i === 0 ? 0.9 : 0.94, i === 0 ? 0.35 : 0.94, i === 0 ? 0.3 : 0.96);
        body.material = mm; body.parent = node;
        const stripe = BABYLON.MeshBuilder.CreateBox('monoS', { width: 2.06, height: 0.6, depth: 6.8 }, scene);
        stripe.position.y = 0.3;
        const scol = stripeCols[g];
        setMeshColor(stripe, scol[0], scol[1], scol[2]);
        stripe.material = mm; stripe.parent = node;
        monoCars.push({ node, offset: i * 0.031 + g * (Math.PI * 2 / 3) });
      }
    }
  }

  // Street trams: two on the 450 boulevard ring, plus branch lines running
  // outward along the (gently curving) major avenues.
  const branchTrams = [];
  function mkTramUnit(scene, tm, node, off, len, c) {
    const unit = BABYLON.MeshBuilder.CreateBox('tu', { width: 2.2, height: 2.6, depth: len }, scene);
    unit.position.set(0, 0, off);
    setMeshColor(unit, c[0], c[1], c[2]);
    unit.material = tm; unit.parent = node;
    const win = BABYLON.MeshBuilder.CreateBox('tw', { width: 2.26, height: 0.8, depth: len - 0.8 }, scene);
    win.position.set(0, 0.5, off);
    setMeshColor(win, 0.6, 0.8, 0.92);
    win.material = tm; win.parent = node;
  }

  function buildTram(scene) {
    const tm = new BABYLON.StandardMaterial('tramMat', scene);
    tm.specularColor = BABYLON.Color3.Black();
    // Ring trams patrol the two longest unbroken stretches of the 450
    // boulevard (the corridor and civic sites cut gaps in it).
    const runs = [];
    {
      let runStart = null;
      const step = 0.02;
      for (let a2 = 0; a2 <= Math.PI * 2 + step; a2 += step) {
        const R = ringWarpR(450, a2);
        const ok = a2 <= Math.PI * 2 && inCityZone(Math.cos(a2) * R, Math.sin(a2) * R);
        if (ok && runStart === null) runStart = a2;
        if (!ok && runStart !== null) {
          runs.push({ a0: runStart + 0.04, a1: a2 - 0.04 });
          runStart = null;
        }
      }
      runs.sort((u, v) => (v.a1 - v.a0) - (u.a1 - u.a0));
    }
    for (let i = 0; i < Math.min(2, runs.length); i++) {
      const node = new BABYLON.TransformNode('tram' + i, scene);
      mkTramUnit(scene, tm, node, -3.4, 6.2, [0.95, 0.75, 0.2]);
      mkTramUnit(scene, tm, node, 3.4, 6.2, [0.95, 0.75, 0.2]);
      const roofline = BABYLON.MeshBuilder.CreateBox('trf', { width: 2.3, height: 0.25, depth: 13.6 }, scene);
      roofline.position.y = 1.45;
      setMeshColor(roofline, 0.35, 0.36, 0.4);
      roofline.material = tm; roofline.parent = node;
      const run = runs[i];
      tramCars.push({ node, a0: run.a0, a1: run.a1, a: (run.a0 + run.a1) / 2, dir: i % 2 ? 1 : -1 });
    }
    // Branch lines: pick the four avenues with the longest unbroken road
    // (some radials are fragmented by the fairground, rail loop, parks...)
    const branchCols = [[0.35, 0.65, 0.4], [0.85, 0.3, 0.28], [0.92, 0.88, 0.75], [0.4, 0.55, 0.85]];
    const majorSet = new Set(MAJOR_RADIALS);
    const candidates = roadSegs
      .filter(s => s.type === 'ray' && majorSet.has(s.angle))
      .map(s => ({ angle: s.angle, r0: Math.max(300, s.r0), r1: Math.min(524, s.r1) }))
      .filter(s => s.r1 - s.r0 > 120)
      .sort((u, v) => (v.r1 - v.r0) - (u.r1 - u.r0))
      .slice(0, 4);
    candidates.forEach((seg, bi) => {
      const a = seg.angle;
      for (let rr = seg.r0; rr <= seg.r1; rr += 18) {
        const aw = radialWarpA(a, rr), aw2 = radialWarpA(a, rr + 18);
        const x = Math.cos(aw) * rr, z = Math.sin(aw) * rr;
        if (!inCityZone(x, z)) continue;
        const x2 = Math.cos(aw2) * (rr + 18), z2 = Math.sin(aw2) * (rr + 18);
        const len = Math.hypot(x2 - x, z2 - z);
        const dx = (x2 - x) / len, dz = (z2 - z) / len;
        const gy = roadGY(x, z);
        for (const side of [-0.75, 0.75]) {
          const rail = colorBox(scene, 'tramRail', 0.22, 0.1, len + 1, (x + x2) / 2 - dz * side, gy + 0.08, (z + z2) / 2 + dx * side, [0.75, 0.75, 0.78]);
          rail.rotation.y = Math.atan2(dx, dz);
        }
      }
      const node = new BABYLON.TransformNode('btram' + bi, scene);
      mkTramUnit(scene, tm, node, 0, 7.5, branchCols[bi % branchCols.length]);
      const roofline = BABYLON.MeshBuilder.CreateBox('trf', { width: 2.3, height: 0.25, depth: 7.9 }, scene);
      roofline.position.y = 1.45;
      setMeshColor(roofline, 0.35, 0.36, 0.4);
      roofline.material = tm; roofline.parent = node;
      branchTrams.push({ node, angle: a, t: (seg.r0 + seg.r1) / 2, r0: seg.r0 + 4, r1: seg.r1 - 4, dir: 1, speed: 7.5 + bi * 0.4 });
    });
  }

  function updateTram(t) {
    for (const c of tramCars) {
      c.a += c.dir * (9 / 450) * 0.0167;
      if (c.a > c.a1) { c.a = c.a1; c.dir = -1; }
      if (c.a < c.a0) { c.a = c.a0; c.dir = 1; }
      const R = ringWarpR(450, c.a);
      const x = Math.cos(c.a) * R, z = Math.sin(c.a) * R;
      c.node.position.set(x, terrainHeight(x, z) + 1.75, z);
      c.node.rotation.y = c.dir > 0 ? tangentYaw(c.a) : tangentYaw(c.a) + Math.PI;
    }
    // branch trams shuttle outward and back (dt from the caller's frame pace)
    for (const b of branchTrams) {
      b.t += b.dir * b.speed * 0.0167;
      if (b.t > b.r1) { b.t = b.r1; b.dir = -1; }
      if (b.t < b.r0) { b.t = b.r0; b.dir = 1; }
      const aw = radialWarpA(b.angle, b.t);
      const aw2 = radialWarpA(b.angle, b.t + 2 * b.dir);
      const x = Math.cos(aw) * b.t, z = Math.sin(aw) * b.t;
      const x2 = Math.cos(aw2) * (b.t + 2 * b.dir), z2 = Math.sin(aw2) * (b.t + 2 * b.dir);
      b.node.position.set(x, terrainHeight(x, z) + 1.75, z);
      b.node.rotation.y = Math.atan2(x2 - x, z2 - z);
    }
  }

  function updateMonorail(t) {
    for (const c of monoCars) {
      const a = (t * 15) / 390 - c.offset + 2;
      const R = ringWarpR(390, a);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      c.node.position.set(x, terrainHeight(x, z) + MONO_H + 1.5, z);
      c.node.rotation.y = tangentYaw(a);
    }
  }

  // --- Scenic railway: an off-center loop through city and park, with
  // ballast bed, twin rails, two stations, and a five-car train ---
  function buildRailway(scene) {
    const segs = 190;
    const step = (Math.PI * 2) / segs;
    for (let k = 0; k < segs; k++) {
      const a = k * step, a2 = a + step;
      const x = RAIL_C.x + Math.cos(a) * RAIL_R, z = RAIL_C.z + Math.sin(a) * RAIL_R;
      const x2 = RAIL_C.x + Math.cos(a2) * RAIL_R, z2 = RAIL_C.z + Math.sin(a2) * RAIL_R;
      const gy = Math.max(0.8, terrainHeight(x, z));
      const yaw = Math.atan2(-(z2 - z), x2 - x);
      const bed = colorBox(scene, 'railBed', 13.5, 0.5, 3.4, x, gy + 0.3, z, [0.5, 0.44, 0.38]);
      bed.rotation.y = yaw;
      const len = Math.hypot(x2 - x, z2 - z);
      const px = -(z2 - z) / len, pz = (x2 - x) / len;
      for (const side of [-1, 1]) {
        const rail = colorBox(scene, 'rail', 13.5, 0.18, 0.3, x + px * side * 0.85, gy + 0.63, z + pz * side * 0.85, [0.82, 0.82, 0.85]);
        rail.rotation.y = yaw;
      }
    }
    for (const sa of [1.15, 4.0]) {
      const x = RAIL_C.x + Math.cos(sa) * (RAIL_R - 6), z = RAIL_C.z + Math.sin(sa) * (RAIL_R - 6);
      const gy = Math.max(0.8, terrainHeight(x, z));
      const yaw = tangentYaw(sa);
      const plat = colorBox(scene, 'stnP', 16, 1, 5, x, gy + 0.5, z, [0.8, 0.76, 0.7]);
      plat.rotation.y = yaw;
      const roof = colorBox(scene, 'stnR', 14, 0.4, 4, x, gy + 4.4, z, [0.62, 0.3, 0.26]);
      roof.rotation.y = yaw;
      for (const po of [-5, 5]) {
        colorCyl(scene, 'stnPl', { height: 3.4, diameter: 0.3, tessellation: 6 },
          x + Math.cos(yaw) * po, gy + 2.5, z - Math.sin(yaw) * po, [0.9, 0.88, 0.82]);
      }
    }
    const tm = new BABYLON.StandardMaterial('trainMat', scene);
    tm.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35);
    tm.specularPower = 32;
    const part = (parent, mesh, c) => {
      setMeshColor(mesh, c[0], c[1], c[2]);
      mesh.material = tm;
      mesh.parent = parent;
      return mesh;
    };
    const boxP = (parent, w, h, d, x, y, z, c) => {
      const b = BABYLON.MeshBuilder.CreateBox('tp', { width: w, height: h, depth: d }, scene);
      b.position.set(x, y, z);
      return part(parent, b, c);
    };
    const axle = (parent, dia, y, z, c) => {
      const w = BABYLON.MeshBuilder.CreateCylinder('tw', { height: 2.7, diameter: dia, tessellation: 14 }, scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, y, z);
      return part(parent, w, c);
    };

    // --- Locomotive: classic toy steam engine ---
    const loco = new BABYLON.TransformNode('train0', scene);
    {
      const black = [0.16, 0.16, 0.18], red = [0.78, 0.16, 0.14], brass = [0.85, 0.68, 0.3];
      boxP(loco, 2.2, 0.55, 7.6, 0, 1.15, 0.2, black);                       // chassis
      const boiler = BABYLON.MeshBuilder.CreateCylinder('tb', { height: 4.8, diameter: 2.3, tessellation: 16 }, scene);
      boiler.rotation.x = Math.PI / 2;
      boiler.position.set(0, 2.5, 1.3);
      part(loco, boiler, black);
      const smokebox = BABYLON.MeshBuilder.CreateCylinder('ts', { height: 0.7, diameter: 2.45, tessellation: 16 }, scene);
      smokebox.rotation.x = Math.PI / 2;
      smokebox.position.set(0, 2.5, 3.85);
      part(loco, smokebox, [0.3, 0.3, 0.33]);
      const funnel = BABYLON.MeshBuilder.CreateCylinder('tf', { height: 1.5, diameterBottom: 0.7, diameterTop: 1.15, tessellation: 12 }, scene);
      funnel.position.set(0, 4.2, 3.2);
      part(loco, funnel, brass);
      const dome = BABYLON.MeshBuilder.CreateSphere('td', { diameter: 1.1, segments: 8, slice: 0.5 }, scene);
      dome.position.set(0, 3.6, 1.2);
      part(loco, dome, brass);
      boxP(loco, 2.7, 2.7, 2.3, 0, 2.75, -1.9, red);                         // cab
      boxP(loco, 2.76, 0.7, 2.34, 0, 3.15, -1.9, [0.75, 0.88, 0.95]);        // cab windows
      boxP(loco, 3.1, 0.3, 2.7, 0, 4.25, -1.9, [0.3, 0.3, 0.33]);            // cab roof
      boxP(loco, 2.5, 1.0, 5.2, 0, 1.6, 1.0, red);                           // side tanks
      const cow = boxP(loco, 2.3, 1.3, 1.3, 0, 0.9, 4.2, red);               // cowcatcher
      cow.rotation.x = 0.65;
      axle(loco, 1.5, 0.75, -1.6, red);
      axle(loco, 1.5, 0.75, 0, red);
      axle(loco, 1.5, 0.75, 1.6, red);
      axle(loco, 0.95, 0.5, 3.3, black);
      // smoke puffs live on the loco, cycled in updateRailway
      const sm = new BABYLON.StandardMaterial('trainSmoke', scene);
      sm.diffuseColor = new BABYLON.Color3(0.94, 0.94, 0.96);
      sm.emissiveColor = new BABYLON.Color3(0.4, 0.4, 0.42);
      sm.specularColor = BABYLON.Color3.Black();
      sm.alpha = 0.6;
      for (let k = 0; k < 5; k++) {
        const puff = BABYLON.MeshBuilder.CreateSphere('tpuff', { diameter: 1.1, segments: 6 }, scene);
        puff.material = sm;
        puff.parent = loco;
        railPuffs.push({ mesh: puff, k });
      }
    }
    trainCars.push({ node: loco, offset: 0 });

    // --- Tender ---
    {
      const tender = new BABYLON.TransformNode('train1', scene);
      boxP(tender, 2.4, 1.9, 4.2, 0, 1.9, 0, [0.78, 0.16, 0.14]);
      boxP(tender, 2.0, 0.6, 3.2, 0, 3.0, -0.2, [0.12, 0.12, 0.13]);         // coal
      boxP(tender, 2.2, 0.5, 4.4, 0, 1.0, 0, [0.16, 0.16, 0.18]);
      axle(tender, 0.9, 0.5, -1.3, [0.16, 0.16, 0.18]);
      axle(tender, 0.9, 0.5, 1.3, [0.16, 0.16, 0.18]);
      trainCars.push({ node: tender, offset: 0.021 });
    }

    // --- Coaches: window bands, rounded roofs, bogies ---
    const coachCols = [[0.28, 0.55, 0.32], [0.92, 0.86, 0.7], [0.32, 0.5, 0.78], [0.85, 0.5, 0.25]];
    coachCols.forEach((cc, i) => {
      const coach = new BABYLON.TransformNode('train' + (i + 2), scene);
      boxP(coach, 2.5, 2.2, 6.4, 0, 2.25, 0, cc);
      boxP(coach, 2.56, 0.75, 5.6, 0, 2.65, 0, [0.85, 0.92, 0.97]);          // window band
      for (let m2 = -2; m2 <= 2; m2++) {
        boxP(coach, 2.6, 0.75, 0.18, 0, 2.65, m2 * 1.15, cc);                // mullions
      }
      const roof = BABYLON.MeshBuilder.CreateCylinder('tr', { height: 6.7, diameter: 2.6, tessellation: 12 }, scene);
      roof.rotation.x = Math.PI / 2;
      roof.scaling.y = 0.45;
      roof.position.set(0, 3.45, 0);
      part(coach, roof, [0.42, 0.4, 0.38]);
      boxP(coach, 2.3, 0.5, 6.6, 0, 1.0, 0, [0.16, 0.16, 0.18]);
      axle(coach, 0.8, 0.45, -2.3, [0.16, 0.16, 0.18]);
      axle(coach, 0.8, 0.45, 2.3, [0.16, 0.16, 0.18]);
      trainCars.push({ node: coach, offset: 0.043 + i * 0.023 });
    });
  }

  function updateRailway(t) {
    const speed = 11.5;
    trainCars.forEach((c, i) => {
      const a = (t * speed) / RAIL_R - c.offset;
      const x = RAIL_C.x + Math.cos(a) * RAIL_R, z = RAIL_C.z + Math.sin(a) * RAIL_R;
      c.node.position.set(x, Math.max(0.8, terrainHeight(x, z)) + 0.75 + Math.sin(t * 7 + i * 1.9) * 0.05, z);
      c.node.rotation.y = tangentYaw(a);
      c.node.rotation.z = Math.sin(t * 5 + i * 2.3) * 0.012;   // gentle rock
    });
    for (const p of railPuffs) {
      const frac = ((t * 1.4 + p.k * 0.2) % 1);
      p.mesh.position.set(Math.sin(p.k) * 0.2 * frac, 5 + frac * 5.5, 3.2 - frac * 6.5);
      p.mesh.scaling.setAll(0.7 + frac * 2.6);
      p.mesh.visibility = 0.75 * (1 - frac);
    }
  }

  // --- Wind farm on the south coast (kept outside the circle so it's seen
  // head-on during play; interior spots are always abeam) ---
  function buildWindmills(scene) {
    const spots = [];
    for (let i = 0; i < 3; i++) {
      const wa = 4.05 + i * 0.14;
      const wr = shoreRadius(wa) - 28;
      spots.push([Math.cos(wa) * wr, Math.sin(wa) * wr]);
    }
    const wm = new BABYLON.StandardMaterial('windmillMat', scene);
    wm.specularColor = BABYLON.Color3.Black();
    spots.forEach(([x, z], i) => {
      const gh = terrainHeight(x, z);
      colorCyl(scene, 'wmp' + i, { height: 17, diameterBottom: 1.4, diameterTop: 0.8, tessellation: 8 }, x, gh + 8.5, z, [0.95, 0.95, 0.96]);
      const rotor = new BABYLON.TransformNode('rotor' + i, scene);
      rotor.position.set(x, gh + 17, z);
      rotor.rotation.y = -0.6;
      const hub = BABYLON.MeshBuilder.CreateSphere('wmh', { diameter: 1.2, segments: 6 }, scene);
      setMeshColor(hub, 0.9, 0.9, 0.92);
      hub.material = wm; hub.parent = rotor;
      for (let b = 0; b < 3; b++) {
        const blade = BABYLON.MeshBuilder.CreateBox('wmb', { width: 0.7, height: 7.5, depth: 0.15 }, scene);
        blade.rotation.z = (b * Math.PI * 2) / 3;
        blade.position.x = -Math.sin((b * Math.PI * 2) / 3) * 3.4;   // along the blade's own axis
        blade.position.y = Math.cos((b * Math.PI * 2) / 3) * 3.4;
        setMeshColor(blade, 0.95, 0.95, 0.96);
        blade.material = wm; blade.parent = rotor;
      }
      rotors.push({ node: rotor, speed: 1.6 + i * 0.3 });
    });
  }

  function updateWindmills(dt) {
    for (const r of rotors) r.node.rotation.z += r.speed * dt;
  }

  // --- Harbor district, sailboats (moored + cruising), ships, buoys ---
  const wanderers = [];   // sailboats cruising the bay
  function makeSailboat(scene, bm, hc) {
    const node = new BABYLON.TransformNode('sailb', scene);
    const hull = BABYLON.MeshBuilder.CreateBox('sh', { width: 1.6, height: 0.8, depth: 4.6 }, scene);
    setMeshColor(hull, hc[0], hc[1], hc[2]);
    hull.material = bm; hull.parent = node;
    const mast = BABYLON.MeshBuilder.CreateCylinder('sm', { height: 5.5, diameter: 0.22, tessellation: 6 }, scene);
    mast.position.y = 3;
    setMeshColor(mast, 0.6, 0.45, 0.3);
    mast.material = bm; mast.parent = node;
    const sail = BABYLON.MeshBuilder.CreateCylinder('ss', { height: 0.1, diameter: 3.6, tessellation: 3 }, scene);
    sail.rotation.x = Math.PI / 2; sail.rotation.y = Math.PI / 2;
    sail.position.set(0, 3.1, 0.9);
    setMeshColor(sail, 0.99, 0.98, 0.94);
    sail.material = bm; sail.parent = node;
    return node;
  }

  function buildBoats(scene) {
    const bm = new BABYLON.StandardMaterial('boatMat', scene);
    bm.specularColor = BABYLON.Color3.Black();
    const hullCols = [[0.95, 0.95, 0.95], [0.9, 0.3, 0.3], [0.3, 0.55, 0.9], [0.3, 0.75, 0.5], [0.98, 0.8, 0.3]];

    // --- Harbor: an industrial port, well away from the beach ---
    const ma = 3.5;
    const shoreR = shoreRadius(ma);
    const hx = Math.cos(ma), hz = Math.sin(ma);
    const tx = -hz, tz = hx;
    const pierYaw = Math.atan2(hx, hz);
    // concrete apron
    const apron = mkFrame(scene, hx * (shoreR - 16) , hz * (shoreR - 16), pierYaw);
    const apronY = Math.max(1.4, terrainHeight(hx * (shoreR - 16), hz * (shoreR - 16)));
    fBox(scene, apron, 78, 0.5, 44, 0, apronY, 0, [0.66, 0.66, 0.64]);
    // four long piers with moored sailboats
    for (let d = 0; d < 4; d++) {
      const off = (d - 1.5) * 20;
      const px2 = hx * (shoreR + 16) + tx * off, pz2 = hz * (shoreR + 16) + tz * off;
      const dock = colorBox(scene, 'pier' + d, 4, 0.8, 44, px2, 1.4, pz2, [0.5, 0.36, 0.22]);
      dock.rotation.y = pierYaw;
      if (d % 2 === 0) {
        const node = makeSailboat(scene, bm, hullCols[d % hullCols.length]);
        node.position.set(hx * (shoreR + 30) + tx * (off + 5), 0.6, hz * (shoreR + 30) + tz * (off + 5));
        node.rotation.y = pierYaw;
        sailboats.push({ node, phase: d * 1.7 });
      }
    }
    // warehouses with gable roofs
    for (let wI = 0; wI < 3; wI++) {
      const off = (wI - 1) * 26;
      const wx2 = hx * (shoreR - 26) + tx * off, wz2 = hz * (shoreR - 26) + tz * off;
      const gy = Math.max(1.4, terrainHeight(wx2, wz2));
      const node = mkFrame(scene, wx2, wz2, pierYaw);
      fBox(scene, node, 13, 5.5, 19, 0, gy + 2.7, 0, [0.72, 0.72, 0.75]);
      const wroof = gablePrism(scene, node, 20, 7, 3.2, 0, gy + 5.4, 0, [0.45, 0.5, 0.58]);
      wroof.rotation.y = 0;   // ridge along the warehouse's long axis (local Z)
    }
    // container stacks
    const contCols = [[0.9, 0.4, 0.2], [0.25, 0.6, 0.9], [0.4, 0.75, 0.4], [0.9, 0.75, 0.2], [0.7, 0.3, 0.5]];
    for (let ci = 0; ci < 10; ci++) {
      const off = -34 + (ci % 5) * 6;
      const row = Math.floor(ci / 5);
      const cx2 = hx * (shoreR - 8 - row * 4) + tx * off, cz2 = hz * (shoreR - 8 - row * 4) + tz * off;
      const gy = Math.max(1.6, terrainHeight(cx2, cz2));
      const cc = contCols[(ci * 3 + row) % contCols.length];
      const box = colorBox(scene, 'cont' + ci, 2.3, 2.3, 5.6, cx2, gy + 1.4 + (ci % 3 === 0 ? 2.3 : 0), cz2, cc);
      box.rotation.y = pierYaw + (hash(ci, 91) - 0.5) * 0.1;
    }
    // harbor crane
    {
      const cx2 = hx * (shoreR - 6) + tx * 26, cz2 = hz * (shoreR - 6) + tz * 26;
      const gy = Math.max(1.6, terrainHeight(cx2, cz2));
      const node = mkFrame(scene, cx2, cz2, pierYaw + 0.5);
      fBox(scene, node, 6, 1.4, 6, 0, gy + 0.7, 0, [0.85, 0.6, 0.15]);
      fBox(scene, node, 1.6, 15, 1.6, 0, gy + 8.2, 0, [0.9, 0.65, 0.18]);
      fBox(scene, node, 3, 2.4, 3.4, 0, gy + 16.5, 0.6, [0.92, 0.7, 0.2]);
      fBox(scene, node, 1.3, 1.3, 15, 0, gy + 17, 8, [0.9, 0.65, 0.18]);       // main jib
      fBox(scene, node, 1.3, 1.3, 6, 0, gy + 17, -4.4, [0.9, 0.65, 0.18]);     // counter jib
      fBox(scene, node, 2, 1.6, 2, 0, gy + 15.8, -6.4, [0.5, 0.52, 0.56]);     // counterweight
      fCyl(scene, node, { height: 6.5, diameter: 0.18, tessellation: 5 }, 0, gy + 13.2, 13, [0.35, 0.35, 0.38]);
      fBox(scene, node, 2.4, 2.4, 2.4, 0, gy + 8.8, 13, [0.3, 0.55, 0.75]);    // hanging container
    }

    // Buoys near the shipping lanes
    for (let i = 0; i < 6; i++) {
      const ba = 2.6 + i * 0.55;
      const br = shoreRadius(ba) + 45;
      colorCyl(scene, 'buoy' + i, { height: 2.6, diameterBottom: 1.6, diameterTop: 0.3, tessellation: 8 },
        Math.cos(ba) * br, 0.9, Math.sin(ba) * br, i % 2 ? [0.9, 0.25, 0.2] : [0.95, 0.95, 0.95]);
    }

    // Cruising sailboats: they wander the bay under sail
    for (let i = 0; i < 7; i++) {
      const node = makeSailboat(scene, bm, hullCols[(i + 2) % hullCols.length]);
      const a0 = hash(i, 511) * Math.PI * 2;
      const r0 = 680 + hash(i, 512) * 500;
      node.position.set(Math.cos(a0) * r0, 0.6, Math.sin(a0) * r0);
      wanderers.push({ node, heading: hash(i, 513) * Math.PI * 2, speed: 3 + hash(i, 514) * 3.5, phase: i * 1.3 });
    }

    function addWake(node, bm2) {
      for (const side of [-1, 1]) {
        const wake = BABYLON.MeshBuilder.CreateBox('wk', { width: 0.5, height: 0.12, depth: 5 }, scene);
        wake.position.set(side * 1.4, -0.25, -3.4);
        wake.rotation.y = side * 0.35;
        setMeshColor(wake, 1, 1, 1);
        wake.material = bm2; wake.parent = node;
      }
    }
    // Motorboats
    for (let i = 0; i < 3; i++) {
      const node = new BABYLON.TransformNode('mboat' + i, scene);
      const hull = BABYLON.MeshBuilder.CreateBox('mh', { width: 2, height: 0.8, depth: 5.5 }, scene);
      setMeshColor(hull, 0.96, 0.96, 0.96);
      hull.material = bm; hull.parent = node;
      const cab = BABYLON.MeshBuilder.CreateBox('mc', { width: 1.5, height: 0.9, depth: 1.8 }, scene);
      cab.position.set(0, 0.8, 0.6);
      const cc = hullCols[(i + 1) % hullCols.length];
      setMeshColor(cab, cc[0], cc[1], cc[2]);
      cab.material = bm; cab.parent = node;
      addWake(node, bm);
      ships.push({ node, radius: 760 + i * 90, speed: 5 + i * 1.5, dir: i % 2 ? 1 : -1, phase: hash(i, 8) * Math.PI * 2, bob: 0.25 });
    }
    // Cargo ships on several shipping lanes
    const cargoDefs = [
      { radius: 1250, speed: 4, dir: 1, phase: 1.2, hull: [0.62, 0.22, 0.2], len: 34 },
      { radius: 1480, speed: 3.4, dir: -1, phase: 3.6, hull: [0.22, 0.32, 0.5], len: 40 },
      { radius: 1080, speed: 4.6, dir: 1, phase: 5.1, hull: [0.28, 0.45, 0.32], len: 28 },
    ];
    for (const cd of cargoDefs) {
      const node = new BABYLON.TransformNode('cargo', scene);
      const hull = BABYLON.MeshBuilder.CreateBox('ch', { width: 8, height: 4, depth: cd.len }, scene);
      hull.position.y = 0.6;
      setMeshColor(hull, cd.hull[0], cd.hull[1], cd.hull[2]);
      hull.material = bm; hull.parent = node;
      const cCols = [[0.9, 0.4, 0.2], [0.25, 0.6, 0.9], [0.4, 0.75, 0.4], [0.9, 0.75, 0.2], [0.7, 0.3, 0.5]];
      const nStack = Math.floor(cd.len / 6) - 1;
      for (let k = 0; k < nStack * 2; k++) {
        const box = BABYLON.MeshBuilder.CreateBox('cc' + k, { width: 5.5, height: 2.2, depth: 4.4 }, scene);
        box.position.set(0, 3.8 + (k % 2) * 2.2, -cd.len / 2 + 5 + Math.floor(k / 2) * 6);
        const col = cCols[(k + Math.round(cd.phase)) % cCols.length];
        setMeshColor(box, col[0], col[1], col[2]);
        box.material = bm; box.parent = node;
      }
      const bridge = BABYLON.MeshBuilder.CreateBox('cb', { width: 7, height: 6, depth: 5 }, scene);
      bridge.position.set(0, 5.5, cd.len / 2 - 4);
      setMeshColor(bridge, 0.95, 0.95, 0.95);
      bridge.material = bm; bridge.parent = node;
      ships.push({ node, radius: cd.radius, speed: cd.speed, dir: cd.dir, phase: cd.phase, bob: 0.15 });
    }
    // Ferry
    {
      const node = new BABYLON.TransformNode('ferry', scene);
      const hull = BABYLON.MeshBuilder.CreateBox('fh', { width: 6, height: 2.4, depth: 20 }, scene);
      hull.position.y = 0.4;
      setMeshColor(hull, 0.97, 0.97, 0.97);
      hull.material = bm; hull.parent = node;
      const deck = BABYLON.MeshBuilder.CreateBox('fd', { width: 5, height: 2.4, depth: 14 }, scene);
      deck.position.y = 2.6;
      setMeshColor(deck, 0.3, 0.6, 0.9);
      deck.material = bm; deck.parent = node;
      const stack = BABYLON.MeshBuilder.CreateCylinder('fs', { height: 2.4, diameter: 1.2, tessellation: 8 }, scene);
      stack.position.set(0, 4.6, -2);
      setMeshColor(stack, 0.9, 0.75, 0.2);
      stack.material = bm; stack.parent = node;
      addWake(node, bm);
      ships.push({ node, radius: 940, speed: 6, dir: -1, phase: 4.4, bob: 0.2 });
    }
  }

  // --- Beach resort cove: umbrellas, towels, huts (far from the harbor) ---
  function buildBeach(scene) {
    const umbCols = [[0.95, 0.35, 0.3], [0.3, 0.65, 0.9], [0.98, 0.8, 0.25], [0.4, 0.8, 0.5], [0.9, 0.5, 0.75]];
    let placed = 0;
    for (let i = 0; i < 110 && placed < 32; i++) {
      const a = 5.5 + hash(i, 301) * 0.44;
      const rr = shoreRadius(a) - 4 - hash(i, 302) * 28;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const gh = terrainHeight(x, z);
      if (gh < 0.7 || gh > 2.3) continue;
      if (hash(i, 303) < 0.55) {
        const c = umbCols[Math.floor(hash(i, 304) * umbCols.length) % umbCols.length];
        colorCyl(scene, 'umbP', { height: 2.4, diameter: 0.16, tessellation: 5 }, x, gh + 1.2, z, [0.9, 0.9, 0.88]);
        const can = colorCyl(scene, 'umbC', { height: 1.1, diameterBottom: 4.4, diameterTop: 0.3, tessellation: 8 }, x, gh + 2.6, z, c);
        can.rotation.z = (hash(i, 305) - 0.5) * 0.25;
      } else {
        const c = umbCols[Math.floor(hash(i, 306) * umbCols.length) % umbCols.length];
        const tw = colorBox(scene, 'towel', 1, 0.07, 2, x, gh + 0.15, z, c);
        tw.rotation.y = hash(i, 307) * Math.PI;
      }
      placed++;
    }
    // beach hut + lifeguard tower
    const ba = 5.7;
    const br2 = shoreRadius(ba) - 24;
    const bx2 = Math.cos(ba) * br2, bz2 = Math.sin(ba) * br2;
    const bg = Math.max(1, terrainHeight(bx2, bz2));
    const hut = mkFrame(scene, bx2, bz2, -ba);
    fBox(scene, hut, 5, 3, 4, 0, bg + 1.5, 0, [0.95, 0.9, 0.8]);
    fBox(scene, hut, 5.8, 0.3, 4.8, 0, bg + 3.2, 0, [0.9, 0.4, 0.35]);
    const la = 5.58;
    const lr = shoreRadius(la) - 9;
    const lx2 = Math.cos(la) * lr, lz2 = Math.sin(la) * lr;
    const lg = Math.max(0.9, terrainHeight(lx2, lz2));
    const lgt = mkFrame(scene, lx2, lz2, -la);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      fCyl(scene, lgt, { height: 3.2, diameter: 0.3, tessellation: 5 }, sx * 1.1, lg + 1.6, sz * 1.1, [0.85, 0.8, 0.7]);
    }
    fBox(scene, lgt, 3, 1.8, 3, 0, lg + 4.1, 0, [0.95, 0.4, 0.35]);
    fBox(scene, lgt, 3.6, 0.25, 3.6, 0, lg + 5.2, 0, [0.98, 0.95, 0.9]);
  }

  function updateBoats(dt, t) {
    for (const b of sailboats) {
      b.node.position.y = 0.55 + Math.sin(t * 1.1 + b.phase) * 0.3;
      b.node.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.06;
      b.node.rotation.x = Math.cos(t * 0.8 + b.phase) * 0.05;
    }
    for (const wd of wanderers) {
      wd.heading += Math.sin(t * 0.11 + wd.phase * 3.1) * 0.25 * dt;
      let nx = wd.node.position.x + Math.sin(wd.heading) * wd.speed * dt;
      let nz = wd.node.position.z + Math.cos(wd.heading) * wd.speed * dt;
      const r = Math.hypot(nx, nz);
      if (r > 1350) wd.heading = Math.atan2(-nx, -nz) + (hash(Math.round(t), 1) - 0.5);
      else if (r < 640) wd.heading = Math.atan2(nx, nz) + (hash(Math.round(t), 2) - 0.5);
      wd.node.position.set(nx, 0.55 + Math.sin(t * 1.2 + wd.phase) * 0.28, nz);
      wd.node.rotation.y = wd.heading;
      wd.node.rotation.z = 0.1 * Math.sin(t * 0.7 + wd.phase);
    }
    for (const b of ships) {
      const a = b.phase + b.dir * (b.speed / b.radius) * t;
      b.node.position.set(b.radius * Math.cos(a), 0.5 + Math.sin(t * 1.3 + b.phase) * b.bob, b.radius * Math.sin(a));
      b.node.rotation.y = Math.atan2(-Math.sin(a) * b.dir, Math.cos(a) * b.dir);
    }
  }

  // --- Offshore islets with palms + sandy shallows ---
  function buildIslets(scene) {
    const spots = [
      { a: 0.7, r: 880 }, { a: 1.9, r: 1050 }, { a: 2.8, r: 800 },
      { a: 4.1, r: 1200 }, { a: 5.0, r: 900 }, { a: 5.9, r: 1100 },
    ];
    spots.forEach((sp, i) => {
      const x = Math.cos(sp.a) * sp.r, z = Math.sin(sp.a) * sp.r;
      const sz = 18 + hash(i, 4) * 22;
      // Sandy shallow shelf just under the surface, visible through the water
      const shelf = colorCyl(scene, 'shelf' + i, { height: 1.5, diameter: sz * 3.2, tessellation: 14 }, x, -1.6, z, [0.85, 0.8, 0.55]);
      shelf.scaling.x *= 1 + hash(i, 6) * 0.4;
      // Mound positioned so its top pokes ~2.5 m above the waves
      const mound = colorSphere(scene, 'islet' + i, { diameter: sz, segments: 7 }, x, 2.5 - 0.225 * sz, z, [0.92, 0.85, 0.58]);
      mound.scaling.y = 0.45;
      if (sz > 26) {
        const topR = colorSphere(scene, 'isletG' + i, { diameter: sz * 0.6, segments: 6 }, x, 2.4, z, [0.45, 0.75, 0.35]);
        topR.scaling.y = 0.35;
      }
      // Palms
      const np = 1 + Math.floor(hash(i, 9) * 3);
      for (let p = 0; p < np; p++) {
        const px = x + (hash(i, p + 20) - 0.5) * sz * 0.5;
        const pz = z + (hash(i, p + 40) - 0.5) * sz * 0.5;
        addPalm(scene, px, pz, 2.2, 0.8 + hash(i, p) * 0.4);
      }
      // A rock or two
      colorSphere(scene, 'rk' + i, { diameter: 4 + hash(i, 60) * 4, segments: 5 }, x + sz * 0.5, 0.3, z + sz * 0.3, [0.6, 0.6, 0.62]);
    });
  }

  function addPalm(scene, x, z, baseY, s) {
    const trunk = BABYLON.MeshBuilder.CreateCylinder('palmT', { height: 6 * s, diameterBottom: 0.5 * s, diameterTop: 0.3 * s, tessellation: 5 }, scene);
    trunk.position.set(x, baseY + 3 * s, z);
    trunk.rotation.z = 0.12;
    setMeshColor(trunk, 0.62, 0.45, 0.28);
    treeParts.push(trunk);
    for (let f = 0; f < 5; f++) {
      const fa = (f * Math.PI * 2) / 5;
      const frond = BABYLON.MeshBuilder.CreateBox('palmF', { width: 3.4 * s, height: 0.12, depth: 0.8 * s }, scene);
      frond.position.set(x + Math.cos(fa) * 1.4 * s + 0.7, baseY + 6 * s, z + Math.sin(fa) * 1.4 * s);
      frond.rotation.y = -fa;
      frond.rotation.z = 0.35;
      setMeshColor(frond, 0.2, 0.65, 0.3);
      treeParts.push(frond);
    }
  }

  // --- Farmland patchwork on the coastal fringe ---
  function buildFields(scene) {
    const cols = [[0.9, 0.8, 0.4], [0.62, 0.85, 0.35], [0.42, 0.75, 0.3], [0.6, 0.45, 0.3], [0.82, 0.7, 0.35]];
    let n = 0;
    for (let i = 0; i < 90 && n < 40; i++) {
      const a = hash(i, 77) * Math.PI * 2;
      if (a > 2.4 && a < 3.05) continue;   // coastal golf links live here
      const r = 545 + hash(i, 78) * 55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gh = terrainHeight(x, z);
      if (gh < 2 || gh > 8) continue;
      if (inCorridor(x, z)) continue;
      const c = cols[Math.floor(hash(i, 79) * cols.length) % cols.length];
      const field = colorBox(scene, 'field' + i, 16 + hash(i, 80) * 10, 0.3, 22 + hash(i, 81) * 12, x, gh + 0.2, z, c);
      field.rotation.y = a + (hash(i, 82) - 0.5);
      // little farmhouse on some
      if (hash(i, 83) < 0.3) {
        colorBox(scene, 'farmh', 4, 2.5, 5, x + 10, gh + 1.4, z + 8, [0.95, 0.3, 0.25]);
        const fr = colorCyl(scene, 'farmr', { height: 1.6, diameterTop: 0, diameterBottom: 6.5, tessellation: 4 }, x + 10, gh + 3.4, z + 8, [0.5, 0.32, 0.25]);
        fr.rotation.y = Math.PI / 4;
      }
      n++;
    }
  }

  // --- Trees: park blobs, mountain pines, coastal palms, sidewalk trees ---
  function buildTrees(scene) {
    let n = 0;
    const addBlobTree = (x, z, gh, s, i) => {
      const trunk = BABYLON.MeshBuilder.CreateCylinder('tt' + n, { height: 2.5 * s, diameter: 0.7 * s, tessellation: 5 }, scene);
      trunk.position.set(x, gh + 1.2 * s, z);
      setMeshColor(trunk, 0.45, 0.3, 0.18);
      const blob = BABYLON.MeshBuilder.CreateSphere('tb' + n++, { diameter: 5 * s, segments: 5 }, scene);
      blob.scaling.y = 0.85;
      blob.position.set(x, gh + 4.2 * s, z);
      const g = 0.62 + hash(i, 61) * 0.28;
      const rb = 0.22 + hash(i, 71) * 0.16;
      setMeshColor(blob, rb, g, 0.26);
      // sunlit highlight lobe on the sun side
      const lobe = BABYLON.MeshBuilder.CreateSphere('tl' + n, { diameter: 3 * s, segments: 4 }, scene);
      lobe.scaling.y = 0.8;
      lobe.position.set(x + 0.9 * s, gh + 5.1 * s, z + 0.6 * s);
      setMeshColor(lobe, rb + 0.13, Math.min(1, g + 0.13), 0.36);
      treeParts.push(trunk, blob, lobe);
    };
    const addTallPine = (x, z, gh, s, i) => {
      const trunk = BABYLON.MeshBuilder.CreateCylinder('pt2' + n, { height: 3 * s, diameter: 0.55 * s, tessellation: 5 }, scene);
      trunk.position.set(x, gh + 1.5 * s, z);
      setMeshColor(trunk, 0.42, 0.3, 0.2);
      const g = 0.48 + hash(i, 63) * 0.16;
      const cone1 = BABYLON.MeshBuilder.CreateCylinder('pc2' + n, { height: 4.5 * s, diameterBottom: 3.6 * s, diameterTop: 0.6 * s, tessellation: 6 }, scene);
      cone1.position.set(x, gh + 4.6 * s, z);
      setMeshColor(cone1, 0.15, g, 0.26);
      const cone2 = BABYLON.MeshBuilder.CreateCylinder('pc3' + n++, { height: 3.6 * s, diameterBottom: 2.5 * s, diameterTop: 0, tessellation: 6 }, scene);
      cone2.position.set(x, gh + 8 * s, z);
      setMeshColor(cone2, 0.17, g + 0.05, 0.28);
      treeParts.push(trunk, cone1, cone2);
    };
    const addCypress = (x, z, gh, s, i) => {
      const spire = BABYLON.MeshBuilder.CreateCylinder('cy' + n++, { height: 7 * s, diameterBottom: 1.7 * s, diameterTop: 0.15 * s, tessellation: 6 }, scene);
      spire.position.set(x, gh + 3.5 * s, z);
      setMeshColor(spire, 0.14, 0.36 + hash(i, 64) * 0.1, 0.2);
      treeParts.push(spire);
    };
    const addBushT = (x, z, gh, s, i) => {
      const bush = BABYLON.MeshBuilder.CreateSphere('bu' + n++, { diameter: 2.4 * s, segments: 4 }, scene);
      bush.scaling.y = 0.7;
      bush.position.set(x, gh + 0.8 * s, z);
      setMeshColor(bush, 0.25 + hash(i, 65) * 0.1, 0.52 + hash(i, 66) * 0.16, 0.27);
      treeParts.push(bush);
    };
    const FLOWER_COLS = [[0.95, 0.3, 0.3], [0.98, 0.85, 0.25], [0.95, 0.5, 0.75], [0.7, 0.4, 0.9], [0.98, 0.6, 0.2]];
    const addFlowerPatch = (x, z, gh, i) => {
      const pad = BABYLON.MeshBuilder.CreateCylinder('fp' + n, { height: 0.15, diameter: 3.5 + hash(i, 67) * 3, tessellation: 8 }, scene);
      pad.position.set(x, gh + 0.1, z);
      setMeshColor(pad, 0.4, 0.66, 0.32);
      treeParts.push(pad);
      for (let fl = 0; fl < 6; fl++) {
        const fa = hash(i * 9 + fl, 68) * Math.PI * 2;
        const fr = hash(i * 9 + fl, 69) * 1.6;
        const fc2 = FLOWER_COLS[(i + fl) % FLOWER_COLS.length];
        const bloom = BABYLON.MeshBuilder.CreateSphere('fb' + n++, { diameter: 0.5, segments: 4 }, scene);
        bloom.position.set(x + Math.cos(fa) * fr, gh + 0.42, z + Math.sin(fa) * fr);
        setMeshColor(bloom, fc2[0], fc2[1], fc2[2]);
        treeParts.push(bloom);
      }
    };
    const addPine = (x, z, gh, s, i) => {
      const trunk = BABYLON.MeshBuilder.CreateCylinder('pt' + n, { height: 2 * s, diameter: 0.6 * s, tessellation: 5 }, scene);
      trunk.position.set(x, gh + s, z);
      setMeshColor(trunk, 0.4, 0.28, 0.18);
      const cone = BABYLON.MeshBuilder.CreateCylinder('pc' + n++, { height: 5.5 * s, diameterBottom: 3.2 * s, diameterTop: 0, tessellation: 6 }, scene);
      cone.position.set(x, gh + 2 * s + 2.4 * s, z);
      const g = 0.5 + hash(i, 62) * 0.18;
      setMeshColor(cone, 0.16, g, 0.28);
      treeParts.push(trunk, cone);
    };

    // Park / hills scatter (blobs low, pines high)
    for (let i = 0; i < 700 && treeParts.length < 900; i++) {
      const a = hash(i, 17) * Math.PI * 2;
      const r = Math.sqrt(hash(i, 31)) * 640;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gh = terrainHeight(x, z);
      if (gh < 2.5 || gh > 55) continue;
      if (inCorridor(x, z)) continue;
      const inCity = r > Config.CITY_R_MIN && r < Config.CITY_R_MAX;
      if (inCity && hash(i, 43) > 0.12) continue;
      const styleRoll = hash(i, 54);
      if (gh > 16) {
        if (styleRoll < 0.5) addPine(x, z, gh, 0.8 + hash(i, 53) * 0.7, i);
        else addTallPine(x, z, gh, 0.75 + hash(i, 53) * 0.6, i);
      } else if (styleRoll < 0.55) addBlobTree(x, z, gh, 0.8 + hash(i, 53) * 0.8, i);
      else if (styleRoll < 0.72) addTallPine(x, z, gh, 0.6 + hash(i, 53) * 0.5, i);
      else if (styleRoll < 0.84) addCypress(x, z, gh, 0.8 + hash(i, 53) * 0.6, i);
      else addBushT(x, z, gh, 0.8 + hash(i, 53) * 0.7, i);
    }
    // Bushes and wildflower patches across the park and greenbelt
    for (let i = 0; i < 240; i++) {
      const a = hash(i, 271) * Math.PI * 2;
      const r = Math.sqrt(hash(i, 272)) * 600;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gh = terrainHeight(x, z);
      if (gh < 1.8 || gh > 40) continue;
      if (inCorridor(x, z) || railDist(x, z) < 7) continue;
      const inCity = r > Config.CITY_R_MIN && r < Config.CITY_R_MAX;
      if (inCity && hash(i, 273) > 0.2) continue;
      if (hash(i, 274) < 0.55) addBushT(x, z, gh, 0.7 + hash(i, 275) * 0.7, i + 500);
      else addFlowerPatch(x, z, gh, i);
    }
    // Beach palms: generous shoreline scatter
    for (let i = 0; i < 480; i++) {
      const a = hash(i, 87) * Math.PI * 2;
      const r = 510 + hash(i, 88) * 130;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gh = terrainHeight(x, z);
      if (gh < 0.6 || gh > 2.7) continue;
      if (inCorridor(x, z)) continue;
      addPalm(scene, x, z, gh, 0.65 + hash(i, 89) * 0.55);
    }
    // Palm clusters: beach cove + tropical lagoon rim
    for (let i = 0; i < 26; i++) {
      const a = 5.5 + hash(i, 91) * 0.45;
      const rr = shoreRadius(a) - 2 - hash(i, 92) * 34;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const gh = terrainHeight(x, z);
      if (gh < 0.6 || gh > 2.8) continue;
      addPalm(scene, x, z, gh, 0.7 + hash(i, 93) * 0.5);
    }
    for (let i = 0; i < 34; i++) {
      const a = hash(i, 94) * Math.PI * 2;
      const rr = 34 + hash(i, 95) * 26;
      const x = 60 + Math.cos(a) * rr, z = 190 + Math.sin(a) * rr;
      const gh = terrainHeight(x, z);
      if (gh < 0.7 || gh > 2.6) continue;
      addPalm(scene, x, z, gh, 0.7 + hash(i, 96) * 0.5);
    }
    // Forest patches: dense clumps in the greenbelt and park
    const FORESTS = [
      { x: 0, z: 110, r: 28 }, { x: -160, z: -120, r: 30 }, { x: 180, z: -160, r: 26 },
      { x: -140, z: 250, r: 26 }, { x: 420 * Math.cos(3.1), z: 420 * Math.sin(3.1), r: 0 },
    ];
    for (let fi = 0; fi < FORESTS.length; fi++) {
      const fp = FORESTS[fi];
      for (let k = 0; k < 22 && fp.r > 0; k++) {
        const ta = hash(fi * 41 + k, 701) * Math.PI * 2;
        const tr = Math.sqrt(hash(fi * 41 + k, 702)) * fp.r;
        const x = fp.x + Math.cos(ta) * tr, z = fp.z + Math.sin(ta) * tr;
        const gh = terrainHeight(x, z);
        if (gh < 1.6 || railDist(x, z) < 7 || inCorridor(x, z)) continue;
        if (gh > 16) addPine(x, z, gh, 0.7 + hash(fi + k, 703) * 0.5, fi * 50 + k);
        else addBlobTree(x, z, gh, 0.7 + hash(fi + k, 703) * 0.5, fi * 50 + k);
      }
    }
    // Orchards: neat rows of small trees on the farm fringe
    for (const [oa, orr] of [[0.85, 560], [3.1, 572]]) {
      const ox = Math.cos(oa) * orr, oz = Math.sin(oa) * orr;
      if (terrainHeight(ox, oz) > 1.5) {
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 6; col++) {
            const x = ox + (col - 2.5) * 6 * Math.cos(oa + Math.PI / 2) + (row - 1.5) * 6 * Math.cos(oa);
            const z = oz + (col - 2.5) * 6 * Math.sin(oa + Math.PI / 2) + (row - 1.5) * 6 * Math.sin(oa);
            const gh = terrainHeight(x, z);
            if (gh < 1.2) continue;
            addBlobTree(x, z, gh, 0.42, row * 10 + col);
          }
        }
      }
    }
    // Dense trees in the city parks (ringing the ponds where present)
    for (let pi = 0; pi < CITY_PARKS.length; pi++) {
      const p = CITY_PARKS[pi];
      for (let k = 0; k < 16; k++) {
        const ta = hash(pi * 31 + k, 611) * Math.PI * 2;
        const tr = (0.35 + hash(pi * 31 + k, 612) * 0.6) * p.r;
        const x = p.x + Math.cos(ta) * tr, z = p.z + Math.sin(ta) * tr;
        const gh = terrainHeight(x, z);
        if (gh < 1.4) continue;
        addBlobTree(x, z, gh, 0.6 + hash(pi * 7 + k, 613) * 0.5, pi * 100 + k);
      }
    }
    // Courtyard trees along the band interiors (between the building rows)
    let ti = 1000;
    for (const cr of [300, 360, 420, 480]) {
      const step = 15 / cr;
      for (let th = 0; th < Math.PI * 2; th += step) {
        ti++;
        if (hash(ti, Math.round(cr)) > 0.5) continue;
        const rr = cr + (hash(ti, 5) - 0.5) * 10;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        if (!inCityZone(x, z) || nearRadial(th, rr, 14)) continue;
        addBlobTree(x, z, ROAD_Y - 0.2, 0.5 + hash(ti, 3) * 0.3, ti);
      }
    }
    const trees = BABYLON.Mesh.MergeMeshes(treeParts, true, true);
    trees.name = 'trees';
    const m = new BABYLON.StandardMaterial('treeMat', scene);
    m.specularColor = BABYLON.Color3.Black();
    trees.material = m;
    trees.freezeWorldMatrix();
  }

  // --- Whale circling offshore, surfacing with a spout ---
  function buildWhale(scene) {
    const node = new BABYLON.TransformNode('whale', scene);
    const wm = new BABYLON.StandardMaterial('whaleMat', scene);
    wm.specularColor = BABYLON.Color3.Black();
    const body = BABYLON.MeshBuilder.CreateSphere('whb', { diameter: 10, segments: 8 }, scene);
    body.scaling.set(0.9, 0.65, 1.7);
    setMeshColor(body, 0.25, 0.35, 0.5);
    body.material = wm; body.parent = node;
    const belly = BABYLON.MeshBuilder.CreateSphere('whbl', { diameter: 8.6, segments: 8 }, scene);
    belly.scaling.set(0.85, 0.5, 1.5);
    belly.position.y = -1.2;
    setMeshColor(belly, 0.85, 0.9, 0.92);
    belly.material = wm; belly.parent = node;
    for (const side of [-1, 1]) {
      const eyeW = BABYLON.MeshBuilder.CreateSphere('whew', { diameter: 0.85, segments: 6 }, scene);
      eyeW.position.set(side * 2.6, 1.1, 5.2);
      setMeshColor(eyeW, 0.97, 0.97, 0.97);
      eyeW.material = wm; eyeW.parent = node;
      const eyeB = BABYLON.MeshBuilder.CreateSphere('wheb', { diameter: 0.42, segments: 5 }, scene);
      eyeB.position.set(side * 2.85, 1.15, 5.45);
      setMeshColor(eyeB, 0.08, 0.08, 0.1);
      eyeB.material = wm; eyeB.parent = node;
    }
    for (const side of [-1, 1]) {
      const fluke = BABYLON.MeshBuilder.CreateBox('whf', { width: 3.2, height: 0.4, depth: 2.4 }, scene);
      fluke.position.set(side * 1.6, 1, -8.2);
      fluke.rotation.y = side * 0.5;
      fluke.rotation.x = -0.2;
      setMeshColor(fluke, 0.25, 0.35, 0.5);
      fluke.material = wm; fluke.parent = node;
    }
    const spouts = [];
    const sm = new BABYLON.StandardMaterial('spoutMat', scene);
    sm.diffuseColor = new BABYLON.Color3(0.95, 0.98, 1);
    sm.emissiveColor = new BABYLON.Color3(0.4, 0.45, 0.5);
    sm.specularColor = BABYLON.Color3.Black();
    sm.alpha = 0.7;
    for (let k = 0; k < 3; k++) {
      const p = BABYLON.MeshBuilder.CreateSphere('spout', { diameter: 1.4 + k * 0.5, segments: 5 }, scene);
      p.material = sm;
      spouts.push(p);
    }
    whale = { node, spouts, radius: 980, speed: 3 };
  }

  function updateWhale(t) {
    if (!whale) return;
    const a = (whale.speed / whale.radius) * t + 2.2;
    const x = whale.radius * Math.cos(a), z = whale.radius * Math.sin(a);
    const surf = Math.sin(t * 0.24);                       // surfacing cycle
    const y = -6.5 + 7.2 * Math.max(0, surf);
    whale.node.position.set(x, y, z);
    whale.node.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    whale.node.rotation.x = -0.12 * Math.cos(t * 0.24);    // gentle porpoising
    const up = y > -0.5;
    whale.spouts.forEach((p, k) => {
      const frac = ((t * 1.8 + k * 0.33) % 1);
      p.visibility = up ? 0.7 * (1 - frac) : 0;
      p.position.set(x, y + 2.5 + frac * 4.5, z + Math.cos(whale.node.rotation.y) * 0);
      p.position.x += Math.sin(whale.node.rotation.y) * 5.5;
      p.position.z += Math.cos(whale.node.rotation.y) * 5.5;
    });
  }

  // --- Blimp cruising above the bay ---
  function buildBlimp(scene) {
    const node = new BABYLON.TransformNode('blimp', scene);
    const bm = new BABYLON.StandardMaterial('blimpMat', scene);
    bm.specularColor = BABYLON.Color3.Black();
    const env = BABYLON.MeshBuilder.CreateSphere('ble', { diameter: 14, segments: 10 }, scene);
    env.scaling.set(1, 1, 2.6);
    setMeshColor(env, 0.93, 0.93, 0.95);
    env.material = bm; env.parent = node;
    const stripe = BABYLON.MeshBuilder.CreateSphere('bls', { diameter: 14.2, segments: 10 }, scene);
    stripe.scaling.set(1.005, 0.35, 2.61);
    setMeshColor(stripe, 0.9, 0.35, 0.3);
    stripe.material = bm; stripe.parent = node;
    for (const [ry, rz] of [[0, 0], [Math.PI / 2, 0]]) {
      const fin = BABYLON.MeshBuilder.CreateBox('blf', { width: 6.5, height: 0.25, depth: 3 }, scene);
      fin.position.z = -16;
      fin.rotation.z = ry;
      setMeshColor(fin, 0.9, 0.35, 0.3);
      fin.material = bm; fin.parent = node;
    }
    const gond = BABYLON.MeshBuilder.CreateBox('blg', { width: 2, height: 1.4, depth: 5 }, scene);
    gond.position.y = -7.4;
    setMeshColor(gond, 0.4, 0.42, 0.5);
    gond.material = bm; gond.parent = node;
    blimp = { node, radius: 620, alt: 150, speed: 7, dir: -1, phase: 2.8 };
  }

  function updateBlimp(t) {
    if (!blimp) return;
    const a = blimp.phase + blimp.dir * (blimp.speed / blimp.radius) * t;
    blimp.node.position.set(blimp.radius * Math.cos(a), blimp.alt + Math.sin(t * 0.4) * 3, blimp.radius * Math.sin(a));
    blimp.node.rotation.y = Math.atan2(-Math.sin(a) * blimp.dir, Math.cos(a) * blimp.dir);
  }

  function buildHotAirs(scene) {
    const cols = [[0.55, 0.4, 0.95], [0.25, 0.75, 0.75]];
    for (let i = 0; i < 2; i++) {
      const node = new BABYLON.TransformNode('hotair' + i, scene);
      const env = BABYLON.MeshBuilder.CreateSphere('he', { diameter: 13, segments: 10 }, scene);
      env.scaling.y = 1.15;
      const c = cols[i];
      setMeshColor(env, c[0], c[1], c[2]);
      env.parent = node;
      const stripe = BABYLON.MeshBuilder.CreateTorus('hs', { diameter: 12.6, thickness: 1.2, tessellation: 16 }, scene);
      stripe.position.y = 1;
      setMeshColor(stripe, 0.98, 0.9, 0.4);
      stripe.parent = node;
      const basket = BABYLON.MeshBuilder.CreateBox('hb', { width: 2, height: 1.6, depth: 2 }, scene);
      basket.position.y = -9.2;
      setMeshColor(basket, 0.6, 0.42, 0.2);
      basket.parent = node;
      const hm = new BABYLON.StandardMaterial('hotairMat' + i, scene);
      hm.specularColor = BABYLON.Color3.Black();
      for (const mesh of node.getChildMeshes()) mesh.material = hm;
      hotAirs.push({ node, radius: 300 + i * 45, alt: 142 + i * 22, speed: 2.2 + i, phase: i * 2.4 });
    }
  }

  function updateHotAirs(t) {
    for (const h of hotAirs) {
      const a = h.phase + (h.speed / h.radius) * t;
      h.node.position.set(h.radius * Math.cos(a), h.alt + Math.sin(t * 0.5 + h.phase) * 4, h.radius * Math.sin(a));
    }
  }

  // --- Vehicles: many body styles, moving + parked instances ---
  function buildCars(scene) {
    if (roadSegs.length === 0) return;
    const mkMat = (i) => {
      const m = new BABYLON.StandardMaterial('carMat' + i, scene);
      m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
      return m;
    };
    const bases = [];
    let mi = 0;
    const finish = (parts, name, wheelZs) => {
      // every vehicle gets wheels: dark cylinders straddling the body
      for (const wz of (wheelZs || [-1.15, 1.15])) {
        const wheel = BABYLON.MeshBuilder.CreateCylinder('vw', { height: 1.95, diameter: 0.55, tessellation: 10 }, scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, -0.32, wz);
        setMeshColor(wheel, 0.13, 0.13, 0.15);
        parts.push(wheel);
      }
      const base = BABYLON.Mesh.MergeMeshes(parts, true, true);
      base.name = name;
      base.material = mkMat(mi++);
      base.isVisible = false;   // setEnabled(false) would hide the instances too
      bases.push(base);
      return base;
    };
    const box = (w, h, d, y, z, c) => {
      const b = BABYLON.MeshBuilder.CreateBox('vp', { width: w, height: h, depth: d }, scene);
      b.position.y = y; b.position.z = z || 0;
      setMeshColor(b, c[0], c[1], c[2]);
      return b;
    };
    // Sedans (4 colors)
    for (const c of [[0.9, 0.2, 0.2], [0.2, 0.4, 0.9], [0.95, 0.95, 0.95], [0.4, 0.7, 0.4]]) {
      finish([box(1.7, 0.7, 3.6, 0, 0, c), box(1.5, 0.6, 1.7, 0.6, -0.3, [0.55, 0.75, 0.9])], 'carBase' + mi);
    }
    // Taxi
    finish([box(1.7, 0.7, 3.6, 0, 0, [1, 0.8, 0.1]), box(1.5, 0.6, 1.7, 0.6, -0.3, [0.55, 0.75, 0.9]), box(0.9, 0.3, 0.5, 1.05, -0.3, [0.2, 0.2, 0.25])], 'carBase' + mi);
    // Van
    finish([box(1.9, 1.3, 4.4, 0.3, 0, [0.92, 0.92, 0.95]), box(1.7, 0.5, 1.2, 0.35, 1.9, [0.5, 0.7, 0.9])], 'carBase' + mi, [-1.5, 1.5]);
    // Bus (index 6 — slower below)
    finish([box(2.2, 1.6, 7.4, 0.45, 0, [1, 0.6, 0.15]), box(2.24, 0.5, 6.6, 0.75, 0, [0.65, 0.85, 0.95])], 'carBase' + mi, [-2.6, 2.6]);
    // Pickup
    finish([box(1.8, 0.75, 2.1, 0.05, 1, [0.35, 0.55, 0.85]), box(1.5, 0.6, 1.4, 0.65, 0.4, [0.55, 0.75, 0.9]), box(1.8, 0.45, 1.9, -0.05, -1.1, [0.3, 0.45, 0.7])], 'carBase' + mi, [-1.35, 1.35]);
    // Mini
    finish([box(1.5, 0.75, 2.5, 0, 0, [0.95, 0.4, 0.6]), box(1.35, 0.5, 1.3, 0.55, -0.1, [0.55, 0.75, 0.9])], 'carBase' + mi, [-0.85, 0.85]);
    // Box truck
    finish([box(2, 2.1, 3.8, 0.75, -0.7, [0.93, 0.93, 0.95]), box(1.8, 1.1, 1.5, 0.25, 1.9, [0.85, 0.3, 0.25])], 'carBase' + mi, [-1.7, 1.7]);
    // Semi with trailer
    finish([box(2.1, 2.4, 6.6, 0.9, -1.6, [0.85, 0.85, 0.88]), box(1.9, 1.5, 2.1, 0.45, 3, [0.3, 0.5, 0.8])], 'carBase' + mi, [-3.6, -2.4, 2.9]);
    // Police
    finish([box(1.7, 0.7, 3.6, 0, 0, [0.95, 0.95, 0.97]), box(1.5, 0.6, 1.7, 0.6, -0.3, [0.3, 0.3, 0.35]), box(0.5, 0.22, 0.45, 1.02, -0.55, [0.9, 0.2, 0.2]), box(0.5, 0.22, 0.45, 1.02, -0.05, [0.25, 0.35, 0.95])], 'carBase' + mi);
    // Ambulance
    finish([box(2, 1.9, 4.2, 0.65, -0.4, [0.97, 0.97, 0.97]), box(2.04, 0.5, 4.2, 0.45, -0.4, [0.9, 0.25, 0.2]), box(1.8, 1, 1.3, 0.2, 2, [0.97, 0.97, 0.97])], 'carBase' + mi, [-1.6, 1.6]);
    // Sports car
    finish([box(1.7, 0.5, 3.5, -0.05, 0, [0.85, 0.15, 0.2]), box(1.4, 0.35, 1.3, 0.35, -0.4, [0.3, 0.4, 0.5])], 'carBase' + mi);

    for (let i = 0; i < Config.NUM_CARS; i++) {
      const seg = roadSegs[Math.floor(hash(i, 5) * roadSegs.length) % roadSegs.length];
      const bi = Math.floor(hash(i, 7) * bases.length) % bases.length;
      const inst = bases[bi].createInstance('car' + i);
      const isBig = bi === 6 || bi === 10 || bi === 11;   // bus/box truck/semi
      const t = seg.type === 'arc'
        ? seg.a0 + hash(i, 9) * (seg.a1 - seg.a0)
        : seg.r0 + hash(i, 9) * (seg.r1 - seg.r0);
      cars.push({
        inst, seg, t,
        dir: hash(i, 11) > 0.5 ? 1 : -1,
        speed: (isBig ? 5.5 : 7) + hash(i, 13) * 7,
      });
    }
    // Parked cars (curbs + lots)
    parkingSpots.forEach((sp, i) => {
      const bi = Math.floor(hash(i, 15) * bases.length) % bases.length;
      const inst = bases[bi].createInstance('parked' + i);
      inst.position.set(sp.x, terrainHeight(sp.x, sp.z) + 1.0, sp.z);
      inst.rotation.y = sp.rot;
    });
  }

  function updateCars(dt) {
    for (const c of cars) {
      if (c.seg.type === 'arc') {
        c.t += c.dir * (c.speed / c.seg.r) * dt;
        if (c.t > c.seg.a1) { c.t = c.seg.a1; c.dir = -1; }
        if (c.t < c.seg.a0) { c.t = c.seg.a0; c.dir = 1; }
        const R = ringWarpR(c.seg.r, c.t) + 3 * c.dir;
        const x = Math.cos(c.t) * R, z = Math.sin(c.t) * R;
        c.inst.position.set(x, terrainHeight(x, z) + 0.95, z);
        c.inst.rotation.y = c.dir > 0
          ? Math.atan2(-Math.sin(c.t), Math.cos(c.t))
          : Math.atan2(Math.sin(c.t), -Math.cos(c.t));
      } else {
        c.t += c.dir * c.speed * dt;
        if (c.t > c.seg.r1) { c.t = c.seg.r1; c.dir = -1; }
        if (c.t < c.seg.r0) { c.t = c.seg.r0; c.dir = 1; }
        const aw = radialWarpA(c.seg.angle, c.t);
        const aw2 = radialWarpA(c.seg.angle, c.t + 2);
        const x1 = Math.cos(aw) * c.t, z1 = Math.sin(aw) * c.t;
        const x2 = Math.cos(aw2) * (c.t + 2), z2 = Math.sin(aw2) * (c.t + 2);
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
        const x = x1 - dz * 2.6 * c.dir, z = z1 + dx * 2.6 * c.dir;
        c.inst.position.set(x, terrainHeight(x, z) + 0.95, z);
        c.inst.rotation.y = c.dir > 0 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
      }
    }
  }

  function buildClouds(scene) {
    const m = new BABYLON.StandardMaterial('cloudMat', scene);
    m.diffuseColor = new BABYLON.Color3(1, 1, 1);
    m.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.4);
    m.specularColor = BABYLON.Color3.Black();
    m.alpha = 0.92;
    for (let i = 0; i < 34; i++) {
      const puffs = [];
      const np = 3 + Math.floor(hash(i, 3) * 3);
      for (let p = 0; p < np; p++) {
        const d = 18 + hash(i, p + 10) * 22;
        const puff = BABYLON.MeshBuilder.CreateSphere('cp', { diameter: d, segments: 8 }, scene);
        puff.scaling.y = 0.5;
        // flat shared cloudbase: bottoms line up like real cumulus
        puff.position.set((p - np / 2) * d * 0.52, d * 0.25, (hash(i, p + 50) - 0.5) * 16);
        puffs.push(puff);
      }
      const cloud = BABYLON.Mesh.MergeMeshes(puffs, true, true);
      cloud.name = 'cloud' + i;
      cloud.material = m;
      const a = hash(i, 7) * Math.PI * 2;
      const r = hash(i, 11) < 0.4 ? 130 + hash(i, 29) * 190 : 540 + hash(i, 29) * 520;
      const alt = i < 24 ? 70 + hash(i, 13) * 120 : 215 + hash(i, 13) * 70;   // a high layer too
      cloud.position.set(Math.cos(a) * r, alt, Math.sin(a) * r);
      clouds.push({ mesh: cloud, r, a, alt, speed: 1.5 + hash(i, 19) * 2.5 });
    }
  }

  function updateClouds(dt) {
    for (const c of clouds) {
      c.a += (c.speed / c.r) * dt;
      c.mesh.position.set(Math.cos(c.a) * c.r, c.alt, Math.sin(c.a) * c.r);
    }
  }

  function buildAiPlanes(scene) {
    const colors = [[0.85, 0.2, 0.2], [0.2, 0.7, 0.35], [0.95, 0.55, 0.1], [0.3, 0.45, 0.85], [0.75, 0.35, 0.75]];
    const params = [
      { radius: 680, alt: 130, speed: 14, dir: 1 },
      { radius: 820, alt: 175, speed: 11, dir: -1 },
      { radius: 950, alt: 215, speed: 16, dir: 1 },
      { radius: 750, alt: 158, speed: 12, dir: -1 },
      { radius: 890, alt: 198, speed: 15, dir: 1 },
    ];
    params.forEach((prm, i) => {
      const c = colors[i];
      const fus = BABYLON.MeshBuilder.CreateCylinder('af', { height: 6, diameter: 1.1, tessellation: 10 }, scene);
      fus.rotation.x = Math.PI / 2;
      setMeshColor(fus, c[0], c[1], c[2]);
      const wing = BABYLON.MeshBuilder.CreateBox('aw', { width: 8.5, height: 0.25, depth: 1.7 }, scene);
      wing.position.z = 0.5;
      setMeshColor(wing, 0.95, 0.92, 0.85);
      const tail = BABYLON.MeshBuilder.CreateBox('at', { width: 3.2, height: 0.2, depth: 1 }, scene);
      tail.position.z = -2.6;
      setMeshColor(tail, 0.95, 0.92, 0.85);
      const fin = BABYLON.MeshBuilder.CreateBox('afn', { width: 0.2, height: 1.3, depth: 1 }, scene);
      fin.position.set(0, 0.6, -2.6);
      setMeshColor(fin, c[0], c[1], c[2]);
      const mesh = BABYLON.Mesh.MergeMeshes([fus, wing, tail, fin], true, true);
      mesh.name = 'aiPlane' + i;
      const m = new BABYLON.StandardMaterial('aiMat' + i, scene);
      m.specularColor = BABYLON.Color3.Black();
      mesh.material = m;
      mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
      aiPlanes.push({ node: mesh, phase: hash(i, 23) * Math.PI * 2, ...prm });
    });
  }

  function updateAiPlanes(t) {
    for (const p of aiPlanes) {
      const a = p.phase + p.dir * (p.speed / p.radius) * t;
      const x = p.radius * Math.cos(a), z = p.radius * Math.sin(a);
      p.node.position.set(x, p.alt + Math.sin(t * 0.7 + p.phase) * 3, z);
      const tx = -Math.sin(a) * p.dir, tz = Math.cos(a) * p.dir;
      const yaw = Math.atan2(tx, tz);
      BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, 0, p.dir * 0.12, p.node.rotationQuaternion);
    }
  }

  function buildBirds(scene) {
    const m = new BABYLON.StandardMaterial('birdMat', scene);
    m.diffuseColor = new BABYLON.Color3(0.15, 0.13, 0.15);
    m.emissiveColor = new BABYLON.Color3(0.06, 0.05, 0.06);
    m.specularColor = BABYLON.Color3.Black();
    const flockParams = [
      { cx: 190, cz: -60, radius: 60, alt: 42, speed: 8 },   // clear of the mountain
      { cx: 80, cz: -60, radius: 55, alt: 30, speed: 7 },
      { cx: 30, cz: 180, radius: 90, alt: 48, speed: 9 },    // over the lagoon
      { cx: 330, cz: -350, radius: 70, alt: 52, speed: 8 },  // beach cove
      { cx: -430, cz: 330, radius: 80, alt: 60, speed: 9 },  // harbor / factory shore
      { cx: 120, cz: 430, radius: 75, alt: 46, speed: 7 },   // north shore
    ];
    flockParams.forEach((fp, fi) => {
      const node = new BABYLON.TransformNode('flock' + fi, scene);
      const wings = [];
      for (let b = 0; b < 6; b++) {
        const lateral = (b % 2 ? 1 : -1) * Math.ceil(b / 2) * 2.2;
        const back = -Math.abs(lateral) * 1.1;
        const bird = new BABYLON.TransformNode('bird', scene);
        bird.parent = node;
        bird.position.set(lateral, (hash(fi, b) - 0.5) * 2, back);
        for (const side of [-1, 1]) {
          const w = BABYLON.MeshBuilder.CreateBox('wing', { width: 1.3, height: 0.08, depth: 0.45 }, scene);
          w.parent = bird;
          w.position.x = side * 0.62;
          w.material = m;
          wings.push({ mesh: w, side });
        }
      }
      flocks.push({ node, wings, phase: hash(fi, 3) * Math.PI * 2, ...fp });
    });
  }

  function updateBirds(t) {
    for (const f of flocks) {
      const a = f.phase + (f.speed / f.radius) * t;
      f.node.position.set(f.cx + f.radius * Math.cos(a), f.alt + Math.sin(t * 0.9 + f.phase) * 2, f.cz + f.radius * Math.sin(a));
      f.node.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      const flap = Math.sin(t * 9 + f.phase) * 0.6;
      for (const w of f.wings) w.mesh.rotation.z = w.side * flap;
    }
  }

  // --- Helicopters patrolling the city at mid altitude ---
  const helis = [];
  function buildHelis(scene) {
    const defs = [
      { body: [0.95, 0.95, 0.97], trim: [0.85, 0.25, 0.2], radius: 370, alt: 72, speed: 8, dir: 1, phase: 1.2 },   // rescue
      { body: [0.35, 0.55, 0.9], trim: [0.95, 0.95, 0.97], radius: 490, alt: 92, speed: 9, dir: -1, phase: 4.1 },  // news
    ];
    defs.forEach((def, i) => {
      const node = new BABYLON.TransformNode('heli' + i, scene);
      const hm = new BABYLON.StandardMaterial('heliMat' + i, scene);
      hm.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
      const cabin = BABYLON.MeshBuilder.CreateSphere('hc', { diameter: 3, segments: 10 }, scene);
      cabin.scaling.set(0.75, 0.72, 1.25);
      setMeshColor(cabin, def.body[0], def.body[1], def.body[2]);
      cabin.material = hm; cabin.parent = node;
      const glass = BABYLON.MeshBuilder.CreateSphere('hg', { diameter: 2.6, segments: 8 }, scene);
      glass.scaling.set(0.68, 0.6, 0.7);
      glass.position.set(0, 0.15, 1);
      setMeshColor(glass, 0.6, 0.8, 0.95);
      glass.material = hm; glass.parent = node;
      const boom = BABYLON.MeshBuilder.CreateBox('hb', { width: 0.4, height: 0.45, depth: 3.6 }, scene);
      boom.position.set(0, 0.25, -2.6);
      setMeshColor(boom, def.trim[0], def.trim[1], def.trim[2]);
      boom.material = hm; boom.parent = node;
      const finT = BABYLON.MeshBuilder.CreateBox('hf', { width: 0.15, height: 1.1, depth: 0.7 }, scene);
      finT.position.set(0, 0.7, -4.3);
      setMeshColor(finT, def.trim[0], def.trim[1], def.trim[2]);
      finT.material = hm; finT.parent = node;
      for (const side of [-1, 1]) {
        const skid = BABYLON.MeshBuilder.CreateBox('hs', { width: 0.16, height: 0.16, depth: 3 }, scene);
        skid.position.set(side * 0.85, -1.25, 0.1);
        setMeshColor(skid, 0.4, 0.4, 0.44);
        skid.material = hm; skid.parent = node;
      }
      const rotor = new BABYLON.TransformNode('heliRotor' + i, scene);
      rotor.parent = node; rotor.position.y = 1.35;
      for (const ra of [0, Math.PI / 2]) {
        const blade = BABYLON.MeshBuilder.CreateBox('hrb', { width: 7.2, height: 0.08, depth: 0.4 }, scene);
        blade.rotation.y = ra;
        setMeshColor(blade, 0.25, 0.25, 0.28);
        blade.material = hm; blade.parent = rotor;
      }
      const tailRotor = new BABYLON.TransformNode('heliTail' + i, scene);
      tailRotor.parent = node; tailRotor.position.set(0.3, 0.7, -4.5);
      const tb = BABYLON.MeshBuilder.CreateBox('htb', { width: 0.1, height: 1.4, depth: 0.25 }, scene);
      setMeshColor(tb, 0.25, 0.25, 0.28);
      tb.material = hm; tb.parent = tailRotor;
      helis.push({ node, rotor, tailRotor, ...def });
    });
  }

  function updateHelis(dt, t) {
    for (const h of helis) {
      const a = h.phase + h.dir * (h.speed / h.radius) * t;
      const x = h.radius * Math.cos(a), z = h.radius * Math.sin(a);
      h.node.position.set(x, h.alt + Math.sin(t * 0.8 + h.phase) * 3, z);
      const yaw = Math.atan2(-Math.sin(a) * h.dir, Math.cos(a) * h.dir);
      h.node.rotation.set(0.1, yaw, 0);   // slight nose-down while cruising
      h.rotor.rotation.y += dt * 26;
      h.tailRotor.rotation.x += dt * 32;
    }
  }

  function buildSky(scene) {
    const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 7000, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const tex = new BABYLON.DynamicTexture('skyTex', { width: 4, height: 256 }, scene, false);
    const ctx = tex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#bfe3ff');
    grad.addColorStop(0.48, '#bfe3ff');
    grad.addColorStop(0.62, '#7ec2f7');
    grad.addColorStop(1, '#3f8fe8');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 4, 256);
    tex.update();
    const m = new BABYLON.StandardMaterial('skyMat', scene);
    m.emissiveTexture = tex;
    m.disableLighting = true;
    m.fogEnabled = false;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    sky.material = m;
    sky.infiniteDistance = true;
  }

  // --- Motivational gantry billboards over the 450 boulevard ---
  function buildMotivation(scene) {
    const msgs = [
      ['YOU CAN DO IT!', '#e8543f'], ['PEDAL POWER!', '#2f7fd1'],
      ['KEEP SPINNING!', '#2fa05a'], ['LOOKING STRONG!', '#8a4fc9'],
      ['GO GO GO!', '#e8913f'], ["SKY'S THE LIMIT!", '#2b9aa8'],
      ['EARN THAT TURBO!', '#d13f7f'], ['BREATHE & CLIMB!', '#5a8a2f'],
    ];
    const tex = new BABYLON.DynamicTexture('motivTex', { width: 1024, height: 1024 }, scene, true);
    const ctx = tex.getContext();
    msgs.forEach(([text, bg], i) => {
      const ox = (i % 2) * 512, oy = Math.floor(i / 2) * 256;
      ctx.fillStyle = bg; ctx.fillRect(ox, oy, 512, 256);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(ox + 10, oy + 10, 492, 236);
      ctx.fillStyle = bg; ctx.fillRect(ox + 18, oy + 18, 476, 220);
      ctx.font = "900 62px 'Baloo 2', Verdana, sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, ox + 256, oy + 132);
    });
    tex.update();
    const pm = new BABYLON.StandardMaterial('motivMat', scene);
    pm.diffuseTexture = tex;
    pm.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);   // readable in shade
    pm.specularColor = BABYLON.Color3.Black();

    // Gantry arches spanning the flight path itself — the plane flies over
    // them, and the tilted panel reads from the cockpit on approach.
    const angles = [0.75, 1.35, 1.95, 2.38, 3.15, 3.75, 4.35, 4.95, 5.55];
    angles.forEach((a0, i) => {
      const a = a0 + (hash(i, 909) - 0.5) * 0.12;
      const cx = Math.cos(a), sz2 = Math.sin(a);
      const rp = Track.radiusAt(a);
      const gy = terrainHeight(cx * rp, sz2 * rp);
      if (gy < 1.5) return;
      // single monopole, like a real highway billboard
      colorCyl(scene, 'motivPole' + i, { height: 21, diameterBottom: 1.7, diameterTop: 1.1, tessellation: 10 }, cx * rp, gy + 10.5, sz2 * rp, [0.58, 0.6, 0.64]);
      const mi = i % msgs.length;
      const u0 = (mi % 2) * 0.5, v0 = 0.75 - Math.floor(mi / 2) * 0.25;
      const faceUV = [];
      for (let f = 0; f < 6; f++) faceUV.push(new BABYLON.Vector4(u0, v0, u0 + 0.5, v0 + 0.25));
      const panel = BABYLON.MeshBuilder.CreateBox('motivB' + i, { width: 21, height: 7.5, depth: 0.4, faceUV }, scene);
      // face the oncoming (CCW) plane, tilted up toward the descending rider
      panel.rotation.y = Math.atan2(-sz2, cx);   // front face toward the oncoming plane
      panel.rotation.x = -0.5;
      panel.position.set(cx * rp, gy + 23, sz2 * rp);
      panel.material = pm;
      if (shadowGen) shadowGen.addShadowCaster(panel);
    });
  }

  // --- Golf course in the takeoff-corridor greenbelt (ground-level only) ---
  function buildGolf(scene, aMin, aMax, rMin, rMax, seed) {
    for (let i = 0; i < 10; i++) {
      const a = aMin + hash(i, seed) * (aMax - aMin);
      const r = rMin + hash(i, seed + 1) * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Track.distToRunway(x, z) < 34) continue;
      if (Math.hypot(x - STADIUM_POS.x, z - STADIUM_POS.z) < 78) continue;
      const gy = terrainHeight(x, z);
      if (gy < 1.5) continue;
      const fw = colorCyl(scene, 'golfF' + i, { height: 0.22, diameter: 22 + hash(i, seed + 2) * 16, tessellation: 12 }, x, gy + 0.14, z, [0.5, 0.8, 0.38]);
      fw.scaling.x = 1 + hash(i, seed + 3) * 0.7;
      fw.rotation.y = hash(i, seed + 4) * Math.PI;
      if (hash(i, seed + 5) < 0.7) {
        colorCyl(scene, 'golfB' + i, { height: 0.24, diameter: 4.5, tessellation: 8 }, x + 8, gy + 0.22, z + 5, [0.93, 0.87, 0.6]);
      }
      if (hash(i, seed + 6) < 0.55) {
        colorCyl(scene, 'golfG' + i, { height: 0.26, diameter: 7, tessellation: 10 }, x - 7, gy + 0.22, z - 4, [0.42, 0.85, 0.4]);
        colorCyl(scene, 'golfP' + i, { height: 2.4, diameter: 0.12, tessellation: 4 }, x - 7, gy + 1.4, z - 4, [0.9, 0.9, 0.88]);
        colorBox(scene, 'golfFl' + i, 0.9, 0.55, 0.06, x - 6.6, gy + 2.3, z - 4, [0.95, 0.25, 0.2]);
      }
    }
  }

  // --- Rocket launch site on the far islet: lifts off every few minutes ---
  let rocket = null;
  function buildRocket(scene) {
    const a = 1.9, r = 1050;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    colorCyl(scene, 'padBase', { height: 1.2, diameter: 22, tessellation: 14 }, x, 2.2, z, [0.6, 0.6, 0.62]);
    colorBox(scene, 'padTower', 2.2, 20, 2.2, x + 7, 12, z, [0.85, 0.35, 0.2]);
    colorBox(scene, 'padArm', 5, 0.8, 0.8, x + 4, 18, z, [0.85, 0.35, 0.2]);
    const node = new BABYLON.TransformNode('rocket', scene);
    const rm = new BABYLON.StandardMaterial('rocketMat', scene);
    rm.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    const body = BABYLON.MeshBuilder.CreateCylinder('rkB', { height: 13, diameter: 2.4, tessellation: 12 }, scene);
    body.position.y = 6.5;
    setMeshColor(body, 0.96, 0.96, 0.94);
    body.material = rm; body.parent = node;
    const nose = BABYLON.MeshBuilder.CreateCylinder('rkN', { height: 3.4, diameterBottom: 2.4, diameterTop: 0, tessellation: 12 }, scene);
    nose.position.y = 14.7;
    setMeshColor(nose, 0.88, 0.22, 0.18);
    nose.material = rm; nose.parent = node;
    for (let f = 0; f < 3; f++) {
      const fa = (f * Math.PI * 2) / 3;
      const fin = BABYLON.MeshBuilder.CreateBox('rkF', { width: 1.6, height: 3, depth: 0.25 }, scene);
      fin.position.set(Math.cos(fa) * 1.4, 1.5, Math.sin(fa) * 1.4);
      fin.rotation.y = -fa + Math.PI / 2;
      setMeshColor(fin, 0.88, 0.22, 0.18);
      fin.material = rm; fin.parent = node;
    }
    node.position.set(x, 2.8, z);

    const mkPS = (cap, sizeA, sizeB, c1, c2, blend) => {
      const tex = new BABYLON.DynamicTexture('rkTex' + blend, { width: 32, height: 32 }, scene, false);
      const cx2 = tex.getContext();
      const g = cx2.createRadialGradient(16, 16, 2, 16, 16, 15);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      cx2.fillStyle = g; cx2.fillRect(0, 0, 32, 32);
      tex.update(); tex.hasAlpha = true;
      const ps = new BABYLON.ParticleSystem('rkPS', cap, scene);
      ps.particleTexture = tex;
      ps.emitter = node;
      ps.minEmitBox = new BABYLON.Vector3(-0.5, -0.4, -0.5);
      ps.maxEmitBox = new BABYLON.Vector3(0.5, 0.2, 0.5);
      ps.minSize = sizeA; ps.maxSize = sizeB;
      ps.minLifeTime = 0.5; ps.maxLifeTime = 1.4;
      ps.emitRate = 0;
      ps.direction1 = new BABYLON.Vector3(-1.5, -6, -1.5);
      ps.direction2 = new BABYLON.Vector3(1.5, -9, 1.5);
      ps.minEmitPower = 2; ps.maxEmitPower = 5;
      ps.color1 = c1; ps.color2 = c2;
      ps.colorDead = new BABYLON.Color4(0.7, 0.7, 0.72, 0);
      ps.blendMode = blend;
      ps.start();
      return ps;
    };
    const flame = mkPS(200, 1.2, 2.6,
      new BABYLON.Color4(1, 0.85, 0.3, 1), new BABYLON.Color4(1, 0.45, 0.1, 1),
      BABYLON.ParticleSystem.BLENDMODE_ADD);
    const smoke = mkPS(300, 3, 7,
      new BABYLON.Color4(0.9, 0.9, 0.92, 0.7), new BABYLON.Color4(0.75, 0.75, 0.78, 0.6),
      BABYLON.ParticleSystem.BLENDMODE_STANDARD);
    rocket = { node, flame, smoke, baseY: 2.8, phase: 'idle', nextLaunch: 70, vy: 0 };
  }

  function updateRocket(dt, t) {
    if (!rocket) return;
    if (rocket.phase === 'idle') {
      if (t > rocket.nextLaunch) {
        rocket.phase = 'flying';
        rocket.vy = 1.5;
      }
    } else {
      rocket.vy += 13 * dt;
      rocket.node.position.y += rocket.vy * dt;
      rocket.flame.emitRate = 150;
      rocket.smoke.emitRate = 120;
      if (rocket.node.position.y > 750) {
        rocket.phase = 'idle';
        rocket.nextLaunch = t + 150 + hash(Math.round(t), 5) * 90;
        rocket.node.position.y = rocket.baseY;
        rocket.vy = 0;
        rocket.flame.emitRate = 0;
        rocket.smoke.emitRate = 0;
      }
    }
  }

  // --- Start/finish gate at the lap line + fireworks on each lap ---
  const fireworksPS = [];
  const fireworkQueue = [];
  function buildLapGate(scene) {
    const tex = new BABYLON.DynamicTexture('checkTex', { width: 128, height: 128 }, scene, true);
    const ctx = tex.getContext();
    for (let cy = 0; cy < 4; cy++) for (let cx2 = 0; cx2 < 4; cx2++) {
      ctx.fillStyle = (cx2 + cy) % 2 ? '#18181c' : '#f5f5f2';
      ctx.fillRect(cx2 * 32, cy * 32, 32, 32);
    }
    tex.update();
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    const cm = new BABYLON.StandardMaterial('checkMat', scene);
    cm.diffuseTexture = tex;
    cm.emissiveColor = new BABYLON.Color3(0.32, 0.32, 0.32);
    cm.specularColor = BABYLON.Color3.Black();
    const gold = [0.98, 0.8, 0.25], white = [0.97, 0.96, 0.92];
    const orbMat = new BABYLON.StandardMaterial('gateOrbMat', scene);
    orbMat.emissiveColor = new BABYLON.Color3(1, 0.85, 0.3);
    orbMat.diffuseColor = new BABYLON.Color3(0.9, 0.7, 0.2);
    for (const rx of [392, 448]) {
      // tapered striped pylon
      for (let seg = 0; seg < 6; seg++) {
        const wSeg = 4.6 - seg * 0.45;
        colorBox(scene, 'gateSeg', wSeg, 26.5, wSeg, rx, Config.PLATEAU_H + 18 + seg * 26, 0, seg % 2 ? white : gold);
      }
      const orb = BABYLON.MeshBuilder.CreateSphere('gateOrb', { diameter: 5, segments: 10 }, scene);
      orb.position.set(rx, Config.PLATEAU_H + 18 + 5 * 26 + 16, 0);
      orb.material = orbMat;
    }
    // checkered crossbar + pennant flags
    const beamUV = [];
    for (let f2 = 0; f2 < 6; f2++) beamUV.push(new BABYLON.Vector4(0, 0, 5, 0.5));
    const beam = BABYLON.MeshBuilder.CreateBox('gateBeam', { width: 60, depth: 2.6, height: 3.4, faceUV: beamUV }, scene);
    beam.position.set(420, Config.PLATEAU_H + 172, 0);
    beam.material = cm;
    const flagCols = [[0.95, 0.3, 0.3], [0.98, 0.8, 0.25], [0.35, 0.7, 0.45], [0.4, 0.6, 0.95]];
    for (let fI = 0; fI < 7; fI++) {
      const fc = flagCols[fI % flagCols.length];
      const fl = colorBox(scene, 'gateFlag', 2.6, 1.7, 0.1, 398 + fI * 7.4, Config.PLATEAU_H + 168.6, 0, fc);
      fl.rotation.z = -0.25;
    }
    // split FINISH banners flanking the flight gap at mid-altitude
    const btex = new BABYLON.DynamicTexture('gateBannerTex', { width: 512, height: 128 }, scene, true);
    const bctx = btex.getContext();
    bctx.fillStyle = '#e8543f'; bctx.fillRect(0, 0, 512, 128);
    for (let k = 0; k < 16; k++) {
      bctx.fillStyle = k % 2 ? '#18181c' : '#f5f5f2';
      bctx.fillRect(k * 32, 0, 32, 10); bctx.fillRect(k * 32, 118, 32, 10);
    }
    bctx.font = "900 64px 'Baloo 2', Verdana, sans-serif";
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.fillStyle = '#ffffff';
    bctx.fillText('FINISH', 256, 66);
    const bMat = new BABYLON.StandardMaterial('gateBannerMat', scene);
    bMat.diffuseTexture = btex;
    bMat.emissiveColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    bMat.specularColor = BABYLON.Color3.Black();
    for (const [bx1, bw] of [[401.5, 15], [438.5, 15]]) {
      const bUV = [];
      for (let f2 = 0; f2 < 6; f2++) bUV.push(new BABYLON.Vector4(0, 0, 1, 1));
      const banner = BABYLON.MeshBuilder.CreateBox('gateBanner', { width: bw, height: 4.2, depth: 0.3, faceUV: bUV }, scene);
      banner.position.set(bx1, Config.PLATEAU_H + 92, 0);
      banner.rotation.y = 0;
      banner.material = bMat;
    }
    // fireworks systems (reused bursts)
    const cols = [
      [new BABYLON.Color4(1, 0.4, 0.35, 1), new BABYLON.Color4(1, 0.7, 0.3, 1)],
      [new BABYLON.Color4(0.4, 0.75, 1, 1), new BABYLON.Color4(0.7, 0.5, 1, 1)],
      [new BABYLON.Color4(0.5, 1, 0.5, 1), new BABYLON.Color4(1, 1, 0.5, 1)],
    ];
    const ftex = new BABYLON.DynamicTexture('fwTex', { width: 32, height: 32 }, scene, false);
    const fctx = ftex.getContext();
    const fg = fctx.createRadialGradient(16, 16, 2, 16, 16, 15);
    fg.addColorStop(0, 'rgba(255,255,255,1)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = fg; fctx.fillRect(0, 0, 32, 32);
    ftex.update(); ftex.hasAlpha = true;
    for (const [c1, c2] of cols) {
      const ps = new BABYLON.ParticleSystem('fw', 300, scene);
      ps.particleTexture = ftex;
      ps.emitter = new BABYLON.Vector3(0, -1000, 0);
      ps.minSize = 0.9; ps.maxSize = 2.2;
      ps.minLifeTime = 0.7; ps.maxLifeTime = 1.5;
      ps.emitRate = 0;
      ps.createSphereEmitter(1.5);
      ps.minEmitPower = 14; ps.maxEmitPower = 26;
      ps.gravity = new BABYLON.Vector3(0, -9, 0);
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
      ps.color1 = c1; ps.color2 = c2;
      ps.colorDead = new BABYLON.Color4(1, 1, 1, 0);
      ps.start();
      fireworksPS.push(ps);
    }
  }

  function fireworks(positions, tNow) {
    positions.forEach((p, i) => {
      fireworkQueue.push({ at: tNow + i * 0.35, pos: p, ps: fireworksPS[i % fireworksPS.length] });
    });
  }

  function updateFireworks(t) {
    for (let i = fireworkQueue.length - 1; i >= 0; i--) {
      const f = fireworkQueue[i];
      if (t >= f.at) {
        f.ps.emitter = f.pos.clone ? f.pos.clone() : new BABYLON.Vector3(f.pos.x, f.pos.y, f.pos.z);
        f.ps.manualEmitCount = 220;
        fireworkQueue.splice(i, 1);
      }
    }
  }

  function buildSun(scene) {
    const dir = new BABYLON.Vector3(0.5, 0.17, 0.35).normalize();   // low over the sea
    const mk = (name, dia, col, alpha) => {
      const disc = BABYLON.MeshBuilder.CreateDisc(name, { radius: dia / 2, tessellation: 24 }, scene);
      const m = new BABYLON.StandardMaterial(name + 'Mat', scene);
      m.emissiveColor = new BABYLON.Color3(col[0], col[1], col[2]);
      m.disableLighting = true;
      m.alpha = alpha;
      m.fogEnabled = false;
      m.disableDepthWrite = true;
      disc.material = m;
      disc.position = dir.scale(3100);
      disc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      disc.infiniteDistance = true;
      disc.renderingGroupId = 0;
      return disc;
    };
    mk('sunHalo', 620, [1, 0.93, 0.75], 0.13);
    mk('sunDisc', 230, [1, 0.97, 0.85], 0.95);
  }

  // --- Distant landmasses: hazy mountain silhouettes on the horizon at two
  // fixed bearings, so riders always know which way they're facing ---
  function buildFarLand(scene) {
    const mkRange = (bearing0, bearing1, count, rBase, hBase, col, seed) => {
      const m = new BABYLON.StandardMaterial('farland' + seed, scene);
      m.emissiveColor = new BABYLON.Color3(col[0], col[1], col[2]);
      m.disableLighting = true;
      m.fogEnabled = false;
      for (let i = 0; i < count; i++) {
        const b = bearing0 + (i / Math.max(1, count - 1)) * (bearing1 - bearing0) + (hash(i, seed) - 0.5) * 0.08;
        const r = rBase + hash(i, seed + 1) * 500;
        const h = hBase * (0.55 + hash(i, seed + 2) * 0.9);
        const w = 650 + hash(i, seed + 3) * 750;
        const cone = BABYLON.MeshBuilder.CreateCylinder('farm' + seed + i, {
          height: h, diameterBottom: w, diameterTop: 0, tessellation: 7,
        }, scene);
        cone.scaling.x = 0.75 + hash(i, seed + 4) * 0.7;   // irregular silhouette
        cone.position.set(Math.cos(b) * r, h / 2 - 25, Math.sin(b) * r);
        cone.rotation.y = hash(i, seed + 5) * Math.PI;
        cone.material = m;
      }
    };
    mkRange(3.85, 4.95, 8, 2900, 300, [0.48, 0.6, 0.77], 771);   // big southwestern range
    mkRange(4.05, 4.7, 5, 3400, 380, [0.6, 0.7, 0.85], 791);     // paler ridge behind it
    mkRange(0.72, 1.18, 4, 3000, 200, [0.54, 0.65, 0.8], 811);   // low northeastern isle
  }

  function mergeProps(scene, name) {
    const batch = propParts.splice(0);
    if (batch.length === 0) return null;
    for (const p of batch) p.computeWorldMatrix(true);
    const props = BABYLON.Mesh.MergeMeshes(batch, true, true);
    props.name = name || 'props';
    const m = new BABYLON.StandardMaterial((name || 'props') + 'Mat', scene);
    m.specularColor = BABYLON.Color3.Black();
    props.material = m;
    props.freezeWorldMatrix();
    return props;
  }

  function build(scene) {
    scene.clearColor = new BABYLON.Color4(0.75, 0.88, 1.0, 1);
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00055;
    scene.fogColor = new BABYLON.Color3(0.78, 0.9, 1.0);

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -0.38, -0.35), scene);
    sun.intensity = 1.32;
    sun.diffuse = new BABYLON.Color3(1, 0.93, 0.82);
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.78;
    hemi.groundColor = new BABYLON.Color3(0.5, 0.55, 0.45);

    buildSky(scene);
    buildTerrain(scene);
    buildWater(scene);
    buildRunway(scene);
    buildRoads(scene);
    buildCity(scene);
    buildCivic(scene);
    buildViaduct(scene);
    buildClockTower(scene);
    buildStadium(scene);
    buildLighthouse(scene);
    buildFactory(scene);
    buildRocket(scene);
    buildLapGate(scene);
    buildFerris(scene);
    buildFairground(scene);
    buildMonorail(scene);
    buildTram(scene);
    buildRailway(scene);
    buildWindmills(scene);
    buildBoats(scene);
    buildBeach(scene);
    buildIslets(scene);
    buildFields(scene);
    buildWhale(scene);
    buildBlimp(scene);
    buildHotAirs(scene);
    mergeProps(scene);
    buildCars(scene);
    buildTrees(scene);
    buildClouds(scene);
    buildAiPlanes(scene);
    buildBirds(scene);
    buildHelis(scene);
    buildSun(scene);
    buildFarLand(scene);

    // --- Cascaded sun shadows: chunky low-poly + real shadows = the look ---
    shadowGen = new BABYLON.CascadedShadowGenerator(1024, sun);
    shadowGen.numCascades = 2;
    shadowGen.lambda = 0.92;
    shadowGen.shadowMaxZ = 950;
    shadowGen.bias = 0.02;
    shadowGen.normalBias = 0.5;
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_LOW;
    shadowGen.stabilizeCascades = true;
    shadowGen.setDarkness(0.58);   // soft shadows: keep shaded areas readable
    const casterNames = ['cityDowntown', 'cityMidtown', 'cityHouses', 'props', 'trees', 'runway'];
    for (const mesh of scene.meshes) {
      if (casterNames.includes(mesh.name) || mesh.name.startsWith('cloud') ||
          mesh.name.startsWith('aiPlane') || mesh.getClassName() === 'InstancedMesh') {
        shadowGen.addShadowCaster(mesh);
      }
    }
    for (const node of [...trainCars.map(c => c.node), ...monoCars.map(c => c.node),
      ...ships.map(s => s.node), ...hotAirs.map(h => h.node), blimp ? blimp.node : null]) {
      if (node) for (const mesh of node.getChildMeshes()) shadowGen.addShadowCaster(mesh);
    }
    if (ferris) for (const mesh of ferris.wheel.getChildMeshes(false).concat(ferris.wheel.parent.getChildMeshes())) {
      shadowGen.addShadowCaster(mesh);
    }
    for (const name of ['island', 'roads', 'roadPaint', 'props', 'cityDowntown', 'cityMidtown', 'cityHouses', 'trees', 'runway', 'water', 'seafloor']) {
      const mesh = scene.getMeshByName(name);
      if (mesh) mesh.receiveShadows = true;
    }
    buildMotivation(scene);
    buildGolf(scene, 0.08, 0.46, 372, 458, 921);   // takeoff greenbelt
    buildGolf(scene, 2.5, 2.95, 512, 556, 951);   // coastal links
    const lateProps = mergeProps(scene, 'props2');
    if (lateProps) {
      shadowGen.addShadowCaster(lateProps);
      lateProps.receiveShadows = true;
    }
  }

  function addShadowCaster(mesh) {
    if (shadowGen) shadowGen.addShadowCaster(mesh);
  }

  function update(dt, t) {
    updateWater(t);
    updateClouds(dt);
    updateCars(dt);
    updateAiPlanes(t);
    updateBirds(t);
    updateFerris(dt);
    updateSmoke(t);
    updateBoats(dt, t);
    updateHotAirs(t);
    updateRailway(t);
    updateWindmills(dt);
    updateWhale(t);
    updateBlimp(t);
    updateFairground(dt, t);
    updateMonorail(t);
    updateTram(t);
    updateCivic(t);
    updateBeams(t);
    updateRocket(dt, t);
    updateFireworks(t);
    updateHelis(dt, t);
  }

  return { build, update, terrainHeight, addShadowCaster, fireworks, _roadSegs: roadSegs, _inCityZone: inCityZone, _majors: MAJOR_RADIALS, _warpA: radialWarpA };
})();
