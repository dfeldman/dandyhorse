"""
The plant generator: grasses, ferns, flowers, palms and cacti as game-ready GLBs, for everything on a
route that is not a tree or a rock. Same driver, materials, export and library mechanism as the tree
generators (tools/treekit); the shapes are in plantkit.py.

    npm run plants -- --species sunflower --seed 3 --preview
    npm run plants -- --library                          -> public/plants/

A plant file is a root node with LOD0..LOD2 children; each is a mesh with up to three primitives: stem
(opaque: green skin, palm bark or cactus skin), leaves and heads (alpha-masked cards). Y up, metres,
origin on the ground. Extras: species, kind 'plant', form, height, bounds and per-LOD triangle counts.
LODs for cards drop a fraction of them and grow the rest, as the trees do.
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

from treekit import blendkit  # noqa: E402
from treekit.genkit import Generator, run  # noqa: E402
from plantkit import build_plant  # noqa: E402

CACHE = HERE.parent / 'cache' / 'plantgen'
SKINS = {'stem': ('skin_stem_diff.jpg', 'flat_arm.jpg', None), 'palm': ('bark_palm_diff_512.jpg', 'bark_palm_arm_512.jpg', 'bark_palm_nor_gl_512.jpg'),
         'cactus': ('skin_cactus_diff.jpg', 'flat_arm.jpg', None)}


def surface(spec: dict, size: int) -> tuple[Path, Path, Path | None]:
    diff, arm, nor = SKINS[spec.get('skin', 'stem')]
    return CACHE / diff, CACHE / arm, (CACHE / nor if nor else None)


def material_for(role: str, spec: dict, args, materials: dict):
    if role in ('stem', 'body'):
        key = ('skin', spec.get('skin', 'stem'))
        if key not in materials:
            diff, arm, nor = surface(spec, args.bark_size)
            materials[key] = blendkit.bark_material(f'skin_{key[1]}', diff, arm, None if args.no_normals else nor)
        return materials[key]
    page = spec.get(f'{role}_page', spec.get('page', 'grass_tuft'))
    key = ('page', page)
    if key not in materials:
        sfx = '' if args.leaf_size == 1024 else '_512'
        if page.startswith('tree:'):
            # a bush is a crown without a tree: it borrows the deciduous leaf-cluster pages
            path = CACHE.parent / 'deciduousgen' / f"leaf_{page[5:]}_atlas{sfx}.png"
        else:
            path = CACHE / f'{page}_atlas{sfx}.png'
        materials[key] = blendkit.leaf_material(f"page_{page.replace(':', '_')}", path, 0.7)
    return materials[key]


def thin(parts: dict, keep: float, grow: float, seed: int) -> dict:
    """An LOD of card parts: keep a fraction of the cards (whole quads), grow the rest; tubes stay."""
    out = {}
    rng = np.random.default_rng(seed)
    for role, m in parts.items():
        if role in ('stem', 'body') or keep >= 1.0:
            out[role] = m
            continue
        from treekit.mesh import MeshData
        n = MeshData()
        total = len(m.positions)
        want = max(1, int(round(total * keep)))
        chosen = set(rng.permutation(total)[:want].tolist())
        for i, (pos, nor, uv, col, tri) in enumerate(zip(m.positions, m.normals, m.uvs, m.colors, m.indices)):
            if i in chosen:
                c = pos.mean(axis=0)
                n.add(c + (pos - c) * grow, nor, uv, col, tri - tri.min())
        out[role] = n
    return out


def build_one(gen: Generator, spec: dict, seed: int, name: str, args, materials: dict) -> dict:
    import bpy
    t0 = time.time()
    scale = float(spec.get('scale', 1.0))
    parts, info = build_plant(spec, seed, scale)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    counts, lods, bounds = [], [], None
    for k in range(max(1, min(args.lods, 3))):
        keep, grow = ((1.0, 1.0), (0.5, 1.35), (0.25, 1.8))[k]
        lp = thin(parts, keep, grow, seed + k)
        pieces = [(role, m.merged(), material_for(role, spec, args, materials)) for role, m in lp.items() if m.count]
        allpos = np.vstack([p[1][0] for p in pieces])
        if k == 0:
            bounds = {'top': round(float(allpos[:, 2].max()), 2), 'radius': round(float(np.hypot(allpos[:, 0], allpos[:, 1]).max()), 2),
                      'bottom': round(float(allpos[:, 2].min()), 2)}
        ob = blendkit.make_object(f'LOD{k}', pieces)
        ob.parent = root
        ob['lod'] = k
        tris = {role: m.triangles for role, m in lp.items()}
        counts.append({'bark': tris.get('stem', 0) + tris.get('body', 0), 'leaves': sum(v for r, v in tris.items() if r not in ('stem', 'body'))})
        lods.append(ob)
    meta = {'species': spec.get('name'), 'kind': 'plant', 'form': info['form'], 'seed': seed, 'height': info.get('height', bounds['top']),
            'bounds': bounds, 'season': spec.get('season', 'summer'), 'lods': counts, 'generator': 'trailtrainer plantgen'}
    for k2, v in meta.items():
        root[k2] = json.dumps(v) if isinstance(v, (list, dict)) else v
    meta['build_s'] = round(time.time() - t0, 2)
    return {'root': root, 'lods': lods, 'meta': meta, 'tree': None, 'preview_height': max(bounds['top'] * 1.3, bounds['radius'] * 1.6, 0.6)}


if __name__ == '__main__':
    run(Generator(name='plantgen', here=HERE, cache=CACHE, default_out=HERE.parent.parent / 'public' / 'plants',
                  doc=__doc__, bark=surface, leaves=None), build=build_one)
