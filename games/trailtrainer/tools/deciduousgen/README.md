# deciduousgen — procedural broadleaf trees for Trail Trainer

Generates game-ready deciduous trees as GLB: a trunk and boughs swept from grown spines, a crown of leaf
cards, PBR bark, alpha-masked leaves, three LODs, 2 000–5 000 triangles at LOD0. Built in advance, never
at runtime. The library that ships in `public/trees/` is five hundred trees of ten species, generated from
the species table in `library.py`, and every one of them is a pure function of a species file, a seed and
a handful of per-tree attributes.

```bash
npm run trees:textures                 # once: fetch the CC0 bark and leaf pages, build the cluster atlases
python3 tools/deciduousgen/library.py  # (re)write library.json from the species table
npm run trees -- --library             # build public/trees/ (500 trees, shared textures, ~6 minutes)
npm run trees -- --species oak --seed 7 --preview        # one tree, embedded textures, with a render
npm run trees -- --species all --count 3 --preview       # three seeds of every species
npm run trees -- --species birch --set height=[9,1] --set leaves.size=[0.06,0.01]
```

Look at the result in the game's own engine at <http://localhost:5196/tools/deciduousgen/viewer.html>
with the dev server running (`?tree=oak_03&lod=all` picks one and shows the LODs side by side). The Blender
renders that `--preview` writes are the other way to look, and the one the library build uses
(`tools/cache/deciduousgen/previews/`).

## What the approach is, and is not

SpeedTree's model, not an L-system: a tree is a chain of **generators** — trunk, boughs, branches, twigs,
leaves — each of which puts nodes on its parent's nodes. Every property of a generator is a `Param`: a
constant, a curve over where the node sits on its parent, or a curve with a per-node variance
(`treekit/curves.py`). "Bough length" is a curve over height up the trunk times a jitter, never a number.
That, plus a **crown envelope** that prunes whatever grows outside the species' silhouette, is what makes an
oak an oak and a poplar a poplar. There is no grammar, no rewriting, and nothing recursive: each level is
grown from the one above, once, in order.

A spine (`treekit/spine.py`) is stepped forward under a few forces — tropism up or down along its length,
a persistent random wander, gnarl, a return force — and carries a parallel-transported frame, so children
can be placed by roll angle (golden spiral, opposite pairs for maple and ash, alternate for oak and beech)
without the twist a Frenet frame would add.

Randomness is keyed, not global (`treekit/rng.py`): every generator and node draws from
`default_rng([seed, level, node, purpose])`. Raising the leaf count does not move a single bough.

## Where the triangles go

The budget decides the architecture. A trunk at ten sides and twenty rings is 400 triangles; twenty boughs
at six sides are another 1 500; geometric twigs would blow the budget on their own. So:

- Ring side count is a function of radius (`radial_for`), 10 sides down to 3, never of level.
- The last level (`"mesh": false`) grows spines for the leaves to sit on and costs nothing.
- Cards are flat quads, two triangles, and the twig is in the texture. A folded card (four triangles)
  is available per species (`leaves.fold`) but halves the card count for the same budget.
- The structure is grown once at full detail and then **reduced** (`treekit/budget.py`): bark gets the
  side count it deserves, then branches are dropped by priority (smallest and most hidden first, bisecting
  on the kept fraction) until bark is under its share; the rest goes to leaves, thinned by a per-leaf
  random ("jumble") and enlarged by the square root of what was lost ("grow scale"), which keeps the crown
  looking full instead of hollow.

LODs (`treekit/lod.py`) are the same machinery applied harder: LOD1 keeps about a third of the triangles,
LOD2 a sixth and strips the tube off the deepest meshed level, leaves growing to cover. They are derived
from the one tree, never regrown, so LOD1 is recognisably the same tree as LOD0.

## The file

One GLB per tree. Y up, metres, origin at the foot of the trunk.

```
<name>            root node; extras: species, seed, height (nominal trunk height), crown_radius (card
                    centres), bounds {top, radius, bottom} measured from LOD0 with cards, lods (tri counts)
  LOD0            mesh of two primitives: bark (opaque, base colour + normal + occlusion/roughness) and
  LOD1              leaves (alpha MASK at 0.5, double-sided, COLOR_0 carries crown shade and hue jitter,
  LOD2              NORMAL points out of the crown rather than out of the card)
```

Babylon loads a two-primitive mesh as a `TransformNode` named `LOD0` with children `LOD0_primitive0`
(bark) and `LOD0_primitive1` (leaves); enable the node you want per distance. The LODs are plain named
nodes rather than `MSFT_lod` on purpose: Babylon treats that extension as progressive loading and hides every
LOD but the finest.

`--library` (and `--shared-textures`) rewrites each GLB to reference its images in `public/trees/textures/`
by content hash rather than embedding them (`glbtools.py`), so five hundred trees are ~120 MB of mesh and
~6 MB of textures instead of a gigabyte. Without the flag a GLB is self-contained (~2 MB). Every GLB also
has its vertex colours rewritten from float to normalised bytes, a quarter of the size and all a shade
needs. `public/trees/index.json` lists every tree with its species, height, measured bounds and triangle
counts per LOD, which is what a scatter system should read to pick and place them.

Leaf cards sit along every branch level, boughs and leaders included, scattered a little off the spine: a
crown is a continuous shell that way rather than a tuft at the end of each branch, which is what the first
version looked like and what SpeedTree's batched leaves avoid the same way.

## Species

`species/*.json`, one per species, documented by example in `oak.json`. `"extends"` inherits another file.
`--set path.to.key=json` overrides anything from the command line.

**The library is a table, not a list.** `library.py` holds, per species, its share of the 500, a height
range and jitter ranges for crown width, forking, leaf size, lean and bough angle. It draws every tree's
attributes from those ranges (sizes lean young, as a wood does) and writes `library.json`, which `--library`
builds. The jitter is expressed as multipliers and offsets (`envelope.width_scale`, `leaves.size_scale`,
`trunk.splits.count_offset`, `levels.0.angle_offset`) that `gen.py` folds into the species values, so the
species files stay the single description of each shape. Change the table, rerun both, and the forest's
population changes.

| species | shape | bark | leaves |
|---|---|---|---|
| oak | short forking trunk, wide crooked crown | jolcham oak | broad |
| maple | straight trunk, dense round crown, opposite boughs | trident maple | broad |
| beech | wide layered crown down to 20 % of height | platanus | dark |
| elm | vase: early fork, leaders rise then arch out | bark_brown_02 | dark |
| ash | tall open crown, upswept tips, compound leaves | bark_brown_02 | fine |
| birch | slender, narrow, twigs hang | platanus | light |
| aspen | small high crown on a slim trunk | platanus | light |
| poplar | Lombardy column, everything sweeps up | bark_brown_02 | light |
| willow | weeping: arching boughs, hanging curtains | bark_willow_02 | light |
| sapling | 4–6 m young broadleaf for edges and hedgerows | bark_brown_02 | broad |

Textures are Poly Haven, CC0 (see `CREDITS.md`). Bark maps come from the texture library; leaf pages are cut
out of Poly Haven tree *models* (`fetch.py`) and composited into cluster atlases, four clusters per page,
by `pages.py` — the "light" and "dark" pages are hue and brightness grades of the same island_tree_01
leaves. The sprig page from tree_small_02 is downloaded but unused: its bark bleed is fused to the sprigs.

## Layout

```
gen.py          the deciduous entry point: where its textures are, then tools/treekit/genkit.run
fetch.py        Poly Haven download (system python, Pillow)
pages.py        leaf cluster atlases, summer and seasonal (system python, Pillow)
species/        the species
library.py      the species table -> library.json
viewer.html     Babylon viewer for public/trees (both generators' trees)

../treekit/     the generator core, shared with tools/conifergen (and bushes and grass to come)
  curves.py     Curve and Param
  rng.py        keyed random streams
  spine.py      growing a spine under forces, with frames
  tree.py       generators, distribution (proportional, interval, absolute, whorls), envelope,
                leaves (clusters and fronds), assembly into mesh arrays
  mesh.py       tube sweep and leaf card
  budget.py     fitting LOD0 into a triangle range
  lod.py        deriving LOD1..3
  genkit.py     command line, species loading, library jitter, the build of one tree, the driver
  blendkit.py   the only bpy code: materials, mesh objects, export, preview render
  glbtools.py   GLB read/write, texture externalising, colour compaction
```

## Colour

Every card's vertex colour carries a per-card lightness (`leaves.light_var`, some leaves are simply paler)
and a per-card warmth (`leaves.warm`, pulls the blue out so a green page goes yellow-green), plus the crown
shade and the tree's `leaves.tint`. Real hue changes cannot be multiplied into a green photograph -- the
project learned that tinting green with green gives near-black -- so autumn comes from graded pages:
`pages.py` writes `<page>_autumn`, `<page>_gold` and `<page>_copper` atlases whose four cells are graded to
different absolute hues (yellow-green, yellow, orange, red), so one texture gives a crown that has half
turned. The library table gives each species a probability of a turned page, and every tree's `season`
(`summer`, `gold`, `autumn`, `copper`) is in its root extras and in `index.json`: a summer forest must
filter on it, or it gets random red trees.

## Winter

A tenth of every species is bare and snow-topped (`season: winter`): `leaves.none` drops the cards, the
twig level is meshed instead (the whole budget goes to bark, so a bare tree has visible fine twigs), and
`snow` switches the bark to a page with a band of snow across the top of the tile. In snow mode the tube
sweep orients every ring so u = 0 faces up, which lays the band along the upper side of every branch, and
vertex colour hides it again on vertical trunks (multiplying can only darken, so the snow has to be in the
texture and the bark is what the vertex colour paints back). Conifers do the same with a whitened needle
page; see `tools/conifergen`. Filter on `season` the same way as for autumn.

## Next

- **Conifers are done** (`tools/conifergen`, same core). Bushes and grass reuse `treekit` as is: a bush is
  a sapling with no trunk and the envelope on the ground.
- **A single atlas per tree** (bark and leaves in one texture, SpeedTree's "allow V wrapping" trick) would
  make each LOD one draw call. The game already separates opaque trunk from alpha-tested canopy, so this
  was left out.
- **Billboard impostors** are rendered at runtime by `render/impostor.ts` already; a baked eight-angle
  atlas per tree would be the offline alternative.
- `distribute` has proportional, interval and absolute; phyllotaxy exists as the spiral roll.
  Bifurcation as a distribution mode is only used for the trunk (`splits`).
