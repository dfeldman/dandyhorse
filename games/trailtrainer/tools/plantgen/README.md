# plantgen — grasses, ferns, flowers, palms and cacti for Trail Trainer

Everything on a route that is neither a tree nor a rock, built on the same core as the trees
(`tools/treekit`: driver, materials, export, LODs, shared textures, library table). The shapes are in
`plantkit.py`, four archetypes:

| form | what | species |
|---|---|---|
| tuft | cards fanned out from a point on the ground, one to four clumps | prairie_grass, meadow_grass, dry_grass, fern |
| flower | thin stems, a rosette at the foot, a head at the top: a tilted disc (daisies, dandelions, wildflowers), crossed upright cards (tulips) or one card facing sideways (sunflowers) | dandelion, daisy, wildflower, sunflower, tulip |
| palm | a leaning ringed trunk, a crown of drooping frond spines carrying frond cards, dead fronds hanging under | palm |
| cactus | a ribbed column with arms that leave it sideways and curve up; or a short fat barrel | saguaro, barrel_cactus |
| bush | cards standing on a dome, crossed, leaning out at the edge, optional flower dots; bushes borrow the tree leaf-cluster pages (`tree:broad` etc.) | bush_green, bush_flowering, bramble, nettle, sagebrush, heather, prickly_pear, clover |

Trail flora on top of the first twelve: meadow_full, meadow_tussock, meadow_short (meadow grass is the
commonest thing on a route, so it has four species and ninety entries), bracken, reeds, yucca, cattail,
lupine, goldenrod, mullein, thistle, cow_parsley, buttercup, poppy. Spikes, discs (poppy, umbel, thistle,
buttercup), prickly-pear pads and heather sprigs are painted.

```bash
npm run plants:textures              # once: Poly Haven pages, painted textures, card atlases
python3 tools/plantgen/library.py    # the table -> library.json (~190 plants)
npm run plants -- --library          # build public/plants/
npm run plants -- --species sunflower --seed 3 --preview
```

## Textures

Grass, fern, dandelion, daisy, wildflower and leaf cards are cut out of Poly Haven's CC0 plant models
(`fetch.py`). Those pages are baked-model sheets with bleed all over them, so every sprite is a
hand-picked rectangle in `pages.py`, trimmed to its alpha; grass cells are clumps of several tufts, or
long blades fanned from one base. Sunflower heads, tulip cups, palm fronds, cactus skin and the plain
green stem are painted by `paint.py` -- flat, 2011-honest, and the lighting does the rest.

## Output

`public/plants/<name>.glb`: root node with LOD0–2 children, each a mesh of up to three primitives: stem
(opaque: green skin, palm bark or cactus skin), leaves and heads (alpha-masked cards, double-sided).
LODs keep half and a quarter of the cards and grow the rest. Origin on the ground. `index.json` has
`kind: plant`, `form`, `species`, `height`, `bounds` and per-LOD triangle counts. Plants are tiny in
triangles (a grass clump is 40, a sunflower patch 400, a palm 300, a saguaro 600), so the game should
instance them by the thousand, as it does the grass it already has.
