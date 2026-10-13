# conifergen — procedural conifers for Trail Trainer

The coniferous half of the tree library, built on the same core as [`tools/deciduousgen`](../deciduousgen/README.md)
(read that first: budget, LODs, the file format, the viewer and the library mechanism are all the same).
What a conifer needs that a broadleaf did not is in three places:

- **Whorls** (`"distribution": "whorls"` in `treekit/tree.py`): rings of N branches at a regular step up
  the trunk, evenly spaced around it, jittered -- SpeedTree's "proportional steps". `step`, `per_whorl`,
  `first`, `last`.
- **Fronds** (`"leaves": {"mode": "frond"}`): cards lying *along* each branch, centred and overlapping like
  tiles, normal up, tilted at random about the branch so a crown is not a stack of edge-on planes, with a
  chance of a second card crossed at 90° (`cross`) and a pair of upright cards on the trunk's tip
  (`leader`) so a spruce ends in a point. `spacing`, `overlap`, `width`, `droop`, `tilt`.
- **A cone envelope**, and card-only secondary sprays (`"mesh": false`) that hang or rise from the whorl
  branches and carry most of the foliage.

```bash
npm run conifers:textures            # once: Poly Haven bark and twig pages, needle-spray atlases
python3 tools/conifergen/library.py  # the species table -> library.json (180 trees)
npm run conifers -- --library        # build into public/trees/ (merges into the deciduous index.json)
npm run conifers -- --species spruce --seed 4 --preview
```

## Species

| species | shape | bark | needles |
|---|---|---|---|
| spruce | narrow spire, whorls droop then turn up, hanging sprays, sharp point | japanese cedar | fir sprays, darker |
| fir | fuller, blunter cone of flat horizontal plates | chinese cedar | fir sprays |
| scots_pine | long bare trunk, open flat-topped crown of crooked upswept limbs | pine | pine bunches |
| black_pine | dense dark broad cone from low on the trunk | knotted pine | fir sprays, darker |
| larch | open airy cone, drooping sprays, light green; turns gold | pine | fir sprays, lighter / gold |
| cypress | tight columnar pillar, foliage to the ground | japanese cedar | fine sprays, blue-green tint |
| conifer_sapling | a young spruce or fir, 1–6 m | japanese cedar | fir sprays |

## Variety

Conifers vary more than a species file alone would give, so `library.py` draws per tree, on top of size: a
**fullness** (card density and spray size -- below 0.7 is spindly), a **branchiness** (branches per whorl
and branch length), a **crown profile** from a handful of shapes (cone, bulge, broken-leader flat top,
ragged with a waist, narrow) and a **lean**. Larches have a 30 % chance of the gold page and carry
`season: gold`. A fifth of every species carries snow (`season: winter`): the needle page blended toward
white under soft noise, heavier at the top of each spray, and the snow-banded bark (`snow=0.8`, see the
deciduous README for how the band lands on top of a branch). Everything else is `summer`.

## Textures

Poly Haven, CC0, in `CREDITS.md`. The needle pages are the twig sheets of `pine_tree_01` and
`fir_tree_01`; both carry cones and bark as well, and `pages.py` keeps only the blobs that are green
enough (and for the pine, only the green pixels inside them). A cell is a spray: sprigs in a herringbone
along an axis, base at the bottom, tip at the top, brighter toward the tip.

## Output

Same as deciduous: one GLB per tree with LOD0–2, shared textures under `public/trees/textures/`, root
extras with `kind: conifer`, `species`, `season`, `height`, `bounds` and per-LOD triangle counts, merged
into `public/trees/index.json`. Budgets: spires 2 500–4 500 triangles, pines 2 200–4 200, cypress
1 200–2 600, saplings 300–1 400.
