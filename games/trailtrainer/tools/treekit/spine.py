"""
Growing a spine: the polyline a trunk or branch is swept along.

Not an L-system and not a fractal. A spine starts somewhere, pointing somewhere, and is stepped forward
segment by segment while a few forces bend it -- exactly the SpeedTree picture of a branch as a path with
gravity, phototropism, wander and gnarl acting on it:

  tropism   pulls the direction toward +Z (reach for light) when positive, toward -Z (droop under weight)
            when negative; a curve along the branch, so a bough can rise at the base and sag at the tip
  wander    random angular jitter per step, with persistence so it reads as a crooked branch rather than a
            nervous one
  gnarl     a slow rotation of the wander about the growth axis, which twists old trunks
  return    pulls the direction back toward what it started as, so a disturbed branch settles

Also returns a parallel-transported frame at every point, which the tube sweep needs for its rings and the
distributor needs to place children by roll angle without the twist that a Frenet frame would add.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

UP = np.array([0.0, 0.0, 1.0])


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def any_perpendicular(d: np.ndarray) -> np.ndarray:
    a = UP if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    return normalize(np.cross(d, a))


def rotate(v: np.ndarray, axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues rotation of v about a unit axis."""
    c, s = np.cos(angle), np.sin(angle)
    return v * c + np.cross(axis, v) * s + axis * np.dot(axis, v) * (1 - c)


@dataclass
class Spine:
    points: np.ndarray      # (n, 3)
    tangents: np.ndarray    # (n, 3) unit
    normals: np.ndarray     # (n, 3) unit, parallel transported
    radii: np.ndarray       # (n,)
    length: float

    @property
    def arc(self) -> np.ndarray:
        """Cumulative arc length, 0 at the base."""
        d = np.linalg.norm(np.diff(self.points, axis=0), axis=1)
        return np.concatenate([[0.0], np.cumsum(d)])

    def at(self, t: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
        """Position, tangent, normal and radius at fraction t of the arc length."""
        arc = self.arc
        s = float(np.clip(t, 0.0, 1.0)) * arc[-1]
        i = int(np.searchsorted(arc, s, side='right') - 1)
        i = max(0, min(i, len(arc) - 2))
        seg = arc[i + 1] - arc[i]
        f = 0.0 if seg <= 1e-9 else (s - arc[i]) / seg
        p = self.points[i] * (1 - f) + self.points[i + 1] * f
        tg = normalize(self.tangents[i] * (1 - f) + self.tangents[i + 1] * f)
        nm = self.normals[i] * (1 - f) + self.normals[i + 1] * f
        nm = normalize(nm - tg * np.dot(nm, tg))
        r = self.radii[i] * (1 - f) + self.radii[i + 1] * f
        return p, tg, nm, float(r)

    def truncated(self, t: float) -> 'Spine':
        """The first fraction t of the spine, cut exactly at t."""
        if t >= 1.0:
            return self
        arc = self.arc
        s = t * arc[-1]
        i = int(np.searchsorted(arc, s, side='right'))
        p, tg, nm, r = self.at(t)
        pts = np.vstack([self.points[:i], p])
        tgs = np.vstack([self.tangents[:i], tg])
        nms = np.vstack([self.normals[:i], nm])
        rs = np.concatenate([self.radii[:i], [r]])
        if len(pts) < 2:
            return self
        return Spine(pts, tgs, nms, rs, float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1))))


def grow(start: np.ndarray, direction: np.ndarray, length: float, segments: int, radius0: float, radius1: float,
         taper, tropism, wander: float, gnarl: float, return_force: float, rng: np.random.Generator,
         seed_normal: np.ndarray | None = None) -> Spine:
    """
    Step a spine forward. `taper(t)` gives radius as a fraction of radius0 (1 at base); `tropism(t)` gives the
    up/down pull along the branch. wander and gnarl are angles in radians per metre-ish; they are scaled by
    the step so a long branch with few segments wanders the same amount as a short one with many.
    """
    d0 = normalize(np.asarray(direction, dtype=float))
    d = d0.copy()
    p = np.asarray(start, dtype=float).copy()
    step = length / max(segments, 1)
    pts = [p.copy()]
    tgs = [d.copy()]
    # persistent jitter state: a slowly drifting axis to bend around
    twist = float(rng.uniform(0, 2 * np.pi))
    kick = np.zeros(3)
    for i in range(segments):
        t = (i + 0.5) / segments
        # forces
        force = np.zeros(3)
        tr = float(tropism(t))
        force += UP * tr
        force += (d0 - d) * return_force
        # wander: rotate about a perpendicular axis that itself drifts (gnarl)
        twist += gnarl * step + float(rng.normal(0, 1.1))
        perp = any_perpendicular(d)
        axis = rotate(perp, d, twist)
        # wander is radians per metre; the step scaling happens once, below
        kick = kick * 0.55 + axis * float(rng.normal(0, 1.0)) * wander
        force += kick
        d = normalize(d + force * step)
        p = p + d * step
        pts.append(p.copy())
        tgs.append(d.copy())
    points = np.array(pts)
    tangents = np.array(tgs)
    # parallel transport a normal along the tangents
    n = seed_normal if seed_normal is not None else any_perpendicular(tangents[0])
    n = normalize(n - tangents[0] * np.dot(n, tangents[0]))
    if np.linalg.norm(n) < 1e-6:
        n = any_perpendicular(tangents[0])
    normals = [n]
    for i in range(1, len(tangents)):
        a, b = tangents[i - 1], tangents[i]
        axis = np.cross(a, b)
        s = np.linalg.norm(axis)
        c = float(np.dot(a, b))
        if s > 1e-8:
            n = rotate(n, axis / s, float(np.arctan2(s, c)))
        n = normalize(n - b * np.dot(n, b))
        normals.append(n)
    ts = np.linspace(0, 1, len(points))
    radii = radius0 * np.asarray(taper(ts), dtype=float)
    radii = np.maximum(radii, radius1)
    radii[-1] = min(radii[-1], radius1)
    return Spine(points, tangents, np.array(normals), radii, float(length))
