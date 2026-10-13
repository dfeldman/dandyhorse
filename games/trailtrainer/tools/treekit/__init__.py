"""
treekit: the engine-free half of the tree generators.

Pure Python + numpy, never imports bpy, so the same code can run under Blender's Python (to export) and
under the system Python (to test). A generator in the SpeedTree sense -- trunk, branch, leaf -- is a set of
parameters in a species file; this package turns those into spines, then meshes, then triangle budgets and
LOD chains. The deciduous generator is the first user; conifer, bush and grass generators are meant to
reuse everything here except `deciduous.py`.
"""
from .curves import Curve, Param
from .rng import stream
from .mesh import MeshData, tube, card, radial_for
from .tree import Tree, Node, Leaf, build_tree
from .budget import fit_budget, triangles
from .lod import derive_lod

__all__ = ['Curve', 'Param', 'stream', 'MeshData', 'tube', 'card', 'radial_for', 'Tree', 'Node', 'Leaf',
           'build_tree', 'fit_budget', 'triangles', 'derive_lod']
