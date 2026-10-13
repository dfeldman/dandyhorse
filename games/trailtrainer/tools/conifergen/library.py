#!/usr/bin/env python3
"""
Writes library.json for the conifers: the table of what a conifer wood is made of.

Conifers vary more than the species files alone would suggest. Most are full, some are spindly; most are
cones, some bulge, some lost their leader and grew flat-topped, some lean. So every tree draws, on top of
its size, a fullness (how many cards), a branchiness (whorl size and branch length), a crown profile
from a handful of shapes, and a lean. Sizes lean young, as a wood does.

    python3 tools/conifergen/library.py [--total 180]
"""
import argparse
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

# crown profiles a spire species may draw instead of its own: widest low (cone), widest a third up
# (bulge), a broken leader (flat top), and a ragged one with a waist
PROFILES = {
    'cone': None,
    'bulge': [0.8, 1.0, 0.95, 0.75, 0.5, 0.25, 0.04],
    'flat_top': [1.0, 0.92, 0.8, 0.65, 0.5, 0.42, 0.3],
    'ragged': [0.95, 0.7, 0.9, 0.55, 0.6, 0.3, 0.05],
    'narrow': [0.8, 0.75, 0.62, 0.48, 0.32, 0.16, 0.03],
}

# share, height range (m), and per-tree ranges: fullness (card density multiplier, < 0.7 is spindly),
# whorl (branches per whorl offset), length (branch length multiplier), profiles (weights), lean (deg)
TABLE = {
    'spruce':          {'share': 26, 'height': (8, 34), 'fullness': (0.55, 1.35), 'whorl': (-2, 2), 'length': (0.8, 1.2),
                        'profiles': {'cone': 5, 'bulge': 2, 'flat_top': 1, 'ragged': 2, 'narrow': 2}, 'lean': (0, 3)},
    'fir':             {'share': 18, 'height': (8, 30), 'fullness': (0.65, 1.35), 'whorl': (-2, 2), 'length': (0.8, 1.2),
                        'profiles': {'cone': 5, 'bulge': 2, 'flat_top': 2, 'ragged': 1}, 'lean': (0, 3)},
    'scots_pine':      {'share': 18, 'height': (8, 28), 'fullness': (0.6, 1.4), 'whorl': (-1, 2), 'length': (0.75, 1.3),
                        'profiles': {'cone': 1}, 'lean': (0, 9)},
    'black_pine':      {'share': 10, 'height': (6, 20), 'fullness': (0.7, 1.4), 'whorl': (-1, 2), 'length': (0.8, 1.2),
                        'profiles': {'cone': 1}, 'lean': (0, 5)},
    'larch':           {'share': 10, 'height': (8, 30), 'fullness': (0.5, 1.2), 'whorl': (-2, 1), 'length': (0.8, 1.2),
                        'profiles': {'cone': 4, 'bulge': 1, 'ragged': 2, 'narrow': 1}, 'lean': (0, 4)},
    'cypress':         {'share': 6, 'height': (3, 12), 'fullness': (0.8, 1.3), 'whorl': (-1, 1), 'length': (0.85, 1.15),
                        'profiles': {'cone': 1}, 'lean': (0, 3)},
    'conifer_sapling': {'share': 12, 'height': (1.2, 6), 'fullness': (0.6, 1.4), 'whorl': (-1, 2), 'length': (0.8, 1.2),
                        'profiles': {'cone': 4, 'bulge': 1, 'ragged': 1}, 'lean': (0, 6)},
}
SEASONS = {'larch': [('larch_gold', 'gold', 0.3)]}
WINTER = 0.2   # share of every species carrying snow
PAGE = {'spruce': 'spruce', 'fir': 'fir', 'scots_pine': 'pine', 'black_pine': 'spruce', 'larch': 'larch', 'cypress': 'larch', 'conifer_sapling': 'fir'}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--total', type=int, default=180)
    ap.add_argument('--seed', type=int, default=2027)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    shares = sum(t['share'] for t in TABLE.values())
    trees = []
    for species, t in TABLE.items():
        n = max(1, round(args.total * t['share'] / shares))
        lo, hi = t['height']
        for i in range(n):
            u = rng.random() ** 1.5
            h = round(lo + (hi - lo) * u, 1)
            fullness = round(rng.uniform(*t['fullness']), 2)
            sets = [
                f'height=[{h},{round(h * 0.03, 2)}]',
                f'leaves.density_scale={fullness}',
                # a spindly tree has smaller sprays too, or the budget fit grows them back to full
                f'leaves.size_scale={round(0.7 + 0.3 * fullness, 2)}',
                f'levels.0.per_whorl_offset={round(rng.uniform(*t["whorl"]), 1)}',
                f'levels.0.length_scale={round(rng.uniform(*t["length"]), 2)}',
                f'trunk.lean=[{round(rng.uniform(*t["lean"]), 1)},1.5]',
                f'leaves.light_var={round(rng.uniform(0.08, 0.18), 2)}',
            ]
            names, weights = zip(*t['profiles'].items())
            profile = rng.choices(names, weights)[0]
            if PROFILES[profile]:
                sets.append(f'envelope.profile={json.dumps(PROFILES[profile])}')
            season = 'summer'
            roll = rng.random()
            for page, season_name, prob in SEASONS.get(species, []):
                if roll < prob:
                    season = season_name
                    sets.append(f'leaves_page={page}')
                    break
                roll -= prob
            if season == 'summer' and rng.random() < WINTER:
                season = 'winter'
                sets += [f'leaves_page={PAGE[species]}_snow', 'snow=0.8']
            sets.append(f'season={season}')
            trees.append({'species': species, 'seed': 5000 + len(trees), 'name': f'{species}_{i + 1:03d}',
                          'shape': profile, 'set': sets})
    out = HERE / 'library.json'
    out.write_text(json.dumps({'about': 'Generated by library.py from its species table; do not edit by hand.',
                               'total': len(trees), 'trees': trees}, indent=1))
    print(f'{len(trees)} trees -> {out}')


if __name__ == '__main__':
    main()
