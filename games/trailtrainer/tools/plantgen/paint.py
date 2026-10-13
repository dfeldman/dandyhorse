#!/usr/bin/env python3
"""
Paints the plant textures Poly Haven does not have: a sunflower head, tulip flowers, a palm frond, cactus
skin, a plain green stem. Pillow only. Flat, slightly shaded, 2011-game honest; the geometry and the
lighting do the rest.

    python3 tools/plantgen/paint.py
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / 'cache' / 'plantgen'
S = 512


def petal(draw: ImageDraw.ImageDraw, cx: float, cy: float, ang: float, length: float, width: float, colour, tip=None) -> None:
    """A pointed petal from (cx, cy) outward at angle `ang` (degrees), as a polygon."""
    a = math.radians(ang)
    pts = []
    for t in [i / 12 for i in range(13)]:
        w = width * math.sin(math.pi * t) * (1 - 0.5 * t)
        for side in (1, -1):
            x = cx + math.cos(a) * length * t - math.sin(a) * w * side
            y = cy + math.sin(a) * length * t + math.cos(a) * w * side
            if side == 1:
                pts.append((x, y))
            else:
                pts.insert(0, (x, y))
    draw.polygon(pts, fill=colour)


def sunflower(seed: int = 1) -> Image.Image:
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = S / 2
    for layer, (length, width, col) in enumerate((((0.46, 0.055, (214, 150, 20, 255))), (0.42, 0.06, (240, 180, 30, 255)))):
        n = 34
        for i in range(n):
            ang = i * 360 / n + layer * 5 + rng.uniform(-3, 3)
            petal(d, cx, cy, ang, S * length * rng.uniform(0.9, 1.05), S * width, col)
    d.ellipse((cx - S * 0.2, cy - S * 0.2, cx + S * 0.2, cy + S * 0.2), fill=(70, 40, 18, 255))
    d.ellipse((cx - S * 0.17, cy - S * 0.17, cx + S * 0.17, cy + S * 0.17), fill=(95, 55, 22, 255))
    # seed spiral
    for k in range(320):
        r = S * 0.17 * math.sqrt(k / 320)
        a = k * 137.508
        x, y = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        c = (120 + rng.randint(-15, 15), 80 + rng.randint(-15, 15), 35, 255)
        d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=c)
    return im


def tulip(colour, seed: int = 2) -> Image.Image:
    """A tulip seen from the side: three overlapping cupped petals on a cell."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, base = S / 2, S * 0.92
    r, g, b = colour
    dark = (int(r * 0.7), int(g * 0.7), int(b * 0.7), 255)
    for i, (dx, shade) in enumerate(((-0.22, dark), (0.22, dark), (0.0, (r, g, b, 255)))):
        x0 = cx + dx * S
        pts = [(x0 - S * 0.11, base), (x0 - S * 0.27, base - S * 0.45), (x0 - S * 0.18 + rng.uniform(-8, 8), base - S * 0.78),
               (x0, base - S * 0.6), (x0 + S * 0.18 + rng.uniform(-8, 8), base - S * 0.78), (x0 + S * 0.27, base - S * 0.45),
               (x0 + S * 0.11, base)]
        d.polygon(pts, fill=shade)
    # a paler highlight down the middle petal
    d.polygon([(cx - S * 0.05, base), (cx - S * 0.1, base - S * 0.5), (cx, base - S * 0.62), (cx + S * 0.1, base - S * 0.5), (cx + S * 0.05, base)],
              fill=(min(255, r + 40), min(255, g + 40), min(255, b + 40), 255))
    return im.filter(ImageFilter.GaussianBlur(0.6))


def palm_frond(seed: int = 3) -> Image.Image:
    """A pinnate frond, rib up the middle, leaflets either side, base at the bottom."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = S / 2
    n = 34
    for i in range(n):
        t = i / n
        y = S * 0.95 - t * S * 0.9
        length = S * 0.42 * math.sin(math.pi * (0.1 + 0.9 * t)) ** 0.6 * (1 - 0.3 * t) + S * 0.05
        for side in (1, -1):
            ang = -90 + side * (62 - 30 * t) + rng.uniform(-5, 5)
            g = 125 + rng.randint(-22, 22)
            petal(d, cx, y, ang, length, S * 0.022, (45 + rng.randint(-10, 10), g, 42, 255))
    d.line([(cx, S * 0.98), (cx, S * 0.05)], fill=(120, 105, 50, 255), width=6)
    return im


def cactus_skin() -> Image.Image:
    """Ribbed green, tileable in u: dark grooves, lighter ridges, a few pale areoles with spines."""
    rng = random.Random(4)
    im = Image.new('RGB', (S, S), (70, 110, 60))
    px = im.load()
    ribs = 6
    for x in range(S):
        u = (x / S * ribs) % 1.0
        shade = 0.7 + 0.3 * math.cos(u * 2 * math.pi)     # ridge bright at u = 0
        for y in range(S):
            n = rng.random() * 0.06
            r, g, b = 60 * shade + 10, 105 * shade + 15, 55 * shade + 8
            px[x, y] = (int(r * (1 + n)), int(g * (1 + n)), int(b * (1 + n)))
    d = ImageDraw.Draw(im)
    for k in range(ribs):
        x = int((k / ribs) * S)
        for y in range(0, S, 44):
            yy = y + (22 if k % 2 else 0)
            d.ellipse((x - 5, yy - 4, x + 5, yy + 4), fill=(190, 185, 150))
            for a in range(0, 360, 45):
                d.line([(x, yy), (x + 9 * math.cos(math.radians(a)), yy + 9 * math.sin(math.radians(a)))], fill=(230, 225, 200), width=1)
    return im


def stem_skin() -> Image.Image:
    rng = random.Random(5)
    im = Image.new('RGB', (S // 4, S), (70, 120, 50))
    px = im.load()
    for x in range(S // 4):
        for y in range(S):
            k = 0.85 + 0.15 * math.cos(x / (S / 4) * 2 * math.pi) + rng.random() * 0.06
            px[x, y] = (int(70 * k), int(120 * k), int(50 * k))
    return im


def spike(colour, kind: str, seed: int) -> Image.Image:
    """A flower spike on a stem: a column of florets (lupine, goldenrod, mullein) or a cattail's sausage."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = S / 2
    d.line([(cx, S * 0.98), (cx, S * 0.2)], fill=(80, 120, 50, 255), width=8)
    r, g, b = colour
    if kind == 'cattail':
        d.rounded_rectangle((cx - S * 0.05, S * 0.12, cx + S * 0.05, S * 0.5), radius=int(S * 0.05), fill=(95, 60, 30, 255))
        d.line([(cx, S * 0.12), (cx, S * 0.03)], fill=(140, 130, 80, 255), width=4)
        return im
    top, bottom = S * 0.08, S * 0.62
    n = 110 if kind == 'plume' else 55
    for i in range(n):
        t = i / n
        y = bottom - (bottom - top) * t
        spread = S * (0.11 if kind == 'plume' else 0.075) * (1 - 0.6 * t) if kind != 'plume' else S * 0.13 * (0.3 + 0.7 * t)
        x = cx + rng.uniform(-spread, spread)
        k = rng.uniform(0.75, 1.15)
        rad = S * (0.03 if kind != 'plume' else 0.032) * rng.uniform(0.7, 1.2)
        d.ellipse((x - rad, y - rad * 0.8, x + rad, y + rad * 0.8), fill=(min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255))
    return im


def disc(kind: str, seed: int) -> Image.Image:
    """A flower seen from above: a four-petal poppy, a white umbel, a thistle head, a buttercup."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = S / 2
    if kind == 'poppy':
        for i in range(4):
            petal(d, cx, cy, i * 90 + rng.uniform(-8, 8), S * 0.45, S * 0.19, (205, 30, 25, 255))
        d.ellipse((cx - S * 0.07, cy - S * 0.07, cx + S * 0.07, cy + S * 0.07), fill=(30, 25, 30, 255))
    elif kind == 'umbel':
        d.ellipse((cx - S * 0.44, cy - S * 0.44, cx + S * 0.44, cy + S * 0.44), fill=(225, 230, 210, 140))
        for i in range(420):
            a = rng.uniform(0, 6.283)
            rr = S * 0.45 * math.sqrt(rng.random())
            x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
            d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=(248, 248, 240, 255))
        for i in range(24):
            a = i * 15
            d.line([(cx, cy), (cx + S * 0.42 * math.cos(math.radians(a)), cy + S * 0.42 * math.sin(math.radians(a)))], fill=(150, 170, 100, 255), width=2)
    elif kind == 'thistle':
        for i in range(90):
            a = rng.uniform(0, 360)
            petal(d, cx, cy, a, S * rng.uniform(0.28, 0.42), S * 0.012, (150, 60, 170, 255))
        d.ellipse((cx - S * 0.13, cy - S * 0.13, cx + S * 0.13, cy + S * 0.13), fill=(90, 120, 60, 255))
    elif kind == 'buttercup':
        for i in range(5):
            petal(d, cx, cy, i * 72 + rng.uniform(-6, 6), S * 0.42, S * 0.2, (245, 205, 30, 255))
        d.ellipse((cx - S * 0.08, cy - S * 0.08, cx + S * 0.08, cy + S * 0.08), fill=(220, 170, 20, 255))
    return im


def pad(seed: int) -> Image.Image:
    """A prickly pear pad: a flat green oval with areoles, base at the bottom."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S * rng.uniform(0.3, 0.4)
    d.ellipse((S / 2 - w, S * 0.08, S / 2 + w, S * 0.95), fill=(85, 130, 70, 255))
    d.ellipse((S / 2 - w * 0.8, S * 0.15, S / 2 + w * 0.8, S * 0.9), outline=(70, 115, 60, 255), width=6)
    for i in range(40):
        a = rng.uniform(0, 6.283)
        rr = math.sqrt(rng.random())
        x, y = S / 2 + w * 0.85 * rr * math.cos(a), S * 0.515 + S * 0.42 * rr * math.sin(a)
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(200, 190, 140, 255))
        for k in range(4):
            aa = rng.uniform(0, 6.283)
            d.line([(x, y), (x + 12 * math.cos(aa), y + 12 * math.sin(aa))], fill=(230, 225, 200, 255), width=1)
    return im


def heather(seed: int) -> Image.Image:
    """A heather sprig: a woody stem with tiny leaves and a spike of small purple bells."""
    rng = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for stem in range(3):
        x0 = S * (0.3 + 0.2 * stem)
        pts = [(x0, S * 0.97)]
        for i in range(1, 8):
            pts.append((x0 + rng.uniform(-S * 0.04, S * 0.04) * i / 2, S * 0.97 - i * S * 0.12))
        d.line(pts, fill=(70, 55, 35, 255), width=5)
        for i in range(60):
            t = rng.uniform(0.35, 1.0)
            k = int(t * 7)
            x = pts[min(k, 7)][0] + rng.uniform(-S * 0.05, S * 0.05)
            y = S * 0.97 - t * S * 0.84
            c = (150 + rng.randint(-20, 20), 70 + rng.randint(-15, 15), 160 + rng.randint(-20, 20), 255)
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=c)
        for i in range(40):
            t = rng.uniform(0.05, 0.6)
            k = int(t * 7)
            x = pts[min(k, 7)][0] + rng.uniform(-S * 0.04, S * 0.04)
            y = S * 0.97 - t * S * 0.84
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(60, 90, 45, 255))
    return im


def flat_arm(im: Image.Image) -> None:
    """A flat 'arm' page (occlusion 1, roughness 0.8, metal 0) sized like the colour page."""
    arm = Image.new('RGB', im.size, (255, 200, 0))
    arm.save(CACHE / 'flat_arm.jpg', quality=80)


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    atlas = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    atlas.alpha_composite(sunflower(1), (0, 0))
    atlas.alpha_composite(sunflower(2), (S, 0))
    atlas.alpha_composite(tulip((220, 40, 40)), (0, S))
    atlas.alpha_composite(tulip((240, 200, 40), 3), (S, S))
    atlas.save(CACHE / 'painted_flowers_atlas.png', optimize=True)
    tul = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    tul.alpha_composite(tulip((220, 40, 40), 1), (0, 0))
    tul.alpha_composite(tulip((240, 200, 40), 2), (S, 0))
    tul.alpha_composite(tulip((235, 90, 160), 3), (0, S))
    tul.alpha_composite(tulip((250, 250, 240), 4), (S, S))
    tul.save(CACHE / 'painted_tulips_atlas.png', optimize=True)
    fr = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    for i in range(4):
        fr.alpha_composite(palm_frond(10 + i), ((i % 2) * S, (i // 2) * S))
    fr.save(CACHE / 'painted_frond_atlas.png', optimize=True)
    sp = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    sp.alpha_composite(spike((120, 70, 200), 'spike', 21), (0, 0))          # lupine
    sp.alpha_composite(spike((240, 200, 40), 'plume', 22), (S, 0))          # goldenrod
    sp.alpha_composite(spike((240, 215, 60), 'spike', 23), (0, S))          # mullein
    sp.alpha_composite(spike((0, 0, 0), 'cattail', 24), (S, S))             # cattail
    sp.save(CACHE / 'painted_spikes_atlas.png', optimize=True)
    dc = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    for i, k in enumerate(('poppy', 'umbel', 'thistle', 'buttercup')):
        dc.alpha_composite(disc(k, 30 + i), ((i % 2) * S, (i // 2) * S))
    dc.save(CACHE / 'painted_discs_atlas.png', optimize=True)
    pd = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    for i in range(4):
        pd.alpha_composite(pad(40 + i), ((i % 2) * S, (i // 2) * S))
    pd.save(CACHE / 'painted_pads_atlas.png', optimize=True)
    he = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0))
    for i in range(4):
        he.alpha_composite(heather(50 + i), ((i % 2) * S, (i // 2) * S))
    he.save(CACHE / 'painted_heather_atlas.png', optimize=True)
    cactus_skin().save(CACHE / 'skin_cactus_diff.jpg', quality=88)
    stem_skin().save(CACHE / 'skin_stem_diff.jpg', quality=88)
    flat_arm(Image.new('RGB', (64, 64)))
    for name in ('painted_flowers', 'painted_tulips', 'painted_frond', 'painted_spikes', 'painted_discs', 'painted_pads', 'painted_heather'):
        Image.open(CACHE / f'{name}_atlas.png').resize((512, 512), Image.LANCZOS).save(CACHE / f'{name}_atlas_512.png', optimize=True)
    print('painted ->', CACHE)


if __name__ == '__main__':
    sys.exit(main())
