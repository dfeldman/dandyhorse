"""
The structure of a tree: generators linked parent to child, exactly as SpeedTree lays them out.

A species file is a Tree generator (global size), a trunk generator, an ordered list of branch generators
(boughs, branches, twigs), a leaf generator and a crown envelope. Each branch generator says how many nodes
it puts on each parent node and where (distribution), how they leave the parent (angle, roll), how far they
go (length curve over position on the parent, times variance) and how they bend on the way (spine forces).
Everything is a Param, so it can be a constant, a curve, or a curve with variance -- see curves.py.

There is no grammar and no rewriting. Every level is generated from the level above, once, in order, and
the envelope prunes what grows out of the crown's silhouette. That is what makes an oak an oak and a poplar
a poplar: the envelope and the angle curve do far more than any amount of branching mathematics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .curves import Curve, Param
from .mesh import MeshData, card, radial_for, tube
from .rng import stream
from .spine import UP, Spine, any_perpendicular, grow, normalize, rotate

GOLDEN = np.deg2rad(137.508)


@dataclass
class Node:
    level: int
    spine: Spine
    parent: 'Node | None'
    t: float                    # where on the parent it grows from
    index: int                  # index within its level, for seeding
    radius: float               # base radius, metres
    size: float = 0.0           # length × radius, the LOD priority
    hidden: float = 0.0         # 0 at the crown surface, 1 deep inside; higher is dropped first
    trunk: bool = False         # drawn with flare, never pruned, kept in every LOD
    mesh: bool = True           # swept into a tube; a card-only level (twigs) is False and costs nothing
    keep: bool = True           # False once an LOD has dropped it
    drawn: bool = True          # mesh and keep, and not thinned away by an LOD's drop_levels
    children: list = field(default_factory=list)


@dataclass
class Leaf:
    pos: np.ndarray
    along: np.ndarray
    across: np.ndarray
    normal: np.ndarray
    width: float
    height: float
    fold: float
    cell: int
    color: np.ndarray
    hidden: float            # depth into the crown, 0..1
    order: float             # a per-leaf random in 0..1: the jumble key
    node: Node
    keep: bool = True
    grow: float = 1.0        # LOD grow scale


@dataclass
class Tree:
    spec: dict
    seed: int
    height: float
    nodes: list            # every Node, trunk first, level by level
    leaves: list
    crown_center: np.ndarray
    crown_radius: float
    cells: int             # uv cells on the leaf page (cells × cells grid)

    def level_nodes(self, level: int) -> list:
        return [n for n in self.nodes if n.level == level]


# ---------------------------------------------------------------- envelope

class Envelope:
    """The crown's silhouette: a radius profile over the crown's height, scaled by the tree's height."""

    def __init__(self, spec: dict, height: float):
        self.base = float(spec.get('base', 0.3)) * height
        self.top = float(spec.get('top', 1.05)) * height
        self.width = float(spec.get('width', 0.4)) * height
        self.profile = Curve.of(spec.get('profile', [0.5, 0.9, 1.0, 0.85, 0.4]))
        self.center = np.array([0.0, 0.0, (self.base + self.top) / 2])

    def radius_at(self, z: float) -> float:
        if self.top <= self.base:
            return 0.0
        u = (z - self.base) / (self.top - self.base)
        if u < 0 or u > 1:
            return 0.0
        return self.width * float(self.profile(u))

    def inside(self, p: np.ndarray, slack: float = 1.0) -> bool:
        r = self.radius_at(float(p[2]))
        return float(np.hypot(p[0], p[1])) <= r * slack

    def depth(self, p: np.ndarray) -> float:
        """How far inside the crown a point is: 0 at the surface (or outside), 1 on the axis."""
        r = self.radius_at(float(p[2]))
        if r <= 1e-6:
            return 0.0
        return float(np.clip(1 - np.hypot(p[0], p[1]) / r, 0, 1))


# ---------------------------------------------------------------- distribution

def distribute(mode: str, parent_len: float, spec: dict, rng: np.random.Generator) -> list[float]:
    """Where along the parent (fraction of length) the nodes of this generator sit."""
    first = float(spec.get('first', 0.0))
    last = float(spec.get('last', 1.0))
    span = max(last - first, 0.0)
    if mode == 'absolute':
        n = int(round(Param.of(spec.get('count', 4)).at(0.5, rng)))
    elif mode == 'interval':
        step = max(Param.of(spec.get('spacing', 0.5)).at(0.5, rng), 0.01)
        n = int(parent_len * span / step)
    else:  # proportional: nodes per metre of parent, scaled by span
        density = Param.of(spec.get('density', 3.0)).at(0.5, rng)
        n = int(round(density * parent_len * span))
    n = max(n, int(spec.get('min', 0)))
    if n <= 0 or span <= 0:
        return []
    jitter = float(spec.get('jitter', 0.6))
    ts = first + span * (np.arange(n) + 0.5 + rng.uniform(-0.5, 0.5, n) * jitter) / n
    return [float(t) for t in np.clip(ts, first, last)]


def whorls(parent_len: float, spec: dict, rng: np.random.Generator) -> list[tuple[float, float]]:
    """
    SpeedTree's "proportional steps": rings of nodes at a regular interval up the parent, each ring's
    nodes evenly spaced around it. What a spruce or a pine does. `step` metres between rings, `per_whorl`
    nodes in a ring (± var), `first`/`last` the span, and the ring spacing itself jittered by `jitter`.
    """
    first = float(spec.get('first', 0.1))
    last = float(spec.get('last', 0.98))
    step = max(Param.of(spec.get('step', 0.6)).at(0.5, rng), 0.05)
    per = Param.of(spec.get('per_whorl', [5, 1]))
    jitter = float(spec.get('jitter', 0.25))
    out = []
    s = first * parent_len
    phase = float(rng.uniform(0, 2 * np.pi))
    while s <= last * parent_len:
        t = s / parent_len
        n = max(1, int(round(per.at(t, rng))))
        phase += GOLDEN
        for i in range(n):
            out.append((float(np.clip(t + rng.uniform(-0.01, 0.01), first, last)),
                        phase + i * 2 * np.pi / n + float(rng.uniform(-0.25, 0.25))))
        s += step * (1 + rng.uniform(-jitter, jitter))
    return out


def roll_angles(n: int, spec: dict, rng: np.random.Generator) -> list[float]:
    """Around the parent: a golden spiral, opposite pairs (maple, ash) or alternate (oak, beech)."""
    mode = spec.get('mode', 'spiral')
    var = np.deg2rad(float(spec.get('var', 20)))
    start = float(rng.uniform(0, 2 * np.pi))
    out = []
    for i in range(n):
        if mode == 'opposite':
            a = start + (i // 2) * np.pi / 2 + (i % 2) * np.pi
        elif mode == 'alternate':
            a = start + i * np.pi + (i // 2) * np.deg2rad(60)
        else:
            a = start + i * GOLDEN
        out.append(float(a + rng.uniform(-var, var)))
    return out


# ---------------------------------------------------------------- growing levels

def _leaf_spec_defaults(spec: dict) -> dict:
    d = {'mode': 'cluster', 'size': [0.5, 0.15], 'aspect': 1.0, 'spacing': 0.25, 'tip': 2, 'first': 0.3, 'fold': 0,
         'overlap': 1.7, 'width': 0.6, 'cross': 0.0, 'droop': 0.0, 'leader': 0.0, 'tilt': 30,
         'outward': 0.5, 'up': 0.3, 'droop': 0.0, 'anchor': 0.1, 'ao': 0.3, 'hue_var': 0.06, 'cells': 2,
         'levels': None, 'edge_lift': 0.5, 'scatter': 0.6, 'bough_first': 0.45, 'size_min': 0.55,
         'light_var': 0.12, 'warm': 0.0, 'tint': [1.0, 1.0, 1.0], 'none': False}
    d['size'] = spec.get('size', [0.07, 0.015]) if spec else [0.07, 0.015]
    d.update(spec or {})
    return d


def _child_direction(parent_tangent: np.ndarray, parent_normal: np.ndarray, angle: float, roll: float) -> np.ndarray:
    """A direction `angle` radians off the parent's tangent, rolled around it."""
    n = rotate(parent_normal, parent_tangent, roll)
    return normalize(parent_tangent * np.cos(angle) + n * np.sin(angle))


def _grow_branch(level_spec: dict, parent: Node, t: float, roll: float, level: int, index: int,
                 tree_height: float, envelope: Envelope | None, seed: int) -> Node | None:
    rng = stream(seed, level + 1, index, 1)
    p, tg, nm, pr = parent.spine.at(t)
    angle = np.deg2rad(Param.of(level_spec.get('angle', [55, 12])).at(t, rng))
    direction = _child_direction(tg, nm, angle, roll)
    # length: a curve over the parent, as a fraction of the parent's length (or of tree height if 'length_abs')
    if 'length_abs' in level_spec:
        length = Param.of(level_spec['length_abs']).at(t, rng) * tree_height
    else:
        length = Param.of(level_spec.get('length', [0.5, 0.1])).at(t, rng) * parent.spine.length
    length = max(length, 0.02)
    ratio = Param.of(level_spec.get('radius', [0.5, 0.1])).at(t, rng)
    radius = min(pr * ratio, pr * 0.85)
    radius = max(radius, float(level_spec.get('tip', 0.004)))
    tip = float(level_spec.get('tip', 0.004))
    taper = Curve.of(level_spec.get('taper', [1.0, 0.75, 0.45, 0.15]))
    tropism = Param.of(level_spec.get('tropism', 0.0))
    tro = Curve(tropism.curve.t, tropism.curve.v + (rng.uniform(-tropism.var, tropism.var) if tropism.var else 0))
    seg_len = float(level_spec.get('segment', 0.6))
    segments = int(np.clip(round(length / seg_len), int(level_spec.get('min_segments', 2)), 24))
    spine = grow(p, direction, length, segments, radius, tip, taper, tro,
                 float(level_spec.get('wander', 0.3)), float(level_spec.get('gnarl', 0.0)),
                 float(level_spec.get('return', 0.0)), stream(seed, level + 1, index, 2))
    # envelope pruning: cut where the spine leaves the crown, drop what is left if too little remains
    if envelope is not None and level_spec.get('prune', True):
        slack = float(level_spec.get('slack', 1.0))
        keep = 1.0
        for i in range(1, len(spine.points)):
            if not envelope.inside(spine.points[i], slack):
                keep = (i - 0.5) / (len(spine.points) - 1)
                break
        if keep < float(level_spec.get('min_keep', 0.35)):
            return None
        if keep < 1.0:
            spine = spine.truncated(keep)
    node = Node(level, spine, parent, t, index, radius, mesh=bool(level_spec.get('mesh', True)))
    node.size = spine.length * radius
    return node


def _grow_trunk(spec: dict, height: float, seed: int) -> list[Node]:
    """The trunk, and its leaders if it splits. Level 0, all flagged trunk."""
    ts = spec.get('trunk', {})
    rng = stream(seed, 0, 0, 1)
    radius = float(Param.of(ts.get('radius', 0.02)).at(0.5, rng)) * height
    tip = float(ts.get('tip', 0.02))
    taper = Curve.of(ts.get('taper', [1.0, 0.85, 0.7, 0.5, 0.25]))
    tropism = Param.of(ts.get('tropism', 0.3))
    seg_len = float(ts.get('segment', 0.5))
    splits = ts.get('splits')
    lean = np.deg2rad(float(Param.of(ts.get('lean', [0, 4])).at(0.5, rng)))
    d0 = rotate(UP, np.array([1.0, 0.0, 0.0]), lean)
    d0 = rotate(d0, UP, float(rng.uniform(0, 2 * np.pi)))
    nodes: list[Node] = []
    split_at = None
    n_leaders = 0
    if splits:
        n_leaders = int(round(Param.of(splits.get('count', 0)).at(0.5, rng)))
        if n_leaders >= 2:
            split_at = float(np.clip(Param.of(splits.get('at', [0.5, 0.1])).at(0.5, rng), 0.15, 0.9))
    length = height if split_at is None else height * split_at
    segments = max(4, int(round(length / seg_len)))
    spine = grow(np.zeros(3), d0, length, segments, radius, tip if split_at is None else radius * 0.6,
                 taper if split_at is None else Curve(taper.t * split_at, taper.v) if False else
                 Curve.of([1.0, float(taper(split_at * 0.5)), float(taper(split_at))]),
                 tropism.curve, float(ts.get('wander', 0.15)), float(ts.get('gnarl', 0.0)),
                 float(ts.get('return', 0.0)), stream(seed, 0, 0, 2))
    trunk = Node(0, spine, None, 0.0, 0, radius, trunk=True)
    trunk.size = 1e9
    nodes.append(trunk)
    if split_at is None:
        return nodes
    # leaders: the trunk continues as n thinner trunks. Leonardo: their sections add up to the cut section.
    p, tg, nm, pr = spine.at(1.0)
    pr = float(spine.radii[-1])
    weights = rng.uniform(0.7, 1.3, n_leaders)
    weights /= weights.sum()
    rolls = roll_angles(n_leaders, {'mode': 'spiral', 'var': 15}, rng) if n_leaders > 2 else \
        [float(rng.uniform(0, 2 * np.pi)) + i * np.pi for i in range(n_leaders)]
    angle_p = Param.of(splits.get('angle', [25, 8]))
    for i in range(n_leaders):
        lr = stream(seed, 0, i + 1, 1)
        r_i = pr * float(np.sqrt(weights[i]))
        ang = np.deg2rad(angle_p.at(0.5, lr))
        if i == 0 and splits.get('extend', True):
            ang *= 0.35  # one leader carries the trunk on
        d = _child_direction(tg, nm, ang, rolls[i])
        l_i = height * (1 - split_at) * float(Param.of(splits.get('length', [1.0, 0.15])).at(0.5, lr)) * \
            (1.0 if i == 0 else float(np.clip(weights[i] * n_leaders, 0.6, 1.1)))
        segs = max(3, int(round(l_i / seg_len)))
        lspine = grow(p, d, l_i, segs, r_i, tip, Curve.of([1.0, 0.8, 0.55, 0.3, 0.1]), tropism.curve,
                      float(ts.get('wander', 0.15)) * 1.3, float(ts.get('gnarl', 0.0)), 0.1, stream(seed, 0, i + 1, 2))
        leader = Node(0, lspine, trunk, 1.0, i + 1, r_i, trunk=True)
        leader.size = 1e8
        trunk.children.append(leader)
        nodes.append(leader)
    return nodes


def _grow_leaves(tree_nodes: list[Node], spec: dict, envelope: Envelope, seed: int, cells: int,
                 height: float) -> list[Leaf]:
    ls = _leaf_spec_defaults(spec)
    levels = ls['levels']
    max_level = max(n.level for n in tree_nodes)
    if levels is None:
        # every level but the trunk: cards along the boughs are what joins one bough's tuft to the next
        levels = list(range(1, max_level + 1))
    size = Param.of(ls['size'])
    fold = np.deg2rad(float(ls['fold']))
    leaves: list[Leaf] = []
    base = np.array([1.0, 1.0, 1.0, 1.0])
    if ls['mode'] == 'frond':
        return _grow_fronds(tree_nodes, ls, envelope, seed, cells, height, levels)
    for node in tree_nodes:
        # leaders (the trunk past a fork) carry cards too: that is what closes the gap between their crowns
        is_leader = node.trunk and node.parent is not None
        if node.level not in levels and not is_leader:
            continue
        rng = stream(seed, 99, node.level, node.index)
        L = node.spine.length
        spacing = float(ls['spacing'])
        first = float(ls['bough_first']) if (node.level == 1 or is_leader) else float(ls['first'])
        n_along = int(max(0, (1 - first) * L / spacing))
        ts = list(first + (1 - first) * (np.arange(n_along) + 0.5) / max(n_along, 1)) if n_along else []
        ts += [1.0] * int(ls['tip'])
        scatter = float(ls['scatter'])
        for k, t in enumerate(ts):
            p, tg, nm, r = node.spine.at(min(t, 1.0))
            at_tip = t >= 1.0
            if not at_tip and scatter > 0:
                # off the spine a little, so cards along a bough read as foliage around it, not a row on it
                p = p + rotate(nm, tg, float(rng.uniform(0, 2 * np.pi))) * float(rng.uniform(0.1, 1.0)) * scatter * height * 0.05
            # direction: along the twig, blended outward from the crown centre and upward
            outward = p - envelope.center
            outward[2] *= 0.5
            outward = normalize(outward) if np.linalg.norm(outward) > 1e-6 else UP
            along = normalize(tg * (1 - ls['outward']) + outward * ls['outward'] + UP * ls['up'] - UP * ls['droop'])
            # roll around the twig: tip cards fan out, side cards alternate
            side = rotate(nm, tg, float(rng.uniform(0, 2 * np.pi)) if at_tip else (k % 2) * np.pi + rng.uniform(-0.5, 0.5))
            along = normalize(along + side * (0.9 if at_tip else 0.5))
            across = normalize(np.cross(along, outward * 0.6 + UP * 0.8 + rng.normal(0, 0.15, 3)))
            hidden = envelope.depth(p)
            normal = normalize(outward * (1 - ls['edge_lift']) + UP * ls['edge_lift'] * 0.7 + np.cross(along, across) * 0.0)
            # size is a fraction of the tree's height, floored in metres: a sapling's leaves are not tiny
            s = max(size.at(hidden, rng) * height, float(ls['size_min']) * (1 + rng.uniform(-0.2, 0.2)))
            s *= (1.0 if at_tip else 0.85)
            w = s
            h = s * float(ls['aspect'])
            # vertex colour multiplies the page: ambient shade deep in the crown, a per-card lightness (some
            # leaves are simply paler), a per-card warmth that pulls blue out so a green page goes
            # yellow-green, a small hue jitter, and the tree's own tint. Real hue changes -- orange, red --
            # cannot be multiplied into a green photograph and come from the seasonal pages instead.
            shade = 1 - ls['ao'] * hidden
            hv = ls['hue_var']
            light = 1 + rng.uniform(-ls['light_var'], ls['light_var'])
            warm = float(np.clip(ls['warm'] * rng.uniform(0.3, 1.0), 0, 1))
            col = base.copy()
            col[:3] = shade * light * (1 + rng.uniform(-hv, hv, 3) * np.array([1.0, 0.6, 1.0]))
            col[:3] *= np.array([1.0, 1 - 0.12 * warm, 1 - 0.55 * warm]) * np.asarray(ls['tint'], dtype=float)
            col[:3] = np.clip(col[:3], 0, 1)
            col[3] = 1.0
            leaves.append(Leaf(p, along, across, normal, w, h, fold, int(rng.integers(0, cells * cells)), col, hidden,
                               float(rng.uniform()), node))
    return leaves


def _card_colour(ls: dict, hidden: float, rng: np.random.Generator) -> np.ndarray:
    shade = 1 - ls['ao'] * hidden
    hv = ls['hue_var']
    light = 1 + rng.uniform(-ls['light_var'], ls['light_var'])
    warm = float(np.clip(ls['warm'] * rng.uniform(0.3, 1.0), 0, 1))
    col = np.ones(4)
    col[:3] = shade * light * (1 + rng.uniform(-hv, hv, 3) * np.array([1.0, 0.6, 1.0]))
    col[:3] *= np.array([1.0, 1 - 0.12 * warm, 1 - 0.55 * warm]) * np.asarray(ls['tint'], dtype=float)
    col[:3] = np.clip(col[:3], 0, 1)
    return col


def _grow_fronds(tree_nodes: list[Node], ls: dict, envelope: Envelope, seed: int, cells: int, height: float,
                 levels: list[int]) -> list[Leaf]:
    """
    Conifer foliage: cards lying ALONG each branch, centred on it, overlapping like tiles, their normal up
    -- SpeedTree's fronds, cut to the budget. `spacing` is metres between card centres, `overlap` how
    much longer than the spacing a card is, `width` the card's width as a fraction of its length, `cross`
    the chance a card gets a second copy rotated 90° about the branch (volume, at double the cost), and
    `leader` puts a pair of crossed upright cards on the trunk's tip so a spruce ends in a point.
    """
    leaves: list[Leaf] = []
    fold = np.deg2rad(float(ls['fold']))
    size = Param.of(ls['size'])
    for node in tree_nodes:
        rng = stream(seed, 99, node.level, node.index)
        if node.trunk and node.parent is None and ls['leader'] > 0:
            # the tip: crossed cards standing up the last stretch of the trunk
            p, tg, nm, r = node.spine.at(1.0)
            length = ls['leader'] * height
            base = p - tg * length * 0.85
            for k in range(2):
                across = rotate(nm, tg, k * np.pi / 2)
                leaves.append(Leaf(base, tg, across, normalize(across + UP * 0.5), length * float(ls['width']) * 1.4, length,
                                   0.0, int(rng.integers(0, cells * cells)), _card_colour(ls, 0.0, rng), 0.0,
                                   float(rng.uniform()), node))
            continue
        if node.level not in levels:
            continue
        L = node.spine.length
        spacing = float(ls['spacing'])
        n = max(1, int(round((1 - ls['first']) * L / spacing)))
        length = min(spacing * float(ls['overlap']), L * 0.9)
        length = max(length, float(ls['size_min']))
        width = length * float(ls['width'])
        for k in range(n):
            t = ls['first'] + (1 - ls['first']) * (k + 0.5) / n
            p, tg, nm, r = node.spine.at(t)
            along = normalize(tg - UP * ls['droop'] * t)
            horiz = np.cross(along, UP)
            if np.linalg.norm(horiz) < 1e-3:
                horiz = nm
            across = normalize(horiz + rng.normal(0, 0.12, 3))
            # tilt the card about the branch, so a crown seen from the side is not a stack of edge-on planes
            across = rotate(across, along, float(np.deg2rad(rng.uniform(-ls['tilt'], ls['tilt']))))
            outward = p - envelope.center
            outward[2] = 0
            outward = normalize(outward) if np.linalg.norm(outward) > 1e-6 else nm
            normal = normalize(UP * 0.75 + outward * 0.35)
            hidden = envelope.depth(p)
            s = size.at(t, rng)
            col = _card_colour(ls, hidden, rng)
            leaves.append(Leaf(p, along, across, normal, width * s, length * s, fold, int(rng.integers(0, cells * cells)),
                               col, hidden, float(rng.uniform()), node))
            if ls['cross'] > 0 and rng.uniform() < ls['cross']:
                across2 = normalize(np.cross(along, across))
                leaves.append(Leaf(p, along, across2, normalize(outward + UP * 0.3), width * s * 0.8, length * s, fold,
                                   int(rng.integers(0, cells * cells)), col, hidden, float(rng.uniform()), node))
    return leaves


def build_tree(spec: dict, seed: int) -> Tree:
    """Grow the whole structure at full detail. LOD and budgets remove from this; they never regrow."""
    rng = stream(seed, 7)
    height = float(Param.of(spec.get('height', [12, 2])).at(0.5, rng))
    envelope = Envelope(spec.get('envelope', {}), height)
    nodes = _grow_trunk(spec, height, seed)
    levels = spec.get('levels', [])
    for level, ls in enumerate(levels, start=1):
        parents = [n for n in nodes if n.level == level - 1]
        index = 0
        knockout = float(ls.get('knockout', 0.0))
        for parent in parents:
            prng = stream(seed, level, parent.index, 3)
            plen = parent.spine.length
            # a trunk's leaders count as trunk for distribution, but the first/last span applies to the whole
            if ls.get('distribution') == 'whorls':
                pairs = whorls(plen, ls, prng)
            else:
                ts = distribute(ls.get('distribution', 'proportional'), plen, ls, prng)
                pairs = list(zip(ts, roll_angles(len(ts), ls.get('roll', {}), prng)))
            for t, roll in pairs:
                if knockout and prng.uniform() < knockout:
                    index += 1
                    continue
                child = _grow_branch(ls, parent, t, roll, level, index, height, envelope if level > 0 else None, seed)
                index += 1
                if child is None:
                    continue
                child.hidden = envelope.depth(child.spine.points[-1])
                parent.children.append(child)
                nodes.append(child)
    cells = int(_leaf_spec_defaults(spec.get('leaves', {}))['cells'])
    bare = bool(spec.get('leaves', {}).get('none', False))
    leaves = _grow_leaves(nodes, spec.get('leaves', {}), envelope, seed, cells, height) if (levels and not bare) else []
    return Tree(spec, seed, height, nodes, leaves, envelope.center, envelope.width, cells)


# ---------------------------------------------------------------- meshing

def leaf_triangles(tree: Tree) -> int:
    """How many triangles the kept leaves will take, without laying them out."""
    return sum((2 if leaf.fold <= 0.001 else 4) for leaf in tree.leaves if leaf.keep)


def assemble(tree: Tree, radial_scale: float = 1.0, ring_stride: int = 1, bark_tile: float | None = None,
             bark_shade: float = 0.25, with_leaves: bool = True) -> tuple[MeshData, MeshData]:
    """Everything kept in the tree, as a bark mesh and a leaf mesh."""
    bark = MeshData()
    leaves = MeshData()
    tile = bark_tile if bark_tile is not None else float(tree.spec.get('bark_tile', 1.2))
    ts = tree.spec.get('trunk', {})
    snow = float(tree.spec.get('snow', 0.0))
    for node in tree.nodes:
        if not (node.keep and node.mesh and node.drawn):
            continue
        radial = radial_for(node.radius, radial_scale)
        # a little darker at the foot of the trunk and deep in the crown: cheap ambient occlusion
        shade = 1 - bark_shade * node.hidden
        color = np.array([shade, shade, shade, 1.0])
        flare = float(ts.get('flare', 0.0)) if (node.trunk and node.parent is None) else 0.0
        stride = ring_stride if not node.trunk else max(1, ring_stride // 2 + (ring_stride > 1))
        bark.add(*tube(node.spine, radial, tile, color, flare=flare, ring_stride=stride, snow=snow))
    if not with_leaves:
        return bark, leaves
    n = tree.cells
    ls = _leaf_spec_defaults(tree.spec.get('leaves', {}))
    anchor = 0.5 if ls['mode'] == 'frond' else float(ls['anchor'])
    for leaf in tree.leaves:
        if not leaf.keep:
            continue
        cx, cy = leaf.cell % n, leaf.cell // n
        cell = (cx / n, cy / n, (cx + 1) / n, (cy + 1) / n)
        leaves.add(*card(leaf.pos, leaf.along, leaf.across, leaf.width * leaf.grow, leaf.height * leaf.grow,
                         leaf.normal, cell, leaf.color, leaf.fold, anchor))
    return bark, leaves
