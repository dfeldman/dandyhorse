# rockgen — boulders, groups, scree and pebbles for Trail Trainer

The rocky furniture of a mountain route, built the same way as the trees (`tools/treekit` driver,
materials, export, LODs, library table, shared textures) with the shapes in `rockkit.py`.

```bash
npm run rocks:textures               # once: Poly Haven rock surfaces
python3 tools/rockgen/library.py     # the species table -> library.json (120 rocks)
npm run rocks -- --library           # build public/rocks/
npm run rocks -- --species cluster_mossy --seed 4 --preview
```

## How a rock is made

An icosphere is scaled into its overall shape (round, flat, tall, long, slab), cut by a few random
planes so it has the flat faces a broken rock has, then displaced along its normals by three scales of
layered value noise: lumps for asymmetry, bumps, grain. The noise is a function of position, so every
LOD -- one sphere subdivision coarser each -- is recognisably the same rock. UVs are a box projection
chosen per triangle by its normal, with the vertices split per face, which keeps a photographed surface
from stretching over a shape nobody unwrapped. `facet` blends the shading from smooth toward flat: a
broken block is flat-shaded, a river boulder smooth.

Moss and lichen are vertex colour. That works on a rock where it could not on a leaf: grey multiplied by
a green is moss-green. The moss mask is noise weighted toward the upper faces; lichen is noise in patches
anywhere; both scale with the species' `moss` and `lichen`, which the library jitters per rock.

A group is a first boulder with two or three smaller ones leaning against it and pebbles around their
feet. A scree or pebble field is forty to a hundred small stones on a disc, half sunk, no boulder.

## Species

| species | what | surface |
|---|---|---|
| boulder | one weathered boulder, any shape | rock_boulder_dry |
| boulder_angular | flat-faced broken block, flat-shaded | dark_rock_02 |
| boulder_mossy | forest boulder, moss on top | mossy_rock |
| lichen_boulder | high and dry, lichen-crusted | lichen_rock |
| slab | flat slab on the ground | rock_08 |
| spire | tall standing tooth | rock_boulder_cracked |
| cluster | 2–4 boulders and pebbles | rock_boulder_dry |
| cluster_mossy | the forest-floor group | mossy_rock |
| pale_cluster | pale cracked limestone group | marble_rock_01 |
| scree | 40–80 sharp stones, no boulder | gravel_stones |
| pebbles | 50–110 rounded river pebbles | dry_river_pebbles |

## Output

`public/rocks/<name>.glb`: root node with LOD0–2 children, one opaque PBR primitive each, shared textures
in `public/rocks/textures/`, `index.json` with `kind: rock`, `species`, `size`, what was placed (`placed`),
`bounds` and per-LOD triangle counts. Origin on the ground under the first boulder (it sits a little
below zero so it looks bedded in). Budgets 800–4 500 triangles at LOD0; a single boulder is 1 280.
