"""
The rock generator: boulders, boulder groups and pebble fields as game-ready GLBs with LODs, for the
rocky ground of a mountain route. Same driver, materials, export and library mechanism as the tree
generators (tools/treekit); the shapes themselves are in rockkit.py.

    npm run rocks -- --species boulder --seed 3 --preview
    npm run rocks -- --library                          -> public/rocks/

A rock file is a root node with LOD0..LOD2 children, one primitive each (opaque PBR rock: colour, normal,
occlusion/roughness), vertex colour carrying the rock's tint, its moss and its lichen. Y up, metres,
origin on the ground under the group's first boulder. Extras: species, kind 'rock', the shapes placed,
the size, bounds and per-LOD triangle counts.
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
from rockkit import build_rock  # noqa: E402

CACHE = HERE.parent / 'cache' / 'rockgen'


def surface(spec: dict, size: int) -> tuple[Path, Path, Path]:
    key = spec.get('surface', 'grey')
    sfx = '' if size == 1024 else '_512'
    return (CACHE / f'rock_{key}_diff{sfx}.jpg', CACHE / f'rock_{key}_arm{sfx}.jpg', CACHE / f'rock_{key}_nor_gl{sfx}.jpg')


def build_one(gen: Generator, spec: dict, seed: int, name: str, args, materials: dict) -> dict:
    import bpy
    t0 = time.time()
    key = spec.get('surface', 'grey')
    if ('rock', key) not in materials:
        diff, arm, nor = surface(spec, args.bark_size)
        materials[('rock', key)] = blendkit.bark_material(f'rock_{key}', diff, arm, None if args.no_normals else nor)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    lo, hi = args.budget if args.budget else spec.get('budget', [1500, 4000])
    # LOD0 picks the sphere subdivision that lands in budget; each LOD below drops one level
    counts, lods, bounds, info = [], [], None, {}
    sub0 = None
    for k in range(max(1, min(args.lods, 3))):
        if sub0 is None:
            for sub in (4, 3, 2, 1):
                mesh, info = build_rock(spec, seed, sub, max(0, sub - 2))
                if mesh.triangles <= hi:
                    break
            sub0 = sub
        else:
            mesh, info = build_rock(spec, seed, max(0, sub0 - k), max(0, sub0 - 2 - k))
        pos, nor, uv, col, tri = mesh.merged()
        if k == 0:
            bounds = {'top': round(float(pos[:, 2].max()), 2), 'radius': round(float(np.hypot(pos[:, 0], pos[:, 1]).max()), 2),
                      'bottom': round(float(pos[:, 2].min()), 2)}
        ob = blendkit.make_object(f'LOD{k}', [('rock', (pos, nor, uv, col, tri), materials[('rock', key)])])
        ob.parent = root
        ob['lod'] = k
        counts.append({'bark': mesh.triangles, 'leaves': 0})
        lods.append(ob)
    meta = {'species': spec.get('name'), 'type': spec.get('name'), 'kind': 'rock', 'seed': seed, 'size': info['size'],
            'form': 'field' if not any(x['kind'] == 'boulder' for x in info['placed']) else ('group' if sum(x['kind'] == 'boulder' for x in info['placed']) > 1 else 'single'),
            'shapes': [x['shape'] for x in info['placed'] if x['kind'] == 'boulder'], 'placed': info['placed'],
            'bounds': bounds, 'season': spec.get('season', 'any'), 'lods': counts, 'generator': 'trailtrainer rockgen'}
    for k2, v in meta.items():
        root[k2] = json.dumps(v) if isinstance(v, (list, dict)) else v
    meta['build_s'] = round(time.time() - t0, 2)
    return {'root': root, 'lods': lods, 'meta': meta, 'tree': None, 'preview_height': max(bounds['top'] * 3.0, bounds['radius'] * 1.9, 1.5)}


if __name__ == '__main__':
    run(Generator(name='rockgen', here=HERE, cache=CACHE, default_out=HERE.parent.parent / 'public' / 'rocks',
                  doc=__doc__, bark=surface, leaves=None), build=build_one)
