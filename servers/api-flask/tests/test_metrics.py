from dandyhorse.sessions.metrics import Integrator, build_timeline


def metrics(**kw):
    base = {m: {"requested": None, "commanded": None, "actual": None}
            for m in ("speed", "incline", "cadence", "power", "grade", "wind", "crr", "cw", "heartRate")}
    for k, v in kw.items():
        base[k] = v
    return base


def test_treadmill_distance_and_acsm_energy():
    it = Integrator("treadmill", {"weight": 80}, 0.24, 75.0)
    for i in range(11):
        it.sample(float(i), metrics(speed={"requested": 3.0, "commanded": 3.0, "actual": 3.0},
                                    incline={"requested": 0.0, "commanded": 0.0, "actual": 0.0}), None)
    s = it.summary(10.0)
    assert abs(s["distance"] - 30.0) < 1e-6
    # running at 3 m/s = 180 m/min: VO2 = 3.5 + 36 = 39.5; kcal/min = 39.5*80/200 = 15.8 -> 66107 J/min
    expected = 15.8 * 4184 / 60 * 10
    assert abs(s["energy"] - expected) < 1.0
    assert s["energySource"] == "acsm"
    assert s["avgSpeed"] == 3.0 and s["maxSpeed"] == 3.0


def test_bike_uses_virtual_speed_and_power():
    it = Integrator("bike", {}, 0.24, 75.0)
    for i in range(3):
        it.sample(float(i), metrics(speed={"requested": 10.0, "commanded": None, "actual": None},
                                    power={"requested": None, "commanded": None, "actual": 240.0}), {"x": 0, "y": i, "z": 0})
    s = it.summary(2.0)
    assert s["distance"] == 20.0
    assert s["work"] == 480.0
    assert abs(s["energy"] - 480.0 / 0.24) < 1e-6
    assert s["elevationGain"] == 2.0
    assert s["energySource"] == "power"


def test_build_timeline_merges_and_samples_at_1hz():
    recs = [
        {"k": "status", "t": 100.0, "from": "pending", "to": "active"},
        {"k": "game", "t": 100.2, "req": {"speed": 9.0, "grade": 3.0}, "pos": {"x": 0, "y": 0, "z": 0}},
        {"k": "bridge", "t": 100.4, "bridgeId": "b1", "devices": [{"role": "fitness", "type": "bike", "status": "connected"}],
         "cmd": {"grade": 3.0}, "act": {"power": 200.0, "cadence": 90.0}},
        {"k": "game", "t": 101.2, "req": {"speed": 9.0, "grade": 3.0}, "pos": {"x": 9, "y": 0.3, "z": 0}},
        {"k": "bridge", "t": 101.4, "bridgeId": "b1", "devices": [{"role": "fitness", "type": "bike", "status": "connected"}],
         "cmd": {"grade": 3.0}, "act": {"power": 210.0, "cadence": 91.0}},
        {"k": "end", "t": 103.0, "status": "complete"},
    ]
    rows, summary = build_timeline(recs, device_type="bike", allow_sim=True, fresh=5.0, body_data={},
                                   efficiency=0.24, default_weight=75.0)
    assert [r["elapsed"] for r in rows] == [0.0, 1.0, 2.0, 3.0]
    assert rows[0]["power"]["actual"] is None          # bridge report arrives after t=100
    assert rows[1]["power"]["actual"] == 200.0
    assert rows[2]["power"]["actual"] == 210.0
    assert rows[2]["grade"]["commanded"] == 3.0
    assert rows[3]["distance"] > rows[1]["distance"] > 0
    assert summary["sampleCount"] == 4
    assert summary["avgCadence"] is not None
