// Landscape height field + terrain/water/trail meshes.
//   rawHeight(x,z)  : noise landscape shaped per biome (mesas, alpine relief,
//                     flat town), edge mountains, lake basins
//   heightAt(x,z)   : rawHeight blended toward the trail inside its corridor
//   groundColor(...) : biome-blended, patchy ground color
// Track is defined from rawHeight; the mesh is built from heightAt.
const Terrain = (() => {
  const { clamp, lerp, smoothstep } = Util;
  const HALF = Config.MAP_SIZE / 2;
  const nHills = Rng.makeNoise2D('hills');
  const nBig = Rng.makeNoise2D('big');
  const nMtn = Rng.makeNoise2D('mountain');
  const nMesa = Rng.makeNoise2D('mesa');
  const nPatchA = Rng.makeNoise2D('patchA');
  const nPatchB = Rng.makeNoise2D('patchB');
  const nDirt = Rng.makeNoise2D('dirt');
  const nBloom = Rng.makeNoise2D('bloom');
  const BLOOM = [Util.hex('#f7a8d8'), Util.hex('#fff0a0'), Util.hex('#c9b6ff')];
  const basins = [];   // {x, z, r} carved lakes (filled by Track)
  const RELIEF = Config.ROUTE.relief;

  function bowl(x, z, b) {
    const d = Math.hypot(x - b.x, z - b.z) / b.r;
    if (d >= 1) return Infinity;
    return Config.WATER_Y + 9 - 16 * (1 - smoothstep(0, 1, d));   // -7 at center, +9 at rim
  }

  function rawHeight(x, z) {
    const w = Biome.weights(x, z);
    const hills = 34 * nHills.fbm(x / 400, z / 400, 5, 2.05, 0.5);
    const big = 22 * nBig.fbm(x / 1100, z / 1100, 3, 2, 0.5);
    const shape = Biome.blend(w, 'shape');
    let h = 14 + RELIEF * (big + hills * shape) + Biome.blend(w, 'lift');
    const V = Biome.volcano;
    if (V) {   // volcano cone with a crater, rising out of the mountain ring
      const d = Math.hypot(x - V.x, z - V.z);
      if (d < V.r) h += V.h * smoothstep(V.r, 0, d) - 34 * smoothstep(38, 0, d);
    }
    if (w.desert > 0.01) {   // flat-topped mesas, damped near the loop so they don't notch the trail
      const m = nMesa.fbm(x / 230, z / 230, 3, 2, 0.5);
      const mesa = smoothstep(0.1, 0.2, m) * 20 * smoothstep(28, 75, Loop.radialDist(x, z));
      h += w.desert * mesa;
    }
    const dist = Math.hypot(x, z);
    const mtn = smoothstep(Config.TRAIL_RADIUS + 210, Config.TRAIL_RADIUS + 520, dist);
    if (mtn > 0) h += mtn * (55 + 60 * (0.5 + 0.5 * nMtn.fbm(x / 260, z / 260, 4, 2.1, 0.5)));
    h = Math.min(h, bowl(x, z, { x: 0, z: 0, r: 250 }) + 1);   // central lake
    for (const b of basins) h = Math.min(h, bowl(x, z, b));
    return h;
  }

  function heightAt(x, z) {
    const h = rawHeight(x, z);
    const n = Track.nearest(x, z);
    if (!n || n.d >= Config.CORRIDOR || n.bridge) return h;
    const w = 1 - smoothstep(Config.TRAIL_WIDTH * 0.5 + 0.8, Config.CORRIDOR, n.d);
    return lerp(h, n.y - 0.08, w);
  }
  function isWater(x, z) { return heightAt(x, z) < Config.WATER_Y; }

  // ---- colors ----
  const H = Util.hex;
  const PAL = {}; for (const n of Biome.POOL) PAL[n] = Biome.DEF[n].palC;
  const LAVA = H('#ffb010');
  const C = { sandLo: H('#c9b26e'), sand: H('#f6e6a4'), snow: H('#ffffff'), rockHi: H('#c9bfd6'), trail: H('#e3b276') };
  const tmp = new BABYLON.Color3(), acc = new BABYLON.Color3();

  // biome-blended ground (no slope/snow) — used by the terrain and the trail verge
  function groundColor(x, z, h, out) {
    const fc = Fields.colorAt(x, z, h);
    if (fc) return out ? out.copyFrom(fc) : fc.clone();
    const w = Biome.weights(x, z);
    // two noise scales, pushed apart so patches read as distinct clumps
    const p = smoothstep(0.3, 0.7, 0.5 + 0.5 * (0.65 * nPatchA.noise(x / 26, z / 26) + 0.6 * nPatchB.noise(x / 130, z / 130)));
    const d = smoothstep(0.55, 0.68, nDirt.fbm(x / 45, z / 45, 2, 2, 0.5));
    acc.set(0, 0, 0);
    for (const n of Biome.NAMES) {
      const wn = w[n]; if (wn < 0.002) continue;
      const pal = PAL[n];
      BABYLON.Color3.LerpToRef(pal.a, pal.b, p, tmp);
      BABYLON.Color3.LerpToRef(tmp, pal.dirt, d, tmp);
      if (n === 'volcanic' && d > 0.5) BABYLON.Color3.LerpToRef(tmp, LAVA, (d - 0.5) * 1.2, tmp);   // lava cracks glow at the center of the patch
      if (n === 'meadow') {   // drifts of wildflowers
        const bl = nBloom.fbm(x / 70, z / 70, 2, 2, 0.5);
        const bw = smoothstep(0.22, 0.4, bl);
        if (bw > 0) BABYLON.Color3.LerpToRef(tmp, BLOOM[Math.floor((x * 0.013 + z * 0.007 + 100) % 3)], bw * 0.55, tmp);
      }
      acc.r += tmp.r * wn; acc.g += tmp.g * wn; acc.b += tmp.b * wn;
    }
    return out ? out.copyFrom(acc) : acc.clone();
  }

  function faceColor(h, ny, x, z) {
    const slope = 1 - ny;
    const w = Biome.weights(x, z);
    let c;
    const rel = h - Config.WATER_Y;
    if (rel < -1.5) c = C.sandLo.clone();
    else if (rel < 1.2) c = BABYLON.Color3.Lerp(C.sandLo, C.sand, smoothstep(-1.5, 1.2, rel));
    else c = groundColor(x, z, h);
    // foam line where the ground meets the water
    if (rel > -0.55 && rel < 0.15) c = BABYLON.Color3.Lerp(c, C.snow, 0.7 * (1 - Math.abs(rel + 0.2) / 0.35));
    // snow line: global high peaks, much lower in the alpine sector
    const snowAt = Biome.blend(w, 'snow');
    if (h > snowAt) c = BABYLON.Color3.Lerp(c, C.snow, smoothstep(snowAt, snowAt + 12, h));
    if (Biome.volcano) {   // lava in the crater, dark scorched slopes
      const V = Biome.volcano, d = Math.hypot(x - V.x, z - V.z);
      if (d < V.r) { c = BABYLON.Color3.Lerp(c, PAL.volcanic.a, smoothstep(V.r, V.r * 0.5, d)); if (d < 34) c = BABYLON.Color3.Lerp(c, LAVA, smoothstep(34, 22, d)); }
    }
    if (slope > 0.2 && rel > 1.2) {
      const t = smoothstep(0.2, 0.4, slope);
      acc.set(0, 0, 0);
      for (const n of Biome.NAMES) { const wn = w[n]; if (wn < 0.002) continue; const r = PAL[n].rock; acc.r += r.r * wn; acc.g += r.g * wn; acc.b += r.b * wn; }
      const rc = BABYLON.Color3.Lerp(acc, C.rockHi, 0.5 + 0.5 * nPatchA.noise(x / 18, z / 18));
      c = BABYLON.Color3.Lerp(c, h > snowAt + 14 ? C.snow : rc, t);
    }
    return c;
  }

  // ---- meshes ----
  function buildGround(scene) {
    const step = Config.TERRAIN_STEP;
    const N = Math.round(Config.MAP_SIZE / step);
    const Hg = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) Hg[j * (N + 1) + i] = heightAt(-HALF + i * step, -HALF + j * step);

    const chunks = Config.TERRAIN_CHUNKS, per = N / chunks;
    const mat = Util.matte(scene);
    const root = new BABYLON.TransformNode('terrainRoot', scene);
    for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
      const quads = per * per;
      const pos = new Float32Array(quads * 18), nor = new Float32Array(quads * 18), col = new Float32Array(quads * 24);
      const idx = new Uint32Array(quads * 6);
      let v = 0, t = 0;
      const tri = (a, b, c) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const ch = (a[1] + b[1] + c[1]) / 3, cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
        const color = faceColor(ch, ny, cx, cz);
        for (const p of [a, c, b]) {   // Babylon (left-handed) front faces wind this way
          pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
          nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
          col[v * 4] = color.r; col[v * 4 + 1] = color.g; col[v * 4 + 2] = color.b; col[v * 4 + 3] = 1;
          idx[t++] = v; v++;
        }
      };
      for (let j = cj * per; j < (cj + 1) * per; j++) for (let i = ci * per; i < (ci + 1) * per; i++) {
        const x0 = -HALF + i * step, z0 = -HALF + j * step;
        const p00 = [x0, Hg[j * (N + 1) + i], z0], p10 = [x0 + step, Hg[j * (N + 1) + i + 1], z0];
        const p01 = [x0, Hg[(j + 1) * (N + 1) + i], z0 + step], p11 = [x0 + step, Hg[(j + 1) * (N + 1) + i + 1], z0 + step];
        if ((i + j) & 1) { tri(p00, p01, p11); tri(p00, p11, p10); }
        else { tri(p00, p01, p10); tri(p10, p01, p11); }
      }
      const mesh = new BABYLON.Mesh(`terrain_${ci}_${cj}`, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = pos; vd.normals = nor; vd.colors = col; vd.indices = idx;
      vd.applyToMesh(mesh, false);
      mesh.material = mat; mesh.parent = root; mesh.isPickable = false; mesh.receiveShadows = true;
      Util.freeze(mesh);
    }
    return root;
  }

  function buildWater(scene) {
    const w = BABYLON.MeshBuilder.CreateGround('water', { width: Config.MAP_SIZE * 1.4, height: Config.MAP_SIZE * 1.4, subdivisions: 1 }, scene);
    w.position.y = Config.WATER_Y;
    const mat = new BABYLON.StandardMaterial('waterMat', scene);
    const tex = new BABYLON.DynamicTexture('waterTex', { width: 256, height: 256 }, scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = '#3fbdf3'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    const r = Rng.stream('water');
    for (let i = 0; i < 26; i++) {
      const x = r.range(0, 256), y = r.range(0, 256), len = r.range(14, 34);
      for (const off of [0, -256]) { ctx.beginPath(); ctx.moveTo(x + off, y); ctx.quadraticCurveTo(x + off + len / 2, y - 5, x + off + len, y); ctx.stroke(); }
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = tex.vScale = 140;
    mat.diffuseTexture = tex;
    mat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3); mat.specularPower = 64;
    mat.emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.25);
    mat.alpha = 0.78;
    w.material = mat; w.isPickable = false;
    Util.freeze(w);
    // second, sparser highlight layer drifting the other way for depth
    const w2 = BABYLON.MeshBuilder.CreateGround('water2', { width: Config.MAP_SIZE * 1.4, height: Config.MAP_SIZE * 1.4, subdivisions: 1 }, scene);
    w2.position.y = Config.WATER_Y + 0.12;
    const mat2 = new BABYLON.StandardMaterial('waterMat2', scene);
    const tex2 = new BABYLON.DynamicTexture('waterTex2', { width: 256, height: 256 }, scene, false);
    const c2 = tex2.getContext();
    c2.clearRect(0, 0, 256, 256);
    c2.strokeStyle = 'rgba(255,255,255,0.7)'; c2.lineWidth = 3; c2.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const x = r.range(0, 256), y = r.range(0, 256), len = r.range(20, 46);
      for (const off of [0, -256]) { c2.beginPath(); c2.moveTo(x + off, y); c2.quadraticCurveTo(x + off + len / 2, y - 4, x + off + len, y); c2.stroke(); }
    }
    tex2.update(); tex2.hasAlpha = true;
    tex2.wrapU = tex2.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex2.uScale = tex2.vScale = 90;
    mat2.diffuseTexture = tex2; mat2.opacityTexture = tex2; mat2.emissiveColor = new BABYLON.Color3(0.6, 0.7, 0.8);
    mat2.specularColor = BABYLON.Color3.Black(); mat2.disableLighting = true;
    w2.material = mat2; w2.isPickable = false; Util.freeze(w2);
    return { mesh: w, update: (t) => { tex.uOffset = t * 0.012; tex.vOffset = Math.sin(t * 0.5) * 0.01; tex2.uOffset = -t * 0.008; tex2.vOffset = t * 0.005; } };
  }

  // Trail surface: packed dirt with speckles and two faint tire ruts.
  function trailTexture(scene) {
    const S = 256;
    const tex = new BABYLON.DynamicTexture('trailTex', { width: S, height: S }, scene, true);
    const ctx = tex.getContext();
    const r = Rng.stream('trailtex');
    ctx.fillStyle = '#e3b276'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = r.range(0, 1);
      ctx.fillStyle = v < 0.5 ? 'rgba(120,80,40,0.18)' : 'rgba(255,240,200,0.22)';
      const x = r.range(0, S), y = r.range(0, S), s = r.range(1.5, 4);
      ctx.fillRect(x, y, s, s);
    }
    // On Babylon ribbons u runs ALONG the path and v ACROSS it, so ruts are
    // horizontal bands (constant v) and the worn edges sit at the top/bottom.
    for (const v of [0.32, 0.68]) {
      const g = ctx.createLinearGradient(0, (v - 0.06) * S, 0, (v + 0.06) * S);
      g.addColorStop(0, 'rgba(110,70,35,0)'); g.addColorStop(0.5, 'rgba(110,70,35,0.3)'); g.addColorStop(1, 'rgba(110,70,35,0)');
      ctx.fillStyle = g; ctx.fillRect(0, (v - 0.06) * S, S, 0.12 * S);
    }
    for (const v of [0, 1]) {
      const g = ctx.createLinearGradient(0, v === 0 ? 0 : S, 0, v === 0 ? 0.12 * S : S - 0.12 * S);
      g.addColorStop(0, 'rgba(90,60,30,0.22)'); g.addColorStop(1, 'rgba(90,60,30,0)');
      ctx.fillStyle = g; ctx.fillRect(0, v === 0 ? 0 : S - 0.12 * S, S, 0.12 * S);
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  function buildTrail(scene) {
    const L = Track.length, stepS = 2;
    const hw = Config.TRAIL_WIDTH / 2;
    const edge = (side, o0, o1, y) => {
      const a = [], b = [];
      for (let s = 0; s < L; s += stepS) {
        const p = Track.poseAt(s);
        const nx = -p.hz * side, nz = p.hx * side;
        a.push(new BABYLON.Vector3(p.x + nx * o0, p.y + y, p.z + nz * o0));
        b.push(new BABYLON.Vector3(p.x + nx * o1, p.y + y, p.z + nz * o1));
      }
      return [a, b];
    };
    // surface
    const [left, right] = [edge(1, hw, 0, 0.06)[0], edge(-1, hw, 0, 0.06)[0]];
    const ribbon = BABYLON.MeshBuilder.CreateRibbon('trail', { pathArray: [left, right], closePath: true, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    const tmat = new BABYLON.StandardMaterial('trailMat', scene);
    tmat.diffuseTexture = trailTexture(scene);
    tmat.diffuseTexture.uScale = L / 6; tmat.diffuseTexture.vScale = 1;   // one tile per 6 m along the path
    tmat.specularColor = BABYLON.Color3.Black();
    ribbon.material = tmat; ribbon.isPickable = false; ribbon.receiveShadows = true;
    {   // per-area tint multiplies the texture: asphalt in town, redder in the desert
      const TINT = {}; for (const n of Biome.POOL) TINT[n] = Biome.DEF[n].trail;
      const pos = ribbon.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const cols = new Float32Array((pos.length / 3) * 4);
      for (let i = 0; i < pos.length / 3; i++) {
        const w = Biome.weights(pos[i * 3], pos[i * 3 + 2]);
        let r = 0, g = 0, b = 0;
        for (const n of Biome.NAMES) { r += TINT[n][0] * w[n]; g += TINT[n][1] * w[n]; b += TINT[n][2] * w[n]; }
        cols[i * 4] = r; cols[i * 4 + 1] = g; cols[i * 4 + 2] = b; cols[i * 4 + 3] = 1;
      }
      ribbon.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
    }
    Util.freeze(ribbon);
    // light edge stripe + darker biome-colored verge
    for (const side of [1, -1]) {
      const [a, b] = edge(side, hw, hw + 0.3, 0.09);
      const e = BABYLON.MeshBuilder.CreateRibbon('trailEdge' + side, { pathArray: [a, b], closePath: true, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
      Util.colorize(e, '#f7d9a2'); e.material = Util.matte(scene); e.isPickable = false; Util.freeze(e);
      const [c, d] = edge(side, hw + 0.3, hw + 1.9, 0.05);
      const vg = BABYLON.MeshBuilder.CreateRibbon('verge' + side, { pathArray: [c, d], closePath: true, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
      const pos = vg.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const cols = new Float32Array((pos.length / 3) * 4);
      const cc = new BABYLON.Color3();
      for (let i = 0; i < pos.length / 3; i++) {
        groundColor(pos[i * 3], pos[i * 3 + 2], pos[i * 3 + 1], cc);
        cols[i * 4] = cc.r * 0.72; cols[i * 4 + 1] = cc.g * 0.72; cols[i * 4 + 2] = cc.b * 0.72; cols[i * 4 + 3] = 1;
      }
      vg.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
      vg.material = Util.matte(scene); vg.isPickable = false; vg.receiveShadows = true; Util.freeze(vg);
    }
    return ribbon;
  }

  let water = null;
  function build(scene) { buildGround(scene); water = buildWater(scene); buildTrail(scene); }
  function update(t) { if (water) water.update(t); }

  return { rawHeight, heightAt, isWater, groundColor, basins, build, update, HALF, colors: C, PAL };
})();
