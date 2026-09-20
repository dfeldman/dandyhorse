/**
 * The GLSL looks: the sea (waves, moon glitter, the beam's light on the water, the lamp's reflection), the sky
 * (gradient, stars, moon, clouds, aurora, dawn, far hills), the beam cones and the surf foam.
 * waveHeight() mirrors the sea's vertex waves so ships and buoys ride them.
 */
import { Constants, Effect, ShaderMaterial, type Scene } from '@babylonjs/core'

/** Wave trains: direction (x, z), wavenumber, speed, amplitude share. */
const WAVES: [number, number, number, number, number][] = [
  [0.32, 0.95, 0.045, 1.1, 1.0],
  [-0.6, 0.8, 0.07, 1.5, 0.55],
  [0.9, 0.43, 0.11, 1.9, 0.32],
  [-0.2, -0.98, 0.16, 2.4, 0.2],
]
export const WAVE_CENTER = { x: -20, z: -60 }

function waveGlsl(): string {
  return WAVES.map((w, i) => {
    const l = Math.hypot(w[0], w[1])
    return `  { vec2 d = vec2(${(w[0] / l).toFixed(4)}, ${(w[1] / l).toFixed(4)}); float ph = dot(d, p) * ${w[2].toFixed(4)} + time * ${w[3].toFixed(4)} + ${i}.7;
    h += ${w[4].toFixed(4)} * sin(ph); g += ${(w[4] * w[2]).toFixed(5)} * cos(ph) * d; }`
  }).join('\n')
}

/** Sea surface height (m) at x, z. amp is the weather's wave amplitude (m). */
export function waveHeight(x: number, z: number, time: number, amp: number): number {
  const fade = waveFade(x, z)
  let h = 0
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]!
    const l = Math.hypot(w[0], w[1])
    h += w[4] * Math.sin(((w[0] / l) * x + (w[1] / l) * z) * w[2] + time * w[3] + i + 0.7)
  }
  return h * amp * fade
}

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Waves die out far away, and the harbour and the south shore are sheltered. */
function waveFade(x: number, z: number): number {
  const d = Math.hypot(x - WAVE_CENTER.x, z - WAVE_CENTER.z)
  return (1 - ss(900, 2200, d)) * (1 - 0.75 * ss(210, 110, z))
}

const COMMON = /* glsl */ `
precision highp float;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 cameraPos;
uniform float time;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, -9.1); a *= 0.5; }
  return s;
}
vec3 applyFog(vec3 col, vec3 pos) {
  float d = length(pos - cameraPos);
  float f = exp(-pow(d * fogDensity, 2.0));
  return mix(fogColor, col, clamp(f, 0.0, 1.0));
}
`

// the lamp and its two beams, as light falling on a surface point
const BEAMS = /* glsl */ `
uniform vec3 lampPos;
uniform vec3 lampColor;
uniform float lampBright;
uniform float beamAngle;
uniform float beamReach;
float beamOn(vec3 p) {
  vec2 d = p.xz - lampPos.xz;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  float acc = 0.0;
  for (int k = 0; k < 2; k++) {
    float da = abs(mod(ang - beamAngle - float(k) * 3.14159265 + 3.14159265, 6.2831853) - 3.14159265);
    float lat = sin(min(da, 1.5)) * dist;
    float w = 2.5 + dist * 0.075;
    acc += smoothstep(w, w * 0.15, lat) * step(da, 1.2) * smoothstep(beamReach, beamReach * 0.35, dist);
  }
  return acc * smoothstep(20.0, 70.0, dist);
}
`

const SEA_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform float waveAmp;
uniform vec2 waveCenter;
varying vec3 vPos;
varying vec3 vNormal;
varying float vCrest;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vec2 p = wp.xz;
  float fade = (1.0 - smoothstep(900.0, 2200.0, length(p - waveCenter))) * (1.0 - 0.75 * smoothstep(210.0, 110.0, p.y));
  float h = 0.0;
  vec2 g = vec2(0.0);
${waveGlsl()}
  wp.y += h * waveAmp * fade;
  g *= waveAmp * fade;
  vNormal = normalize(vec3(-g.x, 1.0, -g.y));
  vCrest = h / 2.07;
  vPos = wp.xyz;
  gl_Position = viewProjection * wp;
}
`

const SEA_FRAG = /* glsl */ `
${COMMON}
${BEAMS}
uniform vec3 seaDeep;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 moonDir;
uniform float moonAmt;
uniform vec3 glowColor;
uniform float glowAmt;
uniform vec3 sunDir;
uniform float flash;
uniform vec2 harbor;
uniform float harborGlow;
uniform float waveAmp;
varying vec3 vPos;
varying vec3 vNormal;
varying float vCrest;
void main() {
  // small ripples on top of the big waves
  vec2 q = vPos.xz * 0.12;
  float r1 = vnoise(q + vec2(time * 0.35, time * 0.2));
  float r2 = vnoise(q * 2.3 - vec2(time * 0.3, -time * 0.45));
  vec3 n = normalize(vNormal + vec3(r1 - 0.5, 0.0, r2 - 0.5) * (0.22 + 0.1 * waveAmp));
  vec3 v = normalize(cameraPos - vPos);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 refl = reflect(-v, n);
  refl.y = abs(refl.y);
  vec3 sky = mix(skyHorizon, skyTop, smoothstep(0.0, 0.35, refl.y));
  float band = 0.5 + 0.5 * sin(dot(vPos.xz, vec2(0.03, 0.05)) + vCrest * 2.0);
  vec3 col = seaDeep * (0.85 + 0.2 * band);
  col = mix(col, sky, 0.12 + 0.6 * fres);
  // cartoon crest highlights
  col += vec3(0.07, 0.11, 0.18) * smoothstep(0.35, 0.9, vCrest) * (0.6 + 0.4 * waveAmp);
  // the moon's path of glitter
  float m = max(dot(refl, moonDir), 0.0);
  float glint = step(0.72, vnoise(vPos.xz * 0.9 + time * 0.8));
  col += vec3(0.85, 0.88, 1.0) * moonAmt * (pow(m, 120.0) * (0.6 + 1.4 * glint) + pow(m, 18.0) * 0.07);
  // dawn and dusk on the water
  float s = max(dot(refl, sunDir), 0.0);
  col += glowColor * glowAmt * (pow(s, 40.0) * 1.2 + pow(s, 6.0) * 0.12);
  // the lamp: its reflection streak, the pool at its foot, and the beams sweeping the water
  vec3 toLamp = normalize(lampPos - vPos);
  float l = max(dot(refl, toLamp), 0.0);
  col += lampColor * lampBright * (pow(l, 90.0) * (0.8 + 1.2 * glint) + pow(l, 10.0) * 0.06);
  float dl = length(vPos.xz - lampPos.xz);
  col += lampColor * lampBright * 0.18 * smoothstep(160.0, 20.0, dl);
  col += lampColor * lampBright * beamOn(vPos) * (0.42 + 0.35 * glint);
  // harbour lights
  col += vec3(1.0, 0.72, 0.38) * harborGlow * smoothstep(150.0, 10.0, length(vPos.xz - harbor)) * (0.12 + 0.2 * glint);
  col += vec3(0.55, 0.6, 0.8) * flash * (0.25 + 0.6 * fres);
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}
`

const SKY_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform float time;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 glowColor;
uniform float glowAmt;
uniform vec3 sunDir;
uniform float sunUp;
uniform vec3 moonDir;
uniform float moonAmt;
uniform float starAmt;
uniform float cloudAmt;
uniform vec3 cloudColor;
uniform float aurora;
uniform float flash;
uniform vec3 fogColor;
uniform float fogAmt;
uniform vec4 shooting; // start azimuth, elevation, progress (0..1, <0 off), length
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, -9.1); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float az = atan(d.x, d.z);
  vec3 col = mix(skyHorizon, skyTop, smoothstep(-0.02, 0.32, h));
  // the warm glow of dusk / dawn, low in the east
  float sg = max(dot(d, sunDir), 0.0);
  col += glowColor * glowAmt * (pow(sg, 6.0) * 0.8 + exp(-max(h, 0.0) * 14.0) * 0.35 * smoothstep(-0.3, 0.9, d.x));
  // stars (bigger, brighter ones sparse)
  vec3 sd = d * 160.0;
  vec3 cell = floor(sd);
  float star = hash3(cell);
  vec3 f = fract(sd) - 0.5;
  float tw = 0.55 + 0.45 * sin(time * (1.3 + star * 4.0) + star * 60.0);
  float size = 0.12 + 0.16 * step(0.9975, star);
  float st = step(0.991, star) * smoothstep(size, 0.0, length(f)) * tw;
  col += mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.7), step(0.996, star)) * st * starAmt * smoothstep(0.005, 0.06, h) * 1.3;
  // a shooting star
  if (shooting.z >= 0.0) {
    float a0 = shooting.x, e0 = shooting.y;
    vec2 p = vec2(az, h);
    vec2 head = vec2(a0 - shooting.z * shooting.w, e0 - shooting.z * shooting.w * 0.35);
    vec2 dir = normalize(vec2(-1.0, -0.35));
    vec2 rel = p - head;
    float along = dot(rel, -dir);
    float lat = abs(dot(rel, vec2(-dir.y, dir.x)));
    float trail = smoothstep(0.0012, 0.0, lat) * smoothstep(0.12, 0.0, along) * step(0.0, along) * (1.0 - shooting.z);
    col += vec3(1.0, 0.95, 0.85) * trail * 1.5;
  }
  // aurora curtains
  if (aurora > 0.0) {
    float x = az * 3.0;
    float curtain = fbm(vec2(x * 2.0 + time * 0.03, time * 0.02));
    float wave = sin(x * 5.0 + fbm(vec2(x, time * 0.05)) * 6.0 + time * 0.2) * 0.5 + 0.5;
    float base = 0.02 + 0.03 * curtain;
    float top = base + 0.08 + 0.1 * wave;
    float band = smoothstep(base, base + 0.01, h) * smoothstep(top, base + 0.02, h);
    float rays = 0.6 + 0.4 * vnoise(vec2(az * 90.0, time * 0.3));
    vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.7, 0.3, 1.0), smoothstep(base + 0.02, top, h));
    col += ac * band * rays * aurora * (0.35 + 0.4 * curtain) * smoothstep(-0.9, -0.2, az) * smoothstep(0.9, 0.2, az);
  }
  // the moon: a disc with soft craters and a halo
  float md = dot(d, normalize(moonDir));
  float disc = smoothstep(0.99955, 0.99968, md);
  vec2 mp = vec2(dot(d, normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)))), d.y - moonDir.y) * 110.0;
  float crater = 1.0 - 0.18 * smoothstep(0.55, 0.75, vnoise(mp * 14.0));
  col = mix(col, vec3(0.98, 0.93, 0.78) * crater * 0.92, disc * max(moonAmt, 0.25));
  col += vec3(0.55, 0.6, 0.85) * (pow(max(md, 0.0), 2000.0) * 0.45 + pow(max(md, 0.0), 60.0) * 0.14) * moonAmt;
  // the sun at dawn
  col += vec3(1.0, 0.85, 0.5) * smoothstep(0.9993, 0.9996, sg) * smoothstep(-0.2, 0.2, sunUp) * 2.0;
  // clouds on a plane above
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.06) * 0.9 + vec2(time * 0.012, time * 0.004);
    float c = fbm(cp * 0.9);
    float cov = smoothstep(1.0 - cloudAmt * 0.95, 1.18 - cloudAmt * 0.6, c);
    vec3 cc = cloudColor * (0.8 + 0.4 * fbm(cp * 2.1 + 3.0));
    cc += vec3(0.7, 0.75, 0.95) * moonAmt * 0.25 * pow(max(md, 0.0), 8.0);
    cc += glowColor * glowAmt * 0.5 * pow(sg, 3.0);
    cc += vec3(0.8, 0.85, 1.0) * flash;
    col = mix(col, cc, cov * smoothstep(0.0, 0.05, h) * 0.92);
  }
  // far hills: west cliffs and a low eastern shore, fogged into the horizon
  float ridgeW = (0.018 + 0.03 * fbm(vec2(az * 6.0, 1.0))) * smoothstep(-0.25, -0.55, az) * smoothstep(-1.7, -1.0, az);
  float ridgeE = (0.008 + 0.02 * fbm(vec2(az * 9.0, 5.0))) * smoothstep(0.5, 0.95, az);
  float ridge = max(ridgeW, ridgeE);
  if (h >= 0.0 && h < ridge) col = mix(skyHorizon * 0.55 + vec3(0.02, 0.02, 0.05), skyHorizon, 0.35 + 0.5 * fogAmt);
  col = mix(col, fogColor, fogAmt * (1.0 - smoothstep(0.0, 0.25, h)));
  // below the horizon (past the sea's far edge) the sky is the sea's haze
  if (h < 0.0) col = fogColor;
  gl_FragColor = vec4(col, 1.0);
}
`

const BEAM_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vPos;
varying vec3 vNormal;
varying float vAlong;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vNormal = normalize(mat3(world) * normal);
  vAlong = position.z;
  gl_Position = viewProjection * wp;
}
`

const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform vec3 cameraPos;
uniform vec3 beamColor;
uniform float intensity;
uniform float time;
varying vec3 vPos;
varying vec3 vNormal;
varying float vAlong;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 v = normalize(cameraPos - vPos);
  float facing = abs(dot(normalize(vNormal), v));
  float soft = pow(facing, 1.6);
  float along = clamp(vAlong, 0.0, 1.0);
  float fall = pow(1.0 - along, 1.4) * smoothstep(0.0, 0.02, along);
  float dust = 0.93 + 0.07 * sin(vAlong * 23.0 - time * 1.1);
  float a = intensity * soft * fall * dust;
  gl_FragColor = vec4(beamColor * a, a);
}
`

const FOAM_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
varying vec3 vPos;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vUV = uv;
  gl_Position = viewProjection * wp;
}
`

// a ring of surf: uv.x goes around, uv.y goes from the rock outward
const FOAM_FRAG = /* glsl */ `
${COMMON}
${BEAMS}
uniform vec3 foamColor;
uniform float foamAmt;
uniform vec3 danger;
uniform float seed;
varying vec2 vUV;
varying vec3 vPos;
void main() {
  float r = vUV.y;
  float around = vUV.x;
  float n = vnoise(vec2(around * 14.0 + seed, r * 3.0 - time * 0.6));
  float pulse = 0.5 + 0.5 * sin(time * 1.3 + seed + around * 6.2831 * 2.0);
  float edge = smoothstep(0.0, 0.12, r) * (1.0 - smoothstep(0.35 + 0.35 * pulse, 0.95, r));
  float bits = smoothstep(0.45, 0.75, n + 0.25 * (1.0 - r));
  float a = edge * bits * foamAmt;
  vec3 col = foamColor + lampColor * lampBright * beamOn(vPos) * 0.8 + danger;
  a = clamp(a, 0.0, 1.0);
  vec3 fogged = applyFog(col, vPos);
  float vis = exp(-pow(length(vPos - cameraPos) * fogDensity, 2.0));
  gl_FragColor = vec4(fogged, a * (0.35 + 0.65 * vis));
}
`

let registered = false
function register(): void {
  if (registered) return
  registered = true
  Effect.ShadersStore['nwSeaVertexShader'] = SEA_VERT
  Effect.ShadersStore['nwSeaFragmentShader'] = SEA_FRAG
  Effect.ShadersStore['nwSkyVertexShader'] = SKY_VERT
  Effect.ShadersStore['nwSkyFragmentShader'] = SKY_FRAG
  Effect.ShadersStore['nwBeamVertexShader'] = BEAM_VERT
  Effect.ShadersStore['nwBeamFragmentShader'] = BEAM_FRAG
  Effect.ShadersStore['nwFoamVertexShader'] = FOAM_VERT
  Effect.ShadersStore['nwFoamFragmentShader'] = FOAM_FRAG
}

const FOG = ['fogColor', 'fogDensity', 'cameraPos', 'time']
const LAMP = ['lampPos', 'lampColor', 'lampBright', 'beamAngle', 'beamReach']

export function seaMaterial(scene: Scene): ShaderMaterial {
  register()
  return new ShaderMaterial('sea', scene, { vertex: 'nwSea', fragment: 'nwSea' }, {
    attributes: ['position'],
    uniforms: ['world', 'viewProjection', ...FOG, ...LAMP, 'waveAmp', 'waveCenter', 'seaDeep', 'skyTop', 'skyHorizon', 'moonDir', 'moonAmt',
      'glowColor', 'glowAmt', 'sunDir', 'flash', 'harbor', 'harborGlow'],
  })
}

export function skyMaterial(scene: Scene): ShaderMaterial {
  register()
  const m = new ShaderMaterial('sky', scene, { vertex: 'nwSky', fragment: 'nwSky' }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'time', 'skyTop', 'skyHorizon', 'glowColor', 'glowAmt', 'sunDir', 'sunUp', 'moonDir', 'moonAmt', 'starAmt',
      'cloudAmt', 'cloudColor', 'aurora', 'flash', 'fogColor', 'fogAmt', 'shooting'],
  })
  m.backFaceCulling = false
  m.disableDepthWrite = true
  return m
}

export function beamMaterial(scene: Scene): ShaderMaterial {
  register()
  const m = new ShaderMaterial('beam', scene, { vertex: 'nwBeam', fragment: 'nwBeam' }, {
    attributes: ['position', 'normal'],
    uniforms: ['world', 'viewProjection', 'cameraPos', 'beamColor', 'intensity', 'time'],
    needAlphaBlending: true,
  })
  m.backFaceCulling = false
  m.disableDepthWrite = true
  m.alphaMode = Constants.ALPHA_ADD
  return m
}

export function foamMaterial(scene: Scene, name: string): ShaderMaterial {
  register()
  const m = new ShaderMaterial(name, scene, { vertex: 'nwFoam', fragment: 'nwFoam' }, {
    attributes: ['position', 'uv'],
    uniforms: ['world', 'viewProjection', ...FOG, ...LAMP, 'foamColor', 'foamAmt', 'danger', 'seed'],
    needAlphaBlending: true,
  })
  m.backFaceCulling = false
  m.disableDepthWrite = true
  return m
}
