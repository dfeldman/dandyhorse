#!/usr/bin/env python3
"""
Fetches the bark and needle pages the conifer generator paints with, once, offline. Poly Haven, CC0,
recorded in CREDITS.md. Same rules and same shape as tools/deciduousgen/fetch.py.

    python3 tools/conifergen/fetch.py [--force]

Needle pages come out of Poly Haven's pine_tree_01 and fir_tree_01 models: a sheet of twigs with needles
on it, against nothing, plus cones and bits of bark the atlas builder has to throw away.
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
CACHE = HERE.parent / 'cache' / 'conifergen'
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'trailtrainer-conifergen/1.0 (+https://polyhaven.com)'}

BARK = [
    {'key': 'pine', 'asset': 'pine_bark', 'what': 'plated red-brown pine bark: Scots pine, larch'},
    {'key': 'knotted', 'asset': 'knotted_pine_bark', 'what': 'rough knotted pine bark: black pine, old pines'},
    {'key': 'cedar', 'asset': 'japanese_cedar_bark', 'what': 'stringy fibrous bark: spruce, cypress, juniper'},
    {'key': 'fir', 'asset': 'chinese_cedar_bark', 'what': 'grey furrowed bark: fir'},
]
BARK_MAPS = [('Diffuse', 'diff'), ('nor_gl', 'nor_gl'), ('arm', 'arm')]
NEEDLES = [
    {'key': 'pine', 'asset': 'pine_tree_01', 'colour': 'twig_diff', 'mask': 'twig_alpha', 'what': 'long pine needles in bunches'},
    {'key': 'fir', 'asset': 'fir_tree_01', 'colour': 'twig_diff', 'mask': 'twig_alpha', 'what': 'short flat fir needles on sprays'},
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
    from PIL import Image

    for bark in BARK:
        print(bark['asset'])
        listing = files(bark['asset'])
        for api, suffix in BARK_MAPS:
            dest = CACHE / f"bark_{bark['key']}_{suffix}.jpg"
            fetch(listing[api][args.res]['jpg']['url'], dest, args.force)
            small = CACHE / f"bark_{bark['key']}_{suffix}_512.jpg"
            if not small.exists() or args.force:
                im = Image.open(dest)
                w, h = im.size
                im.resize((512, 512 * h // w), Image.LANCZOS).save(small, quality=88)
            if suffix == 'diff':
                snow_bark = snowtex.snow_bark
                for src, dst in ((dest, CACHE / f"bark_{bark['key']}_snow_diff.jpg"), (small, CACHE / f"bark_{bark['key']}_snow_diff_512.jpg")):
                    if not dst.exists() or args.force:
                        snow_bark(src, dst)
    for n in NEEDLES:
        print(n['asset'])
        listing = files(n['asset'])
        colour = CACHE / f"needle_{n['key']}_diff.jpg"
        mask = CACHE / f"needle_{n['key']}_alpha.jpg"
        fetch(listing[n['colour']][args.res]['jpg']['url'], colour, args.force)
        fetch(listing[n['mask']][args.res]['jpg']['url'], mask, args.force)
        out = CACHE / f"needle_{n['key']}_page.png"
        if not out.exists() or args.force:
            rgb = Image.open(colour).convert('RGB')
            a = Image.open(mask).convert('L').resize(rgb.size)
            rgb.putalpha(a)
            rgb.save(out, optimize=True)
    print('done ->', CACHE)


if __name__ == '__main__':
    sys.exit(main())
