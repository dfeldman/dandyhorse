#!/usr/bin/env python3
"""
Fetches the rock surfaces the rock generator paints with. Poly Haven, CC0, in CREDITS.md. Three 1k maps
per surface (colour, OpenGL normal, arm) and a 512 copy of each, like the tree generators' fetch scripts.

    python3 tools/rockgen/fetch.py [--force]
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / 'cache' / 'rockgen'
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'trailtrainer-rockgen/1.0 (+https://polyhaven.com)'}

SURFACES = [
    {'key': 'grey', 'asset': 'rock_boulder_dry', 'what': 'weathered grey boulder'},
    {'key': 'bare', 'asset': 'rock_08', 'what': 'coarse bare rock'},
    {'key': 'dark', 'asset': 'dark_rock_02', 'what': 'dark stratified rock'},
    {'key': 'cracked', 'asset': 'rock_boulder_cracked', 'what': 'orange-brown cracked boulder'},
    {'key': 'marble', 'asset': 'marble_rock_01', 'what': 'pale cracked rock'},
    {'key': 'lichen', 'asset': 'lichen_rock', 'what': 'rock with lichen'},
    {'key': 'mossy', 'asset': 'mossy_rock', 'what': 'rock with moss in the cracks'},
    {'key': 'pebble', 'asset': 'dry_river_pebbles', 'what': 'rounded river pebbles'},
    {'key': 'scree', 'asset': 'gravel_stones', 'what': 'sharp grey scree'},
]
MAPS = [('Diffuse', 'diff'), ('nor_gl', 'nor_gl'), ('arm', 'arm')]


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
    for s in SURFACES:
        print(s['asset'])
        listing = files(s['asset'])
        for api, suffix in MAPS:
            if api not in listing:
                print('  no', api)
                continue
            dest = CACHE / f"rock_{s['key']}_{suffix}.jpg"
            fetch(listing[api][args.res]['jpg']['url'], dest, args.force)
            small = CACHE / f"rock_{s['key']}_{suffix}_512.jpg"
            if not small.exists() or args.force:
                im = Image.open(dest)
                w, h = im.size
                im.resize((512, 512 * h // w), Image.LANCZOS).save(small, quality=88)
    print('done ->', CACHE)


if __name__ == '__main__':
    sys.exit(main())
