"""
Levels of detail, SpeedTree's way: derived from the one full tree, never regrown.

A lower LOD drops branches by priority -- smallest and most hidden first -- and thins what survives: fewer
sides per ring, every other ring. Leaves are the other half. Removing interior leaves first carves the crown
into an empty shell, so the survivors are chosen by a per-leaf random ("jumble") rather than by position,
and each one grows to cover the gap the others left ("grow scale"). Silhouette is kept; density is not.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .tree import Tree


@dataclass
class LodSpec:
    branch_keep: float = 1.0     # fraction of non-trunk nodes kept, by priority
    leaf_keep: float = 1.0       # fraction of leaves kept, by jumble
    grow: float = 1.0            # leaf grow scale
    radial_scale: float = 1.0    # ring side multiplier
    ring_stride: int = 1         # spine points skipped per ring
    drop_levels: int = 0         # whole levels removed from the deepest end (twigs go first)


def apply_lod(tree: Tree, lod: LodSpec) -> Tree:
    """Mark keep flags in place and return the tree. Call with full detail first to reset."""
    for n in tree.nodes:
        n.keep = True
        n.drawn = True
    for l in tree.leaves:
        l.keep = True
        l.grow = 1.0
    # drop_levels takes the tube off the deepest meshed levels; the nodes stay, so their leaves stay
    mesh_levels = sorted({n.level for n in tree.nodes if n.mesh and not n.trunk})
    for lv in mesh_levels[len(mesh_levels) - lod.drop_levels:] if lod.drop_levels > 0 else []:
        for n in tree.nodes:
            if n.level == lv:
                n.drawn = False
    # priority: size against how hidden the node is; trunks never go, and card-only nodes cost nothing
    candidates = [n for n in tree.nodes if not n.trunk and n.mesh]
    live = [n for n in candidates if n.keep]
    if lod.branch_keep < 1.0 and live:
        prio = np.array([n.size * (1.0 - 0.6 * n.hidden) for n in live])
        order = np.argsort(prio)
        drop = int(round(len(live) * (1 - lod.branch_keep)))
        for i in order[:drop]:
            live[i].keep = False
    # a dropped parent takes its children with it
    changed = True
    while changed:
        changed = False
        for n in tree.nodes:
            if n.keep and n.parent is not None and not n.parent.keep:
                n.keep = False
                changed = True
    # leaves: those on dropped twigs move to the nearest kept ancestor's tip? No: they go, and the survivors
    # elsewhere grow. Then the jumble takes the rest down to the fraction wanted.
    # Leaves on a dropped branch stay: the crown is mostly cards, and a cluster that lost its twig is
    # invisible among the others, where a hole where it was is not. The jumble is what thins them.
    live_leaves = [l for l in tree.leaves if l.keep]
    if lod.leaf_keep < 1.0 and live_leaves:
        keep_n = int(round(len(live_leaves) * lod.leaf_keep))
        order = sorted(live_leaves, key=lambda l: l.order)
        for l in order[keep_n:]:
            l.keep = False
    for l in tree.leaves:
        if l.keep:
            l.grow = lod.grow
    return tree


def derive_lod(tree: Tree, level: int, base: LodSpec | None = None) -> LodSpec:
    """
    The standard chain. LOD0 is whatever the budget fit chose; each step keeps roughly a third of the
    triangles of the one before, and the leaves grow by the square root of what was lost so the crown's
    coverage stays about the same.
    """
    b = base or LodSpec()
    if level <= 0:
        return b
    if level == 1:
        return LodSpec(branch_keep=b.branch_keep * 0.55, leaf_keep=b.leaf_keep * 0.45, grow=b.grow * 1.45,
                       radial_scale=b.radial_scale * 0.6, ring_stride=2, drop_levels=0)
    if level == 2:
        return LodSpec(branch_keep=b.branch_keep * 0.3, leaf_keep=b.leaf_keep * 0.18, grow=b.grow * 2.2,
                       radial_scale=b.radial_scale * 0.45, ring_stride=3, drop_levels=1)
    return LodSpec(branch_keep=b.branch_keep * 0.12, leaf_keep=b.leaf_keep * 0.07, grow=b.grow * 3.4,
                   radial_scale=0.35, ring_stride=4, drop_levels=2)
