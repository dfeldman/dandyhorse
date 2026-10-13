"""
What every generator's gen.py shares that is not Blender: the command line, species loading with
`extends` and `--set` overrides, the library table's relative jitter, the build of one tree into LOD
objects, and the driver loop with previews, the shared-texture post-pass and index.json.

A generator supplies a `Textures` object that knows where its bark and leaf pages live, and its species
folder. Everything else is here.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from . import blendkit, glbtools
from .budget import fit_budget
from .lod import apply_lod, derive_lod
from .tree import Tree, assemble, build_tree


@dataclass
class Generator:
    name: str                       # 'deciduousgen'
    here: Path                      # the generator's folder (species/, library.json)
    cache: Path                     # where fetch.py and pages.py put textures
    default_out: Path
    doc: str = ''
    bark: Callable[[dict, int], tuple[Path, Path, Path | None]] | None = None      # spec, size -> diff, arm, nor
    leaves: Callable[[dict, int], Path] | None = None                               # spec, size -> page


def parse_args(gen: Generator) -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='gen.py', description=gen.doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--species', default=None, help="a name in species/, or 'all'")
    ap.add_argument('--seed', type=int, default=1, help='first seed')
    ap.add_argument('--count', type=int, default=1, help='how many seeds per species')
    ap.add_argument('--library', action='store_true', help='build the whole library from library.json')
    ap.add_argument('--library-file', default=None, help='a different library table (for samples)')
    ap.add_argument('--out', default=str(gen.default_out))
    ap.add_argument('--lods', type=int, default=3, help='how many LODs to write (1-4)')
    ap.add_argument('--budget', type=int, nargs=2, metavar=('LO', 'HI'), help='override the LOD0 triangle range')
    ap.add_argument('--set', action='append', default=[], metavar='KEY=VALUE',
                    help='override a species value, dotted path, JSON value: --set leaves.size=[0.06,0.01]')
    ap.add_argument('--format', choices=['glb', 'gltf'], default='glb',
                    help='gltf writes .gltf + .bin with textures as shared files beside them')
    ap.add_argument('--shared-textures', action='store_true',
                    help='GLBs reference textures in <out>/textures/ instead of embedding them (the library does this)')
    ap.add_argument('--preview', action='store_true', help='render a PNG for each tree')
    ap.add_argument('--preview-dir', default=None, help='where previews go (default: beside the GLBs)')
    ap.add_argument('--preview-every', type=int, default=1, help='render only every Nth tree')
    ap.add_argument('--preview-size', type=int, default=900)
    ap.add_argument('--no-normals', action='store_true', help='skip the bark normal map (smaller files)')
    ap.add_argument('--bark-size', type=int, choices=[512, 1024], default=512, help='bark texture width')
    ap.add_argument('--leaf-size', type=int, choices=[512, 1024], default=1024, help='leaf atlas size')
    ap.add_argument('--blend', action='store_true', help='also save a .blend beside each GLB, for inspection')
    return ap.parse_args(argv)


# ---------------------------------------------------------------- species

def apply_overrides(spec: dict, sets: list[str]) -> dict:
    spec = copy.deepcopy(spec)
    for item in sets:
        key, _, raw = item.partition('=')
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = raw
        d = spec
        parts = key.split('.')
        for p in parts[:-1]:
            d = d.setdefault(p, {}) if not p.isdigit() else d[int(p)]
        last = parts[-1]
        if last.isdigit():
            d[int(last)] = value
        else:
            d[last] = value
    return spec


def resolve_relative(spec: dict) -> dict:
    """The library's per-tree jitter is written as multipliers and offsets next to the values they change;
    fold them in here so the generator never sees them."""
    env = spec.get('envelope', {})
    if isinstance(env.get('width'), (int, float)) and 'width_scale' in env:
        env['width'] = env['width'] * env.pop('width_scale')
    leaves = spec.get('leaves', {})
    if 'size_scale' in leaves:
        k = leaves.pop('size_scale')
        size = leaves.get('size', [0.07, 0.015])
        leaves['size'] = [size[0] * k, size[1] * k] if isinstance(size, list) else size * k
    splits = spec.get('trunk', {}).get('splits')
    if splits and 'count_offset' in splits:
        k = splits.pop('count_offset')
        c = splits.get('count', 0)
        splits['count'] = [c[0] + k, c[1]] if isinstance(c, list) else c + k
    if 'density_scale' in leaves:
        # more or fewer cards for the same species: fullness
        k = leaves.pop('density_scale')
        leaves['spacing'] = float(leaves.get('spacing', 0.25)) / k
    for level in spec.get('levels') or []:
        if 'per_whorl_offset' in level:
            k = level.pop('per_whorl_offset')
            c = level.get('per_whorl', [5, 1])
            level['per_whorl'] = [c[0] + k, c[1]] if isinstance(c, list) else c + k
        if 'length_scale' in level:
            k = level.pop('length_scale')
            for key in ('length', 'length_abs'):
                if key in level:
                    v = level[key]
                    if isinstance(v, dict):
                        v = dict(v)
                        v['curve'] = [[pt[0], pt[1] * k] if isinstance(pt, list) else pt * k for pt in v['curve']]
                        level[key] = v
                    elif isinstance(v, list):
                        level[key] = [v[0] * k, v[1]]
                    else:
                        level[key] = v * k
        if 'angle_offset' in level:
            k = level.pop('angle_offset')
            a = level.get('angle', [55, 12])
            if isinstance(a, dict):
                a = dict(a)
                a['curve'] = [[pt[0], pt[1] + k] if isinstance(pt, list) else pt + k for pt in a['curve']]
                level['angle'] = a
            elif isinstance(a, list):
                level['angle'] = [a[0] + k, a[1]]
            else:
                level['angle'] = a + k
    return spec


def _deep_update(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_update(dst[k], v)
        else:
            dst[k] = v


def load_species(gen: Generator, name: str) -> dict:
    spec = json.loads((gen.here / 'species' / f'{name}.json').read_text())
    if 'extends' in spec:
        base = load_species(gen, spec['extends'])
        merged = copy.deepcopy(base)
        _deep_update(merged, {k: v for k, v in spec.items() if k != 'extends'})
        spec = merged
    return spec


# ---------------------------------------------------------------- one tree

def build_one(gen: Generator, spec: dict, seed: int, name: str, args: argparse.Namespace, materials: dict) -> dict:
    import bpy
    t0 = time.time()
    tree = build_tree(spec, seed)
    lo, hi = args.budget if args.budget else spec.get('budget', [2000, 5000])
    lod0 = fit_budget(tree, lo, hi, 0.0 if not tree.leaves else float(spec.get('leaf_share', 0.55)))
    bark_key = spec.get('bark', 'brown') + ('_snow' if float(spec.get('snow', 0)) > 0 else '')
    page = spec.get('leaves_page', 'broad')
    if ('bark', bark_key) not in materials:
        diff, arm, nor = gen.bark(spec, args.bark_size)
        materials[('bark', bark_key)] = blendkit.bark_material(f'bark_{bark_key}', diff, arm, None if args.no_normals else nor)
    if ('leaf', page) not in materials:
        materials[('leaf', page)] = blendkit.leaf_material(f'leaves_{page}', gen.leaves(spec, args.leaf_size))
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    counts = []
    lod_objects = []
    bounds = None
    for k in range(max(1, min(args.lods, 4))):
        lod = derive_lod(tree, k, lod0)
        apply_lod(tree, lod)
        bark, leaves = assemble(tree, lod.radial_scale, lod.ring_stride)
        if k == 0:
            pts = np.vstack([bark.merged()[0], leaves.merged()[0]])
            bounds = {'top': round(float(pts[:, 2].max()), 2), 'radius': round(float(np.hypot(pts[:, 0], pts[:, 1]).max()), 2),
                      'bottom': round(float(pts[:, 2].min()), 2)}
        ob = blendkit.make_object(f'LOD{k}', [('bark', bark.merged(), materials[('bark', bark_key)]),
                                              ('leaves', leaves.merged(), materials[('leaf', page)])])
        ob.parent = root
        ob['lod'] = k
        counts.append({'bark': bark.triangles, 'leaves': leaves.triangles})
        lod_objects.append(ob)
    crown = max(float(np.hypot(l.pos[0], l.pos[1])) for l in tree.leaves) if tree.leaves else tree.crown_radius
    meta = {'species': spec.get('name', args.species), 'kind': spec.get('kind', 'deciduous'), 'form': spec.get('form', 'tree'), 'seed': seed,
            'height': round(tree.height, 2), 'crown_radius': round(crown, 2), 'bounds': bounds,
            'season': spec.get('season', 'summer'), 'lods': counts, 'generator': f'trailtrainer {gen.name}'}
    for k, v in meta.items():
        root[k] = json.dumps(v) if isinstance(v, (list, dict)) else v
    meta['build_s'] = round(time.time() - t0, 2)
    return {'root': root, 'lods': lod_objects, 'meta': meta, 'tree': tree}


# ---------------------------------------------------------------- driver

def run(gen: Generator, build: Callable = None) -> None:
    """The driver. `build(gen, spec, seed, name, args, materials)` defaults to the tree build; a generator
    that is not a tree (rocks) supplies its own and everything else here still applies."""
    import bpy
    build = build or build_one
    args = parse_args(gen)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.library:
        args.shared_textures = True
        lib = json.loads(Path(args.library_file).read_text()) if args.library_file else json.loads((gen.here / 'library.json').read_text())
        jobs = [(entry['species'], entry.get('seed', i + 1), entry.get('name'), entry.get('set', []))
                for i, entry in enumerate(lib['trees'])]
    else:
        species = args.species or 'all'
        names = sorted(p.stem for p in (gen.here / 'species').glob('*.json')) if species == 'all' else [species]
        jobs = [(n, args.seed + i, None, []) for n in names for i in range(args.count)]
    # a library build merges into whatever index is already there, so two generators can share a folder
    index_path = out / 'index.json'
    existing = json.loads(index_path.read_text())['trees'] if index_path.exists() else []
    # a merged index keeps other generators' entries, but not ones whose file has since been deleted
    report: dict[str, dict] = {t['file']: t for t in existing if (out / t['file']).exists()}
    done = 0
    for species, seed, name, sets in jobs:
        spec = resolve_relative(apply_overrides(load_species(gen, species), list(sets) + args.set))
        name = name or f'{species}_{seed}'
        blendkit.reset_scene()
        materials: dict = {}
        result = build(gen, spec, seed, name, args, materials)
        path = out / f'{name}.{args.format}'
        blendkit.export(path, args.format)
        if args.format == 'glb':
            glbtools.externalize(path, out / 'textures' if args.shared_textures else None)
        if args.blend:
            bpy.ops.wm.save_as_mainfile(filepath=str(out / f'{name}.blend'))
        meta = result['meta']
        meta['file'] = path.name
        meta['bytes'] = path.stat().st_size
        tris = [c['bark'] + c['leaves'] for c in meta['lods']]
        print(f"{name}: {meta.get('height', '-')} m nominal, {meta['bounds']['top']} m tall, r {meta['bounds']['radius']} m, "
              f"tris {tris}, {meta['bytes'] // 1024} KB, {meta['build_s']} s")
        if args.preview and (done % max(1, args.preview_every) == 0):
            pdir = Path(args.preview_dir) if args.preview_dir else out
            pdir.mkdir(parents=True, exist_ok=True)
            blendkit.render_preview(pdir / f'{name}.png', result['lods'], result.get('preview_height') or result['tree'].height, args.preview_size)
        report[meta['file']] = meta
        done += 1
    index_path.write_text(json.dumps({'trees': sorted(report.values(), key=lambda t: t['file'])}, indent=1))
    print(f'{done} trees -> {out} ({len(report)} in index)')
