"""
Post-processing a GLB after Blender has written it.

A GLB embeds its images, which is right for one tree and wrong for a library: a hundred oaks would carry a
hundred copies of the same bark. glTF allows a GLB's images to be external URIs instead, so `externalize`
lifts every embedded image out into a shared textures/ folder (named by content hash, so identical pages
across trees become one file) and rewrites the GLB to point at them. The mesh data stays binary and the
file stays a .glb; a loader resolves the URIs relative to it, as Babylon's does.
"""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == MAGIC and version == 2, f'{path} is not a GLB 2.0'
    offset = 12
    doc, bin_data = None, b''
    while offset < length:
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == JSON_CHUNK:
            doc = json.loads(chunk.decode('utf-8'))
        elif kind == BIN_CHUNK:
            bin_data = bytes(chunk)
        offset += 8 + size
    assert doc is not None
    return doc, bin_data


def write_glb(path: Path, doc: dict, bin_data: bytes) -> None:
    js = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    bn = bin_data + b'\0' * (-len(bin_data) % 4)
    total = 12 + 8 + len(js) + (8 + len(bn) if bn else 0)
    with path.open('wb') as f:
        f.write(struct.pack('<III', MAGIC, 2, total))
        f.write(struct.pack('<II', len(js), JSON_CHUNK))
        f.write(js)
        if bn:
            f.write(struct.pack('<II', len(bn), BIN_CHUNK))
            f.write(bn)


def compact_colors(doc: dict, bin_data: bytes) -> tuple[bytes, set[int]]:
    """
    Blender writes COLOR_0 as four floats a vertex, 16 bytes for a shade and a tint that never need more
    than a byte each. Rewrite every COLOR_0 accessor as normalised unsigned bytes, appended to the buffer;
    returns the new buffer and the views now unused.
    """
    import numpy as np
    views = doc['bufferViews']
    extra = bytearray()
    dropped: set[int] = set()
    seen: dict[int, int] = {}
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            ai = prim['attributes'].get('COLOR_0')
            if ai is None:
                continue
            if ai in seen:
                continue
            acc = doc['accessors'][ai]
            if acc['componentType'] != 5126:
                continue
            bv = views[acc['bufferView']]
            n = {'VEC3': 3, 'VEC4': 4}[acc['type']]
            off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            data = np.frombuffer(bin_data, np.float32, count=acc['count'] * n, offset=off).reshape(-1, n)
            if n == 3:
                data = np.hstack([data, np.ones((len(data), 1), np.float32)])
            q = np.clip(np.round(data * 255), 0, 255).astype(np.uint8)
            pad = -len(extra) % 4
            extra += b'\0' * pad
            start = len(extra)
            extra += q.tobytes()
            dropped.add(acc['bufferView'])
            views.append({'buffer': 0, 'byteOffset': len(bin_data) + start, 'byteLength': len(q.tobytes()), 'target': 34962})
            acc.update({'bufferView': len(views) - 1, 'byteOffset': 0, 'componentType': 5121, 'normalized': True, 'type': 'VEC4'})
            acc.pop('min', None)
            acc.pop('max', None)
            seen[ai] = 1
    return bin_data + bytes(extra), dropped


def externalize(path: Path, textures_dir: Path | None, compact: bool = True) -> list[str]:
    """Move embedded images to textures_dir (None: leave them), compact colours, rewrite the file.
    Returns the texture file names written or reused."""
    doc, bin_data = read_glb(path)
    images = doc.get('images', [])
    dropped: set[int] = set()
    if compact:
        bin_data, dropped = compact_colors(doc, bin_data)
    views = doc.get('bufferViews', [])
    names = []
    if textures_dir is not None:
        textures_dir.mkdir(parents=True, exist_ok=True)
    for img in images:
        if 'bufferView' not in img or textures_dir is None:
            continue
        bv = views[img['bufferView']]
        start = bv.get('byteOffset', 0)
        blob = bin_data[start:start + bv['byteLength']]
        ext = {'image/jpeg': 'jpg', 'image/png': 'png'}.get(img.get('mimeType', ''), 'bin')
        stem = img.get('name', 'image').replace(' ', '_')
        name = f"{stem}_{hashlib.sha1(blob).hexdigest()[:8]}.{ext}"
        out = textures_dir / name
        if not out.exists():
            out.write_bytes(blob)
        img['uri'] = f'{textures_dir.name}/{name}'
        dropped.add(img.pop('bufferView'))
        img.pop('mimeType', None)
        names.append(name)
    if not dropped:
        return names
    # rebuild the binary buffer without the image views and renumber everything that points at a view
    remap: dict[int, int] = {}
    new_views = []
    chunks = []
    cursor = 0
    for i, bv in enumerate(views):
        if i in dropped:
            continue
        start = bv.get('byteOffset', 0)
        blob = bin_data[start:start + bv['byteLength']]
        pad = -cursor % 4
        cursor += pad
        chunks.append(b'\0' * pad + blob)
        nv = dict(bv)
        nv['byteOffset'] = cursor
        cursor += len(blob)
        remap[i] = len(new_views)
        new_views.append(nv)
    new_bin = b''.join(chunks)
    doc['bufferViews'] = new_views
    doc['buffers'] = [{'byteLength': len(new_bin)}]
    for img in doc.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = remap[img['bufferView']]
    for acc in doc.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] = remap[acc['bufferView']]
        sp = acc.get('sparse')
        if sp:
            sp['indices']['bufferView'] = remap[sp['indices']['bufferView']]
            sp['values']['bufferView'] = remap[sp['values']['bufferView']]
    write_glb(path, doc, new_bin)
    return names


def summary(path: Path) -> dict:
    """Triangle counts per named LOD node and the materials, straight from the file: the check that what
    was asked for is what was written."""
    doc, _ = read_glb(path)
    acc = doc['accessors']
    meshes = doc['meshes']
    out = {}
    for node in doc['nodes']:
        if 'mesh' in node:
            prims = meshes[node['mesh']]['primitives']
            out[node['name']] = {
                'triangles': sum(acc[p['indices']]['count'] // 3 for p in prims),
                'primitives': len(prims),
            }
    out['materials'] = [(m['name'], m.get('alphaMode', 'OPAQUE'), m.get('doubleSided', False)) for m in doc['materials']]
    out['images'] = [i.get('uri', '<embedded>') for i in doc.get('images', [])]
    return out
