#!/usr/bin/env python3
"""
Fetches the pages the plant generator paints with: grass blades, fern fronds, flowers and leaves cut out
of Poly Haven's CC0 plant models (each a colour page and a mask, merged here into one RGBA page), and the
palm bark. Recorded in CREDITS.md. Sunflowers, tulips, palm fronds and cactus skin are not on Poly Haven
and are painted by paint.py instead.

    python3 tools/plantgen/fetch.py [--force]
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / 'cache' / 'plantgen'
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'trailtrainer-plantgen/1.0 (+https://polyhaven.com)'}

PAGES = [
    {'key': 'grass_a', 'asset': 'grass_medium_01', 'what': 'meadow grass blades'},
    {'key': 'grass_b', 'asset': 'grass_medium_02', 'what': 'meadow grass, taller'},
    {'key': 'grass_dry', 'asset': 'grass_medium_01', 'colour': 'dry_diff', 'what': 'dry prairie grass'},
    {'key': 'bermuda', 'asset': 'grass_bermuda_01', 'what': 'short fine grass'},
    {'key': 'fern', 'asset': 'fern_02', 'what': 'fern fronds'},
    {'key': 'dandelion', 'asset': 'dandelion_01', 'what': 'dandelion leaves, flowers and clocks'},
    {'key': 'celandine', 'asset': 'celandine_01', 'what': 'small yellow flowers and leaves'},
    {'key': 'gazania', 'asset': 'flower_gazania', 'what': 'orange daisy-like flowers'},
    {'key': 'ursinia', 'asset': 'flower_ursinia', 'what': 'orange-yellow daisies'},
    {'key': 'empodium', 'asset': 'flower_empodium', 'what': 'yellow star flowers'},
    {'key': 'heliophila', 'asset': 'flower_heliophila', 'what': 'small blue flowers'},
    {'key': 'periwinkle', 'asset': 'periwinkle_plant', 'mask': 'opacity', 'what': 'blue periwinkle'},
    {'key': 'nettle', 'asset': 'nettle_plant', 'what': 'broad serrated leaves'},
    {'key': 'shrub', 'asset': 'shrub_01', 'what': 'bushy leaves with small flowers'},
]
BARK = [{'key': 'palm', 'asset': 'palm_bark'}]
BARK_MAPS = [('Diffuse', 'diff'), ('nor_gl', 'nor_gl'), ('arm', 'arm')]


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
    for p in PAGES:
        print(p['asset'])
        listing = files(p['asset'])
        colour = CACHE / f"page_{p['key']}_diff.jpg"
        mask = CACHE / f"page_{p['key']}_alpha.jpg"
        fetch(listing[p.get('colour', 'Diffuse')][args.res]['jpg']['url'], colour, args.force)
        fetch(listing[p.get('mask', 'Alpha')][args.res]['jpg']['url'], mask, args.force)
        out = CACHE / f"page_{p['key']}.png"
        if not out.exists() or args.force:
            rgb = Image.open(colour).convert('RGB')
            a = Image.open(mask).convert('L').resize(rgb.size)
            rgb.putalpha(a)
            rgb.save(out, optimize=True)
    for b in BARK:
        print(b['asset'])
        listing = files(b['asset'])
        for api, suffix in BARK_MAPS:
            dest = CACHE / f"bark_{b['key']}_{suffix}.jpg"
            fetch(listing[api][args.res]['jpg']['url'], dest, args.force)
            small = CACHE / f"bark_{b['key']}_{suffix}_512.jpg"
            if not small.exists() or args.force:
                im = Image.open(dest)
                w, h = im.size
                im.resize((512, 512 * h // w), Image.LANCZOS).save(small, quality=88)
    print('done ->', CACHE)


if __name__ == '__main__':
    sys.exit(main())
