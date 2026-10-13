"""
Snow for textures, run under the system Python with Pillow (fetch/pages scripts import this; nothing here
needs numpy or bpy).

Vertex colour can only darken a page, so snow has to be IN the texture. Bark gets a band of snow across
the top of its tile: the tube sweep, in snow mode, orients every ring so u = 0 faces up, so the band lands
along the upper side of every branch, and vertex colour then hides it again where a branch is vertical.
Needle pages get their sprigs blended toward white under a blurred noise mask, heavier at the top of each
spray.
"""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

SNOW = (232, 238, 248)


def _noise(size: tuple[int, int], seed: int, blur: float) -> Image.Image:
    rng = random.Random(seed)
    im = Image.effect_noise(size, 80).convert('L')
    # effect_noise is centred on 128; stretch it and blur it into soft patches
    im = im.point(lambda v: max(0, min(255, int((v - 128) * 2.2 + 128 + rng.uniform(-3, 3)))))
    return im.filter(ImageFilter.GaussianBlur(blur))


def snow_bark(diff: Path, out: Path, band: float = 0.22, seed: int = 3) -> None:
    """A bark page with a snow band centred on u = 0 (the left/right edges, which the tube's u wraps)."""
    im = Image.open(diff).convert('RGB')
    w, h = im.size
    mask = Image.new('L', (w, h), 0)
    px = mask.load()
    for x in range(w):
        u = x / w
        d = min(u, 1 - u)                     # distance from the wrap seam, where the top of the branch is
        v = max(0.0, 1 - d / band)
        v = v * v * (3 - 2 * v)               # smooth edge
        col = int(255 * v)
        for y in range(h):
            px[x, y] = col
    noise = _noise((w, h), seed, 6).point(lambda v: int(max(0, min(255, (v - 40) * 2.0))))
    mask = ImageChops.multiply(mask, noise.point(lambda v: 150 + v * 105 // 255))
    snow = Image.new('RGB', (w, h), SNOW)
    grain = _noise((w, h), seed + 1, 1.5).point(lambda v: 200 + v * 55 // 255)
    snow = ImageChops.multiply(snow, Image.merge('RGB', (grain, grain, grain)))
    Image.composite(snow, im, mask).save(out, quality=88)


def snow_needles(page: Path, out: Path, amount: float = 0.92, seed: int = 5) -> None:
    """A needle atlas blended toward white under soft noise, heavier toward the top of each cell."""
    im = Image.open(page).convert('RGBA')
    w, h = im.size
    a = im.getchannel('A')
    noise = _noise((w, h), seed, 5).point(lambda v: int(max(0, min(255, (v - 30) * 2.4))))
    # heavier at the top of each cell: cells are a 2 x 2 grid
    grad = Image.new('L', (w, h), 0)
    gp = grad.load()
    cell = h // 2
    for y in range(h):
        t = 1 - (y % cell) / cell
        col = int(255 * min(1.0, 0.45 + 0.55 * t))
        for x in range(w):
            gp[x, y] = col
    mask = ImageChops.multiply(noise, grad).point(lambda v: int(v * amount))
    mask = ImageChops.multiply(mask, a)
    snow = Image.new('RGBA', (w, h), SNOW + (255,))
    outim = Image.composite(snow, im, mask)
    outim.putalpha(a)
    outim.save(out, optimize=True)
    outim.resize((512, 512), Image.LANCZOS).save(out.with_name(out.stem + '_512.png'), optimize=True)
