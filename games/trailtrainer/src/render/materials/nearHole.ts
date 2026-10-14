/**
 * Cuts a hole in the coarse ground ring around wherever the rider is, so the detailed ring is the only ground
 * near them.
 *
 * The two rings are the same hillside sampled at five metres and at fifty, and on anything steep they
 * disagree badly: a fifty-metre triangle chords straight across a gully or a road cut that the five-metre mesh
 * follows properly, by as much as eighteen metres where it was measured on Alpe d'Huez. `Config.farDrop` sinks
 * the coarse ring to hide that, but it can only hide a disagreement smaller than the drop, and a drop big
 * enough for a mountainside would leave a visible step wherever the two rings meet.
 *
 * Depth layers (see render/layers.ts) stop the coarse ring being drawn OVER the road, which is most of the
 * problem. They cannot help where the coarse ring is above the camera and the detailed ring is below it:
 * nothing of the near ring projects onto those pixels, so the coarse ring is simply the ceiling, and the ride
 * appears to go into a tunnel. That is what this is for. Below a radius the detailed ring is known to cover,
 * the coarse ring draws nothing at all.
 *
 * The radius has to stay inside what the near ring really covers. That ring is a square of chunks reaching
 * `Config.viewRadius`, which guarantees about six hundred metres in every direction once built; four hundred
 * leaves room for the chunks still streaming in.
 *
 * The centre is in SCENE space, not world space — the same space `vPositionW` is in, which is already past the
 * floating origin. Feeding it a world coordinate would put the hole hundreds of kilometres away on the Katy
 * Trail, and moving the origin would drag it about.
 */
import {
  type AbstractEngine,
  type Material,
  MaterialDefines,
  MaterialPluginBase,
  type Scene,
  ShaderLanguage,
  type SubMesh,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core'

export class NearHolePlugin extends MaterialPluginBase {
  /** where the hole is, in scene metres; y is ignored */
  readonly centre = new Vector3(0, 0, 0)
  /** how wide it is, in metres */
  radius = 400

  constructor(material: Material) {
    super(material, 'NearHole', 200, { NEARHOLE: true })
    this._enable(true)
  }

  override getClassName(): string { return 'NearHolePlugin' }

  override isCompatible(): boolean { return true }

  override prepareDefines(defines: MaterialDefines): void {
    defines.NEARHOLE = true
  }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'nearHoleCentre', size: 3, type: 'vec3' },
      { name: 'nearHoleRadius2', size: 1, type: 'float' },
    ]
    // WGSL always has uniform buffers; the GLSL declaration is only used on an engine without them
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef NEARHOLE
uniform vec3 nearHoleCentre;
uniform float nearHoleRadius2;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateVector3('nearHoleCentre', this.centre)
    // squared, so the shader never takes a square root it does not need
    uniformBuffer.updateFloat('nearHoleRadius2', this.radius * this.radius)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_FRAGMENT_MAIN_BEGIN: `
#ifdef NEARHOLE
{
  let nearHoleD: vec2f = fragmentInputs.vPositionW.xz - uniforms.nearHoleCentre.xz;
  if (dot(nearHoleD, nearHoleD) < uniforms.nearHoleRadius2) { discard; }
}
#endif
`,
      }
    }
    return {
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
#ifdef NEARHOLE
{
  vec2 nearHoleD = vPositionW.xz - nearHoleCentre.xz;
  if (dot(nearHoleD, nearHoleD) < nearHoleRadius2) { discard; }
}
#endif
`,
    }
  }
}
