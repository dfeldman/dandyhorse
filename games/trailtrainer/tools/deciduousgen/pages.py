#!/usr/bin/env python3
"""
Builds the leaf-cluster atlases the cards are painted with.

A Poly Haven leaf page is loose parts: eight single leaves on black, or a sheet of sprigs with a bleed of
bark down one side. A card showing one leaf at crown size is a banana, so the parts are cut out here and
composited into clusters -- a dozen leaves fanned around a centre, darker at the back -- and four clusters
go on one atlas as a 2 × 2 grid. Every card picks a cell by hash, which is what keeps a crown of two
hundred cards from looking like one card two hundred times. Deterministic: same seed, same atlas.

    python3 tools/deciduousgen/pages.py

Runs under the system Python with Pillow, like fetch.py, and writes next to it in tools/cache/deciduousgen.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageEnhance

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / 'cache' / 'deciduousgen'
SIZE = 1024
CELLS = 2

# Per page: how to cut it and how to compose a cluster from what was cut.
PAGES = {
    # eight loose leaves: a dense mass of thirty-odd around the centre, stems inward
    'broad': {'source': 'broad', 'crop': (0, 0, 1, 1), 'min_pixels': 400, 'count': (36, 50), 'scale': (0.24, 0.34),
              'stem_in': True, 'spread': 0.28, 'seed': 11},
    # the same leaves, smaller and yellower: birch, poplar, aspen
    'light': {'source': 'broad', 'crop': (0, 0, 1, 1), 'min_pixels': 400, 'count': (44, 60), 'scale': (0.18, 0.26),
              'stem_in': True, 'spread': 0.32, 'seed': 14, 'hue': 10, 'brightness': 1.18, 'saturation': 0.95},
    # the same leaves, darker and bluer: beech, elm in shade
    'dark': {'source': 'broad', 'crop': (0, 0, 1, 1), 'min_pixels': 400, 'count': (34, 48), 'scale': (0.25, 0.36),
             'stem_in': True, 'spread': 0.27, 'seed': 15, 'hue': -6, 'brightness': 0.88, 'saturation': 1.05},
    # feathery compound fronds: ash, rowan, locust
    'fine': {'source': 'fine', 'crop': (0, 0, 1, 1), 'min_pixels': 5000, 'count': (5, 7), 'scale': (0.55, 0.75),
             'stem_in': False, 'spread': 0.4, 'seed': 13},
}
# (tree_small_02's sprig page is downloaded too, but its bark bleed is fused to the sprigs and cannot be cut
# apart by flood fill, so it is not used.)

# Seasonal pages: the same clusters, each CELL graded differently, so a card picking a cell by hash gives a
# crown that is a mixture -- some leaves turned, some not -- from a single texture. Hue shifts are degrees
# on the HSV wheel; the source leaves sit around 75 (yellow-green), so -20 is yellow, -50 orange, -75 red.
GRADES = {
    # absolute targets: hue on the HSV wheel (yellow 50, orange 30, red 10), and the mean value the cell
    # should reach -- the photographed leaves average a value of about 0.33, and turned leaves are brighter
    'autumn': [{'hue_to': 58, 'val_to': 0.5, 'sat': 1.1}, {'hue_to': 46, 'val_to': 0.58, 'sat': 1.15},
               {'hue_to': 32, 'val_to': 0.55, 'sat': 1.2}, {'hue_to': 14, 'val_to': 0.45, 'sat': 1.15}],
    'gold': [{'hue_to': 52, 'val_to': 0.6, 'sat': 1.1}, {'hue_to': 47, 'val_to': 0.62, 'sat': 1.15},
             {'hue_to': 56, 'val_to': 0.55, 'sat': 1.05}, {'hue_to': 62, 'val_to': 0.5, 'sat': 1.0}],
    'copper': [{'hue_to': 30, 'val_to': 0.52, 'sat': 0.95}, {'hue_to': 24, 'val_to': 0.48, 'sat': 1.0},
               {'hue_to': 36, 'val_to': 0.55, 'sat': 0.95}, {'hue_to': 20, 'val_to': 0.45, 'sat': 0.9}],
}


def measure(im: Image.Image) -> tuple[float, float]:
    """Mean hue (degrees) and value of the opaque pixels."""
    import colorsys
    hs, vs = [], []
    for r, g, b, a in list(im.getdata())[::23]:
        if a > 200:
            h, s_, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            hs.append(h * 360)
            vs.append(v)
    return (sum(hs) / max(len(hs), 1), sum(vs) / max(len(vs), 1))


def regrade(im: Image.Image, target: dict) -> Image.Image:
    """Grade a cluster to an absolute hue and value target."""
    hue, val = measure(im)
    cfg = {'hue': target['hue_to'] - hue, 'brightness': min(2.5, target['val_to'] / max(val, 0.05)), 'saturation': target.get('sat', 1.0)}
    return graded(im, cfg)


SEASONAL = [('broad', 'autumn'), ('broad', 'gold'), ('light', 'gold'), ('light', 'autumn'), ('dark', 'copper'),
            ('dark', 'autumn'), ('dark', 'gold'), ('fine', 'gold')]


def graded(im: Image.Image, cfg: dict) -> Image.Image:
    """Hue, saturation and brightness shifts, so one photographed page can serve several species."""
    if not any(k in cfg for k in ('hue', 'brightness', 'saturation')):
        return im
    a = im.getchannel('A')
    hsv = im.convert('RGB').convert('HSV')
    h, s, v = hsv.split()
    if cfg.get('hue'):
        shift = int(cfg['hue'] * 255 / 360)
        h = h.point(lambda x: (x + shift) % 256)
    if cfg.get('saturation'):
        s = s.point(lambda x: min(255, int(x * cfg['saturation'])))
    if cfg.get('brightness'):
        v = v.point(lambda x: min(255, int(x * cfg['brightness'])))
    out = Image.merge('HSV', (h, s, v)).convert('RGBA')
    out.putalpha(a)
    return out


def components(alpha: Image.Image, cutoff: int, min_pixels: int) -> list[tuple[int, int, int, int]]:
    """Bounding boxes of every solid blob, found by flood fill on a quarter-size copy."""
    w, h = alpha.size
    small = alpha.resize((w // 4, h // 4), Image.BILINEAR)
    sw, sh = small.size
    px = small.load()
    seen = bytearray(sw * sh)
    boxes = []
    for start in range(sw * sh):
        if seen[start] or px[start % sw, start // sw] <= cutoff:
            continue
        stack = [start]
        seen[start] = 1
        x0, y0, x1, y1, n = sw, sh, 0, 0, 0
        while stack:
            i = stack.pop()
            x, y = i % sw, i // sw
            n += 1
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < sw and 0 <= ny < sh:
                    j = ny * sw + nx
                    if not seen[j] and px[nx, ny] > cutoff:
                        seen[j] = 1
                        stack.append(j)
        if n * 16 >= min_pixels:
            boxes.append((x0 * 4, y0 * 4, min(w, (x1 + 1) * 4), min(h, (y1 + 1) * 4)))
    return boxes


def cluster(sprites: list[Image.Image], cfg: dict, rng: random.Random, size: int) -> Image.Image:
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    n = rng.randint(*cfg['count'])
    cx, cy = size / 2, size * 0.55
    placed = []
    for i in range(n):
        sp = rng.choice(sprites)
        s = rng.uniform(*cfg['scale']) * size / max(sp.size)
        # position: an ellipse around the centre, denser in the middle
        r = cfg['spread'] * size * (0.1 + 0.9 * rng.random() ** 0.8)
        a = rng.uniform(0, 6.283)
        ux, uy = math.cos(a), math.sin(a) * 0.85
        im = sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.LANCZOS)
        if cfg['stem_in']:
            # the leaf's stem is at its bottom: put the stem at radius r and point the tip outward, so the
            # leaves overlap in the middle of the cluster instead of leaving a hole there
            ang = math.degrees(math.atan2(-uy, ux)) - 90 + rng.uniform(-30, 30)
            reach = im.height * 0.5
            x, y = cx + ux * (r + reach * 0.9), cy + uy * (r + reach * 0.9)
        else:
            ang = rng.uniform(-35, 35)
            x, y = cx + ux * r, cy + uy * r
        im = im.rotate(ang, expand=True, resample=Image.BICUBIC)
        placed.append((r, x, y, im))
    # back to front, the back ones darker: light does not reach the middle of a cluster
    placed.sort(key=lambda p: -p[0])
    for k, (r, x, y, im) in enumerate(placed):
        depth = k / max(len(placed) - 1, 1)
        im = ImageEnhance.Brightness(im).enhance(0.62 + 0.38 * depth)
        out.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))
    return out


def build(key: str, cfg: dict, grades: list | None) -> None:
    page = graded(Image.open(CACHE / f"leaf_{cfg['source']}_page.png").convert('RGBA'), cfg)
    w, h = page.size
    c = cfg['crop']
    page = page.crop((int(c[0] * w), int(c[1] * h), int(c[2] * w), int(c[3] * h)))
    boxes = components(page.getchannel('A'), 64, cfg['min_pixels'])
    sprites = [page.crop(b) for b in boxes]
    print(f'{key}: {len(sprites)} sprites from {len(boxes)} blobs')
    rng = random.Random(cfg['seed'])
    atlas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    cell = SIZE // CELLS
    for i in range(CELLS * CELLS):
        im = cluster(sprites, cfg, rng, cell)
        if grades:
            im = regrade(im, grades[i % len(grades)])
        atlas.alpha_composite(im, ((i % CELLS) * cell, (i // CELLS) * cell))
    finish(key, atlas)


def main() -> None:
    for key, cfg in PAGES.items():
        build(key, cfg, None)
    for source, grade in SEASONAL:
        build(f'{source}_{grade}', PAGES[source], GRADES[grade])


def finish(key: str, atlas: Image.Image) -> None:
    if True:
        # premultiplied-looking edges: bleed the colour a little past the alpha so filtering does not go black
        rgb = atlas.convert('RGB')
        a = atlas.getchannel('A')
        halo = rgb.copy()
        for _ in range(3):
            from PIL import ImageFilter
            halo = halo.filter(ImageFilter.MaxFilter(3))
        mask = a.point(lambda v: 255 if v > 8 else 0)
        rgb = Image.composite(rgb, halo, mask)
        rgb.putalpha(a)
        out = CACHE / f'leaf_{key}_atlas.png'
        rgb.save(out, optimize=True)
        rgb.resize((512, 512), Image.LANCZOS).save(CACHE / f'leaf_{key}_atlas_512.png', optimize=True)
        print(f'  -> {out.name}')


if __name__ == '__main__':
    sys.exit(main())
