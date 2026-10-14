/**
 * The material every body and wheel is drawn with: flat, saturated, a little glossy, like a toy.
 *
 * It is lit the same way as Street Runner's cartoon material (a flat sun, a sky/ground hemisphere and a rim
 * light), so the cars sit in the city without looking pasted on, and `setCarLook` takes the same numbers the
 * game already keeps for its sky. Two things are its own:
 *
 * - **Glass is opaque.** Dark, with the sky reflected in it by the angle you see it at, and a sun glint. Nobody
 *   is ever drawn inside, and nothing behind it needs sorting.
 * - **Lamps are live.** Each face carries a role (geometry/builder.ts) and each copy a light state, so brake
 *   lamps, indicators, headlamps, reversing lamps, beacons and roof signs light per vehicle with no extra draw.
 *   Indicators flash at 1.5 Hz with a per-vehicle phase, so a queue at a junction doesn't blink in unison.
 *
 * Per-copy attributes (thin instances): `paint` = rgb + blink phase, `paint2` = rgb + unused,
 * `lights` = (brake, indicator 0 off/1 left/2 right/3 hazard, headlights, flags: 1 reverse + 2 beacon + 4 sign).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
attribute float role;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 paint;
attribute vec4 paint2;
attribute vec4 lights;
uniform mat4 viewProjection;
uniform float time;
uniform float night;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vBase;
varying vec3 vEmit;
varying float vGlass;
varying float vAO;
varying vec3 vLocal;
varying vec3 vLocalN;
varying float vBands;
varying float vPainted;

float flash(float t, float hz) { return step(0.5, fract(t * hz)); }
bool is(float r, float k) { return abs(r - k) < 0.5; }

void main(void) {
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 wp = W * vec4(position, 1.0);
  vPos = wp.xyz;
  vNormal = normalize(transpose(inverse(mat3(W))) * normal);
  gl_Position = viewProjection * wp;
  vLocal = position;
  vLocalN = normal;
  vBands = paint2.a;
  vPainted = (is(role, 1.0) || is(role, 2.0) || is(role, 3.0)) ? 1.0 : 0.0;

  // grounding: the lower body darkens towards the road (colour alpha 0 opts out: the wheels' unit space)
  vAO = mix(1.0, mix(0.62, 1.0, smoothstep(0.08, 0.8, position.y)), color.a);
  vec3 base = color.rgb;
  vec3 emit = vec3(0.0);
  vGlass = 0.0;
  float brake = lights.x, ind = lights.y, head = lights.z, flags = lights.w;
  float reverse = mod(flags, 2.0);
  float beacon = mod(floor(flags / 2.0), 2.0);
  float signOn = mod(floor(flags / 4.0), 2.0);
  float blink = flash(time + paint.w, 1.5);
  float strobe = flash(time + paint.w, 2.5);
  bool left = abs(ind - 1.0) < 0.5 || abs(ind - 3.0) < 0.5;
  bool right = abs(ind - 2.0) < 0.5 || abs(ind - 3.0) < 0.5;

  if (is(role, 1.0)) base = paint.rgb;
  else if (is(role, 2.0)) base = paint2.rgb;
  else if (is(role, 3.0)) vGlass = 1.0;
  else if (is(role, 4.0)) emit = vec3(1.0, 0.96, 0.82) * head * 1.3;
  else if (is(role, 5.0)) emit = vec3(1.0, 0.04, 0.02) * max(brake * 1.5, head * 0.45);
  else if (is(role, 6.0)) emit = left ? vec3(1.0, 0.42, 0.0) * blink * 1.25 : vec3(0.0);
  else if (is(role, 7.0)) emit = right ? vec3(1.0, 0.42, 0.0) * blink * 1.25 : vec3(0.0);
  else if (is(role, 8.0)) emit = vec3(1.0) * reverse;
  // a beacon glows in its own built colour, so police blue, ambulance red and school-bus red share the roles
  else if (is(role, 9.0)) emit = normalize(color.rgb) * beacon * strobe * 1.8;
  else if (is(role, 10.0)) emit = normalize(color.rgb) * beacon * (1.0 - strobe) * 1.8;
  else if (is(role, 11.0)) emit = vec3(1.0, 0.92, 0.6) * max(signOn, night) * 0.9;
  vBase = base;
  vEmit = emit;
}
`

const FRAGMENT = `
precision highp float;
uniform vec3 eye;
uniform vec3 sunDir;
uniform vec3 sunColour;
uniform vec3 skyColour;
uniform vec3 groundColour;
uniform vec3 fogColour;
uniform float fogDensity;
uniform float night;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vBase;
varying vec3 vEmit;
varying float vGlass;
varying float vAO;
varying vec3 vLocal;
varying vec3 vLocalN;
varying float vBands;
varying float vPainted;

/** What a glossy surface sees in direction r: sky above a crisp horizon, ground below. */
vec3 environment(vec3 r) {
  vec3 horizon = mix(skyColour, vec3(1.0), 0.15);
  vec3 up = mix(horizon, skyColour * 0.9, smoothstep(0.0, 0.6, r.y));
  vec3 down = groundColour * 0.45;
  return mix(down, up, smoothstep(-0.02, 0.02, r.y));
}

void main(void) {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(eye - vPos);
  float ndv = max(dot(N, V), 0.0);
  float nl = dot(N, sunDir);
  // a wrapped sun: the shaded side keeps some shape instead of falling to flat ambient
  float diffuse = max(nl, 0.0) * 0.8 + (nl * 0.5 + 0.5) * 0.2;
  vec3 hemi = mix(groundColour, skyColour, N.y * 0.5 + 0.5);
  vec3 light = sunColour * diffuse + hemi;
  vec3 R = reflect(-V, N);
  float glint = max(dot(R, sunDir), 0.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 col;
  vec3 base = vBase;
  float glass = vGlass;
  /*
   * A BANDED LIVERY, painted here rather than built (owner, 2026-10-05: Muni's two red stripes as boxes "read as panels
   * … the red sticks out past the chassis"). On the body's side and back faces (not the front, roof or underside) by
   * the height in the model: a broad red band from the window heads to under the roof, which shortens the windows as
   * on the real bus, and a red skirt from the sill to below the windows. vBands is the body's height.
   */
  if (vBands > 0.5 && vPainted > 0.5 && abs(vLocalN.y) < 0.6 && vLocalN.z < 0.7) {
    float H = vBands, y = vLocal.y;
    bool top = y > 0.71 * H && y < 0.87 * H;
    bool skirt = y > 0.1 && y < 0.27 * H;
    if (top || skirt) { base = vec3(0.8, 0.1, 0.09); glass = 0.0; }
    // above the band the body is silver to the roof: the side glass stops at the band
    else if (y >= 0.87 * H && glass > 0.5) { base = vec3(0.7, 0.71, 0.72); glass = 0.0; }
  }
  if (glass > 0.5) {
    // opaque, tinted glass: mostly what it reflects, a crisp horizon line across it, and the sun
    // a blue-grey tint, a shade lighter than a black roof, so windows read against black pillars
    vec3 tint = vec3(0.13, 0.16, 0.21);
    col = tint * light + environment(R) * (0.05 + 0.3 * fres) + sunColour * pow(glint, 160.0) * 1.0;
  } else {
    col = base * light;
    // clear coat: a little sky in the paint at grazing angles, and a soft sun highlight
    col += environment(R) * (0.03 + 0.22 * fres);
    col += sunColour * pow(glint, 40.0) * 0.28;
  }
  col *= vAO;
  col *= 1.0 - night * 0.68;
  col += vEmit;
  float d = length(eye - vPos) * fogDensity;
  col = mix(fogColour, col, exp(-d * d));
  gl_FragColor = vec4(col, 1.0);
}
`

const SHADOW_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
uniform mat4 viewProjection;
varying vec2 vUV;
void main(void) {
  mat4 W = mat4(world0, world1, world2, world3);
  vUV = uv * 2.0 - 1.0;
  gl_Position = viewProjection * W * vec4(position, 1.0);
}
`
const SHADOW_FRAGMENT = `
precision highp float;
uniform float strength;
varying vec2 vUV;
void main(void) {
  // a rounded rectangle, soft at the edge: a car's footprint, not a disc
  vec2 q = abs(vUV);
  float d = length(max(q - vec2(0.55, 0.7), 0.0)) / 0.45;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * strength;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`

/** The sky the cars are lit by. Same fields Street Runner keeps in its `SkyLook`. */
export interface CarLook {
  /** unit vector TOWARDS the sun */
  sun: Vector3
  sunColour: Color3
  skyColour: Color3
  groundColour: Color3
  fogColour: Color3
  fogDensity: number
  /** 0 day … 1 full night: dims the paint, and lights roof signs */
  night: number
}

export const DEFAULT_LOOK: CarLook = {
  sun: new Vector3(-0.5, 0.78, -0.38).normalize(),
  sunColour: new Color3(0.72, 0.69, 0.63),
  skyColour: new Color3(0.56, 0.6, 0.68),
  groundColour: new Color3(0.4, 0.38, 0.35),
  fogColour: new Color3(0.8, 0.84, 0.9),
  fogDensity: 0.0015,
  night: 0,
}

let registered = false
function register(): void {
  if (registered) return
  Effect.ShadersStore['carkitVertexShader'] = VERTEX
  Effect.ShadersStore['carkitFragmentShader'] = FRAGMENT
  Effect.ShadersStore['carkitShadowVertexShader'] = SHADOW_VERTEX
  Effect.ShadersStore['carkitShadowFragmentShader'] = SHADOW_FRAGMENT
  registered = true
}

export function carMaterial(scene: Scene, name = 'carkit'): ShaderMaterial {
  register()
  const mat = new ShaderMaterial(name, scene, 'carkit', {
    attributes: ['position', 'normal', 'color', 'role', 'world0', 'world1', 'world2', 'world3', 'paint', 'paint2', 'lights'],
    uniforms: ['viewProjection', 'eye', 'time', 'sunDir', 'sunColour', 'skyColour', 'groundColour', 'fogColour',
      'fogDensity', 'night'],
  })
  mat.backFaceCulling = true
  mat.depthFunction = Constants.LEQUAL
  setCarLook(mat, DEFAULT_LOOK)
  mat.setFloat('time', 0)
  return mat
}

export function setCarLook(mat: ShaderMaterial, look: CarLook): void {
  mat.setVector3('sunDir', look.sun)
  mat.setColor3('sunColour', look.sunColour)
  mat.setColor3('skyColour', look.skyColour)
  mat.setColor3('groundColour', look.groundColour)
  mat.setColor3('fogColour', look.fogColour)
  mat.setFloat('fogDensity', look.fogDensity)
  mat.setFloat('night', look.night)
}

export function shadowMaterial(scene: Scene, strength = 0.42): ShaderMaterial {
  register()
  const mat = new ShaderMaterial('carkitShadow', scene, 'carkitShadow', {
    attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
    uniforms: ['viewProjection', 'strength'],
    needAlphaBlending: true,
  })
  mat.setFloat('strength', strength)
  mat.alphaMode = Constants.ALPHA_COMBINE
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  return mat
}
