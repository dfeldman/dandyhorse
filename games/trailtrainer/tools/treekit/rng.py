"""
Derived random streams, so a knob change is local.

One integer seed names a tree. Every generator, and every node inside it, draws from its own stream keyed
by (seed, level, node index, purpose), so raising the leaf count does not reshuffle the boughs and changing
the twig angle does not move the trunk. SpeedTree gets the same property from per-node seeds; this is the
numpy way of writing it.
"""
import numpy as np


def stream(seed: int, *keys: int) -> np.random.Generator:
    """A generator for (seed, key, key, ...). Same arguments, same numbers, forever."""
    return np.random.default_rng([int(seed) & 0xFFFFFFFF, *[int(k) & 0xFFFFFFFF for k in keys]])


def jitter(rng: np.random.Generator, variance: float) -> float:
    """A uniform ± variance."""
    return float(rng.uniform(-variance, variance)) if variance else 0.0
