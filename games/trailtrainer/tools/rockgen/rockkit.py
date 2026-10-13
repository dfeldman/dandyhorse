"""
Rocks, as numpy arrays: boulders, clusters and pebble fields.

A boulder starts as an icosphere, is squashed or stretched into its overall shape, cut by a few random
planes so it has the flat faces a broken rock has, and then displaced along its normals by layered value
noise for the bumps. Every LOD comes from the same noise at a coarser sphere, so it is the same rock.
UVs are a box projection chosen per triangle by its normal, with the vertices split per face, which is
what keeps a photographed rock surface from stretching over a shape no unwrap was made for.

Moss and lichen are vertex colour, which on a grey rock is enough: multiplying grey by a green gives
moss-green, and the noise mask that places it is heavier on the upper, more sheltered faces.
"""
from __future__ import annotations

import warnings

import numpy as np

warnings.filterwarnings('ignore', category=RuntimeWarning)  # Accelerate's matmul warns on finite data

from treekit.mesh import MeshData
from treekit.rng import stream

# ---------------------------------------------------------------- noise

def _hash3(ix: np.ndarray, iy: np.ndarray, iz: np.ndarray, seed: int) -> np.ndarray:
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + iz.astype(np.int64) * 1274126177 + seed * 97) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296.0


def value_noise(p: np.ndarray, seed: int) -> np.ndarray:
    """Trilinear value noise in [0,1] at points p (n,3)."""
    i = np.floor(p)
    f = p - i
    f = f * f * (3 - 2 * f)
    ix, iy, iz = i[:, 0], i[:, 1], i[:, 2]
    out = np.zeros(len(p))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out += w * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return out


def fbm(p: np.ndarray, seed: int, octaves: int = 4, lacunarity: float = 2.1, gain: float = 0.5) -> np.ndarray:
    """Layered noise in about [-1, 1]."""
    out = np.zeros(len(p))
    amp, freq, total = 1.0, 1.0, 0.0
    for k in range(octaves):
        out += amp * (value_noise(p * freq + k * 17.3, seed + k) * 2 - 1)
        total += amp
        amp *= gain
        freq *= lacunarity
    return out / total


# ---------------------------------------------------------------- icosphere

def icosphere(subdivisions: int) -> tuple[np.ndarray, np.ndarray]:
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
                  [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], dtype=float)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6],
                  [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10],
                  [8, 6, 7], [9, 8, 1]])
    verts = [tuple(x) for x in v]
    for _ in range(subdivisions):
        cache: dict = {}
        vlist = list(verts)

        def mid(a: int, b: int) -> int:
            key = (min(a, b), max(a, b))
            if key not in cache:
                m = (np.array(vlist[a]) + np.array(vlist[b])) / 2
                m /= np.linalg.norm(m)
                vlist.append(tuple(m))
                cache[key] = len(vlist) - 1
            return cache[key]
        nf = []
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        f = np.array(nf)
        verts = vlist
    return np.array(verts), f


# ---------------------------------------------------------------- boulders

def boulder(seed: int, size: float, shape: np.ndarray, cuts: int, roughness: float, detail: float,
            subdivisions: int, noise_seed: int, op: str | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    One boulder: positions, per-vertex normals, faces. `shape` scales the three axes (flat, tall, long),
    `cuts` is how many planes slice it, `roughness` the large bump amplitude, `detail` the fine one.
    The noise is sampled in the rock's own scaled space, so every LOD sees the same bumps.
    """
    rng = stream(seed, 11)
    v, f = icosphere(subdivisions)
    # random orientation of the sphere's own poles, then the shape
    axis = rng.normal(size=3)
    axis /= np.linalg.norm(axis)
    ang = rng.uniform(0, np.pi)
    c, s_ = np.cos(ang), np.sin(ang)
    v = v * c + np.cross(axis, v) * s_ + np.outer(v @ axis, axis) * (1 - c)
    p = v * shape
    # plane cuts: everything beyond a plane is pressed flat onto it
    for k in range(cuts):
        n = rng.normal(size=3)
        n /= np.linalg.norm(n)
        d = rng.uniform(0.35, 0.7) * float(np.max(np.abs(shape)))
        over = p @ n - d
        m = over > 0
        p[m] -= np.outer(over[m], n)
    # bumps: two scales of noise along the sphere normal
    nrm = v.copy()
    lumps = fbm(p * 0.7 + 1.3, noise_seed + 9, 2) * roughness * 1.6      # the overall asymmetry
    big = fbm(p * 1.8 + 3.1, noise_seed, 3) * roughness
    fine = fbm(p * 6.0 + 9.7, noise_seed + 5, 3) * detail
    p = p + nrm * (lumps + big + fine)[:, None] * float(np.mean(shape))
    if op == 'wedge':
        # one end tall, the other low: height scales along x
        t = (p[:, 0] - p[:, 0].min()) / max(np.ptp(p[:, 0]), 1e-6)
        p[:, 2] *= 0.35 + 0.65 * t
    elif op == 'dome':
        # a flat underside: everything below a plane is pressed onto it
        zmin = p[:, 2].min() + 0.4 * np.ptp(p[:, 2])
        p[:, 2] = np.maximum(p[:, 2], zmin)
    elif op == 'split':
        # cracked in two along a plane, the halves pushed apart a little
        n = rng.normal(size=3)
        n[2] *= 0.3
        n /= np.linalg.norm(n)
        side = np.sign(p @ n)
        p += np.outer(side, n) * 0.12 * float(np.mean(shape))
    p *= size
    # sit on the ground: lowest point a little below z = 0, so it looks bedded in
    p[:, 2] -= p[:, 2].min() + 0.08 * size
    # smooth normals from the deformed mesh
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    vn = np.zeros_like(p)
    for k in range(3):
        np.add.at(vn, f[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    return p, vn, f


def box_uv_split(p: np.ndarray, n: np.ndarray, f: np.ndarray, tile: float, facet: float = 0.0) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Split vertices per face and give each face a planar UV along its dominant normal axis. `facet` blends
    the smooth normals toward the face normal: 1 is flat shading, which is what a broken rock looks like."""
    tri = f.reshape(-1)
    pos = p[tri]
    nor = n[tri]
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    if facet > 0:
        fnu = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
        nor = nor * (1 - facet) + np.repeat(fnu, 3, axis=0) * facet
        nor /= np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9)
    axis = np.argmax(np.abs(fn), axis=1)                # 0 x, 1 y, 2 z
    axis = np.repeat(axis, 3)
    uv = np.zeros((len(pos), 2))
    for a, (u, w) in enumerate(((1, 2), (0, 2), (0, 1))):
        m = axis == a
        uv[m, 0] = pos[m, u] / tile
        uv[m, 1] = pos[m, w] / tile
    faces = np.arange(len(pos)).reshape(-1, 3)
    return pos, nor, uv, faces


def moss_colour(pos: np.ndarray, nor: np.ndarray, seed: int, moss: float, lichen: float, tint: np.ndarray,
                size: float) -> np.ndarray:
    """Vertex colour: the rock's own tint, moss on sheltered upper faces, lichen in patches anywhere."""
    col = np.tile(np.append(tint, 1.0), (len(pos), 1))
    if moss > 0:
        up = np.clip(nor[:, 2], 0, 1)
        m = value_noise(pos / max(size, 0.2) * 2.3 + 5.0, seed + 31)
        mask = np.clip((m - (0.6 - 0.4 * moss)) * 4.0, 0, 1) * (0.2 + 0.8 * up) * min(1.0, moss * 1.3)
        green = np.array([0.3, 0.48, 0.14])
        col[:, :3] = col[:, :3] * (1 - mask[:, None]) + green * mask[:, None]
    if lichen > 0:
        m = value_noise(pos / max(size, 0.2) * 5.0 + 11.0, seed + 47)
        mask = np.clip((m - (0.68 - 0.3 * lichen)) * 6.0, 0, 1) * min(1.0, lichen * 1.5)
        pale = np.array([0.72, 0.75, 0.45])
        col[:, :3] = col[:, :3] * (1 - mask[:, None]) + pale * mask[:, None]
    # a little darker toward the ground, where a rock is damp and shaded
    z = pos[:, 2] / max(pos[:, 2].max(), 1e-6)
    col[:, :3] *= (0.75 + 0.25 * np.clip(z, 0, 1))[:, None]
    return col


# ---------------------------------------------------------------- assemblies

# shape archetypes: axis scale ranges, then how many plane cuts, a roughness multiplier, and a facet
# (0 smooth .. 1 flat-shaded), plus an op that only some shapes have
SHAPES = {
    'round':  {'axes': ([0.9, 1.1], [0.9, 1.1], [0.8, 1.0]), 'cuts': (1, 3), 'rough': 1.0, 'facet': 0.3},
    'egg':    {'axes': ([1.0, 1.3], [0.8, 1.0], [0.75, 0.95]), 'cuts': (0, 1), 'rough': 0.7, 'facet': 0.15},
    'flat':   {'axes': ([1.1, 1.5], [0.9, 1.3], [0.35, 0.55]), 'cuts': (2, 4), 'rough': 1.0, 'facet': 0.4},
    'slab':   {'axes': ([1.4, 1.9], [1.1, 1.5], [0.22, 0.38]), 'cuts': (3, 6), 'rough': 0.6, 'facet': 0.6},
    'tall':   {'axes': ([0.6, 0.85], [0.6, 0.85], [1.3, 1.9]), 'cuts': (2, 5), 'rough': 1.0, 'facet': 0.4},
    'long':   {'axes': ([1.3, 1.8], [0.6, 0.85], [0.6, 0.85]), 'cuts': (2, 4), 'rough': 1.0, 'facet': 0.35},
    'block':  {'axes': ([1.0, 1.3], [0.85, 1.1], [0.7, 1.0]), 'cuts': (7, 12), 'rough': 0.45, 'facet': 1.0},
    'shard':  {'axes': ([1.2, 1.6], [0.3, 0.45], [1.2, 1.8]), 'cuts': (3, 6), 'rough': 0.5, 'facet': 0.9},
    'wedge':  {'axes': ([1.2, 1.6], [0.8, 1.1], [0.7, 1.1]), 'cuts': (2, 5), 'rough': 0.8, 'facet': 0.6, 'op': 'wedge'},
    'dome':   {'axes': ([1.0, 1.3], [0.9, 1.2], [0.6, 0.9]), 'cuts': (0, 2), 'rough': 0.9, 'facet': 0.2, 'op': 'dome'},
    'lumpy':  {'axes': ([0.9, 1.2], [0.9, 1.2], [0.8, 1.1]), 'cuts': (0, 2), 'rough': 2.2, 'facet': 0.25},
    'split':  {'axes': ([1.1, 1.4], [0.9, 1.2], [0.8, 1.0]), 'cuts': (2, 4), 'rough': 0.8, 'facet': 0.5, 'op': 'split'},
}


def build_rock(spec: dict, seed: int, subdivisions: int, pebble_subdivisions: int) -> tuple[MeshData, dict]:
    """Everything in the spec -- boulders, then pebbles -- as one mesh; returns it and what was placed."""
    rng = stream(seed, 3)
    mesh = MeshData()
    tile = float(spec.get('tile', 1.5))
    tint = np.array(spec.get('tint', [1.0, 1.0, 1.0]), dtype=float)
    tint = tint * (1 + rng.uniform(-0.06, 0.06, 3))
    moss = float(spec.get('moss', 0.0))
    lichen = float(spec.get('lichen', 0.0))
    placed = []
    # boulders
    n_boulders = int(round(rng.uniform(*spec.get('boulders', [1, 1]))))
    size = float(rng.uniform(*spec.get('size', [1.0, 2.0])))
    centre = np.zeros(3)
    shapes = spec.get('shapes', ['round'])
    weights = spec.get('shape_weights')
    for i in range(n_boulders):
        if weights and len(weights) != len(shapes):
            weights = None
        shape_name = shapes[int(rng.choice(len(shapes), p=np.array(weights) / np.sum(weights)))] if weights else rng.choice(shapes)
        arch = SHAPES[shape_name]
        lo_hi = arch['axes']
        shape = np.array([rng.uniform(*lo_hi[0]), rng.uniform(*lo_hi[1]), rng.uniform(*lo_hi[2])])
        s = size * (1.0 if i == 0 else rng.uniform(0.35, 0.8))
        cuts = int(round(rng.uniform(*arch['cuts']) + float(spec.get('cuts_offset', 0))))
        rough = float(spec.get('roughness', 0.14)) * arch['rough'] * float(rng.uniform(0.75, 1.3))
        facet = float(np.clip(arch['facet'] + float(spec.get('facet_offset', 0)), 0, 1))
        p, n, f = boulder(seed * 7 + i, s, shape, max(0, cuts), rough, float(spec.get('detail', 0.04)), subdivisions, seed,
                          arch.get('op'))
        # yaw, and pack the group: later boulders lean against the first
        yaw = rng.uniform(0, 2 * np.pi)
        rot = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
        p = p @ rot.T
        n = n @ rot.T
        if i > 0:
            a = rng.uniform(0, 2 * np.pi)
            r = size * rng.uniform(0.7, 1.0) + s * 0.5
            p[:, :2] += np.array([np.cos(a), np.sin(a)]) * r
        pos, nor, uv, faces = box_uv_split(p, n, f, tile, facet)
        col = moss_colour(pos, nor, seed + i, moss, lichen, tint, s)
        mesh.add(pos, nor, uv, col, faces)
        placed.append({'kind': 'boulder', 'shape': shape_name, 'size': round(s, 2)})
    # pebbles: many small stones on a disc, half sunk
    n_peb = int(round(rng.uniform(*spec.get('pebbles', [0, 0]))))
    if n_peb:
        radius = float(spec.get('field_radius', 2.0)) * (1 + 0.4 * size)
        pmin, pmax = spec.get('pebble_size', [0.08, 0.3])
        for i in range(n_peb):
            s = float(rng.uniform(pmin, pmax)) * (0.6 + 0.8 * rng.random())
            shape = np.array([rng.uniform(0.8, 1.4), rng.uniform(0.7, 1.1), rng.uniform(0.45, 0.8)])
            p, n, f = boulder(seed * 13 + 100 + i, s, shape, int(spec.get('pebble_cuts', 1)), 0.1, 0.0, pebble_subdivisions, seed + 200)
            yaw = rng.uniform(0, 2 * np.pi)
            rot = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
            p = p @ rot.T
            n = n @ rot.T
            r = radius * np.sqrt(rng.random())
            a = rng.uniform(0, 2 * np.pi)
            p[:, :2] += np.array([np.cos(a), np.sin(a)]) * r
            p[:, 2] -= s * 0.25
            pos, nor, uv, faces = box_uv_split(p, n, f, tile * 0.5, float(np.clip(0.4 + float(spec.get('facet_offset', 0)), 0, 1)))
            col = moss_colour(pos, nor, seed + 300 + i, moss * 0.5, lichen * 0.3, tint, s)
            mesh.add(pos, nor, uv, col, faces)
        placed.append({'kind': 'pebbles', 'count': n_peb, 'radius': round(radius, 2)})
    return mesh, {'placed': placed, 'size': round(size, 2)}
