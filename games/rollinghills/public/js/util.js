// Small shared helpers: colors, mesh merging, math.
const Util = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function hex(h) { return BABYLON.Color3.FromHexString(h); }
  function hex4(h, a = 1) { const c = hex(h); return new BABYLON.Color4(c.r, c.g, c.b, a); }

  // Paint every vertex of a mesh one color (vertex colors * white material).
  function colorize(mesh, h, shade = 1) {
    const c = typeof h === 'string' ? hex(h) : h;
    const n = mesh.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { cols[i * 4] = c.r * shade; cols[i * 4 + 1] = c.g * shade; cols[i * 4 + 2] = c.b * shade; cols[i * 4 + 3] = 1; }
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
    return mesh;
  }

  // Merge a list of vertex-colored meshes into one (disposes sources).
  function merge(meshes, name) {
    const m = BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (m) m.name = name || 'merged';
    return m;
  }

  // One shared flat material: white diffuse so vertex colors show, no specular.
  let flatMat = null;
  function matte(scene) {
    if (!flatMat) {
      flatMat = new BABYLON.StandardMaterial('matte', scene);
      flatMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
      flatMat.specularColor = new BABYLON.Color3(0, 0, 0);
      flatMat.ambientColor = new BABYLON.Color3(1, 1, 1);
    }
    return flatMat;
  }

  // Shared material for things that light up at night (windows, lamps).
  // Daylight drives its emissive color.
  let glow = null;
  function glowMat(scene) {
    if (!glow) {
      glow = new BABYLON.StandardMaterial('glow', scene);
      glow.diffuseColor = new BABYLON.Color3(1, 1, 1); glow.specularColor = BABYLON.Color3.Black();
      glow.emissiveColor = new BABYLON.Color3(0, 0, 0);
    }
    return glow;
  }

  // Build a matrix buffer for thin instances from an array of placements.
  // Large sets are split into map cells (clones sharing the geometry) so
  // frustum culling works for both the camera and the shadow passes.
  function thinInstances(mesh, placements, cell = 300) {
    if (placements.length > 150) {
      const groups = new Map();
      for (const p of placements) {
        const k = Math.floor(p.x / cell) * 100000 + Math.floor(p.z / cell);
        let g = groups.get(k); if (!g) { g = []; groups.set(k, g); }
        g.push(p);
      }
      // clone from the pristine mesh BEFORE any instance buffers exist, so the
      // clones don't inherit (and then fight over) the source's instance state
      const list = [...groups.values()];
      const chunks = [mesh];
      // thin-instance buffers live on the geometry, so each chunk needs its own copy
      for (let i = 1; i < list.length; i++) { const c = mesh.clone(mesh.name + '_c' + i); c.makeGeometryUnique(); chunks.push(c); }
      chunks.forEach((m, i) => { thinInstancesRaw(m, list[i]); m.freezeWorldMatrix(); m.isPickable = false; });
      mesh.__chunks = chunks;
      return mesh;
    }
    thinInstancesRaw(mesh, placements);
    mesh.__chunks = [mesh];
    return mesh;
  }
  function thinInstancesRaw(mesh, placements) {
    const buf = new Float32Array(placements.length * 16);
    const cols = new Float32Array(placements.length * 4);
    let hasColor = false;
    placements.forEach((p, i) => {
      const m = BABYLON.Matrix.Compose(
        new BABYLON.Vector3(p.sx ?? p.s ?? 1, p.sy ?? p.s ?? 1, p.sz ?? p.s ?? 1),
        BABYLON.Quaternion.RotationYawPitchRoll(p.ry || 0, p.rx || 0, p.rz || 0),
        new BABYLON.Vector3(p.x, p.y, p.z));
      m.copyToArray(buf, i * 16);
      const c = p.color || null;
      if (c) hasColor = true;
      cols[i * 4] = c ? c.r : 1; cols[i * 4 + 1] = c ? c.g : 1; cols[i * 4 + 2] = c ? c.b : 1; cols[i * 4 + 3] = 1;
    });
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    if (hasColor) mesh.thinInstanceSetBuffer('color', cols, 4, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    return mesh;
  }

  function freeze(mesh) { mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true; return mesh; }

  return { clamp, lerp, smoothstep, hex, hex4, colorize, merge, matte, glowMat, thinInstances, freeze };
})();
