#!/usr/bin/env python3
"""
Writes library.json: the table of trees that `npm run trees -- --library` builds.

The table below is the whole description of the forest's population: for each species, how many trees,
the height range, and how far the shape may wander from the species file per tree -- crown width, how
often the trunk forks, leaf size, lean, bough angle. Every tree gets its own seed and its own draw from
those ranges, so five hundred trees are five hundred different trees and not ten species scaled.

    python3 tools/deciduousgen/library.py            rewrite library.json (deterministic)
    python3 tools/deciduousgen/library.py --total 200

Sizes are drawn from a distribution that leans young: a wood has many more small trees than old ones.
"""
import argparse
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

# species -> share of the library, height range (m), and per-tree jitter ranges.
# 'width' and 'size' are multipliers on the species file; 'fork' is added to trunk.splits.count;
# 'angle' is added to the boughs' angle; 'lean' is the trunk lean range in degrees.
# 'season' is the share of trees that get a turned page: (page suffix, season name, probability).
# 'warm' is the per-tree warmth range for the summer page: 0 is the page as photographed, 1 pulls the
# blue out so the leaves go yellow-green; 'light' is the per-card lightness variation.
SEASONS = {
    'oak':     [('autumn', 'autumn', 0.18), ('gold', 'gold', 0.06)],
    'maple':   [('autumn', 'autumn', 0.22), ('gold', 'gold', 0.08)],
    'beech':   [('copper', 'copper', 0.15), ('autumn', 'autumn', 0.08)],
    'elm':     [('autumn', 'autumn', 0.12), ('gold', 'gold', 0.1)],
    'ash':     [('gold', 'gold', 0.2)],
    'birch':   [('gold', 'gold', 0.25), ('autumn', 'autumn', 0.05)],
    'aspen':   [('gold', 'gold', 0.3)],
    'poplar':  [('gold', 'gold', 0.2)],
    'willow':  [('gold', 'gold', 0.1)],
    'sapling': [('autumn', 'autumn', 0.12), ('gold', 'gold', 0.1)],
}
WINTER = 0.1   # share of every species that is bare and snow-topped
PAGES = {'oak': 'broad', 'maple': 'broad', 'beech': 'dark', 'elm': 'dark', 'ash': 'fine', 'birch': 'light',
         'aspen': 'light', 'poplar': 'light', 'willow': 'light', 'sapling': 'broad'}

TABLE = {
    'oak':     {'share': 14, 'height': (9, 24), 'width': (0.85, 1.2), 'fork': (-0.6, 0.6), 'size': (0.9, 1.15), 'angle': (-6, 6), 'lean': (0, 6)},
    'maple':   {'share': 13, 'height': (8, 20), 'width': (0.85, 1.15), 'fork': (-0.6, 0.4), 'size': (0.9, 1.1), 'angle': (-6, 6), 'lean': (0, 4)},
    'beech':   {'share': 10, 'height': (10, 26), 'width': (0.85, 1.15), 'fork': (-0.5, 0.5), 'size': (0.9, 1.1), 'angle': (-6, 6), 'lean': (0, 4)},
    'elm':     {'share': 8,  'height': (12, 28), 'width': (0.85, 1.15), 'fork': (-0.6, 0.6), 'size': (0.9, 1.1), 'angle': (-5, 5), 'lean': (0, 3)},
    'ash':     {'share': 10, 'height': (10, 26), 'width': (0.85, 1.2), 'fork': (-0.6, 0.6), 'size': (0.9, 1.1), 'angle': (-6, 6), 'lean': (0, 4)},
    'birch':   {'share': 13, 'height': (7, 20), 'width': (0.85, 1.25), 'fork': (-0.4, 0.6), 'size': (0.9, 1.15), 'angle': (-8, 8), 'lean': (0, 8)},
    'aspen':   {'share': 10, 'height': (6, 17), 'width': (0.85, 1.2), 'fork': (-0.4, 0.5), 'size': (0.9, 1.15), 'angle': (-8, 8), 'lean': (0, 6)},
    'poplar':  {'share': 7,  'height': (12, 30), 'width': (0.85, 1.2), 'fork': (0, 0), 'size': (0.9, 1.1), 'angle': (-4, 4), 'lean': (0, 2)},
    'willow':  {'share': 5,  'height': (8, 18), 'width': (0.85, 1.15), 'fork': (-0.6, 0.6), 'size': (0.9, 1.1), 'angle': (-6, 6), 'lean': (3, 10)},
    'sapling': {'share': 10, 'height': (2.5, 7), 'width': (0.8, 1.25), 'fork': (-0.5, 0.5), 'size': (0.9, 1.2), 'angle': (-8, 8), 'lean': (0, 8)},
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--total', type=int, default=500)
    ap.add_argument('--seed', type=int, default=2026)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    shares = sum(t['share'] for t in TABLE.values())
    trees = []
    for species, t in TABLE.items():
        n = max(1, round(args.total * t['share'] / shares))
        lo, hi = t['height']
        for i in range(n):
            # young-leaning size distribution: the square of a uniform draw piles up at the small end
            u = rng.random() ** 1.6
            h = round(lo + (hi - lo) * u, 1)
            sets = [
                f'height=[{h},{round(h * 0.03, 2)}]',
                f'envelope.width_scale={round(rng.uniform(*t["width"]), 3)}',
                f'leaves.size_scale={round(rng.uniform(*t["size"]), 3)}',
                f'trunk.lean=[{round(rng.uniform(*t["lean"]), 1)},2]',
                f'levels.0.angle_offset={round(rng.uniform(*t["angle"]), 1)}',
            ]
            if t['fork'] != (0, 0):
                sets.append(f'trunk.splits.count_offset={round(rng.uniform(*t["fork"]), 2)}')
            # colour: most trees are summer green with their own warmth and lightness; some have turned
            roll = rng.random()
            season = 'summer'
            for suffix, season_name, prob in SEASONS.get(species, []):
                if roll < prob:
                    season = season_name
                    sets.append(f'leaves_page={PAGES[species]}_{suffix}')
                    break
                roll -= prob
            if rng.random() < WINTER:
                # bare and snow-topped: no cards, the twigs meshed instead, the snow-banded bark
                season = 'winter'
                sets = [x for x in sets if not x.startswith('leaves_page=')]
                spec = json.loads((HERE / 'species' / f'{species}.json').read_text())
                n_levels = len(spec.get('levels') or json.loads((HERE / 'species' / f"{spec['extends']}.json").read_text())['levels'])
                sets += ['leaves.none=true', f'levels.{n_levels - 1}.mesh=true', 'snow=0.8']
            sets.append(f'season={season}')
            sets.append(f'leaves.warm={round(rng.random() ** 2 * 0.8, 2)}')
            sets.append(f'leaves.light_var={round(rng.uniform(0.08, 0.2), 2)}')
            trees.append({'species': species, 'seed': 1000 + len(trees), 'name': f'{species}_{i + 1:03d}', 'set': sets})
    out = HERE / 'library.json'
    out.write_text(json.dumps({'about': 'Generated by library.py from its species table; do not edit by hand.',
                               'total': len(trees), 'trees': trees}, indent=1))
    print(f'{len(trees)} trees -> {out}')


if __name__ == '__main__':
    main()
