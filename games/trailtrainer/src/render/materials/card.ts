/**
 * Hiding a leaf card when it turns edge-on — and keeping a canopy from dissolving with distance.
 *
 * A crown is a few dozen flat pages of leaves pointing in different directions, and at any moment some of
 * them are nearly edge-on to the camera. A page seen edge-on is a bright sliver a pixel or two wide — it
 * catches the light along its whole length and reads as a shard of glass stuck in the tree, which is the one
 * artefact that gives card foliage away immediately.
 *
 * The cure is to stop drawing a page as it turns away. The card's own vertex normal is the direction it
 * faces, so how square-on it is to the eye is one dot product, and the fade is folded into the alpha the card
 * is already being cut out with: as it turns, its leaves thin out and vanish rather than the whole page
 * snapping off. The pages behind it are still there, so the crown does not thin — it simply stops showing
 * anything an edge.
 *
 * **The second thing this does is fix what mip-mapping does to an alpha test, which is destroy it.**
 *
 * A leaf page is mostly holes, so its alpha averages well below the cut-out threshold as soon as the mip
 * chain starts averaging — and an alpha test is a step function, so the moment the average crosses the
 * threshold the leaves stop being drawn at all. What that looks like is a crown a hundred metres off breaking
 * into a cloud of loose green specks against the sky, thinning as it goes, until the tree is a ghost. It was
 * mistaken for the level-of-detail dissolve twice, and it is not: it happens to every alpha-tested canopy at
 * range whatever else is switched off.
 *
 * The standard cure is to lower the threshold as the mip level rises, which restores the coverage the
 * averaging took away. There is no mip level to hand in this shader, but distance is the thing the mip level
 * is a proxy for, so distance is what is used. Near trees keep a crisp cut-out; far ones keep their leaves.
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
} from '@babylonjs/core'
import { Config } from '../../config.ts'

export class CardEdgePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'CardEdge', 165, { CARDEDGE: true })
    this._enable(true)
  }

  override getClassName(): string { return 'CardEdgePlugin' }
  override isCompatible(): boolean { return true }
  override prepareDefines(defines: MaterialDefines): void { defines.CARDEDGE = true }

  override getUniforms(shaderLanguage?: ShaderLanguage): {
    ubo: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    const ubo = [
      { name: 'cardEdgeFrom', size: 1, type: 'float' },
      { name: 'cardEdgeTo', size: 1, type: 'float' },
      { name: 'cardCut', size: 1, type: 'float' },
      { name: 'cardCutFar', size: 1, type: 'float' },
    ]
    if (shaderLanguage === ShaderLanguage.WGSL) return { ubo }
    return {
      ubo,
      fragment: `#ifdef CARDEDGE
uniform float cardEdgeFrom;
uniform float cardEdgeTo;
uniform float cardCut;
uniform float cardCutFar;
#endif`,
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('cardEdgeFrom', Config.cardEdgeFrom)
    uniformBuffer.updateFloat('cardEdgeTo', Config.cardEdgeTo)
    uniformBuffer.updateFloat('cardCut', Config.cardCut)
    uniformBuffer.updateFloat('cardCutFar', Config.cardCutFar)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    const wgsl = shaderLanguage === ShaderLanguage.WGSL
    const u = (n: string): string => (wgsl ? `uniforms.${n}` : n)
    const posW = wgsl ? 'fragmentInputs.vPositionW' : 'vPositionW'
    // the SHADED normal, which on a two-sided leaf has already been turned to face the viewer
    const normW = 'normalW'
    const eye = wgsl ? 'scene.vEyePosition.xyz' : 'vEyePosition.xyz'
    const body = `
  {
    ${wgsl ? 'let' : 'vec3'} cardV = normalize(${posW} - ${eye});
    // how square-on the page is: one at face value, zero when it has turned to an edge
    ${wgsl ? 'let' : 'float'} cardFace = abs(dot(normalize(${normW}), cardV));
    ${wgsl ? 'let' : 'float'} cardD = length(${posW} - ${eye});
    /**
     * The edge-on fade is a CLOSE-UP fix, and applying it far away destroys the tree.
     *
     * Near to, a crown is dozens of leaf pages and hiding the two or three that have turned edge-on costs
     * nothing. Far away it is the same tree decimated to a handful of big cards — sixty-four triangles at the
     * coarsest level — and hiding a couple of those takes most of the canopy with it. What that looks like
     * from the road is a wood of bare pale trunks standing among the leafy ones, and it was reported as
     * "further trunks drawing over closer ones", which is what a stump in the middle distance looks like.
     *
     * So the fade is eased out with distance. By sixty metres a leaf page is a few pixels across and cannot
     * produce the bright sliver this was written to remove anyway.
     */
    ${wgsl ? 'let' : 'float'} cardNear = 1.0 - clamp((cardD - 40.0) / 45.0, 0.0, 1.0);
    ${wgsl ? 'let' : 'float'} cardKeep = mix(1.0, smoothstep(${u('cardEdgeFrom')}, ${u('cardEdgeTo')}, cardFace), cardNear);
    ${wgsl ? 'let' : 'float'} cardAt = mix(${u('cardCut')}, ${u('cardCutFar')}, clamp((cardD - 30.0) / 90.0, 0.0, 1.0));
    if (baseColor.a * cardKeep < cardAt) { discard; }
  }
`
    return { CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef CARDEDGE\n${body}\n#endif\n` }
  }
}
