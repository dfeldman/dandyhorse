/**
 * Loading the four ground surfaces.
 *
 * They are ordinary tiling textures fetched from `public/textures/`, put there once by `npm run textures`
 * from Poly Haven's CC0 library — the game asks nothing of the network while it runs, the same rule the baked
 * routes follow. See CREDITS.md.
 *
 * Nothing waits for them. The terrain is drawn from the moment there is ground to draw, and the surfaces
 * appear over it as they arrive, which on a local load is one frame and on a cold cache is a second. A ride
 * that cannot start until eight megabytes of grass has downloaded is a worse ride than one that starts plain.
 */
import { type Scene, Texture } from '@babylonjs/core'
import type { SplatTextures } from './splat.ts'
import type { SurfaceTextures } from './surface.ts'

const BASE = 'textures/'

/** One loader for both, so the settings that matter (no sRGB on a normal map, anisotropy on) are set once. */
function loader(scene: Scene): (name: string, srgb: boolean) => Texture {
  return (name: string, srgb: boolean): Texture => {
    const t = new Texture(new URL(`${BASE}${name}`, document.baseURI).href, scene, {
      // a normal map is data, not a picture: reading it through sRGB bends every slope the wrong way
      noMipmap: false,
      invertY: false,
      samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      gammaSpace: srgb,
    })
    t.wrapU = Texture.WRAP_ADDRESSMODE
    t.wrapV = Texture.WRAP_ADDRESSMODE
    // the ground is seen at a grazing angle almost everywhere, which is exactly what this is for
    t.anisotropicFilteringLevel = 8
    return t
  }
}

export function loadGroundTextures(scene: Scene): SplatTextures {
  const get = loader(scene)
  return {
    grassDiff: get('grass_diff.jpg', true),
    grassNorm: get('grass_nor_gl.jpg', false),
    dryDiff: get('dry_diff.jpg', true),
    dryNorm: get('dry_nor_gl.jpg', false),
    rockDiff: get('rock_diff.jpg', true),
    rockNorm: get('rock_nor_gl.jpg', false),
    snowDiff: get('snow_diff.jpg', true),
    snowNorm: get('snow_nor_gl.jpg', false),
  }
}

/** The trail's own three surfaces, named as OpenStreetMap's tags are. */
export function loadSurfaceTextures(scene: Scene): SurfaceTextures {
  const get = loader(scene)
  return {
    pavedDiff: get('paved_diff.jpg', true),
    pavedNorm: get('paved_nor_gl.jpg', false),
    gravelDiff: get('gravel_diff.jpg', true),
    gravelNorm: get('gravel_nor_gl.jpg', false),
    dirtDiff: get('dirt_diff.jpg', true),
    dirtNorm: get('dirt_nor_gl.jpg', false),
  }
}
