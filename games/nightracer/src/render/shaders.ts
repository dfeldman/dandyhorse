/**
 * The night look, as small GLSL shaders: buildings with procedural windows, the road with its markings and light
 * pools, barrier walls, the ground's street grid with moving traffic, the sky. All share the same exp² fog as the
 * standard materials, so everything fades into the same haze.
 */
import { Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

const COMMON = /* glsl */ `
precision highp float;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 cameraPos;
uniform float time;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 applyFog(vec3 col, vec3 pos) {
  float d = length(pos - cameraPos);
  float f = exp(-pow(d * fogDensity, 2.0));
  return mix(fogColor, col, clamp(f, 0.0, 1.0));
}
// a box pulse [a, b] on x, softened by w (for anti-aliasing)
float pulse(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
`

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#ifdef UV2
attribute vec2 uv2;
#endif
#ifdef VCOLOR
attribute vec4 color;
#endif
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  vUV = uv;
#ifdef UV2
  vUV2 = uv2;
#else
  vUV2 = vec2(0.0);
#endif
#ifdef VCOLOR
  vColor = color;
#else
  vColor = vec4(1.0);
#endif
  gl_Position = viewProjection * wp;
}
`

/** Street lamps along the road: every LAMP_SPACING metres, alternating sides (shared with world.ts). */
export const LAMP_SPACING = 32
const LAMPS = /* glsl */ `
uniform vec3 lampColor;
uniform float lampSide;
// light from the two nearest lamps at along-track distance v and lateral u (lamps at u = +-lampSide)
vec3 lampLight(float v, float u) {
  float sp = ${LAMP_SPACING.toFixed(1)};
  float k = floor(v / sp);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 3; j++) {
    float idx = k + float(j) - 1.0;
    float side = mod(idx, 2.0) < 0.5 ? 1.0 : -1.0;
    float dv = v - idx * sp;
    float du = u - side * (lampSide - 2.5);
    float d2 = dv * dv * 0.55 + du * du;
    acc += lampColor * exp(-d2 / 70.0);
  }
  return acc;
}
`

const CARS = /* glsl */ `
uniform vec3 carPos[4];
uniform vec3 carDir[4];
uniform vec3 carTint[4];
// headlight cones and a red glow behind each car, on a surface point p
vec3 carLight(vec3 p) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = p - carPos[i];
    float along = dot(d, carDir[i]);
    vec3 side = d - carDir[i] * along;
    float lat = length(side);
    float cone = smoothstep(along * 0.42 + 1.4, along * 0.18, lat) * smoothstep(0.5, 3.0, along) * smoothstep(48.0, 6.0, along);
    acc += vec3(1.0, 0.93, 0.75) * cone * 0.85;
    float back = -along;
    float tail = smoothstep(7.0, 0.0, length(vec2(back - 3.0, lat * 1.2))) * step(0.0, back);
    acc += vec3(0.9, 0.08, 0.08) * tail * 0.35;
    // a soft glow of the car's own colour around it
    acc += carTint[i] * smoothstep(5.5, 0.0, length(d)) * 0.25;
  }
  return acc;
}
`

const BUILDING_FRAG = /* glsl */ `
${COMMON}
uniform vec3 winWarm;
uniform vec3 winCool;
uniform vec3 winAccent;
uniform vec3 moonDir;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 body = vColor.rgb;
  float seed = vColor.a * 97.0;
  float lightAmt = 0.55 + 0.5 * max(0.0, dot(n, moonDir)) + 0.1 * n.y;
  vec3 col = body * lightAmt;
  // a faint lighter rim at the top of each wall so silhouettes read against the sky
  float wall = 1.0 - step(0.6, abs(n.y));
  float density = vUV2.x;
  float style = vUV2.y;
  if (wall > 0.5 && density > 0.0 && vUV.y > 0.5) {
    vec2 cellSize = style < 0.5 ? vec2(3.0, 3.4) : style < 1.5 ? vec2(1.6, 3.6) : style < 2.5 ? vec2(4.4, 3.4) : vec2(2.2, 4.2);
    vec2 g = vUV / cellSize;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 w = fwidth(g) * 1.2;
    float wx = style < 0.5 ? pulse(0.2, 0.8, f.x, w.x) : style < 1.5 ? pulse(0.1, 0.9, f.x, w.x) : style < 2.5 ? pulse(0.08, 0.92, f.x, w.x) : pulse(0.3, 0.7, f.x, w.x);
    float wy = style < 1.5 ? pulse(0.28, 0.82, f.y, w.y) : style < 2.5 ? pulse(0.35, 0.75, f.y, w.y) : pulse(0.15, 0.85, f.y, w.y);
    float win = wx * wy;
    // whole floors tend to be lit or dark together
    float faceId = floor(dot(n.xz, vec2(3.0, 7.0)) + 10.0);
    float floorLit = hash(vec2(id.y + seed, faceId));
    float cellLit = hash(id + vec2(seed, faceId * 3.1));
    float lit = step(1.0 - density, mix(cellLit, floorLit, 0.55));
    vec3 wc = mix(winWarm, winCool, step(0.62, hash(id * 1.37 + seed)));
    wc = mix(wc, winAccent, step(0.965, hash(id * 3.7 + seed * 1.3)));
    wc *= 0.75 + 0.45 * hash(id + 11.0);
    // a few windows flicker (TV light)
    float tv = step(0.985, hash(id * 5.3 + seed));
    wc *= 1.0 - tv * 0.4 * (0.5 + 0.5 * sin(time * 9.0 + id.x * 3.0 + sin(time * 13.0 + id.y)));
    vec3 glass = body * 0.45 + vec3(0.015, 0.02, 0.05);
    // far away the window grid shimmers: fade to its average
    float far = smoothstep(0.35, 0.9, max(w.x, w.y));
    vec3 near = mix(col, mix(glass, wc, lit), win);
    vec3 avg = mix(col, mix(glass, wc * 0.9, density * 0.6), 0.45);
    col = mix(near, avg, far);
  }
  // roofs a touch lighter; rooftop edge highlight
  if (n.y > 0.6) col = body * 0.9 + vec3(0.02, 0.02, 0.04);
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}
`

const ROAD_FRAG = /* glsl */ `
${COMMON}
${LAMPS}
${CARS}
uniform float trackLength;
uniform float roadHalf;
uniform float laneWidth;
uniform vec3 asphalt;
uniform vec3 kerbColor;
uniform vec4 gridSlots; // lane index for grid slots 0..3
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
void main() {
  float u = vUV.x;   // lateral (m)
  float v = vUV.y;   // along (m)
  float au = abs(u);
  vec2 wd = fwidth(vUV) * 1.1;
  float grain = hash(floor(vec2(u * 3.0, v * 3.0)));
  vec3 col = asphalt * (0.88 + 0.16 * grain);
  // worn tyre lines in each lane
  for (int l = 0; l < 4; l++) {
    float c = (float(l) - 1.5) * laneWidth;
    col *= 1.0 - 0.18 * (pulse(c - 1.0, c - 0.55, u, wd.x) + pulse(c + 0.55, c + 1.0, u, wd.x));
  }
  vec3 paint = vec3(0.92, 0.92, 0.88);
  // lane dashes between the lanes
  float dash = pulse(0.0, 5.0, mod(v, 12.0), wd.y);
  for (int l = 1; l < 4; l++) {
    float c = (float(l) - 2.0) * laneWidth;
    col = mix(col, paint, pulse(c - 0.1, c + 0.1, u, wd.x) * dash);
  }
  // edge lines
  float edge = roadHalf - 1.0;
  col = mix(col, paint, pulse(edge - 0.12, edge + 0.12, au, wd.x));
  // kerbs on the bends
  float bend = smoothstep(0.006, 0.011, abs(vUV2.x));
  float kerb = step(edge + 0.2, au) * bend;
  float stripe = step(0.5, fract(v / 3.0));
  col = mix(col, mix(vec3(0.95), kerbColor, stripe), kerb);
  // start line: a checkered band, and the grid slots behind it
  float sv = mod(v, trackLength);
  float line = pulse(0.0, 3.0, sv, wd.y) * step(au, edge);
  float checker = mod(floor(u / 1.0) + floor(sv / 1.0), 2.0);
  col = mix(col, vec3(checker * 0.95 + 0.03), line);
  for (int k = 0; k < 4; k++) {
    float slot = trackLength - (7.0 + 8.0 * float(k)) + 2.8;
    float c = (gridSlots[k] - 1.5) * laneWidth;
    float bar = pulse(slot - 0.15, slot + 0.15, sv, wd.y) * pulse(c - 1.3, c + 1.3, u, wd.x);
    float legs = pulse(slot - 2.2, slot, sv, wd.y) * (pulse(c - 1.3, c - 1.1, u, wd.x) + pulse(c + 1.1, c + 1.3, u, wd.x));
    col = mix(col, paint, max(bar, legs));
  }
  // light
  vec3 light = vec3(0.16, 0.17, 0.26) + lampLight(v, u) + carLight(vPos);
  vec3 lit = col * light;
  // a wet sheen: lamp light streaks toward the camera
  vec3 view = normalize(cameraPos - vPos);
  float sheen = pow(1.0 - max(0.0, view.y), 3.0);
  lit += lampLight(v - sign(v) * 0.0, u) * 0.12 * sheen;
  gl_FragColor = vec4(applyFog(lit, vPos), 1.0);
}
`

const WALL_FRAG = /* glsl */ `
${COMMON}
${LAMPS}
${CARS}
uniform vec3 wallA;
uniform vec3 wallB;
uniform vec3 neon;
uniform float roadHalfW;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
void main() {
  float h = vUV.x;  // height above the road (m)
  float v = vUV.y;  // along (m)
  float side = vUV2.y;
  vec2 wd = fwidth(vUV) * 1.1;
  float bend = smoothstep(0.006, 0.011, abs(vUV2.x));
  float panel = step(0.5, fract(v / 8.0));
  vec3 col = mix(wallA, wallB, panel * 0.35);
  // bends get red and white blocks
  col = mix(col, mix(vec3(0.9), vec3(0.85, 0.08, 0.1), step(0.5, fract(v / 4.0))), bend * step(0.05, h));
  // a band of the theme's neon colour, and reflectors
  col = mix(col, neon * 0.9, pulse(0.55, 0.68, h, wd.x));
  float refl = pulse(0.0, 0.25, mod(v, 6.0), wd.y) * pulse(0.3, 0.42, h, wd.x);
  vec3 light = vec3(0.2, 0.2, 0.3) + lampLight(v, side * roadHalfW) * 0.8 + carLight(vPos) * 1.3;
  vec3 lit = col * light + neon * refl * 1.2 + carLight(vPos) * refl * 2.0;
  gl_FragColor = vec4(applyFog(lit, vPos), 1.0);
}
`

const GROUND_FRAG = /* glsl */ `
${COMMON}
uniform vec3 groundColor;
uniform vec3 streetGlow;
uniform float block;
uniform float street;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vColor;
void main() {
  vec2 p = vPos.xz;
  vec2 cell = mod(p, block);
  vec2 wd = fwidth(p) * 1.2;
  float corridor = vUV2.x;
  float lightAmt = 0.6 + 0.4 * max(0.0, normalize(vNormal).y);
  vec3 col = groundColor * lightAmt;
  // streets between the blocks: darker asphalt, sodium glow, moving cars
  float sx = pulse(0.0, street, cell.x, wd.x);
  float sz = pulse(0.0, street, cell.y, wd.y);
  float isStreet = max(sx, sz) * (1.0 - corridor);
  vec3 streetCol = groundColor * 0.6 + streetGlow * 0.25;
  // curbs
  float curb = (pulse(street, street + 1.5, cell.x, wd.x) + pulse(street, street + 1.5, cell.y, wd.y)) * (1.0 - corridor);
  col = mix(col, groundColor * 1.6 + streetGlow * 0.08, clamp(curb, 0.0, 1.0));
  col = mix(col, streetCol, isStreet);
  // traffic: headlights one way, taillights the other
  vec2 bid = floor(p / block);
  float laneA = pulse(street * 0.25 - 0.4, street * 0.25 + 0.4, cell.x, wd.x) * (1.0 - corridor);
  float laneB = pulse(street * 0.75 - 0.4, street * 0.75 + 0.4, cell.x, wd.x) * (1.0 - corridor);
  float spd = 9.0 + 4.0 * hash(vec2(bid.x, 1.0));
  float ca = step(0.93, fract((p.y + time * spd) / 23.0 + hash(vec2(bid.x, 2.0))));
  float cb = step(0.93, fract((p.y - time * spd) / 19.0 + hash(vec2(bid.x, 3.0))));
  col += vec3(1.0, 0.95, 0.8) * laneA * ca * 1.4 + vec3(1.0, 0.15, 0.1) * laneB * cb * 1.2;
  float laneC = pulse(street * 0.25 - 0.4, street * 0.25 + 0.4, cell.y, wd.y) * (1.0 - corridor);
  float laneD = pulse(street * 0.75 - 0.4, street * 0.75 + 0.4, cell.y, wd.y) * (1.0 - corridor);
  float spd2 = 8.0 + 5.0 * hash(vec2(bid.y, 4.0));
  float cc = step(0.94, fract((p.x - time * spd2) / 21.0 + hash(vec2(bid.y, 5.0))));
  float cd = step(0.94, fract((p.x + time * spd2) / 25.0 + hash(vec2(bid.y, 6.0))));
  col += vec3(1.0, 0.95, 0.8) * laneC * cc * 1.4 + vec3(1.0, 0.15, 0.1) * laneD * cd * 1.2;
  // street lamps at the corners
  vec2 cc2 = cell - vec2(street * 0.5);
  col += streetGlow * exp(-dot(cc2, cc2) / 60.0) * 0.6 * (1.0 - corridor);
  // near the race road: a plaza
  col = mix(col, groundColor * 1.25 + vec3(0.02, 0.02, 0.035), corridor * 0.8);
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}
`

const SKY_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = world * vec4(position, 1.0);
  gl_Position = viewProjection * wp;
}
`

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 skyGlow;
uniform vec3 moonDir;
uniform float time;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(skyHorizon, skyTop, smoothstep(-0.02, 0.45, h));
  // city glow on the horizon
  col += skyGlow * exp(-max(h, 0.0) * 9.0) * 0.8;
  // stars
  vec3 sd = d * 180.0;
  vec3 cell = floor(sd);
  float star = hash(cell);
  vec3 f = fract(sd) - 0.5;
  float tw = 0.6 + 0.4 * sin(time * (1.0 + star * 3.0) + star * 40.0);
  float s = step(0.992, star) * smoothstep(0.22, 0.0, length(f)) * tw * smoothstep(0.08, 0.3, h);
  col += vec3(0.9, 0.92, 1.0) * s;
  // the moon, with a halo and a few craters
  float md = dot(d, normalize(moonDir));
  float disc = smoothstep(0.9985, 0.9989, md);
  float crater = 1.0 - 0.12 * step(0.6, hash(floor(d * 900.0)));
  col = mix(col, vec3(1.0, 0.98, 0.88) * crater, disc);
  col += vec3(0.5, 0.55, 0.8) * pow(max(md, 0.0), 400.0) * 0.6;
  col += vec3(0.25, 0.3, 0.5) * pow(max(md, 0.0), 30.0) * 0.25;
  gl_FragColor = vec4(col, 1.0);
}
`

const SKYLINE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 skyHorizon;
uniform vec3 silhouette;
uniform vec3 winWarm;
varying vec3 vPos;
varying vec2 vUV;
varying vec3 vNormal;
varying vec2 vUV2;
varying vec4 vColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // u around the ring (0..1), v height (0..1)
  float x = vUV.x * 900.0;
  float id = floor(x);
  float hgt = 0.15 + 0.55 * pow(hash(vec2(id, 1.0)), 2.2) + 0.25 * step(0.93, hash(vec2(id, 7.0)));
  float hgt2 = 0.1 + 0.35 * hash(vec2(floor(x * 0.37), 3.0));
  float top = max(hgt, hgt2);
  if (vUV.y > top) discard;
  vec3 col = silhouette;
  vec2 w = vec2(fract(x) * 6.0, vUV.y * 90.0);
  float win = step(0.5, fract(w.x)) * step(0.5, fract(w.y)) * step(0.82, hash(floor(w) + id));
  col += winWarm * win * 0.55;
  float haze = smoothstep(0.0, 0.6, vUV.y);
  col = mix(skyHorizon * 0.9, col, 0.55 + 0.45 * haze);
  gl_FragColor = vec4(col, 1.0);
}
`

let registered = false
function register(): void {
  if (registered) return
  registered = true
  Effect.ShadersStore['nrVertexShader'] = VERTEX
  Effect.ShadersStore['nrBuildingFragmentShader'] = BUILDING_FRAG
  Effect.ShadersStore['nrRoadFragmentShader'] = ROAD_FRAG
  Effect.ShadersStore['nrWallFragmentShader'] = WALL_FRAG
  Effect.ShadersStore['nrGroundFragmentShader'] = GROUND_FRAG
  Effect.ShadersStore['nrSkyVertexShader'] = SKY_VERT
  Effect.ShadersStore['nrSkyFragmentShader'] = SKY_FRAG
  Effect.ShadersStore['nrSkylineFragmentShader'] = SKYLINE_FRAG
}

const BASE_UNIFORMS = ['world', 'viewProjection', 'fogColor', 'fogDensity', 'cameraPos', 'time']
const LAMP_UNIFORMS = ['lampColor', 'lampSide']
const CAR_UNIFORMS = ['carPos', 'carDir', 'carTint']

export type ShaderKind = 'building' | 'road' | 'wall' | 'ground' | 'sky' | 'skyline'

export function makeShader(scene: Scene, kind: ShaderKind, name: string): ShaderMaterial {
  register()
  const spec: Record<ShaderKind, { frag: string; uniforms: string[]; defines: string[]; vert?: string; attrs?: string[] }> = {
    building: { frag: 'nrBuilding', uniforms: ['winWarm', 'winCool', 'winAccent', 'moonDir'], defines: ['#define UV2', '#define VCOLOR'] },
    road: { frag: 'nrRoad', uniforms: [...LAMP_UNIFORMS, ...CAR_UNIFORMS, 'trackLength', 'roadHalf', 'laneWidth', 'asphalt', 'kerbColor', 'gridSlots'], defines: ['#define UV2'] },
    wall: { frag: 'nrWall', uniforms: [...LAMP_UNIFORMS, ...CAR_UNIFORMS, 'wallA', 'wallB', 'neon', 'roadHalfW'], defines: ['#define UV2'] },
    ground: { frag: 'nrGround', uniforms: ['groundColor', 'streetGlow', 'block', 'street'], defines: ['#define UV2'] },
    sky: { frag: 'nrSky', vert: 'nrSky', uniforms: ['skyTop', 'skyHorizon', 'skyGlow', 'moonDir'], defines: [], attrs: ['position'] },
    skyline: { frag: 'nrSkyline', uniforms: ['skyHorizon', 'silhouette', 'winWarm'], defines: [] },
  }
  const s = spec[kind]
  const attrs = s.attrs ?? ['position', 'normal', 'uv', ...(s.defines.includes('#define UV2') ? ['uv2'] : []), ...(s.defines.includes('#define VCOLOR') ? ['color'] : [])]
  const mat = new ShaderMaterial(name, scene, { vertex: s.vert ?? 'nr', fragment: s.frag }, {
    attributes: attrs,
    uniforms: [...BASE_UNIFORMS, ...s.uniforms],
    defines: s.defines,
  })
  return mat
}
