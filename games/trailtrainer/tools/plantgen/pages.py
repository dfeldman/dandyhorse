#!/usr/bin/env python3
"""
Builds the card atlases for the plant generator: four cells per atlas, each a sprite cut from a Poly
Haven plant page (by a hand-picked crop, then trimmed to its alpha) or a clump composed of several.

The plant pages are baked-model sheets with bleed all over them, so nothing here is found automatically
the way the leaf pages were: every sprite is a rectangle someone looked at. Upright sprites (grass,
leaves, fronds) are anchored at the bottom centre of their cell, so a card's base is the plant's base;
flower heads are centred.

    python3 tools/plantgen/pages.py
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / 'cache' / 'plantgen'
SIZE = 1024
CELL = SIZE // 2

# an atlas: four cells. A cell is ('page', crop) for one sprite, or ('clump', page, crop, n) for a clump of
# the sprites found inside the crop, or ('fan', page, crop, n) for blades fanned from the base.
G_TUFTS = [('grass_a', b) for b in ((0.21, 0.75, 0.54, 0.91), (0.59, 0.76, 0.86, 0.86), (0.57, 0.86, 0.79, 1.0), (0.03, 0.87, 0.20, 1.0), (0.24, 0.89, 0.50, 1.0))]
D_TUFTS = [('grass_dry', b) for _, b in G_TUFTS]
B_TUFTS = [('bermuda', b) for b in ((0.54, 0.36, 0.71, 0.55), (0.28, 0.40, 0.45, 0.54), (0.05, 0.42, 0.18, 0.54), (0.68, 0.11, 0.95, 0.24),
                                     (0.23, 0.63, 0.38, 0.98), (0.70, 0.67, 0.86, 0.99), (0.42, 0.69, 0.62, 0.99), (0.35, 0.03, 0.47, 0.31))]
BLADES = [('grass_b', b) for b in ((0.0, 0.0, 1.0, 1.0),)]

# an atlas is four cells; a cell is a single sprite ('page', box) or a composite ('clump'|'fan', [sprites], n)
ATLASES = {
    'fern': [('fern', (0.02, 0.0, 0.28, 1.0)), ('fern', (0.3, 0.0, 0.55, 1.0)), ('fern', (0.55, 0.0, 0.8, 1.0)), ('fern', (0.8, 0.0, 1.0, 1.0))],
    'grass_tuft': [('clump', B_TUFTS + G_TUFTS, 5), ('clump', G_TUFTS, 4), ('clump', B_TUFTS, 5), ('clump', G_TUFTS + B_TUFTS, 4)],
    # a second meadow page: fuller clumps with a few long blades through them, so two neighbouring clumps
    # are not the same four pictures
    'grass_meadow': [('clump', B_TUFTS + G_TUFTS, 7), ('clump', G_TUFTS + BLADES, 6), ('clump', B_TUFTS, 8), ('clump', G_TUFTS + B_TUFTS + BLADES, 7)],
    'grass_dry': [('clump', D_TUFTS, 4), ('clump', D_TUFTS, 3), ('clump', D_TUFTS, 5), ('clump', D_TUFTS + B_TUFTS, 4)],
    'grass_tall': [('fan', BLADES, 14), ('fan', BLADES, 18), ('fan', BLADES, 12), ('fan', BLADES, 16)],
    'daisy': [('gazania', (0.02, 0.66, 0.34, 0.98)), ('gazania', (0.39, 0.73, 0.63, 0.97)), ('ursinia', (0.47, 0.23, 0.78, 0.49)),
              ('ursinia', (0.23, 0.41, 0.43, 0.62))],
    'dandelion': [('dandelion', (0.58, 0.02, 0.79, 0.25)), ('dandelion', (0.81, 0.02, 1.0, 0.24)), ('dandelion', (0.86, 0.45, 0.98, 0.64)),
                  ('celandine', (0.28, 0.74, 0.41, 0.87))],
    'wildflower': [('periwinkle', (0.29, 0.25, 0.53, 0.49)), ('periwinkle', (0.79, 0.60, 0.96, 0.77)), ('empodium', (0.58, 0.51, 0.76, 0.70)),
                   ('celandine', (0.07, 0.83, 0.19, 0.96))],
    'rosette': [('dandelion', (0.02, 0.22, 0.17, 0.93)), ('dandelion', (0.20, 0.18, 0.40, 0.80)), ('gazania', (0.02, 0.28, 0.55, 0.59)),
                ('empodium', (0.14, 0.01, 0.47, 0.77))],
    'broadleaf': [('nettle', (0.50, 0.33, 0.66, 0.58)), ('shrub', (0.44, 0.0, 0.69, 0.51)), ('shrub', (0.67, 0.39, 0.93, 0.77)),
                  ('periwinkle', (0.32, 0.80, 0.61, 0.97))],
}


def page(name: str) -> Image.Image:
    return Image.open(CACHE / f'page_{name}.png').convert('RGBA')


def crop(im: Image.Image, box: tuple) -> Image.Image:
    w, h = im.size
    out = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    bbox = out.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def components(im: Image.Image, min_pixels: int = 300) -> list[Image.Image]:
    w, h = im.size
    small = im.resize((max(1, w // 3), max(1, h // 3)), Image.BILINEAR)
    sw, sh = small.size
    px = small.load()
    seen = bytearray(sw * sh)
    out = []
    for start in range(sw * sh):
        if seen[start] or px[start % sw, start // sw][3] <= 40:
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
                    if not seen[j] and px[nx, ny][3] > 40:
                        seen[j] = 1
                        stack.append(j)
        if n * 9 >= min_pixels:
            out.append(im.crop((x0 * 3, y0 * 3, min(w, (x1 + 1) * 3), min(h, (y1 + 1) * 3))))
    return out


def fit(sp: Image.Image, cell: int, anchor: str, fill: float = 0.92) -> Image.Image:
    """Scale a sprite into a cell, anchored at the bottom centre (upright) or the centre (head)."""
    out = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    s = cell * fill / max(sp.size)
    im = sp.resize((max(1, int(sp.width * s)), max(1, int(sp.height * s))), Image.LANCZOS)
    x = (cell - im.width) // 2
    y = cell - im.height - int(cell * 0.03) if anchor == 'bottom' else (cell - im.height) // 2
    out.alpha_composite(im, (x, y))
    return out


def clump(sprites: list[Image.Image], n: int, rng: random.Random, cell: int) -> Image.Image:
    """Several tufts side by side and overlapping, bases on one line: a grass clump seen from the side."""
    out = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    base = cell * 0.97
    xs = sorted(rng.uniform(0.2, 0.8) for _ in range(n))
    for k, x in enumerate(xs):
        sp = rng.choice(sprites)
        s = rng.uniform(0.5, 0.8) * cell / max(sp.size)
        im = sp.resize((max(1, int(sp.width * s)), max(1, int(sp.height * s))), Image.LANCZOS)
        if rng.random() < 0.5:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.8, 1.1))
        out.alpha_composite(im, (int(x * cell - im.width / 2), int(base - im.height)))
    return out


def fan(blades: list[Image.Image], n: int, rng: random.Random, cell: int) -> Image.Image:
    """Long blades fanned out from one base point, a bunch-grass tussock."""
    out = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    cx, base = cell * 0.5, cell * 0.97
    for k in range(n):
        sp = rng.choice(blades)
        if sp.width > sp.height:
            sp = sp.rotate(90, expand=True)
        s = rng.uniform(0.75, 0.95) * cell / sp.height
        im = sp.resize((max(1, int(sp.width * s)), max(1, int(sp.height * s))), Image.LANCZOS)
        ang = rng.uniform(-42, 42)
        im = im.rotate(ang, expand=True, resample=Image.BICUBIC)
        # the blade base at the fan's base; the tip swings out with the angle
        import math
        dx = -math.sin(math.radians(ang)) * im.height * 0.5
        im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.75, 1.1))
        out.alpha_composite(im, (int(cx + dx - im.width / 2), int(base - im.height * 0.98)))
    return out


def finish(atlas: Image.Image, name: str) -> None:
    rgb = atlas.convert('RGB')
    a = atlas.getchannel('A')
    halo = rgb.copy()
    for _ in range(3):
        halo = halo.filter(ImageFilter.MaxFilter(3))
    mask = a.point(lambda v: 255 if v > 8 else 0)
    rgb = Image.composite(rgb, halo, mask)
    rgb.putalpha(a)
    rgb.save(CACHE / f'{name}_atlas.png', optimize=True)
    rgb.resize((512, 512), Image.LANCZOS).save(CACHE / f'{name}_atlas_512.png', optimize=True)


def main() -> None:
    rng = random.Random(9)
    pages: dict = {}
    for name, cells in ATLASES.items():
        atlas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        for i, cell in enumerate(cells):
            if cell[0] in ('clump', 'fan'):
                _, srcs, n = cell
                sprites = []
                for pg, box in srcs:
                    pages.setdefault(pg, page(pg))
                    if box == (0.0, 0.0, 1.0, 1.0):
                        sprites += components(pages[pg])
                    else:
                        sprites.append(crop(pages[pg], box))
                im = clump(sprites, n, rng, CELL) if cell[0] == 'clump' else fan(sprites, n, rng, CELL)
            else:
                pg, box = cell
                pages.setdefault(pg, page(pg))
                sp = crop(pages[pg], box)
                head = name in ('daisy', 'dandelion', 'wildflower')
                im = fit(sp, CELL, 'centre' if head else 'bottom')
            atlas.alpha_composite(im, ((i % 2) * CELL, (i // 2) * CELL))
        finish(atlas, name)
        print(name)


if __name__ == '__main__':
    sys.exit(main())
