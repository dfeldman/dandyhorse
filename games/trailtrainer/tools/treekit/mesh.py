"""
Geometry: sweeping tubes along spines and laying leaf cards, into plain numpy arrays a glTF exporter can
take without knowing what a tree is.

Tubes are where the triangles go, so every ring's side count is decided by the radius at that ring rather
than by the level: a trunk gets ten sides, a bough six, a twig three. The tip closes to a point.
Bark UVs are u around the ring, v = arc length / tile size, so bark never stretches along a long branch and
wraps freely in v -- the reason bark cannot share an atlas with the leaves without SpeedTree's "allow V
wrapping" trick.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .spine import Spine, normalize


@dataclass
class MeshData:
    positions: list = field(default_factory=list)   # (n,3) arrays
    normals: list = field(default_factory=list)
    uvs: list = field(default_factory=list)
    colors: list = field(default_factory=list)      # (n,4)
    indices: list = field(default_factory=list)     # (m,3) int arrays, already offset
    count: int = 0

    def add(self, pos: np.ndarray, nor: np.ndarray, uv: np.ndarray, col: np.ndarray, tri: np.ndarray) -> None:
        self.positions.append(pos)
        self.normals.append(nor)
        self.uvs.append(uv)
        self.colors.append(col)
        self.indices.append(tri + self.count)
        self.count += len(pos)

    def merged(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        if not self.positions:
            z = np.zeros((0, 3))
            return z, z, np.zeros((0, 2)), np.zeros((0, 4)), np.zeros((0, 3), dtype=np.int64)
        return (np.vstack(self.positions), np.vstack(self.normals), np.vstack(self.uvs), np.vstack(self.colors),
                np.vstack(self.indices).astype(np.int64))

    @property
    def triangles(self) -> int:
        return sum(len(i) for i in self.indices)


def radial_for(radius: float, scale: float = 1.0) -> int:
    """How many sides a ring of this radius deserves. `scale` < 1 is what LOD does to it."""
    r = radius
    if r > 0.30:
        n = 10
    elif r > 0.15:
        n = 8
    elif r > 0.06:
        n = 6
    elif r > 0.025:
        n = 5
    elif r > 0.010:
        n = 4
    else:
        n = 3
    return max(3, int(round(n * scale)))


def tube(spine: Spine, radial: int, tile: float, color: np.ndarray, flare: float = 0.0, flare_span: float = 0.15,
         ring_stride: int = 1, snow: float = 0.0) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Sweep a ring of `radial` sides along the spine. `flare` widens the base ring (a trunk's root flare) over
    the first `flare_span` of the length. `ring_stride` > 1 skips spine points, which is how LOD thins a tube
    without regrowing it. Returns positions, normals, uvs, colours, triangles.
    """
    idx = list(range(0, len(spine.points) - 1, ring_stride)) + [len(spine.points) - 1]
    pts = spine.points[idx]
    tgs = spine.tangents[idx]
    nms = spine.normals[idx]
    rad = spine.radii[idx].copy()
    arc = spine.arc[idx]
    ts = arc / max(arc[-1], 1e-9)
    if flare > 0:
        f = np.clip(1 - ts / max(flare_span, 1e-6), 0, 1)
        rad = rad * (1 + flare * f * f)
    n_rings = len(pts)
    ang = np.linspace(0, 2 * np.pi, radial, endpoint=False)
    if snow > 0:
        # every ring's u = 0 faces up, so the snow band in the texture lies along the top of the branch
        up = np.array([0.0, 0.0, 1.0])
        proj = up[None, :] - tgs * tgs[:, 2:3]
        ok = np.linalg.norm(proj, axis=1) > 0.15
        nms = nms.copy()
        nms[ok] = proj[ok] / np.linalg.norm(proj[ok], axis=1, keepdims=True)
    bis = np.cross(tgs, nms)                                   # (n,3)
    ring = (np.cos(ang)[None, :, None] * nms[:, None, :] + np.sin(ang)[None, :, None] * bis[:, None, :])  # (n,r,3)
    pos = (pts[:, None, :] + ring * rad[:, None, None]).reshape(-1, 3)
    nor = ring.reshape(-1, 3)
    # u repeats around thick rings so the bark keeps its scale; v is arc length over the tile
    reps = np.maximum(1.0, np.round(2 * np.pi * rad / tile)) if snow <= 0 else np.ones(n_rings)
    uv = np.stack([np.repeat(reps, radial) * np.tile(ang / (2 * np.pi), n_rings),
                   np.repeat(arc / tile, radial)], axis=1)
    # tip point
    tip = n_rings * radial
    pos = np.vstack([pos, pts[-1] + tgs[-1] * rad[-1] * 0.5])
    nor = np.vstack([nor, tgs[-1]])
    uv = np.vstack([uv, (0.5, arc[-1] / tile + rad[-1] / tile)])
    i = np.repeat(np.arange(n_rings - 1), radial) * radial
    j = np.tile(np.arange(radial), n_rings - 1)
    a = i + j
    b = i + (j + 1) % radial
    c = a + radial
    d = b + radial
    quads = np.stack([np.stack([a, c, b], 1), np.stack([b, c, d], 1)], 1).reshape(-1, 3)
    last = (n_rings - 1) * radial + np.arange(radial)
    cap = np.stack([last, np.full(radial, tip), (n_rings - 1) * radial + (np.arange(radial) + 1) % radial], 1)
    col = np.tile(color, (len(pos), 1))
    if snow > 0:
        # hide the band where it should not be: a vertical trunk holds no snow on its sides, and a thin
        # dusting keeps some bark showing through. Vertex colour multiplies, so darkening is all it can do.
        slope = np.repeat(1 - np.abs(tgs[:, 2]), radial)             # 1 for a horizontal branch
        topness = np.tile(np.clip(np.cos(ang), 0, 1), n_rings)        # 1 at the top of the ring
        keep = np.clip(snow * (0.25 + 0.75 * slope), 0, 1)
        hide = 1 - topness * (1 - keep)                               # 1 on the band when it should show
        band = 0.45 + 0.55 * hide                                      # bark-ish darkness where hidden
        col[:len(band), :3] *= band[:, None]
    return pos, nor, uv, col, np.vstack([quads, cap]).astype(np.int64)


def card(center: np.ndarray, along: np.ndarray, across: np.ndarray, width: float, height: float,
         normal: np.ndarray, uv_cell: tuple[float, float, float, float], color: np.ndarray, fold: float = 0.0,
         anchor: float = 0.0) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    One leaf card: a quad, or two quads bent along `along` by `fold` radians (four triangles that catch light
    from both sides and never vanish edge-on). `anchor` is where along the card the centre sits (0 = base,
    the twig end). Normals are the supplied crown-outward normal at every vertex, not the plane's: a flat
    normal makes a canopy read as a stack of boards.
    """
    # uv_cell is in image fractions, top-down (as pages.py lays cells out); Blender's v runs bottom-up,
    # so the card's base takes the cell's lower edge and its tip the upper one after flipping
    u0, pv0, u1, pv1 = uv_cell
    v0, v1 = 1 - pv1, 1 - pv0          # v0 is now the image-bottom of the cell, v1 its top
    a = normalize(along)
    x = normalize(across - a * np.dot(across, a))
    n = normalize(np.cross(a, x))
    base = center - a * height * anchor
    if fold <= 0.001:
        p = np.array([
            base - x * width / 2, base + x * width / 2,
            base + x * width / 2 + a * height, base - x * width / 2 + a * height])
        uv = np.array([[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
        tri = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    else:
        # crease along the spine: the two halves lift by fold/2 each
        lift = np.sin(fold / 2) * width / 2
        w = np.cos(fold / 2) * width / 2
        um = (u0 + u1) / 2
        p = np.array([
            base - x * w + n * lift, base, base + x * w + n * lift,
            base - x * w + n * lift + a * height, base + a * height, base + x * w + n * lift + a * height])
        uv = np.array([[u0, v0], [um, v0], [u1, v0], [u0, v1], [um, v1], [u1, v1]])
        tri = np.array([[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]], dtype=np.int64)
    nor = np.tile(normalize(normal), (len(p), 1))
    col = np.tile(color, (len(p), 1))
    return p, nor, uv, col, tri
