/**
 * Aerial perspective: what distance does to colour.
 *
 * Babylon's fog blends everything toward one colour by distance, which is most of the effect and not all of
 * it. Air does three things to a far hillside, and only one of them is a blend. It washes the colour toward
 * the sky's, yes — but it also takes the SATURATION out first, so a green slope two kilometres away is grey
 * before it is pale; and the haze it adds is not one colour, because scattered light is brighter and warmer
 * looking toward the sun than away from it. Leave those two out and the far side of the Romanche valley is
 * the same green as the verge, only lighter, which is exactly what it looked like before this existed.
 *
 * So the scene's own fog is turned off for anything that uses this, and the whole term is done here. That is
 * also why it has to be a fragment-shader plugin rather than a tweak to `scene.fogColor`: the sun tint depends
 * on which way the pixel is from the camera, and a scene-wide colour cannot know that.
 *
 * Everything it needs is already in the standard material's fragment shader — the world position of the pixel
 * and the eye — so it costs a handful of instructions and no extra varyings.
 *
 * **The haze is the sky, in the direction being looked.** It was one flat colour, and that is what made the
 * Alps look wrong: a ridge four kilometres off saturated to a pale constant that was BRIGHTER than the sky
 * behind it, which no amount of air can do — haze converges on the sky's own radiance and can never overshoot
 * it. A mountain lit like that reads as a hole cut in the world. So the same gradient the dome is painted with
 * is evaluated here from the pixel's own direction, and a distant ridge now fades into exactly whatever is
 * behind it: pale at the horizon, bluer where it stands against the upper sky.
 *
 * And it never fades the whole way. `aerialKeep` holds a little of the surface's own colour back at any
 * distance, because a far mountain is not a silhouette — you can see where the snow is on it, and the
 * difference between a ridge in sun and one in shade, forty kilometres away. Saturating completely throws away
 * the shape of the thing, which is the whole reason it is on the skyline.
 */
import {
  type AbstractEngine,
  Color3,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  type Scene,
  ShaderLanguage,
  type StandardMaterial,
  type SubMesh,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core'
import { Config } from '../../config.ts'
import type { BiomePalette } from '../palette.ts'

class AerialPlugin extends MaterialPluginBase {
  /** the sky at the horizon, which is what a distant thing at eye level fades into */
  readonly haze = new Color3(0.8, 0.85, 0.9)
  /** and the sky overhead, for a mountain whose top stands against it */
  readonly zenith = new Color3(0.36, 0.58, 0.86)
  /** the warmer haze looking into the sun */
  readonly glow = new Color3(1, 0.95, 0.85)
  /** the way the sunlight travels, so looking along it is looking away from the sun */
  readonly sun = new Vector3(0, -1, 0)
  /** how quickly the air thickens: the same per-biome number the scene's fog used */
  density = 0.001

  constructor(material: Material) {
    super(material, 'Aerial', 210, { AERIAL: true })
    this._enable(true)
  }

  override getClassName(): string { return 'AerialPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.AERIAL = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'aerialHaze', size: 3, type: 'vec3' },
      { name: 'aerialDensity', size: 1, type: 'float' },
      { name: 'aerialGlow', size: 3, type: 'vec3' },
      { name: 'aerialSaturation', size: 1, type: 'float' },
      { name: 'aerialSun', size: 3, type: 'vec3' },
      { name: 'aerialGlowStrength', size: 1, type: 'float' },
      { name: 'aerialZenith', size: 3, type: 'vec3' },
      { name: 'aerialKeep', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef AERIAL
uniform vec3 aerialHaze;
uniform float aerialDensity;
uniform vec3 aerialGlow;
uniform float aerialSaturation;
uniform vec3 aerialSun;
uniform float aerialGlowStrength;
uniform vec3 aerialZenith;
uniform float aerialKeep;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateColor3('aerialHaze', this.haze)
    uniformBuffer.updateFloat('aerialDensity', this.density)
    uniformBuffer.updateColor3('aerialGlow', this.glow)
    uniformBuffer.updateFloat('aerialSaturation', Config.aerialDesaturation)
    uniformBuffer.updateVector3('aerialSun', this.sun)
    uniformBuffer.updateFloat('aerialGlowStrength', Config.aerialGlow)
    uniformBuffer.updateColor3('aerialZenith', this.zenith)
    uniformBuffer.updateFloat('aerialKeep', Config.aerialKeep)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    // the maths, once, in the language-neutral order it is written in below:
    //   t      how much air is between the eye and this pixel, 0 near and 1 far
    //   grey   the colour with the life taken out of it, which is what happens first
    //   glow   haze looking toward the sun is brighter and warmer than haze looking away
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef AERIAL
{
  let aToEye: vec3f = fragmentInputs.vPositionW - scene.vEyePosition.xyz;
  let aD: f32 = length(aToEye);
  let aDir: vec3f = normalize(aToEye);
  let aT: f32 = (1.0 - exp(-(aD * uniforms.aerialDensity) * (aD * uniforms.aerialDensity))) * uniforms.aerialKeep;
  let aLum: f32 = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  var aRgb: vec3f = mix(color.rgb, vec3f(aLum), aT * uniforms.aerialSaturation);
  let aToSun: f32 = max(0.0, dot(aDir, -uniforms.aerialSun));
  let aSky: vec3f = mix(uniforms.aerialHaze, uniforms.aerialZenith, pow(max(0.0, aDir.y), 0.5));
  let aHaze: vec3f = mix(aSky, uniforms.aerialGlow, pow(aToSun, 4.0) * uniforms.aerialGlowStrength);
  aRgb = mix(aRgb, aHaze, aT);
  color = vec4f(aRgb, color.a);
}
#endif
`,
      }
    }
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef AERIAL
{
  vec3 aToEye = vPositionW - vEyePosition.xyz;
  float aD = length(aToEye);
  vec3 aDir = normalize(aToEye);
  float aT = (1.0 - exp(-(aD * aerialDensity) * (aD * aerialDensity))) * aerialKeep;
  float aLum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 aRgb = mix(color.rgb, vec3(aLum), aT * aerialSaturation);
  float aToSun = max(0.0, dot(aDir, -aerialSun));
  vec3 aSky = mix(aerialHaze, aerialZenith, pow(max(0.0, aDir.y), 0.5));
  vec3 aHaze = mix(aSky, aerialGlow, pow(aToSun, 4.0) * aerialGlowStrength);
  aRgb = mix(aRgb, aHaze, aT);
  color.rgb = aRgb;
}
#endif
`,
    }
  }
}

/**
 * The air, shared by everything standing in it.
 *
 * One of these exists per scene. Every material that is part of the world attaches to it, and when the rider
 * crosses into another biome they all change together — which they have to, or the road would haze differently
 * from the grass beside it.
 */
export class Atmosphere {
  private readonly plugins: AerialPlugin[] = []
  private readonly sun = new Vector3(0, -1, 0)
  private palette: BiomePalette | null = null

  /** Put the air on a material, and turn off the scene fog it replaces. */
  attach(material: StandardMaterial): void {
    // the scene's own fog would blend to a flat colour on top of this one, twice
    material.fogEnabled = false
    const plugin = new AerialPlugin(material)
    this.plugins.push(plugin)
    if (this.palette) this.apply(plugin)
    plugin.sun.copyFrom(this.sun)
  }

  setSun(direction: Vector3): void {
    this.sun.copyFrom(direction).normalize()
    for (const p of this.plugins) p.sun.copyFrom(this.sun)
  }

  setBiome(palette: BiomePalette): void {
    this.palette = palette
    for (const p of this.plugins) this.apply(p)
  }

  private apply(p: AerialPlugin): void {
    const palette = this.palette
    if (!palette) return
    /**
     * The sky the dome is actually painted with, not the palette's haze colour.
     *
     * render/sky.ts builds its gradient as horizon = lerp(haze, sky, 0.25), zenith = sky × 0.82, and then
     * multiplies the whole thing by `skyBrightness` in the shader. The air has to arrive at the same two
     * colours or the ground and the sky meet at a visible step — which they did, and the ground was the
     * brighter of the two.
     */
    Color3.LerpToRef(palette.haze, palette.sky, 0.25, p.haze)
    p.haze.scaleInPlace(Config.skyBrightness)
    p.zenith.copyFrom(palette.sky).scaleInPlace(0.82 * Config.skyBrightness)
    // the bright side of the haze: the same air, lit
    Color3.LerpToRef(p.haze, Color3.White(), 0.4, p.glow)
    p.density = palette.fog * Config.aerialDensityScale
  }
}
