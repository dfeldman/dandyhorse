#!/usr/bin/env python3
"""
Fetches the bark and leaf pages the tree generator paints with, once, offline.

Everything comes from Poly Haven, which is CC0 -- the only reason it can be redistributed inside a GLB at
all. Anything added here has to be CC0 or CC-BY with the attribution written into CREDITS.md, exactly as
the ground textures are (tools/textures.ts follows the same rule).

    python3 tools/deciduousgen/fetch.py            fetch anything missing
    python3 tools/deciduousgen/fetch.py --force    fetch everything again

Bark comes from the texture library as three 1k maps: colour, OpenGL-convention normal, and Poly Haven's
`arm` page, whose channels (ambient occlusion, roughness, metalness) are already the layout glTF wants for
its occlusion/metallic-roughness texture. Leaves come out of Poly Haven's tree MODELS, which carry a page of
loose leaves against black plus a separate mask; glTF has no separate mask, so the two are merged here into
one RGBA PNG. Runs under the system Python (needs Pillow); Blender's own Python has no image library and
does not need one, because the cutting-out is done here.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location('snowtex', HERE.parent / 'treekit' / 'snowtex.py')
snowtex = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(snowtex)
CACHE = HERE.parent / 'cache' / 'deciduousgen'
API = 'https://api.polyhaven.com/files/'
# Poly Haven's CDN refuses the default urllib agent.
UA = {'User-Agent': 'trailtrainer-deciduousgen/1.0 (+https://polyhaven.com)'}

# Bark: texture-library assets. `what` is which species it is meant for.
BARK = [
    {'key': 'oak', 'asset': 'jolcham_oak_bark_01', 'what': 'deeply fissured oak bark with a little moss'},
    {'key': 'brown', 'asset': 'bark_brown_02', 'what': 'generic brown furrowed bark: ash, elm, poplar'},
    {'key': 'willow', 'asset': 'bark_willow_02', 'what': 'rough dry ridged bark: willow'},
    {'key': 'platanus', 'asset': 'bark_platanus', 'what': 'smooth flaking plane/sycamore bark, pale patches: birch stand-in, beech'},
    {'key': 'maple', 'asset': 'trident_maple_bark', 'what': 'maple bark'},
]
BARK_MAPS = [('Diffuse', 'diff'), ('nor_gl', 'nor_gl'), ('arm', 'arm')]

# Leaves: pages taken from tree models. Each is a colour page and a mask, merged into one RGBA page.
LEAVES = [
    {'key': 'broad', 'asset': 'island_tree_01', 'what': 'medium rounded broadleaf'},
    {'key': 'small', 'asset': 'tree_small_02', 'what': 'small leaves on twigs'},
    {'key': 'fine', 'asset': 'jacaranda_tree', 'what': 'fine feathery compound leaves'},
]


def fetch(url: str, dest: Path, force: bool) -> None:
    if dest.exists() and not force:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f'  {url}')
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        dest.write_bytes(r.read())


def files(asset: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(API + asset, headers=UA)) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--res', default='1k')
    args = ap.parse_args()
    from PIL import Image  # noqa: WPS433 -- only the system Python runs this

    for bark in BARK:
        print(bark['asset'])
        listing = files(bark['asset'])
        for api, suffix in BARK_MAPS:
            url = listing[api][args.res]['jpg']['url']
            dest = CACHE / f"bark_{bark['key']}_{suffix}.jpg"
            fetch(url, dest, args.force)
            # a half-size copy: a game with hundreds of trees does not want 2k bark on each of them
            small = CACHE / f"bark_{bark['key']}_{suffix}_512.jpg"
            if not small.exists() or args.force:
                im = Image.open(dest)
                w, h = im.size
                im.resize((512, 512 * h // w), Image.LANCZOS).save(small, quality=88)
            if suffix == 'diff':
                # the same bark with a band of snow along the top of the tile, for winter trees
                snow_bark = snowtex.snow_bark
                for src, dst in ((dest, CACHE / f"bark_{bark['key']}_snow_diff.jpg"), (small, CACHE / f"bark_{bark['key']}_snow_diff_512.jpg")):
                    if not dst.exists() or args.force:
                        snow_bark(src, dst)

    for leaf in LEAVES:
        print(leaf['asset'])
        listing = files(leaf['asset'])
        colour = CACHE / f"leaf_{leaf['key']}_diff.jpg"
        mask = CACHE / f"leaf_{leaf['key']}_alpha.jpg"
        fetch(listing['leaves_diff'][args.res]['jpg']['url'], colour, args.force)
        fetch(listing['leaves_alpha'][args.res]['jpg']['url'], mask, args.force)
        out = CACHE / f"leaf_{leaf['key']}_page.png"
        if not out.exists() or args.force:
            rgb = Image.open(colour).convert('RGB')
            a = Image.open(mask).convert('L').resize(rgb.size)
            rgb.putalpha(a)
            rgb.save(out, optimize=True)
            print(f'  merged -> {out.name}')
    print('done ->', CACHE)


if __name__ == '__main__':
    sys.exit(main())
