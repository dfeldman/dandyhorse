/**
 * The surface of water.
 *
 * Almost everything that makes water read as water happens in the two or three centimetres at the top of it,
 * and none of it is the colour blue. What the eye actually uses, in order of how much it matters:
 *
 * 1. **It reflects the sky, and more of it the further along the surface you look.** That is the Fresnel term,
 *    and it is why a river is silver-white toward the far bank and dark green at your feet. Get this one right
 *    and a flat plane with no other trick on it already reads as water; get it wrong and no amount of ripple
 *    texture saves it.
 * 2. **It ripples, and the ripples move the reflection rather than the surface.** The displacement of a real
 *    ripple is a centimetre and invisible at any distance; what you see is the NORMAL turning, which swings
 *    the reflected sky about by tens of degrees. So this shader does not move a single vertex. It perturbs the
 *    normal with a handful of travelling waves, which costs a few instructions and has exact derivatives.
 * 3. **The sun, in one hard bright point that breaks into a path of sparks.** A specular highlight with a very
 *    high exponent on a rippled normal does this by itself.
 * 4. **It gets darker and greener as it deepens, and you can see the bed through the shallows.** Depth comes
 *    from the geometry — the vertex knows how far the ground is below the surface (see render/water.ts) — and
 *    it drives both the colour and the transparency, so the edge of a lake is where the bed rises through it
 *    rather than where a polygon happens to stop.
 *
 * The sky it reflects is the same gradient the dome is painted with and the same one the air fades into
 * (render/materials/aerial.ts), because water reflecting a different sky from the one overhead is the fastest
 * way to make a landscape look assembled from parts.
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

export class WaterPlugin extends MaterialPluginBase {
  /** seconds, ever increasing */
  time = 0
  /** the sky this water is under, at the horizon and overhead */
  readonly horizon = new Color3(0.8, 0.85, 0.9)
  readonly zenith = new Color3(0.36, 0.58, 0.86)
  /** the colour of the water itself, shallow and deep */
  readonly shallow = new Color3(0.30, 0.42, 0.34)
  readonly deep = new Color3(0.045, 0.105, 0.115)
  /** the way the sunlight travels */
  readonly sun = new Vector3(0, -1, 0)
  readonly sunColour = new Color3(1, 0.97, 0.9)
  /** how choppy: 1 is a river on a breezy day, 0 is a millpond */
  chop = 1

  constructor(material: Material) {
    // before the air (210): the haze goes over the finished water, as it goes over everything else
    super(material, 'Water', 150, { WATERSURF: true })
    this._enable(true)
  }

  override getClassName(): string { return 'WaterPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.WATERSURF = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'wTime', size: 1, type: 'float' },
      { name: 'wChop', size: 1, type: 'float' },
      { name: 'wHorizon', size: 3, type: 'vec3' },
      { name: 'wGlint', size: 1, type: 'float' },
      { name: 'wZenith', size: 3, type: 'vec3' },
      { name: 'wClarity', size: 1, type: 'float' },
      { name: 'wShallow', size: 3, type: 'vec3' },
      { name: 'wOpacity', size: 1, type: 'float' },
      { name: 'wDeep', size: 3, type: 'vec3' },
      { name: 'wPad', size: 1, type: 'float' },
      { name: 'wSun', size: 3, type: 'vec3' },
      { name: 'wPad2', size: 1, type: 'float' },
      { name: 'wSunColour', size: 3, type: 'vec3' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef WATERSURF
uniform float wTime;
uniform float wChop;
uniform vec3 wHorizon;
uniform float wGlint;
uniform vec3 wZenith;
uniform float wClarity;
uniform vec3 wShallow;
uniform float wOpacity;
uniform vec3 wDeep;
uniform float wPad;
uniform vec3 wSun;
uniform float wPad2;
uniform vec3 wSunColour;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    uniformBuffer.updateFloat('wTime', this.time)
    uniformBuffer.updateFloat('wChop', this.chop * Config.waterChop)
    uniformBuffer.updateColor3('wHorizon', this.horizon)
    uniformBuffer.updateFloat('wGlint', Config.waterGlint)
    uniformBuffer.updateColor3('wZenith', this.zenith)
    uniformBuffer.updateFloat('wClarity', Config.waterClarity)
    uniformBuffer.updateColor3('wShallow', this.shallow)
    uniformBuffer.updateFloat('wOpacity', Config.waterOpacity)
    uniformBuffer.updateColor3('wDeep', this.deep)
    // the reach of this copy of the surface, from its mesh: positive keeps what is nearer, negative what is farther
    uniformBuffer.updateFloat('wPad', (subMesh.getMesh().metadata as { waterCut?: number } | null)?.waterCut ?? 0)
    uniformBuffer.updateVector3('wSun', this.sun)
    uniformBuffer.updateFloat('wPad2', 0)
    uniformBuffer.updateColor3('wSunColour', this.sunColour)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null

    /**
     * Six travelling waves, and their exact slopes.
     *
     * A wave of amplitude a and wavevector k contributes a cosine to the height and therefore a sine, times k,
     * to the SLOPE — so the normal is analytic: no texture, no derivative lookup, nothing to tile and nothing
     * to load. Six is plenty, because each one is turned by the golden angle from the last and its wavelength
     * is nearly double: the pattern has no period inside any water anyone can see.
     *
     * Nothing is displaced. The vertical movement of a real ripple is a centimetre and invisible; what the eye
     * sees is the normal turning, which swings the reflected sky about by tens of degrees.
     *
     * **Scale is everything here, and the first attempt had it an order of magnitude out.** Waves eleven metres
     * long with a three-centimetre amplitude are not ripples — they are swell, and a river drawn with them
     * looks like corrugated iron, which is exactly how it came out. Real wind ripples on fresh water run from
     * about six metres down to a hand's breadth, and their slopes are small: a tenth, all six together.
     *
     * Each wave also fades with distance in proportion to its own frequency, because a wave shorter than the
     * pixel it lands in cannot be drawn — it can only alias, and a river boiling with aliased ripples a
     * kilometre away is worse than a flat one. Far water goes smooth and takes its colour from the sky, which
     * is what far water does.
     */
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef WATERSURF
{
  let wP: vec2f = vec2f(fragmentInputs.vPositionW.x, fragmentInputs.vPositionW.z);
  var wSlope: vec2f = vec2f(0.0, 0.0);
  let wEye: f32 = length(scene.vEyePosition.xyz - fragmentInputs.vPositionW);
  // which depth layer this copy of the surface is for: see \`split\` in render/water.ts
  let wFlat: f32 = length(scene.vEyePosition.xz - fragmentInputs.vPositionW.xz);
  if ((uniforms.wPad > 0.0 && wFlat > uniforms.wPad) || (uniforms.wPad < 0.0 && wFlat < -uniforms.wPad)) { discard; }
  var wA: f32 = 0.014 * uniforms.wChop;
  var wK: f32 = 1.0;
  var wAng: f32 = 0.6;
  for (var wI: i32 = 0; wI < 6; wI = wI + 1) {
    let wDir: vec2f = vec2f(cos(wAng), sin(wAng));
    let wPh: f32 = dot(wP, wDir) * wK + uniforms.wTime * (0.9 + 0.55 * f32(wI)) * sqrt(wK);
    // a wave dies out of the picture once it is shorter than the pixel it is drawn in
    let wFade: f32 = 1.0 / (1.0 + wEye * wK * 0.010);
    wSlope = wSlope + wDir * (cos(wPh) * wA * wK * wFade);
    wA = wA * 0.55;
    wK = wK * 1.9;
    wAng = wAng + 2.399;
  }
  let wN: vec3f = normalize(vec3f(-wSlope.x, 1.0, -wSlope.y));
  let wV: vec3f = normalize(scene.vEyePosition.xyz - fragmentInputs.vPositionW);
  let wF: f32 = 0.02 + 0.98 * pow(1.0 - max(dot(wN, wV), 0.0), 5.0);
  let wR: vec3f = reflect(-wV, wN);
  let wSky: vec3f = mix(uniforms.wHorizon, uniforms.wZenith, pow(max(wR.y, 0.0), 0.5));
  let wDepth: f32 = fragmentInputs.vColor.r;
  let wBody: vec3f = mix(uniforms.wShallow, uniforms.wDeep, clamp(wDepth / uniforms.wClarity, 0.0, 1.0));
  let wH: vec3f = normalize(wV - normalize(uniforms.wSun));
  let wSpec: f32 = pow(max(dot(wN, wH), 0.0), 420.0) * uniforms.wGlint;
  let wOut: vec3f = mix(wBody, wSky, wF) + uniforms.wSunColour * wSpec;
  /**
   * The waterline, roughened.
   *
   * How far in from the bank a pixel is arrives in the vertex colour's alpha, and used as it comes it draws
   * the map's own polygon: on the flat Missouri bottom that is a dead straight line across the grass, which is
   * the one thing no river has. A little noise on the world position, added to that distance, gives the edge
   * back its bays and its spits — at a scale of a few metres, which is what a bank of mud and willow actually
   * wanders by — and costs two sine waves.
   */
  let wWob: f32 = sin(wP.x * 0.21 + cos(wP.y * 0.17) * 2.3) * 0.5 + sin(wP.y * 0.13 - cos(wP.x * 0.11) * 1.9) * 0.5;
  // and narrow water gives up before it can alias: see the note in the GLSL below
  let wLim: f32 = 80.0 + 900.0 * fragmentInputs.vColor.g;
  let wFar: f32 = 1.0 - smoothstep(wLim, wLim * 1.7, wEye);
  let wAlpha: f32 = clamp(uniforms.wOpacity + wF * 0.75, 0.0, 1.0)
    * clamp(fragmentInputs.vColor.a * 1.35 + wWob * 0.30 - 0.18, 0.0, 1.0) * wFar;
  color = vec4f(wOut, wAlpha);
}
#endif
`,
      }
    }
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef WATERSURF
{
  vec2 wP = vec2(vPositionW.x, vPositionW.z);
  vec2 wSlope = vec2(0.0, 0.0);
  float wEye = length(vEyePosition.xyz - vPositionW);
  float wFlat = length(vEyePosition.xz - vPositionW.xz);
  if ((wPad > 0.0 && wFlat > wPad) || (wPad < 0.0 && wFlat < -wPad)) { discard; }
  float wA = 0.014 * wChop;
  float wK = 1.0;
  float wAng = 0.6;
  for (int wI = 0; wI < 6; wI++) {
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    float wPh = dot(wP, wDir) * wK + wTime * (0.9 + 0.55 * float(wI)) * sqrt(wK);
    // a wave dies out of the picture once it is shorter than the pixel it is drawn in
    float wFade = 1.0 / (1.0 + wEye * wK * 0.010);
    wSlope += wDir * (cos(wPh) * wA * wK * wFade);
    wA *= 0.55;
    wK *= 1.9;
    wAng += 2.399;
  }
  vec3 wN = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
  vec3 wV = normalize(vEyePosition.xyz - vPositionW);
  float wF = 0.02 + 0.98 * pow(1.0 - max(dot(wN, wV), 0.0), 5.0);
  vec3 wR = reflect(-wV, wN);
  vec3 wSky = mix(wHorizon, wZenith, pow(max(wR.y, 0.0), 0.5));
  float wDepth = vColor.r;
  vec3 wBody = mix(wShallow, wDeep, clamp(wDepth / wClarity, 0.0, 1.0));
  vec3 wH = normalize(wV - normalize(wSun));
  float wSpec = pow(max(dot(wN, wH), 0.0), 420.0) * wGlint;
  vec3 wOut = mix(wBody, wSky, wF) + wSunColour * wSpec;
  // The edge is the one thing that must not be a line. How far in from the bank a pixel is arrives in the
  // vertex colour's alpha; the noise added to it here gives the waterline back the bays and spits that the
  // map's polygon does not have, at the few-metre scale a bank of mud and willow actually wanders by.
  float wWob = sin(wP.x * 0.21 + cos(wP.y * 0.17) * 2.3) * 0.5 + sin(wP.y * 0.13 - cos(wP.x * 0.11) * 1.9) * 0.5;
  /**
   * Narrow water gives up before it can alias.
   *
   * A two-metre torrent three hundred metres up a mountainside is a third of a pixel wide, and at that size
   * the Fresnel term — which is correct, and says a surface seen at a grazing angle is a mirror — turns it
   * into a bright white thread. A hillside laced with those reads as scratches on the screen, not as water.
   * The width is carried in the vertex colour's green, so each watercourse fades out at a distance in
   * proportion to it: a stream is gone by a couple of hundred metres, a river not until a kilometre, and open
   * water not before the edge of what is built — which incidentally hides that edge as well.
   */
  float wLim = 80.0 + 900.0 * vColor.g;
  float wFar = 1.0 - smoothstep(wLim, wLim * 1.7, wEye);
  float wAlpha = clamp(wOpacity + wF * 0.75, 0.0, 1.0) * clamp(vColor.a * 1.35 + wWob * 0.30 - 0.18, 0.0, 1.0) * wFar;
  color = vec4(wOut, wAlpha);
}
#endif
`,
    }
  }
}
