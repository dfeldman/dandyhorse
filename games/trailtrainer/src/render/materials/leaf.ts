/**
 * Light coming through a leaf.
 *
 * Stand under a tree on a sunny day and the canopy above you is not dark — it is a bright, saturated green,
 * because a leaf is thin enough to let light through it. A renderer that treats a leaf as an opaque surface
 * gets this exactly backwards: the sun is on the far side, the dot product with the normal is negative, the
 * leaf receives only the ambient term, and the whole canopy over the rider's head comes out nearly black.
 * That is what was wrong here, and it is why piling on more ambient and bigger diffuse multipliers never
 * fixed it — they lift everything, including the half that was already correct.
 *
 * The fix is the standard cheap stand-in for subsurface scattering in foliage: add a term for light arriving
 * through the back of the surface. It is tinted, because what comes through a leaf has been filtered by the
 * leaf and is greener and warmer than what bounced off it, and it is sharpened toward the sun, because a
 * canopy glows most where you are looking straight into the light.
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
} from '@babylonjs/core'
import { Config } from '../../config.ts'

export class LeafTransmissionPlugin extends MaterialPluginBase {
  /** the colour light takes on once it has been through a leaf */
  readonly tint = new Color3(0.42, 0.62, 0.22)

  constructor(material: Material) {
    // after the aerial perspective would be wrong: light through a leaf is light, and the air is in front
    super(material, 'LeafThrough', 200, { LEAFTHROUGH: true })
    this._enable(true)
  }

  override getClassName(): string { return 'LeafTransmissionPlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.LEAFTHROUGH = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'leafThrough', size: 3, type: 'vec3' },
      { name: 'leafSharpness', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return { ubo, fragment: `#ifdef LEAFTHROUGH\nuniform vec3 leafThrough;\nuniform float leafSharpness;\n#endif` }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateColor3('leafThrough', this.tint.scale(Config.leafThrough))
    uniformBuffer.updateFloat('leafSharpness', Config.leafThroughSharpness)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    const posW = wgsl ? 'fragmentInputs.vPositionW' : 'vPositionW'
    // The SHADED normal, not the raw one off the vertex. A leaf material is two-sided, so Babylon has
    // already flipped the normal to face the viewer; the raw varying still points whichever way the triangle
    // was wound. Reading that, half the canopy asked for light through a face that was not facing away, got
    // none, and stayed black — which is exactly what a canopy overhead looked like.
    const normW = 'normalW'
    const eye = wgsl ? 'scene.vEyePosition.xyz' : 'vEyePosition.xyz'
    // light 0 is the sun; for a directional light Babylon stores the direction it travels in xyz
    const lightData = wgsl ? 'light0.vLightData' : 'vLightData0'
    const body = `
  {
    ${wgsl ? 'let' : 'vec3'} ltL = normalize(-${lightData}.xyz);
    ${wgsl ? 'let' : 'vec3'} ltN = normalize(${normW});
    ${wgsl ? 'let' : 'vec3'} ltV = normalize(${eye} - ${posW});
    // how much of the sun is on the FAR side of this leaf
    ${wgsl ? 'let' : 'float'} ltBack = max(0.0, dot(-ltN, ltL));
    // and how much we are looking into it, which is where a canopy glows
    ${wgsl ? 'let' : 'float'} ltInto = pow(max(0.0, dot(-ltV, ltL)), ${u('leafSharpness')});
    color = ${wgsl ? 'vec4f' : 'vec4'}(color.rgb + ${u('leafThrough')} * ltBack * (0.35 + 0.65 * ltInto), color.a);
  }
`
    return { CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef LEAFTHROUGH\n${body}\n#endif\n` }
  }
}
