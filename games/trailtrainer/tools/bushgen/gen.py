"""
The bush generator: woody shrubs, built as trees without a single trunk.

A bush is not a dome of cards. It is several stems leaving the ground together, each branching into twigs,
with foliage over the whole of it -- which is exactly what tools/treekit already grows, given a trunk that
splits at ankle height into half a dozen leaders and a crown envelope that starts at the ground. So this
generator is deciduousgen's, pointed at shorter species and a smaller budget, and it borrows both leaf
libraries: broadleaf cluster pages from deciduousgen's cache, needle sprays from conifergen's, so a
juniper scrub and a hazel come off the same machinery.

    npm run bushes -- --species hazel --seed 3 --preview
    npm run bushes -- --library                       -> public/plants (merged with plantgen's index)

They go in with the plants rather than the trees because that is what they are to the game: ground cover
the scatter sows by the hundred on its near ring, not standing scenery it counts by the hectare.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from treekit.genkit import Generator, run  # noqa: E402

DECID = HERE.parent / 'cache' / 'deciduousgen'
CONIF = HERE.parent / 'cache' / 'conifergen'


def bark(spec: dict, size: int) -> tuple[Path, Path, Path]:
    """Bark from whichever cache the species' wood comes from."""
    key = spec.get('bark', 'brown')
    cache = CONIF if spec.get('bark_from') == 'conifer' else DECID
    sfx = '' if size == 1024 else '_512'
    snow = '_snow' if float(spec.get('snow', 0)) > 0 else ''
    return (cache / f'bark_{key}{snow}_diff{sfx}.jpg', cache / f'bark_{key}_arm{sfx}.jpg', cache / f'bark_{key}_nor_gl{sfx}.jpg')


def leaves(spec: dict, size: int) -> Path:
    """Broadleaf cluster page, or a conifer needle spray page for the evergreen scrub."""
    page = spec.get('leaves_page', 'broad')
    sfx = '' if size == 1024 else '_512'
    if spec.get('leaves_from') == 'conifer':
        return CONIF / f'needle_{page}_atlas{sfx}.png'
    return DECID / f'leaf_{page}_atlas{sfx}.png'


if __name__ == '__main__':
    run(Generator(name='bushgen', here=HERE, cache=DECID, default_out=HERE.parent.parent / 'public' / 'plants',
                  doc=__doc__, bark=bark, leaves=leaves))
