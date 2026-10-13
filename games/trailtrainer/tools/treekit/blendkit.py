"""
The Blender half, shared by every generator: scene reset, images, materials, mesh objects from numpy
arrays, glTF export, preview render. Only this file and the generators' gen.py import bpy.

Materials are built from texture paths, not species names, so a generator decides what a bark or a leaf
page is called and this file only wires nodes. Two things here are load-bearing for the export and worth
knowing: a Greater Than math node between the page's alpha and the BSDF is what makes the exporter write
alphaMode MASK, and wiring the arm page's blue channel to Metallic keeps its channel layout identical to
glTF's, so the JPEG is embedded as is instead of re-packed into a PNG three times the size.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np

_images: dict[str, bpy.types.Image] = {}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    _images.clear()


def image(path: Path, colorspace: str) -> bpy.types.Image:
    key = f'{path}:{colorspace}'
    if key not in _images:
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = path.stem
        img.colorspace_settings.name = colorspace
        img.alpha_mode = 'STRAIGHT'
        _images[key] = img
    return _images[key]


def gltf_output_group() -> bpy.types.NodeTree:
    """The node group the glTF exporter reads occlusion from."""
    name = 'glTF Material Output'
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput')
    return g


def _base(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree, bpy.types.Node]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat, nt, bsdf


def _colour_times_vertex(nt: bpy.types.NodeTree, tex: bpy.types.Node, bsdf: bpy.types.Node) -> None:
    vcol = nt.nodes.new('ShaderNodeVertexColor')
    vcol.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs[6])
    nt.links.new(vcol.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])


def bark_material(name: str, diff: Path, arm: Path, nor: Path | None) -> bpy.types.Material:
    """Opaque PBR bark: colour × vertex colour, roughness and occlusion from the arm page, a normal map."""
    mat, nt, bsdf = _base(name)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image(diff, 'sRGB')
    _colour_times_vertex(nt, tex, bsdf)
    armn = nt.nodes.new('ShaderNodeTexImage')
    armn.image = image(arm, 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(armn.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    occ = nt.nodes.new('ShaderNodeGroup')
    occ.node_tree = gltf_output_group()
    nt.links.new(sep.outputs['Red'], occ.inputs['Occlusion'])
    if nor is not None:
        norn = nt.nodes.new('ShaderNodeTexImage')
        norn.image = image(nor, 'Non-Color')
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(norn.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    mat.use_backface_culling = True
    return mat


def leaf_material(name: str, page: Path, roughness: float = 0.75) -> bpy.types.Material:
    """Alpha-masked, double-sided foliage: page colour × vertex colour, cut at alpha 0.5."""
    mat, nt, bsdf = _base(name)
    bsdf.inputs['Roughness'].default_value = roughness
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image(page, 'sRGB')
    _colour_times_vertex(nt, tex, bsdf)
    cut = nt.nodes.new('ShaderNodeMath')
    cut.operation = 'GREATER_THAN'
    cut.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs['Alpha'], cut.inputs[0])
    nt.links.new(cut.outputs['Value'], bsdf.inputs['Alpha'])
    mat.use_backface_culling = False
    mat.surface_render_method = 'DITHERED'
    return mat


def make_object(name: str, parts: list[tuple[str, tuple, bpy.types.Material]]) -> bpy.types.Object:
    """One mesh object from (label, (pos, nor, uv, col, tri), material) parts: one primitive per material."""
    all_pos, all_nor, all_uv, all_col, all_tri, mat_idx = [], [], [], [], [], []
    offset = 0
    mats = []
    for label, (pos, nor, uv, col, tri), mat in parts:
        if len(pos) == 0:
            continue
        all_pos.append(pos)
        all_nor.append(nor)
        all_uv.append(uv)
        all_col.append(col)
        all_tri.append(tri + offset)
        mat_idx.append(np.full(len(tri), len(mats), dtype=np.int32))
        mats.append(mat)
        offset += len(pos)
    pos = np.vstack(all_pos)
    nor = np.vstack(all_nor)
    uv = np.vstack(all_uv)
    col = np.vstack(all_col)
    tri = np.vstack(all_tri)
    mi = np.concatenate(mat_idx)
    me = bpy.data.meshes.new(name)
    me.from_pydata(pos.tolist(), [], tri.tolist())
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', mi)
    uvl = me.uv_layers.new(name='UVMap')
    loops = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops)
    uvl.data.foreach_set('uv', uv[loops].ravel())
    ca = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    ca.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    me.validate(clean_customdata=False)
    me.normals_split_custom_set_from_vertices(nor.tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def export(path: Path, fmt: str) -> None:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB' if fmt == 'glb' else 'GLTF_SEPARATE',
        use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_tangents=False, export_texcoords=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_materials='EXPORT', export_image_format='AUTO', export_jpeg_quality=85,
        export_extras=True, export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
        export_morph=False, export_texture_dir='textures' if fmt == 'gltf' else '')


def render_preview(path: Path, lods: list, height: float, size: int) -> None:
    """The LODs side by side, a sun, a sky colour and a ground plane; EEVEE, Workbench if it cannot start."""
    scene = bpy.context.scene
    spacing = height * 1.1
    for i, ob in enumerate(lods):
        ob.location.x = (i - (len(lods) - 1) / 2) * spacing
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    width = spacing * len(lods)
    cam_data.lens = 50
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_end = 1000
    aspect = max(1, len(lods))
    fov_h = 2 * math.atan(cam_data.sensor_width / 2 / cam_data.lens)
    fov_v = 2 * math.atan(math.tan(fov_h / 2) / aspect)
    dist = max(width / (2 * math.tan(fov_h / 2)), height * 1.15 / (2 * math.tan(fov_v / 2))) * 1.1
    cam.location = (0, -dist, height * 0.55)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 3.5
    sun_data.angle = math.radians(2)
    sun = bpy.data.objects.new('sun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(35))
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    bg.inputs[1].default_value = 0.7
    bpy.ops.mesh.primitive_plane_add(size=width * 4)
    ground = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.diffuse_color = (0.25, 0.3, 0.16, 1)
    ground.data.materials.append(gm)
    scene.render.resolution_x = size * aspect
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(path)
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        scene.eevee.taa_render_samples = 16
        scene.eevee.use_shadows = True
        bpy.ops.render.render(write_still=True)
    except Exception as e:  # headless macOS sometimes cannot make an EEVEE context
        print('EEVEE failed, falling back to Workbench:', e)
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'TEXTURE'
        scene.display.shading.show_shadows = True
        bpy.ops.render.render(write_still=True)
    for ob in lods:
        ob.location.x = 0
