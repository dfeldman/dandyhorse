/**
 * The sky: a gradient, a sun, and clouds, all worked out per pixel from the direction the eye is looking.
 *
 * It was a colour gradient painted into the dome's vertices, which is fine for a flat blue and cannot do
 * either of the two things that most make a sky read as one. A sun is a small bright disc with a wide soft
 * halo, and a dome with twenty segments does not have vertices anywhere near dense enough to carry a disc.
 * Clouds are a pattern that has to move. Both want the fragment shader.
 *
 * **Clouds are a painted layer, not volumes.** A cloud deck at a fixed height is intersected by the view ray
 * and the point it hits is looked up in a few octaves of noise. That gives the thing that matters — clouds
 * that shrink and crowd together toward the horizon the way real ones do, because the same deck is further
 * away there — at the cost of a handful of noise reads, which is nothing next to what a volumetric sky costs.
 * They are lit from the sun's side: brighter where the sun is behind them, and with darker undersides, which
 * is most of what separates a cloud from a smudge.
 *
 * The sun never moves in this game (see render/sky.ts for why), so neither does its disc. The clouds drift,
 * slowly, because a sky that is completely still reads as a painting of one.
 */
import {
  type AbstractEngine,
  Color3,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  type Scene,
  ShaderLanguage,
  type SubMesh,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core'
import { Config } from '../../config.ts'

export class SkyPlugin extends MaterialPluginBase {
  readonly horizon = new Color3(0.8, 0.86, 0.92)
  readonly zenith = new Color3(0.36, 0.58, 0.86)
  /** the way the sunlight travels; looking along the opposite of this is looking at the sun */
  readonly sun = new Vector3(0, -1, 0)
  readonly sunColour = new Color3(1, 0.96, 0.86)
  /** seconds, for the clouds' drift */
  time = 0
  /** 0 a clear sky, 1 overcast */
  cover = 0.45

  constructor(material: Material) {
    super(material, 'Sky', 100, { SKYSHADE: true })
    this._enable(true)
  }

  override getClassName(): string { return 'SkyPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.SKYSHADE = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'skyHorizon', size: 3, type: 'vec3' },
      { name: 'skyTime', size: 1, type: 'float' },
      { name: 'skyZenith', size: 3, type: 'vec3' },
      { name: 'skyCover', size: 1, type: 'float' },
      { name: 'skySun', size: 3, type: 'vec3' },
      { name: 'skyCloudScale', size: 1, type: 'float' },
      { name: 'skySunColour', size: 3, type: 'vec3' },
      { name: 'skyBrightness', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef SKYSHADE
uniform vec3 skyHorizon;
uniform float skyTime;
uniform vec3 skyZenith;
uniform float skyCover;
uniform vec3 skySun;
uniform float skyCloudScale;
uniform vec3 skySunColour;
uniform float skyBrightness;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateColor3('skyHorizon', this.horizon)
    uniformBuffer.updateFloat('skyTime', this.time)
    uniformBuffer.updateColor3('skyZenith', this.zenith)
    uniformBuffer.updateFloat('skyCover', this.cover)
    uniformBuffer.updateVector3('skySun', this.sun)
    uniformBuffer.updateFloat('skyCloudScale', Config.cloudScale)
    uniformBuffer.updateColor3('skySunColour', this.sunColour)
    uniformBuffer.updateFloat('skyBrightness', Config.skyBrightness)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    if (wgsl) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
fn skyHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn skyNoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = skyHash(i); let b = skyHash(i + vec2f(1.0, 0.0));
  let c = skyHash(i + vec2f(0.0, 1.0)); let d = skyHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn skyFbm(q: vec2f) -> f32 {
  var p = q; var v = 0.0; var a = 0.5;
  for (var k = 0; k < 5; k++) { v = v + a * skyNoise(p); p = p * 2.03 + vec2f(1.7, 9.2); a = a * 0.5; }
  return v;
}
`,
        CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef SKYSHADE
{
  let sd = normalize(fragmentInputs.vPositionW - scene.vEyePosition.xyz);
  let up = max(sd.y, 0.0);
  var sc = mix(uniforms.skyHorizon, uniforms.skyZenith, pow(up, 0.5));
  let toSun = normalize(-uniforms.skySun);
  let cs = max(dot(sd, toSun), 0.0);
  sc = sc + uniforms.skySunColour * (pow(cs, 9.0) * 0.28 + pow(cs, 80.0) * 0.6);
  if (sd.y > 0.012) {
    let t = min(1.0 / sd.y, 9.0);
    let p = sd.xz * t * uniforms.skyCloudScale + vec2f(uniforms.skyTime * 0.006, uniforms.skyTime * 0.0023);
    let n = skyFbm(p);
    let dens = smoothstep(1.0 - uniforms.skyCover, 1.0 - uniforms.skyCover + 0.16, n);
    let lit = skyFbm(p + toSun.xz * 0.18);
    let shade = clamp(0.62 + (n - lit) * 2.2, 0.35, 1.08);
    let cloud = mix(vec3f(0.64, 0.68, 0.76), vec3f(1.0, 0.99, 0.96), shade) + uniforms.skySunColour * pow(cs, 6.0) * 0.35;
    let fade = smoothstep(0.012, 0.14, sd.y);
    sc = mix(sc, cloud, dens * fade);
  }
  let disc = smoothstep(0.99955, 0.99975, cs);
  sc = mix(sc, uniforms.skySunColour * 1.6, disc);
  color = vec4f(sc * uniforms.skyBrightness, 1.0);
}
#endif
`,
      }
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = skyHash(i); float b = skyHash(i + vec2(1.0, 0.0));
  float c = skyHash(i + vec2(0.0, 1.0)); float d = skyHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float skyFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int k = 0; k < 5; k++) { v += a * skyNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef SKYSHADE
{
  vec3 sd = normalize(vPositionW - vEyePosition.xyz);
  float up = max(sd.y, 0.0);
  vec3 sc = mix(skyHorizon, skyZenith, pow(up, 0.5));
  vec3 toSun = normalize(-skySun);
  float cs = max(dot(sd, toSun), 0.0);
  // the halo, wide and faint, and a tighter glow around the disc
  sc += skySunColour * (pow(cs, 9.0) * 0.28 + pow(cs, 80.0) * 0.6);
  if (sd.y > 0.012) {
    // where the view ray meets a flat deck of cloud overhead; further away toward the horizon, so smaller
    // Clamped, and this matters. A flat deck seen at a shallow angle runs away to infinity, and the noise
    // with it: the clouds stretch into thin streaks along the horizon and read as scratches on glass rather
    // than as weather. Holding the projection short keeps them cloud-shaped all the way down.
    float t = min(1.0 / sd.y, 9.0);
    vec2 p = sd.xz * t * skyCloudScale + vec2(skyTime * 0.006, skyTime * 0.0023);
    float n = skyFbm(p);
    float dens = smoothstep(1.0 - skyCover, 1.0 - skyCover + 0.16, n);
    // lit from the sun's side: sample a little toward the sun, and the difference is the cloud's relief
    float lit = skyFbm(p + toSun.xz * 0.18);
    float shade = clamp(0.62 + (n - lit) * 2.2, 0.35, 1.08);
    vec3 cloud = mix(vec3(0.64, 0.68, 0.76), vec3(1.0, 0.99, 0.96), shade) + skySunColour * pow(cs, 6.0) * 0.35;
    // and thinning out into the haze at the horizon, where the deck would be too far to resolve
    float fade = smoothstep(0.012, 0.14, sd.y);
    sc = mix(sc, cloud, dens * fade);
  }
  float disc = smoothstep(0.99955, 0.99975, cs);
  sc = mix(sc, skySunColour * 1.6, disc);
  color = vec4(sc * skyBrightness, 1.0);
}
#endif
`,
    }
  }
}
