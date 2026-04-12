"""
System tests: regression baseline for /api/calculate.

Expected values are taken directly from **Einat.exe reference CSVs**:
  - tests/fcr test.csv   → scenario "fcr_saraf_lb_2eft_2hf"
  - tests/einat1.csv     → scenario "einat1_saraf_lb_2bidons"

Tolerances:
  GW / fuel  ±3 lbs  — VB6 Single-precision vs Python Double in the integration loop
                        causes ≤3 lb cumulative drift; logic is correct
  TRQ / FF / OGE / IGE / PA  exact  — all round to the same integer as Einat.exe

Run:
    cd <ilana-web root>
    backend/venv/bin/pytest tests/test_scenarios.py -v
"""

import sys
from pathlib import Path

import pytest
from pyproj import Transformer
from starlette.testclient import TestClient

# Allow imports from backend/
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from app.main import app  # noqa: E402

client = TestClient(app)

# ── UTM helpers ────────────────────────────────────────────────────────────────

def utm36_to_latlon(easting: float, northing_csv: float) -> tuple[float, float]:
    """
    Convert Israeli-military-grid UTM coordinates to WGS84 lat/lon.

    Einat.exe reports northings without the leading '3' (e.g. 482000 means
    3 482 000 m in UTM zone 36 N).  Easting is standard.
    """
    full_northing = northing_csv + 3_000_000
    transformer = Transformer.from_crs("EPSG:32636", "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(easting, full_northing)
    return round(lat, 6), round(lon, 6)


# ── Scenario definitions ───────────────────────────────────────────────────────

# Each scenario dict contains:
#   id            – human-readable identifier shown in pytest output
#   variant       – "LB" | "peten"
#   etf           – engine test factor (applied to both engines)
#   gw_lbs        – initial gross weight (lbs)
#   fuel_lbs      – initial usable fuel (lbs)
#   n_bidons      – number of external fuel tanks (drives cDRAG when delta_f is None)
#   delta_f       – total stores ΔF (sq.ft); None → fall back to n_bidons drag
#   waypoints     – list of tuples:
#                   (easting, northing_csv, alt_ft, tas_kts, oat_c,
#                    wind_dir, wind_speed_kts, spare_pct)
#
# Expected per-waypoint results:
#   gw, fuel, oge, ige, pa, trq, ff

SCENARIOS = [
    {
        # ── FCR Scenario (tests/fcr test.csv) ─────────────────────────────────
        # Saraf-LB, ETF 0.95×2, GW 19 435 lbs
        # Stores: 2×EFT (IB) + 2×HF (OB) + FCR ON → ATF 1.000 → delta_f = 0.0
        # Waypoints in UTM zone 36 (northing without leading 3)
        "id": "fcr_saraf_lb_2eft_2hf",
        "variant": "LB",
        "etf": 0.95,
        "gw_lbs": 19_435,
        "fuel_lbs": 4_000,
        "n_bidons": 2,
        "delta_f": 0.0,
        "waypoints": [
            # (easting, northing_csv, alt_ft, tas_kts, oat_c, wind_dir, wind_speed_kts, spare_pct)
            (639_000, 482_000, 2000,  80, 15,   0,  0, 0),
            (657_000, 417_000, 3000,  70, 20,  30,  5, 0),
            (722_000, 409_000, 1000,  90, 25,  40, 10, 0),
            (743_000, 427_000, 5000, 110, 30, 270,  5, 2),
            (779_000, 480_000, 4000, 120, 20,  90, 15, 2),
            (721_000, 514_000, 3000,  80, 10, 180, 20, 2),
        ],
        # Reference: tests/fcr test.csv
        # WP  gw      fuel   oge  ige  pa   trq  ff
        # wp1 19435   4000   109   90  117   60   922
        # wp2 19019   3584   108   89  110   56   865
        # wp3 18569   3134   102   84  116   69  1032
        # wp4 18378   2943   107   89   97   76  1099
        # wp5 18055   2620   101   84  106   80  1143
        # wp6 17745   2310    96   80  115   53   863
        "expected": [
            {"gw": 19_435, "fuel": 4_000, "oge": 109, "ige": 90, "pa": 117, "trq": 60, "ff":   922},
            {"gw": 19_019, "fuel": 3_584, "oge": 108, "ige": 89, "pa": 110, "trq": 56, "ff":   865},
            {"gw": 18_569, "fuel": 3_134, "oge": 102, "ige": 84, "pa": 116, "trq": 69, "ff": 1_032},
            {"gw": 18_378, "fuel": 2_943, "oge": 107, "ige": 89, "pa":  97, "trq": 76, "ff": 1_099},
            {"gw": 18_055, "fuel": 2_620, "oge": 101, "ige": 84, "pa": 106, "trq": 80, "ff": 1_143},
            {"gw": 17_745, "fuel": 2_310, "oge":  96, "ige": 80, "pa": 115, "trq": 53, "ff":   863},
        ],
    },
    {
        # ── Einat1 Scenario (tests/einat1.csv) ────────────────────────────────
        # Saraf-LB, ETF 0.95×2, GW 19 035 lbs, 2 bidons (drag = −0.81), no wind
        # delta_f = None → backend uses _CDRAG[2] = −0.81
        "id": "einat1_saraf_lb_2bidons",
        "variant": "LB",
        "etf": 0.95,
        "gw_lbs": 19_035,
        "fuel_lbs": 4_000,
        "n_bidons": 2,
        "delta_f": None,
        "waypoints": [
            # (easting, northing_csv, alt_ft, tas_kts, oat_c, wind_dir, wind_speed_kts, spare_pct)
            (674_000, 351_000, 2000, 100, 25, 0, 0, 0),
            (641_000, 455_000, 7000, 120, 25, 0, 0, 0),
            (672_000, 516_000,  500,  60, 25, 0, 0, 0),
            (713_000, 516_000, 2000,  90, 25, 0, 0, 0),
            (705_000, 432_000, 4000, 130, 25, 0, 0, 0),
            (681_000, 413_000,  500,  70, 25, 0, 0, 0),
        ],
        # Reference: tests/einat1.csv
        # WP  gw      fuel   oge  ige  pa   trq  ff
        # wp1 19035   4000   108   89  111   67   995
        # wp2 18439   3404   111   92   91   80  1104
        # wp3 18117   3082    97   81  118   54   889
        # wp4 17798   2763    97   80  111   55   878
        # wp5 17362   2327    97   80  103   75  1062
        # wp6 17225   2190    91   75  118   47   822
        "expected": [
            {"gw": 19_035, "fuel": 4_000, "oge": 108, "ige": 89, "pa": 111, "trq": 67, "ff":   995},
            {"gw": 18_439, "fuel": 3_404, "oge": 111, "ige": 92, "pa":  91, "trq": 80, "ff": 1_104},
            {"gw": 18_117, "fuel": 3_082, "oge":  97, "ige": 81, "pa": 118, "trq": 54, "ff":   889},
            {"gw": 17_798, "fuel": 2_763, "oge":  97, "ige": 80, "pa": 111, "trq": 55, "ff":   878},
            {"gw": 17_362, "fuel": 2_327, "oge":  97, "ige": 80, "pa": 103, "trq": 75, "ff": 1_062},
            {"gw": 17_225, "fuel": 2_190, "oge":  91, "ige": 75, "pa": 118, "trq": 47, "ff":   822},
        ],
    },
]

# ── Tolerances ─────────────────────────────────────────────────────────────────
# GW/fuel: ±3 lbs due to VB6 Single vs Python Double in the integration loop.
# All performance values (TRQ, FF, OGE, IGE, PA) match Einat.exe exactly (±0).
TOL_WEIGHT_LBS = 3      # GW and fuel ±3 lbs
TOL_TRQ_PCT    = 0      # cruise torque exact
TOL_OGE_PCT    = 0      # OGE hover torque exact
TOL_IGE_PCT    = 0      # IGE hover torque exact
TOL_PA_PCT     = 0      # PA available exact
TOL_FF_LBHR    = 0      # fuel flow exact


# ── Fixtures / helpers ─────────────────────────────────────────────────────────

def build_request(scenario: dict) -> dict:
    """Build a FlightPlanRequest dict from a scenario definition."""
    waypoints = []
    for i, (east, north_csv, alt, tas, oat, wdir, wspd, spare) in enumerate(
        scenario["waypoints"]
    ):
        lat, lon = utm36_to_latlon(east, north_csv)
        waypoints.append(
            {
                "name": f"wp{i + 1}",
                "lat": lat,
                "lon": lon,
                "alt_ft": alt,
                "airspeed_kts": tas,
                "oat_c": oat,
                "wind_dir": wdir,
                "wind_speed_kts": float(wspd),
                "spare_pct": spare,
            }
        )

    return {
        "variant": scenario["variant"],
        "empty_weight_lbs": scenario["gw_lbs"] - scenario["fuel_lbs"],
        "initial_fuel_lbs": scenario["fuel_lbs"],
        "etf_eng1": scenario["etf"],
        "etf_eng2": scenario["etf"],
        "n_bidons": scenario["n_bidons"],
        "delta_f": scenario["delta_f"],
        "waypoints": waypoints,
    }


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["id"] for s in SCENARIOS])
def test_scenario(scenario):
    req = build_request(scenario)
    resp = client.post("/api/calculate", json=req)

    assert resp.status_code == 200, f"API error: {resp.text}"
    data = resp.json()

    wpts = data["waypoints"]
    expected = scenario["expected"]
    assert len(wpts) == len(expected), (
        f"Waypoint count mismatch: got {len(wpts)}, expected {len(expected)}"
    )

    for i, (wpt, exp) in enumerate(zip(wpts, expected)):
        label = f"[{scenario['id']}] wp{i + 1}"

        assert abs(round(wpt["gross_weight_lbs"]) - exp["gw"]) <= TOL_WEIGHT_LBS, (
            f"{label} GW: got {wpt['gross_weight_lbs']:.0f}, ref {exp['gw']}, "
            f"tol ±{TOL_WEIGHT_LBS}"
        )
        assert abs(round(wpt["fuel_remaining_lbs"]) - exp["fuel"]) <= TOL_WEIGHT_LBS, (
            f"{label} FUEL: got {wpt['fuel_remaining_lbs']:.0f}, ref {exp['fuel']}, "
            f"tol ±{TOL_WEIGHT_LBS}"
        )
        assert abs(wpt["oge_torque_required_pct"] - exp["oge"]) <= TOL_OGE_PCT, (
            f"{label} OGE: got {wpt['oge_torque_required_pct']:.1f}, ref {exp['oge']}, "
            f"tol ±{TOL_OGE_PCT}"
        )
        assert abs(wpt["ige_torque_required_pct"] - exp["ige"]) <= TOL_IGE_PCT, (
            f"{label} IGE: got {wpt['ige_torque_required_pct']:.1f}, ref {exp['ige']}, "
            f"tol ±{TOL_IGE_PCT}"
        )
        assert abs(wpt["pa_available_pct"] - exp["pa"]) <= TOL_PA_PCT, (
            f"{label} PA: got {wpt['pa_available_pct']:.1f}, ref {exp['pa']}, "
            f"tol ±{TOL_PA_PCT}"
        )
        assert abs(wpt["cruise_torque_pct"] - exp["trq"]) <= TOL_TRQ_PCT, (
            f"{label} TRQ: got {wpt['cruise_torque_pct']:.1f}, ref {exp['trq']}, "
            f"tol ±{TOL_TRQ_PCT}"
        )
        assert abs(wpt["fuel_flow_lb_hr"] - exp["ff"]) <= TOL_FF_LBHR, (
            f"{label} FF: got {wpt['fuel_flow_lb_hr']:.0f}, ref {exp['ff']}, "
            f"tol ±{TOL_FF_LBHR}"
        )
