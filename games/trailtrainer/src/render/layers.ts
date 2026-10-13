/**
 * What is drawn over what.
 *
 * The two ground rings are the same hillside at two resolutions, and they disagree. The coarse ring has a
 * vertex every fifty metres, so on anything steep its triangles chord straight across a gully or a road cut
 * that the five-metre ring follows properly — measured at up to eighteen metres on Alpe d'Huez. Drawn in the
 * same pass, whichever happens to be nearer the camera wins per pixel, and what that looks like is the road
 * and the rider disappearing into a green hillside that is not there.
 *
 * Dropping the coarse ring a few metres (`Config.farDrop`) only works while the disagreement is smaller than
 * the drop, and on a 30% slope it is not. So the rings are separated in depth instead of in height: Babylon
 * clears the depth buffer between rendering groups, so everything in a later group is drawn over everything
 * in an earlier one whatever the depth says. The near ring and everything standing on it simply win.
 *
 * The order is the order of the layers below. Note that this also frees the distant ground from the sky dome,
 * which is only three kilometres across while the coarse ring reaches six.
 *
 * Anything added to the scene that belongs in the world — a mesh, a particle system, an imported body — has
 * to be given `Layer.near`, or it will be drawn under the ground it is standing on.
 */
export const Layer = {
  /** the sky dome, behind everything */
  sky: 0,
  /** the coarse distant ring */
  far: 1,
  /** the detailed ring and everything on it: trail, trees, rocks, bodies */
  near: 2,
} as const

export type LayerName = keyof typeof Layer
