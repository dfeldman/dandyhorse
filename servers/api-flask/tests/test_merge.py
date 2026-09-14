from dandyhorse.sessions.merge import ignored_roles, merged_metrics, owners


def rep(t, devices, cmd=None, act=None):
    return {"t": t, "devices": devices, "commanded": cmd or {}, "actual": act or {}}


def test_owner_prefers_freshest_matching_fitness_device():
    reports = {
        "old": rep(90.0, [{"role": "fitness", "type": "bike", "status": "connected"}]),
        "new": rep(99.0, [{"role": "fitness", "type": "bike", "status": "connected"}]),
        "wrong": rep(100.0, [{"role": "fitness", "type": "treadmill", "status": "connected"}]),
        "hr": rep(98.0, [{"role": "hrm", "status": "connected"}]),
    }
    own = owners(reports, 100.0, "bike", True, 5.0)
    assert own == {"fitness": "new", "hrm": "hr"}


def test_stale_reports_are_ignored():
    reports = {"a": rep(10.0, [{"role": "fitness", "type": "bike", "status": "connected"}])}
    assert owners(reports, 20.0, "bike", True, 5.0) == {"fitness": None, "hrm": None}


def test_simulator_gated_by_allow_sim():
    reports = {"sim": rep(1.0, [{"role": "fitness", "type": "treadmill", "status": "simulated"}])}
    assert owners(reports, 1.0, "treadmill", False, 5.0)["fitness"] is None
    assert owners(reports, 1.0, "treadmill", True, 5.0)["fitness"] == "sim"
    assert ignored_roles(reports["sim"], "treadmill", False) == ["fitness"]
    assert ignored_roles(reports["sim"], "treadmill", True) == []


def test_merged_metrics_hr_from_hrm_owner():
    reports = {
        "fit": rep(1.0, [{"role": "fitness", "type": "bike", "status": "connected"}],
                   cmd={"grade": 4.5}, act={"power": 200.0, "cadence": 88.0, "heartRate": 100.0}),
        "hr": rep(1.0, [{"role": "hrm", "status": "connected"}], act={"heartRate": 141.0}),
    }
    own = owners(reports, 1.0, "bike", True, 5.0)
    m = merged_metrics({"grade": 4.5, "speed": 9.0}, reports, own)
    assert m["grade"] == {"requested": 4.5, "commanded": 4.5, "actual": None}
    assert m["power"]["actual"] == 200.0
    assert m["heartRate"] == {"requested": None, "commanded": None, "actual": 141.0}
    assert m["speed"]["requested"] == 9.0 and m["speed"]["actual"] is None


def test_ulid_sorts_by_time():
    from dandyhorse.util import ulid
    a = ulid(1000.0)
    b = ulid(1001.0)
    c = ulid(1000.0)
    assert len(a) == 26 and a < b and c < b
    assert a[:10] == c[:10]


def test_ownership_is_sticky_while_fresh():
    a = rep(10.0, [{"role": "fitness", "type": "bike", "status": "connected"}])
    b = rep(10.5, [{"role": "fitness", "type": "bike", "status": "connected"}])
    reports = {"a": a, "b": b}
    first = owners(reports, 11.0, "bike", True, 5.0)
    assert first["fitness"] == "b"
    # a reports again (now freshest) but b stays fresh: b keeps the role
    reports["a"] = rep(11.5, [{"role": "fitness", "type": "bike", "status": "connected"}])
    assert owners(reports, 12.0, "bike", True, 5.0, first)["fitness"] == "b"
    # b goes stale: a takes over
    assert owners(reports, 16.0, "bike", True, 5.0, first)["fitness"] == "a"
