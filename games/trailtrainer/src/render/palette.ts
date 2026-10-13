/**
 * What each biome looks like. Flat, warm, slightly storybook colours — the same family Rolling Hills uses — but
 * the shapes underneath are a real hillside, so the palette does the work of making a 30 m elevation model read
 * as somewhere rather than as a grey mesh.
 *
 * Ground colour is chosen per vertex from three things the terrain already knows: which biome the nearest part
 * of the route is in, how steep the ground is there, and how high it is. Steep ground is rock because soil does
 * not stay on it; high ground loses its trees and then its grass. That is enough to make the Romanche valley
 * read as a valley and the Missouri bluffs as bluffs, without a single texture.
 */
import { Color3 } from '@babylonjs/core'
import type { BiomeName, SurfaceName } from '../route/package.ts'

const hex = (s: string): Color3 => Color3.FromHexString(s)

export interface BiomePalette {
  /** the ground where it is flat and low */
  grass: Color3
  /** the ground where it is flat and high, or dry */
  dry: Color3
  /** the ground where it is too steep to hold anything */
  rock: Color3
  /** above the snow line */
  snow: Color3
  /** the trees, if any grow here */
  foliage: Color3[]
  trunk: Color3
  /** fog and the bottom of the sky */
  haze: Color3
  sky: Color3
  /** metres above which grass gives out */
  bareAbove: number
  /** metres above which snow lies */
  snowAbove: number
  /** how thick the air is; thin air over a mountain, heavy air in a river bottom */
  fog: number
}

export const BIOMES: Record<BiomeName, BiomePalette> = {
  prairie: {
    grass: hex('#8fb257'),
    dry: hex('#cbbf6e'),
    rock: hex('#a09274'),
    snow: hex('#f2f4f7'),
    foliage: [hex('#5f8f45'), hex('#74a052'), hex('#4e7c3c')],
    trunk: hex('#7a5b3c'),
    haze: hex('#dbe4c9'),
    sky: hex('#8ec7f0'),
    bareAbove: 4000,
    snowAbove: 9000,
    fog: 0.0009,
  },
  /**
   * Forest floor, not meadow.
   *
   * A wood's ground is not the colour of a field: it is leaf litter and shade, a good deal darker and browner
   * than anything growing in the open, and the terrain shader has no way to know a canopy is over it. Since the
   * biome band already says "this is forest", the colour can say it too — which is what stops a dense Missouri
   * bottomland reading as big trees standing about on a lawn.
   */
  forest: {
    grass: hex('#55763a'),
    dry: hex('#7d8b4f'),
    rock: hex('#8d8574'),
    snow: hex('#f2f4f7'),
    foliage: [hex('#3d6b34'), hex('#4b7c3a'), hex('#335b2d'), hex('#5c8a42')],
    trunk: hex('#6b4f36'),
    haze: hex('#cfdcc4'),
    sky: hex('#84c0ec'),
    bareAbove: 4000,
    snowAbove: 9000,
    fog: 0.0012,
  },
  river: {
    grass: hex('#638b45'),
    dry: hex('#a2996a'),
    rock: hex('#948b78'),
    snow: hex('#f2f4f7'),
    foliage: [hex('#477a3a'), hex('#578c43'), hex('#3b6832')],
    trunk: hex('#6f5339'),
    haze: hex('#d6e0d0'),
    sky: hex('#8ac4ee'),
    bareAbove: 4000,
    snowAbove: 9000,
    fog: 0.0014,
  },
  mountain: {
    grass: hex('#6b8f4a'),
    dry: hex('#9a9a63'),
    rock: hex('#8a8276'),
    snow: hex('#f4f6f9'),
    foliage: [hex('#2f5c34'), hex('#3a6b3a'), hex('#28502e')],
    trunk: hex('#5e452f'),
    haze: hex('#c6d3dd'),
    sky: hex('#6fb3e8'),
    bareAbove: 2100,
    snowAbove: 2700,
    fog: 0.00035,
  },
  alpine: {
    grass: hex('#7d9159'),
    dry: hex('#a8a173'),
    rock: hex('#948c80'),
    snow: hex('#f6f8fb'),
    foliage: [hex('#35603a'), hex('#2b5433')],
    trunk: hex('#5a4430'),
    haze: hex('#c2d2e2'),
    sky: hex('#5aa8e6'),
    bareAbove: 2300,
    snowAbove: 2650,
    fog: 0.00028,
  },
}

export const SURFACES: Record<SurfaceName, { colour: Color3; edge: Color3; dust: boolean }> = {
  paved: { colour: hex('#565a60'), edge: hex('#d8d5cc'), dust: false },
  // Packed limestone, not chalk. It was light enough that under this scene's exposure the Katy came out as a
  // white ribbon laid across the prairie — the brightest thing in the frame by a distance, brighter than the
  // clouds. What it actually is, is pale warm gravel with dust on it.
  gravel: { colour: hex('#a4977d'), edge: hex('#80765d'), dust: true },
  dirt: { colour: hex('#9c7c5a'), edge: hex('#7a6044'), dust: true },
}

/**
 * The colour of the ground at one vertex. `slope` is rise over run of the terrain itself, not the trail.
 */
export function groundColour(p: BiomePalette, elevation: number, slope: number, dryness: number, out: Color3): Color3 {
  // soil and scrub hold on further than you would think; below about 40 degrees a mountainside is still green
  const rockiness = Math.min(1, Math.max(0, (slope - 0.8) / 0.7))
  const bare = Math.min(1, Math.max(0, (elevation - p.bareAbove) / 260))
  const snowy = Math.min(1, Math.max(0, (elevation - p.snowAbove) / 200))
  out.copyFrom(p.grass)
  Color3.LerpToRef(out, p.dry, Math.min(1, dryness + bare * 0.6), out)
  Color3.LerpToRef(out, p.rock, Math.max(rockiness, bare * 0.7), out)
  // snow settles where it is flat enough to lie
  Color3.LerpToRef(out, p.snow, snowy * (1 - rockiness * 0.65), out)
  return out
}
