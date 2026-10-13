"""
The coniferous tree generator: species file + seed -> a game-ready GLB with LODs.

Same machinery as tools/deciduousgen (tools/treekit does the work); what differs is in the species files:
branches come in whorls up a single trunk, the crown envelope is a cone, and the foliage is fronds --
cards lying along each branch, tiled and overlapping -- painted with needle sprays.

    npm run conifers -- --species spruce --seed 3 --preview
    npm run conifers -- --library
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from treekit.genkit import Generator, run  # noqa: E402

CACHE = HERE.parent / 'cache' / 'conifergen'


def bark(spec: dict, size: int) -> tuple[Path, Path, Path]:
    key = spec.get('bark', 'pine')
    sfx = '' if size == 1024 else '_512'
    snow = '_snow' if float(spec.get('snow', 0)) > 0 else ''
    return (CACHE / f'bark_{key}{snow}_diff{sfx}.jpg', CACHE / f'bark_{key}_arm{sfx}.jpg', CACHE / f'bark_{key}_nor_gl{sfx}.jpg')


def leaves(spec: dict, size: int) -> Path:
    sfx = '' if size == 1024 else '_512'
    return CACHE / f"needle_{spec.get('leaves_page', 'fir')}_atlas{sfx}.png"


if __name__ == '__main__':
    run(Generator(name='conifergen', here=HERE, cache=CACHE, default_out=HERE.parent.parent / 'public' / 'trees',
                  doc=__doc__, bark=bark, leaves=leaves))
