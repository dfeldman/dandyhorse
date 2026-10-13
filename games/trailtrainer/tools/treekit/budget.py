"""
Fitting a tree into a triangle budget, because it is for a game.

The structure is grown at full detail and then reduced, the same machinery as LOD: the bark gets the sides
it deserves per ring, and whatever is left of the budget goes to leaf cards. If the bark alone is over,
branches are dropped by priority and the rings thinned before the leaves are touched -- but the leaf
fraction is never allowed below a floor, because a tree with bare twigs is worse than one with fewer twigs.
"""
from __future__ import annotations

from .lod import LodSpec, apply_lod
from .tree import Tree, assemble, leaf_triangles


def triangles(tree: Tree, lod: LodSpec) -> tuple[int, int]:
    apply_lod(tree, lod)
    bark, _ = assemble(tree, lod.radial_scale, lod.ring_stride, with_leaves=False)
    return bark.triangles, leaf_triangles(tree)


def fit_budget(tree: Tree, lo: int, hi: int, leaf_share: float = 0.55) -> LodSpec:
    """A LodSpec for LOD0 whose triangle count lands in [lo, hi], aiming at the middle."""
    target = (lo + hi) / 2
    lod = LodSpec()
    bark, leaf = triangles(tree, lod)
    bark_target = target * (1 - leaf_share)
    # bark over its share: thin the rings a little, then bisect on how many branches to keep
    if bark > bark_target:
        lod.radial_scale = 0.8
        bark, leaf = triangles(tree, lod)
    if bark > bark_target:
        a, b = 0.1, 1.0
        for _ in range(8):
            lod.branch_keep = (a + b) / 2
            bark, leaf = triangles(tree, lod)
            if bark > bark_target:
                b = lod.branch_keep
            else:
                a = lod.branch_keep
        lod.branch_keep = a
        bark, leaf = triangles(tree, lod)
    # a tall tree has thick boughs, and thick boughs get many sides: thin the rings before giving up
    for radial_scale, stride in ((0.65, 1), (0.65, 2), (0.5, 2), (0.5, 3)):
        if bark <= bark_target * 1.1:
            break
        lod.radial_scale, lod.ring_stride = radial_scale, stride
        bark, leaf = triangles(tree, lod)
    room = max(target - bark, hi * 0.25) if leaf_share > 0 else 0
    if leaf > room and room > 0:
        lod.leaf_keep = room / leaf
        # grow the survivors to cover the gaps, by the square root of what was lost
        lod.grow = min(2.2, (leaf / room) ** 0.5)
    return lod
