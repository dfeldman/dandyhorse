"""
The deciduous tree generator: species file + seed -> a game-ready GLB with LODs.

Runs inside Blender, headless. All the botany lives in tools/treekit/ and species/*.json; this file only
says where this generator's textures are and hands over to the shared driver.

    npm run trees -- --species oak --seed 3                 one tree, public/trees/oak_3.glb
    npm run trees -- --species all --count 4                four seeds of every species
    npm run trees -- --library                              the whole library (library.json)
    npm run trees -- --species birch --set height=[9,1] --set leaves.size=[0.06,0.01]

What comes out, per tree:

    <name>.glb        a root node with LOD0, LOD1, LOD2 children, each a mesh of two primitives -- bark
                      (opaque, PBR: colour + normal + occlusion/roughness) and leaves (alpha-masked,
                      double-sided, vertex-coloured for shade and hue). Y up, metres, origin at the foot
                      of the trunk. Root node extras carry species, kind, season, seed, height, bounds
                      and the triangle count of each LOD.
    <name>.png        a preview render: the LODs side by side, if --preview

LODs are named nodes, not MSFT_lod, on purpose: Babylon's loader treats MSFT_lod as progressive loading and
would hide every LOD but the finest. The game picks by name.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from treekit.genkit import Generator, run  # noqa: E402

CACHE = HERE.parent / 'cache' / 'deciduousgen'


def bark(spec: dict, size: int) -> tuple[Path, Path, Path]:
    key = spec.get('bark', 'brown')
    sfx = '' if size == 1024 else '_512'
    snow = '_snow' if float(spec.get('snow', 0)) > 0 else ''
    return (CACHE / f'bark_{key}{snow}_diff{sfx}.jpg', CACHE / f'bark_{key}_arm{sfx}.jpg', CACHE / f'bark_{key}_nor_gl{sfx}.jpg')


def leaves(spec: dict, size: int) -> Path:
    sfx = '' if size == 1024 else '_512'
    return CACHE / f"leaf_{spec.get('leaves_page', 'broad')}_atlas{sfx}.png"


if __name__ == '__main__':
    run(Generator(name='deciduousgen', here=HERE, cache=CACHE, default_out=HERE.parent.parent / 'public' / 'trees',
                  doc=__doc__, bark=bark, leaves=leaves))
