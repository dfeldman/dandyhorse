// NPC racer planes for pylon races. They fly the same rail as the player
// (small lateral offsets so nobody overlaps), chase the ring line's
// altitudes with personal sloppiness, and rubber-band their pace to stay
// close, so races finish tight no matter the rider's fitness.
const Rivals = (() => {
  const defs = [
    { name: 'Baron von Turnip', color: [0.78, 0.16, 0.16], trim: [0.95, 0.9, 0.8], skill: 1.005, wobble: 1.2, lat: -9 },
    { name: 'Goldie Gears', color: [0.95, 0.75, 0.15], trim: [0.25, 0.28, 0.33], skill: 0.995, wobble: 0.8, lat: 9 },
    { name: 'Captain Cumulus', color: [0.35, 0.62, 0.95], trim: [0.98, 0.98, 0.98], skill: 0.985, wobble: 1.8, lat: -16 },
  ];
  const rivals = [];   // { def, node, s, alt, altVel }
  let racing = false;

  function setColor(mesh, c) {
    const n = mesh.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { cols[i * 4] = c[0]; cols[i * 4 + 1] = c[1]; cols[i * 4 + 2] = c[2]; cols[i * 4 + 3] = 1; }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
  }

  // A simplified biplane in the rival's colors (nose facing +Z).
  function buildPlane(scene, def, i) {
    const parts = [];
    const fus = BABYLON.MeshBuilder.CreateCylinder('rf', { height: 6.8, diameterBottom: 0.9, diameterTop: 0.5, tessellation: 10 }, scene);
    fus.rotation.x = Math.PI / 2;
    setColor(fus, def.color);
    parts.push(fus);
    for (const wy of [-0.4, 1.0]) {
      const wing = BABYLON.MeshBuilder.CreateBox('rw', { width: 8.8, height: 0.22, depth: 1.5 }, scene);
      wing.position.set(0, wy, 0.5);
      setColor(wing, def.trim);
      parts.push(wing);
    }
    for (const sx of [-3, 3]) {
      const strut = BABYLON.MeshBuilder.CreateBox('rs', { width: 0.12, height: 1.4, depth: 0.12 }, scene);
      strut.position.set(sx, 0.3, 0.5);
      setColor(strut, [0.4, 0.4, 0.45]);
      parts.push(strut);
    }
    const hstab = BABYLON.MeshBuilder.CreateBox('rh', { width: 3, height: 0.18, depth: 1 }, scene);
    hstab.position.set(0, 0.1, -2.9);
    setColor(hstab, def.trim);
    parts.push(hstab);
    const fin = BABYLON.MeshBuilder.CreateBox('rfn', { width: 0.16, height: 1.2, depth: 1 }, scene);
    fin.position.set(0, 0.65, -2.9);
    setColor(fin, def.color);
    parts.push(fin);
    const disc = BABYLON.MeshBuilder.CreateDisc('rd', { radius: 1.2, tessellation: 16 }, scene);
    disc.position.z = 3.6;
    setColor(disc, [0.85, 0.85, 0.9]);
    parts.push(disc);
    const mesh = BABYLON.Mesh.MergeMeshes(parts, true, true);
    mesh.name = 'rival' + i;
    const m = new BABYLON.StandardMaterial('rivalMat' + i, scene);
    m.specularColor = BABYLON.Color3.Black();
    m.backFaceCulling = false;
    mesh.material = m;
    mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    return mesh;
  }

  function build(scene) {
    defs.forEach((def, i) => {
      const node = buildPlane(scene, def, i);
      node.setEnabled(false);
      rivals.push({ def, node, s: 0, alt: 60, prevAlt: 60 });
    });
  }

  function startRace(playerS) {
    racing = true;
    rivals.forEach((r, i) => {
      r.s = playerS - 22 * (i + 1);   // start behind: the player has the hole-shot
      r.alt = 60;
      r.node.setEnabled(true);
    });
  }

  function endRace() {
    racing = false;
    for (const r of rivals) r.node.setEnabled(false);
  }

  function update(dt, t, playerS) {
    if (!racing) return;
    for (const r of rivals) {
      // Pace: personality wobble + rubber-band toward the player
      const rubber = Math.max(-0.06, Math.min(0.12, (playerS - r.s) / 500));
      const v = Config.SPEED * (r.def.skill + 0.025 * Math.sin(t * 0.35 * r.def.wobble + r.def.lat)) * (1 + rubber);
      r.s += v * dt;
      // Altitude: chase the next ring with personal error
      const nxt = Rings.nextRing(r.s);
      const target = (nxt ? nxt.alt : 70) + Math.sin(t * r.def.wobble + r.def.lat) * 5;
      r.prevAlt = r.alt;
      r.alt += (target - r.alt) * (1 - Math.exp(-dt / 1.6));
      // Pose on the rail with a lateral offset
      const p = Track.poseAt(Math.max(0, r.s));
      const x = p.x - p.tz * r.def.lat;   // (-tz, tx) is perpendicular to the tangent
      const z = p.z + p.tx * r.def.lat;
      r.node.position.set(x, r.alt, z);
      const pitch = Math.atan2(dt > 0 ? (r.alt - r.prevAlt) / dt : 0, Config.SPEED);
      const yaw = Math.atan2(p.tx, p.tz);
      BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, -pitch, Config.BANK_RAD, r.node.rotationQuaternion);
    }
  }

  // Standings including the player; returns { pos, total, gap } where gap is
  // meters to the rival ahead (or lead margin when P1).
  function standings(playerS) {
    const all = rivals.map(r => ({ name: r.def.name, s: r.s }));
    all.push({ name: 'YOU', s: playerS, you: true });
    all.sort((a, b) => b.s - a.s);
    const pos = all.findIndex(e => e.you) + 1;
    let gap = 0;
    if (pos > 1) gap = all[pos - 2].s - playerS;
    else if (all.length > 1) gap = playerS - all[1].s;
    return { pos, total: all.length, gap: Math.round(gap), order: all };
  }

  return { build, startRace, endRace, update, standings, get racing() { return racing; }, _rivals: rivals };
})();
