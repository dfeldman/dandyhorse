#!/usr/bin/env python3
"""
Builds the needle-spray atlases the conifer cards are painted with.

A conifer card lies ALONG a branch rather than at its tip, so a cell is a spray: a central axis with
sprigs coming off it in a herringbone, thicker near the base and finer at the tip, cut from Poly Haven's
pine and fir twig pages. The pages carry cones, bark and sticks as well, and the only test that separates a
sprig from a cone is how green it is -- the same test tools/canopies.ts uses on the same sheets.

    python3 tools/conifergen/pages.py

Four cells per atlas, picked per card by hash. Also writes yellow-graded pages for larch.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location('snowtex', HERE.parent / 'treekit' / 'snowtex.py')
snowtex = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(snowtex)
CACHE = HERE.parent / 'cache' / 'conifergen'
SIZE = 1024
CELLS = 2

PAGES = {
    # long needles in loose bunches: pines
    'pine': {'source': 'pine', 'min_pixels': 3000, 'green': 12, 'pixel_green': 6, 'count': (16, 20), 'scale': (0.55, 0.7), 'seed': 21,
             'axis': 0.8, 'angle': (45, 80), 'taper': 0.4},
    # short flat sprays: spruce, fir
    'fir': {'source': 'fir', 'min_pixels': 1500, 'green': 10, 'count': (24, 30), 'scale': (0.5, 0.65), 'seed': 22,
            'axis': 0.85, 'angle': (50, 85), 'taper': 0.4},
    # the fir sprays denser and darker: spruce
    'spruce': {'source': 'fir', 'min_pixels': 1500, 'green': 10, 'count': (28, 34), 'scale': (0.45, 0.58), 'seed': 23,
               'axis': 0.85, 'angle': (55, 85), 'taper': 0.4, 'brightness': 0.85, 'saturation': 0.9},
    # fine, light, feathery: larch, and juniper/cypress scale-leaves at a stretch
    'larch': {'source': 'fir', 'min_pixels': 1500, 'green': 10, 'count': (20, 26), 'scale': (0.42, 0.55), 'seed': 24,
              'axis': 0.85, 'angle': (55, 85), 'taper': 0.4, 'hue': -8, 'brightness': 1.15, 'saturation': 0.95},
    'larch_gold': {'source': 'fir', 'min_pixels': 1500, 'green': 10, 'count': (20, 26), 'scale': (0.42, 0.55), 'seed': 24,
                   'axis': 0.85, 'angle': (55, 85), 'taper': 0.4, 'hue': -40, 'brightness': 1.6, 'saturation': 1.1},
}


def components(im: Image.Image, cutoff: int, min_pixels: int, green_min: float) -> list[tuple[int, int, int, int]]:
    """Bounding boxes of every blob that is solid AND green enough, found on a quarter-size copy."""
    w, h = im.size
    small = im.resize((w // 4, h // 4), Image.BILINEAR)
    sw, sh = small.size
    px = small.load()
    seen = bytearray(sw * sh)
    boxes = []
    for start in range(sw * sh):
        x0_, y0_ = start % sw, start // sw
        if seen[start] or px[x0_, y0_][3] <= cutoff:
            continue
        stack = [start]
        seen[start] = 1
        x0, y0, x1, y1, n, green = sw, sh, 0, 0, 0, 0.0
        while stack:
            i = stack.pop()
            x, y = i % sw, i // sw
            r, g, b, a = px[x, y]
            n += 1
            green += g - (r + b) / 2
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < sw and 0 <= ny < sh:
                    j = ny * sw + nx
                    if not seen[j] and px[nx, ny][3] > cutoff:
                        seen[j] = 1
                        stack.append(j)
        if n * 16 >= min_pixels and green / n >= green_min:
            boxes.append((x0 * 4, y0 * 4, min(w, (x1 + 1) * 4), min(h, (y1 + 1) * 4)))
    return boxes


def graded(im: Image.Image, cfg: dict) -> Image.Image:
    if not any(k in cfg for k in ('hue', 'brightness', 'saturation')):
        return im
    a = im.getchannel('A')
    h, s, v = im.convert('RGB').convert('HSV').split()
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


def upright(sp: Image.Image) -> Image.Image:
    """Sprigs are cut at any angle; stand each one up so its long axis is vertical, base at the bottom."""
    if sp.width > sp.height:
        sp = sp.rotate(90, expand=True)
    return sp


def spray(sprites: list[Image.Image], cfg: dict, rng: random.Random, size: int) -> Image.Image:
    """A herringbone of sprigs along a vertical axis, base at the bottom centre, tip at the top."""
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    n = rng.randint(*cfg['count'])
    axis = cfg['axis'] * size
    cx = size / 2
    y_base = size * 0.96
    placed = []
    for i in range(n):
        u = (i + 0.5) / n                      # 0 at the base, 1 at the tip
        sp = upright(rng.choice(sprites))
        s = rng.uniform(*cfg['scale']) * size / max(sp.size) * (1 - cfg['taper'] * u)
        im = sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.LANCZOS)
        side = 1 if i % 2 == 0 else -1
        ang = rng.uniform(*cfg['angle']) * side          # off the axis, alternating sides
        im = im.rotate(-ang * 0.9, expand=True, resample=Image.BICUBIC)
        y = y_base - axis * u
        # the sprig's base sits on the axis; its body leans out to its side
        reach = im.height * 0.45
        x = cx + side * reach * math.sin(math.radians(abs(ang))) * 1.0
        y -= reach * math.cos(math.radians(abs(ang))) * 0.5
        placed.append((u, x, y, im))
    # a sprig straight up the axis for the tip
    sp = upright(rng.choice(sprites))
    s = rng.uniform(*cfg['scale']) * size / max(sp.size) * (1 - cfg['taper'])
    im = sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.LANCZOS)
    placed.append((1.0, cx, y_base - axis - im.height * 0.3, im))
    placed.sort(key=lambda p: p[0])
    for k, (u, x, y, im) in enumerate(placed):
        im = ImageEnhance.Brightness(im).enhance(0.75 + 0.25 * (k / max(len(placed) - 1, 1)))
        out.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))
    return out


def main() -> None:
    for key, cfg in PAGES.items():
        page = Image.open(CACHE / f"needle_{cfg['source']}_page.png").convert('RGBA')
        boxes = components(page, 64, cfg['min_pixels'], cfg['green'])
        sprites = [page.crop(b) for b in boxes]
        if 'pixel_green' in cfg:
            # a sprig's box can hold bits of bark and cone; drop every pixel that is not green enough
            th = cfg['pixel_green']
            cleaned = []
            for sp in sprites:
                px = sp.load()
                for y in range(sp.height):
                    for x in range(sp.width):
                        r, g, b, a = px[x, y]
                        if a and g - (r + b) / 2 < th:
                            px[x, y] = (r, g, b, 0)
                cleaned.append(sp)
            sprites = cleaned
        print(f'{key}: {len(sprites)} sprigs kept')
        rng = random.Random(cfg['seed'])
        atlas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        cell = SIZE // CELLS
        for i in range(CELLS * CELLS):
            im = graded(spray(sprites, cfg, rng, cell), cfg)
            atlas.alpha_composite(im, ((i % CELLS) * cell, (i // CELLS) * cell))
        rgb = atlas.convert('RGB')
        a = atlas.getchannel('A')
        halo = rgb.copy()
        for _ in range(3):
            halo = halo.filter(ImageFilter.MaxFilter(3))
        mask = a.point(lambda v: 255 if v > 8 else 0)
        rgb = Image.composite(rgb, halo, mask)
        rgb.putalpha(a)
        rgb.save(CACHE / f'needle_{key}_atlas.png', optimize=True)
        rgb.resize((512, 512), Image.LANCZOS).save(CACHE / f'needle_{key}_atlas_512.png', optimize=True)
        if key != 'larch_gold':
            snowtex.snow_needles(CACHE / f'needle_{key}_atlas.png', CACHE / f'needle_{key}_snow_atlas.png')


if __name__ == '__main__':
    sys.exit(main())
