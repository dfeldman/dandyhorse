"""
Plants that are not trees, as numpy arrays: tufts, flowers, palms and cacti.

Four archetypes cover the lot. A `tuft` is cards fanned out from one point on the ground -- grass clumps,
prairie tussocks, ferns, a dandelion's rosette. A `flower` is one or more thin stems, each with a rosette
at its foot and a head at its top: a disc tilted up for daisies and dandelions, a pair of crossed upright
cards for tulips, a single card facing sideways for a sunflower. A `palm` is a leaning trunk with a crown
of drooping frond spines, each carrying frond cards, and a few dead fronds hanging under them. A `cactus`
is a ribbed trunk with arms that leave it sideways and curve up. Spines come from treekit; so do tubes
and cards. Everything is a function of the spec and the seed.
"""
from __future__ import annotations

import numpy as np

from treekit.curves import Curve
from treekit.mesh import MeshData, card, tube
from treekit.rng import stream
from treekit.spine import UP, any_perpendicular, grow, normalize, rotate


def _cell(i: int, n: int = 2) -> tuple[float, float, float, float]:
    cx, cy = i % n, i // n
    return (cx / n, cy / n, (cx + 1) / n, (cy + 1) / n)


def _colour(rng: np.random.Generator, tint, light_var: float, ao: float = 0.0) -> np.ndarray:
    c = np.ones(4)
    c[:3] = np.asarray(tint, dtype=float) * (1 + rng.uniform(-light_var, light_var)) * (1 - ao)
    c[:3] = np.clip(c[:3], 0, 1)
    return c


# ---------------------------------------------------------------- tufts

def tuft(mesh: MeshData, spec: dict, rng: np.random.Generator, base: np.ndarray, scale: float = 1.0,
         cells: list | None = None) -> None:
    """Cards fanned round a point: `cards`, `height`, `width` (fraction of height), `lean` degrees off
    vertical, `spread` metres the bases scatter, `cross` adds a second card at 90° to some."""
    n = int(round(rng.uniform(*spec.get('cards', [5, 8]))))
    h0 = float(rng.uniform(*spec.get('height', [0.4, 0.8]))) * scale
    tint = spec.get('tint', [1, 1, 1])
    lv = float(spec.get('light_var', 0.12))
    cells = cells if cells is not None else list(range(4))
    phase = rng.uniform(0, 2 * np.pi)
    for i in range(n):
        a = phase + i * 2 * np.pi / n + rng.uniform(-0.4, 0.4)
        out = np.array([np.cos(a), np.sin(a), 0.0])
        lean = np.deg2rad(rng.uniform(*spec.get('lean', [10, 30])))
        along = normalize(UP * np.cos(lean) + out * np.sin(lean))
        across = normalize(np.cross(along, out + rng.normal(0, 0.1, 3)))
        h = h0 * rng.uniform(0.8, 1.15)
        w = h * float(spec.get('width', 0.8)) * rng.uniform(0.85, 1.15)
        p = base + out * rng.uniform(0, float(spec.get('spread', 0.1))) * scale
        normal = normalize(out * 0.6 + UP * 0.8)
        col = _colour(rng, tint, lv, float(spec.get('ao', 0.15)) * (1 - i / max(n, 1)))
        mesh.add(*card(p, along, across, w, h, normal, _cell(int(rng.choice(cells))), col, 0.0, 0.0))
        if rng.uniform() < float(spec.get('cross', 0.0)):
            across2 = normalize(np.cross(along, across))
            mesh.add(*card(p, along, across2, w, h, normalize(np.cross(along, across2) + UP * 0.5), _cell(int(rng.choice(cells))), col, 0.0, 0.0))


# ---------------------------------------------------------------- bushes

def bush(leaves: MeshData, heads: MeshData, spec: dict, rng: np.random.Generator, scale: float) -> None:
    """Cards over a dome: `cards`, `height`, `width` (dome radius), each card standing on a point in the
    volume, leaning outward, its normal out of the dome; `flowers` scatters head cards on the surface."""
    n = int(round(rng.uniform(*spec.get('cards', [14, 24]))))
    h = float(rng.uniform(*spec.get('height', [0.6, 1.2]))) * scale
    w = float(rng.uniform(*spec.get('width', [0.6, 1.0]))) * scale
    size = float(spec.get('card', 0.55))
    tint = spec.get('tint', [1, 1, 1])
    lv = float(spec.get('light_var', 0.12))
    cells = spec.get('cells', [0, 1, 2, 3])
    ch0 = h * size
    for i in range(n):
        # a point on (or just inside) the dome's surface; the card stands there, its top near the surface
        a = rng.uniform(0, 2 * np.pi)
        rr = w * rng.uniform(0.0, 1.0) ** 0.7 * rng.uniform(0.85, 1.0)   # a fair share at the crown, so it is not hollow
        out = np.array([np.cos(a), np.sin(a), 0.0])
        zs = h * (1 - (rr / w) ** 2) ** 0.5
        ch = ch0 * rng.uniform(0.8, 1.2)
        cw = ch * float(spec.get('aspect', 1.0))
        p = out * rr * 0.85 + UP * max(0.0, zs - ch * rng.uniform(0.6, 1.0))
        lean = np.deg2rad(rng.uniform(5, 25) + 40 * (rr / w) ** 2)
        along = normalize(UP * np.cos(lean) + out * np.sin(lean))
        across = normalize(np.cross(along, out + rng.normal(0, 0.25, 3)))
        normal = normalize(out * (0.4 + 0.6 * rr / w) + UP * (1.0 - 0.5 * rr / w))
        col = _colour(rng, tint, lv, float(spec.get('ao', 0.3)) * (1 - rr / w))
        leaves.add(*card(p, along, across, cw, ch, normal, _cell(int(rng.choice(cells))), col, 0.0, 0.0))
        if rng.uniform() < float(spec.get('cross', 0.3)):
            across2 = normalize(np.cross(along, across))
            leaves.add(*card(p, along, across2, cw, ch, normalize(np.cross(along, across2) * 0.3 + normal), _cell(int(rng.choice(cells))), col, 0.0, 0.0))
    fl = spec.get('flowers')
    if fl:
        m = int(round(rng.uniform(*fl.get('count', [4, 10]))))
        for i in range(m):
            a = rng.uniform(0, 2 * np.pi)
            rr = w * rng.uniform(0.2, 0.95)
            out = np.array([np.cos(a), np.sin(a), 0.0])
            z = h * 0.75 * (1 - (rr / w) ** 2) ** 0.5 + h * 0.15
            p = out * rr + UP * z
            fs = float(rng.uniform(*fl.get('size', [0.06, 0.1]))) * scale
            normal = normalize(out * 0.5 + UP * 0.9)
            along = normalize(np.cross(normal, any_perpendicular(normal)))
            heads.add(*card(p, along, normalize(np.cross(normal, along)), fs, fs, normal, _cell(int(rng.choice(fl.get('cells', [0, 1, 2, 3])))),
                            _colour(rng, fl.get('tint', [1, 1, 1]), 0.08), 0.0, 0.5))


# ---------------------------------------------------------------- flowers

def flower(stems: MeshData, leaves: MeshData, heads: MeshData, spec: dict, rng: np.random.Generator, scale: float) -> None:
    n = int(round(rng.uniform(*spec.get('stems', [1, 3]))))
    tint = spec.get('tint', [1, 1, 1])
    lv = float(spec.get('light_var', 0.1))
    hs = spec.get('head', {})
    for i in range(n):
        base = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0.0]) * float(spec.get('spread', 0.15)) * scale if n > 1 else np.zeros(3)
        h = float(rng.uniform(*spec.get('height', [0.3, 0.6]))) * scale
        r = float(spec.get('stem_radius', 0.006)) * (0.6 + 0.4 * scale)
        lean = np.deg2rad(rng.uniform(0, float(spec.get('lean', 8))))
        d0 = rotate(UP, any_perpendicular(UP), lean)
        d0 = rotate(d0, UP, rng.uniform(0, 2 * np.pi))
        sp = grow(base, d0, h, max(3, int(h / 0.12)), r, r * 0.5, Curve.of([1.0, 0.85, 0.7]), Curve.of(float(spec.get('tropism', 0.2))),
                  float(spec.get('wander', 0.3)), 0.0, 0.0, stream(int(rng.integers(1 << 30)), 1))
        stems.add(*tube(sp, 4, 0.3, _colour(rng, [1, 1, 1], 0.1)))
        if spec.get('rosette'):
            tuft(leaves, spec['rosette'], rng, base, scale, spec['rosette'].get('cells'))
        # leaves up the stem
        for k in range(int(round(rng.uniform(*spec.get('stem_leaves', [0, 0]))))):
            t = rng.uniform(0.25, 0.75)
            p, tg, nm, _ = sp.at(t)
            out = rotate(nm, tg, rng.uniform(0, 2 * np.pi))
            along = normalize(out * 0.8 + UP * 0.35)
            size = float(spec.get('leaf_size', 0.12)) * scale
            leaves.add(*card(p, along, normalize(np.cross(along, UP + rng.normal(0, 0.1, 3))), size * 0.6, size, normalize(UP * 0.7 + out * 0.4),
                             _cell(int(rng.choice(spec.get('leaf_cells', [0, 1, 2, 3])))), _colour(rng, tint, lv), 0.0, 0.0))
        # the head
        p, tg, nm, _ = sp.at(1.0)
        size = float(rng.uniform(*hs.get('size', [0.08, 0.12]))) * (0.7 + 0.3 * scale)
        cell = _cell(int(rng.choice(hs.get('cells', [0, 1, 2, 3]))))
        col = _colour(rng, hs.get('tint', [1, 1, 1]), float(hs.get('light_var', 0.08)))
        mode = hs.get('mode', 'disc')
        if mode in ('disc', 'both'):
            # a card lying nearly flat on the stem's tip, tilted a little off the stem's own direction
            tilt = np.deg2rad(rng.uniform(*hs.get('tilt', [10, 35])))
            normal = rotate(tg, rotate(nm, tg, rng.uniform(0, 2 * np.pi)), tilt)
            along = normalize(np.cross(normal, any_perpendicular(normal)))
            across = normalize(np.cross(normal, along))
            heads.add(*card(p + tg * size * 0.05, along, across, size, size, normal, cell, col, 0.0, 0.5))
            if mode == 'both':
                # and one standing card, so the head reads from the side as well as from above
                face = rotate(nm, tg, rng.uniform(0, 2 * np.pi))
                heads.add(*card(p - tg * size * 0.45, tg, normalize(np.cross(face, tg)), size * 0.9, size * 0.9, face, cell, col, 0.0, 0.0))
        elif mode == 'facing':
            # a sunflower: one big card standing on the stem's tip, facing one way
            face = rotate(nm, tg, rng.uniform(0, 2 * np.pi))
            along = tg
            across = normalize(np.cross(face, along))
            heads.add(*card(p - tg * size * 0.1, along, across, size, size, face, cell, col, 0.0, 0.0))
        else:
            # crossed upright cards: a tulip's cup seen from any side
            for k in range(2):
                across = rotate(nm, tg, k * np.pi / 2 + rng.uniform(-0.2, 0.2))
                heads.add(*card(p - tg * size * 0.05, tg, across, size * float(hs.get('aspect', 0.8)), size,
                                normalize(np.cross(tg, across) + UP * 0.4), cell, col, 0.0, 0.0))


# ---------------------------------------------------------------- palms

def palm(trunk: MeshData, fronds: MeshData, spec: dict, rng: np.random.Generator, scale: float) -> dict:
    h = float(rng.uniform(*spec.get('height', [4, 10]))) * scale
    r = float(spec.get('radius', 0.028)) * h ** 0.75
    lean = np.deg2rad(rng.uniform(*spec.get('lean', [3, 18])))
    d0 = rotate(UP, np.array([1.0, 0, 0]), lean)
    d0 = rotate(d0, UP, rng.uniform(0, 2 * np.pi))
    sp = grow(np.zeros(3), d0, h, max(6, int(h / 0.7)), r, r * 0.65, Curve.of([1.0, 0.9, 0.85, 0.8, 0.85]), Curve.of(float(spec.get('tropism', 0.25))),
              float(spec.get('wander', 0.08)), 0.0, 0.0, stream(int(rng.integers(1 << 30)), 2))
    trunk.add(*tube(sp, 8, float(spec.get('tile', 0.9)), _colour(rng, [1, 1, 1], 0.05), flare=0.6, flare_span=0.12))
    top, tg, nm, _ = sp.at(1.0)
    n = int(round(rng.uniform(*spec.get('fronds', [9, 15]))))
    flen = float(rng.uniform(*spec.get('frond_length', [0.28, 0.38]))) * h
    tint = spec.get('tint', [1, 1, 1])
    phase = rng.uniform(0, 2 * np.pi)
    for i in range(n + int(round(rng.uniform(*spec.get('dead', [2, 5]))))):
        dead = i >= n
        a = phase + i * 2.399 + rng.uniform(-0.3, 0.3)
        out = rotate(nm, tg, a)
        ang = np.deg2rad(rng.uniform(*spec.get('angle', [25, 95]))) if not dead else np.deg2rad(rng.uniform(140, 170))
        d = normalize(tg * np.cos(ang) + out * np.sin(ang))
        fs = grow(top - tg * r * 0.5, d, flen * (0.7 if dead else 1.0), 6, 0.02, 0.01, Curve.of([1.0, 0.5]),
                  Curve.of(-float(spec.get('droop', 1.2)) if not dead else -0.5), 0.15, 0.0, 0.0, stream(int(rng.integers(1 << 30)), 3))
        # two or three cards along each frond, wider toward the middle
        k = 3 if flen > 2.0 else 2
        col = _colour(rng, [0.55, 0.45, 0.25] if dead else tint, 0.1)
        for j in range(k):
            t0, t1 = j / k, (j + 1) / k
            p0, tg0, nm0, _ = fs.at(t0)
            p1, tg1, nm1, _ = fs.at(min(t1, 1.0))
            mid = (p0 + p1) / 2
            along = normalize(p1 - p0)
            across = normalize(np.cross(along, UP + rng.normal(0, 0.05, 3)))
            length = float(np.linalg.norm(p1 - p0)) * 1.15
            width = flen * float(spec.get('frond_width', 0.22)) * (1.0 if j < k - 1 else 0.7)
            fronds.add(*card(mid, along, across, width, length, normalize(UP * 0.7 + out * 0.4), _cell(int(rng.integers(0, 4))), col, 0.0, 0.5))
    return {'height': round(h, 2)}


# ---------------------------------------------------------------- cacti

def cactus(body: MeshData, spec: dict, rng: np.random.Generator, scale: float) -> dict:
    h = float(rng.uniform(*spec.get('height', [2, 7]))) * scale
    r = float(spec.get('radius', 0.09)) * h ** 0.6
    sp = grow(np.zeros(3), UP, h, max(5, int(h / 0.5)), r, r * float(spec.get('tip', 0.55)), Curve.of(spec.get('taper', [1.0, 1.05, 1.0, 0.9, 0.7])), Curve.of(0.6),
              float(spec.get('wander', 0.05)), 0.0, 0.0, stream(int(rng.integers(1 << 30)), 4))
    tile = float(spec.get('tile', 0.5))
    body.add(*tube(sp, int(spec.get('radial', 10)), tile, _colour(rng, spec.get('tint', [1, 1, 1]), 0.06)))
    arms = int(round(rng.uniform(*spec.get('arms', [0, 4]))))
    lo, hi = spec.get('arm_at', [0.3, 0.7])
    phase = rng.uniform(0, 2 * np.pi)
    for i in range(arms):
        t = rng.uniform(lo, hi)
        p, tg, nm, pr = sp.at(t)
        out = rotate(nm, tg, phase + i * 2.399 + rng.uniform(-0.4, 0.4))
        length = h * float(rng.uniform(*spec.get('arm_length', [0.25, 0.5])))
        ar = pr * float(spec.get('arm_radius', 0.7))
        # the arm runs out sideways for a stretch, then turns up: tropism grows along its length
        asp = grow(p + out * pr * 0.2, normalize(out + UP * 0.05), length, max(6, int(length / 0.2)), ar, ar * 0.75,
                   Curve.of([1.0, 1.0, 0.95, 0.85]), Curve.of([0.3, 1.5, float(spec.get('arm_tropism', 3.0)), 4.0]), 0.08, 0.0, 0.0,
                   stream(int(rng.integers(1 << 30)), 5 + i))
        body.add(*tube(asp, int(spec.get('radial', 10)) - 2, tile, _colour(rng, spec.get('tint', [1, 1, 1]), 0.06)))
    return {'height': round(h, 2), 'arms': arms}


# ---------------------------------------------------------------- build

def build_plant(spec: dict, seed: int, scale: float = 1.0) -> tuple[dict, dict]:
    """Returns {part: MeshData} keyed by material role ('stem', 'leaves', 'heads', 'fronds', 'body') and info."""
    rng = stream(seed, 21)
    form = spec.get('form', 'tuft')
    parts: dict = {}
    info: dict = {'form': form}
    if form == 'tuft':
        m = MeshData()
        n_clumps = int(round(rng.uniform(*spec.get('clumps', [1, 1]))))
        for i in range(n_clumps):
            base = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0.0]) * float(spec.get('clump_spread', 0.3)) * scale if n_clumps > 1 else np.zeros(3)
            tuft(m, spec, rng, base, scale)
        parts['leaves'] = m
    elif form == 'bush':
        leaves, heads = MeshData(), MeshData()
        bush(leaves, heads, spec, rng, scale)
        parts.update(leaves=leaves, heads=heads)
    elif form == 'flower':
        stems, leaves, heads = MeshData(), MeshData(), MeshData()
        flower(stems, leaves, heads, spec, rng, scale)
        parts.update(stem=stems, leaves=leaves, heads=heads)
    elif form == 'palm':
        trunk, fronds = MeshData(), MeshData()
        info.update(palm(trunk, fronds, spec, rng, scale))
        parts.update(stem=trunk, fronds=fronds)
    elif form == 'cactus':
        body = MeshData()
        info.update(cactus(body, spec, rng, scale))
        parts['stem'] = body
    return parts, info
