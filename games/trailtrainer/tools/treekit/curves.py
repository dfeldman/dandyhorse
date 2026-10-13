"""
Curves and varied parameters, which is what every SpeedTree property really is.

"Branch length" is never a number. It is a curve over where the branch sits on its parent, times a per-node
variance. A species file writes a parameter in any of these shapes and `Param.of` reads all of them:

    0.7                         constant
    [0.7, 0.2]                  constant 0.7, ± 0.2 per node
    {"curve": [0.3, 1, 0.5]}    a curve sampled evenly over 0..1 (here: short, long, medium)
    {"curve": [[0, 0.3], [0.6, 1], [1, 0.5]], "var": 0.1}   explicit (t, value) knots, plus variance

The curve is piecewise linear between knots. Smooth curves would look nicer in a graph and make no
difference on a tree.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np


@dataclass(frozen=True)
class Curve:
    t: np.ndarray
    v: np.ndarray

    @staticmethod
    def of(spec: Any) -> 'Curve':
        if isinstance(spec, Curve):
            return spec
        if isinstance(spec, (int, float)):
            return Curve(np.array([0.0, 1.0]), np.array([float(spec)] * 2))
        pts = list(spec)
        if len(pts) == 0:
            raise ValueError('empty curve')
        if isinstance(pts[0], (list, tuple)):
            t = np.array([float(p[0]) for p in pts])
            v = np.array([float(p[1]) for p in pts])
        else:
            v = np.array([float(p) for p in pts])
            t = np.linspace(0.0, 1.0, len(v)) if len(v) > 1 else np.array([0.0])
        if len(v) == 1:
            return Curve(np.array([0.0, 1.0]), np.array([v[0], v[0]]))
        return Curve(t, v)

    def __call__(self, t: float | np.ndarray) -> float | np.ndarray:
        return np.interp(t, self.t, self.v)

    def scaled(self, k: float) -> 'Curve':
        return Curve(self.t, self.v * k)


@dataclass(frozen=True)
class Param:
    """A curve plus a per-node variance."""
    curve: Curve
    var: float = 0.0

    @staticmethod
    def of(spec: Any, default: float | None = None) -> 'Param':
        if spec is None:
            if default is None:
                raise ValueError('missing parameter')
            spec = default
        if isinstance(spec, Param):
            return spec
        if isinstance(spec, dict):
            return Param(Curve.of(spec.get('curve', spec.get('value', default))), float(spec.get('var', 0.0)))
        if isinstance(spec, (list, tuple)) and len(spec) == 2 and all(isinstance(x, (int, float)) for x in spec):
            return Param(Curve.of(spec[0]), float(spec[1]))
        return Param(Curve.of(spec), 0.0)

    def at(self, t: float, rng: np.random.Generator | None = None) -> float:
        """The value at t, jittered by ± var if a stream is given."""
        v = float(self.curve(t))
        if rng is not None and self.var:
            v += float(rng.uniform(-self.var, self.var))
        return v

    def sample(self, t: float, rng: np.random.Generator) -> float:
        return self.at(t, rng)


def get(spec: dict, key: str, default: Any = None) -> Param:
    return Param.of(spec.get(key), default)
