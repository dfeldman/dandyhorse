"""SI helpers and FTMS conversions (shared with tests; the bridge has a TS twin)."""

MPS_PER_KMH = 1000.0 / 3600.0


def kmh_to_mps(v: float) -> float:
    return v * MPS_PER_KMH


def mps_to_kmh(v: float) -> float:
    return v / MPS_PER_KMH


def joules_to_kcal(j: float) -> float:
    return j / 4184.0


# FTMS control-point encodings (value -> integer field)
def ftms_speed(mps: float) -> int:       # uint16, 0.01 km/h
    return round(mps_to_kmh(mps) * 100)


def ftms_incline(pct: float) -> int:     # sint16, 0.1 %
    return round(pct * 10)


def ftms_grade(pct: float) -> int:       # sint16, 0.01 %
    return round(pct * 100)


def ftms_wind(mps: float) -> int:        # sint16, 0.001 m/s
    return round(mps * 1000)


def ftms_crr(crr: float) -> int:         # uint8, 0.0001
    return round(crr * 10000)


def ftms_cw(cw: float) -> int:           # uint8, 0.01 kg/m
    return round(cw * 100)
