"""
Wing-stores drag calculation for AH-64D Peten.

Method (TM(IS) 1-1520-251-10, sec 7.24–7.26, fig 7-42):
  1. For each of the 4 wing stations select an installed store.
  2. Sum the ΔF (flat-plate drag area) contribution of every store
     (position-dependent: inboard vs outboard), then add NO_WEAPONS_DELTA_F.
  3. ATF = 1.00 + total_ΔF / 100.0

  ATF = 1.00 + (NO_WEAPONS_ΔF + Σ station_ΔF) / 100.0

Reference baseline (TM fig 7-42): 2×EFT inboard + 2×HF×4 outboard → ATF = 1.00
  Verification: -0.996 + 2×0.205 + 2×0.293 = 0.000  →  ATF = 1.00 + 0/100 = 1.000 ✓

ΔF values from TM(IS) 1-1520-251-10 fig 7-42 (sq. ft.):
  NO WEAPONS (all empty pylons): -0.996
  Hellfire ×4  inboard: 0.364  outboard: 0.293
  Rocket  ×19  inboard: 0.071  outboard: 0.071
  EFT          inboard: 0.205  outboard: 0.170
  Empty pylon  (both):  0.000
"""

from dataclasses import dataclass


# ── Store definitions ──────────────────────────────────────────────────────────
@dataclass
class Store:
    id:              str
    label:           str
    delta_f_inboard: float   # ΔF (sq. ft.) when mounted inboard  — TM fig 7-42
    delta_f_outboard: float  # ΔF (sq. ft.) when mounted outboard — TM fig 7-42
    pylon_types: tuple[str, ...]   # "inboard", "outboard", or both


# fmt: off
STORES: dict[str, Store] = {
    "none":        Store("none",        "Stores Pylon (Empty)",                     0.000, 0.000, ("inboard", "outboard")),
    "eft_230":     Store("eft_230",     "External Fuel Tank",                       0.205, 0.170, ("inboard", "outboard")),
    "hf_4rnd":     Store("hf_4rnd",     "Hellfire Missile Launcher (loaded ×4)",    0.364, 0.293, ("inboard", "outboard")),
    "eo_launcher": Store("eo_launcher", "EO Launcher",                              0.364, 0.293, ("inboard", "outboard")),
    "rocket_m261": Store("rocket_m261", "Rocket Launcher (loaded ×19)",             0.071, 0.071, ("inboard", "outboard")),
}
# fmt: on

# ΔF for bare helicopter (all 4 pylons empty / no stores on any station)
# Source: TM(IS) 1-1520-251-10 fig 7-42, "NO WEAPONS" row = -9.96 sq. ft.
NO_WEAPONS_DELTA_F = -0.996


# ── Preset configurations ──────────────────────────────────────────────────────
PRESETS: list[dict] = [
    {
        "id":    "2eft_2hf",
        "label": "2×EFT + 2×HF (L-OB:HF / L-IB:EFT / R-IB:EFT / R-OB:HF)",
        "stations": {"l_outboard": "hf_4rnd",     "l_inboard": "eft_230", "r_inboard": "eft_230", "r_outboard": "hf_4rnd"},
    },
    {
        "id":    "hf_eft_eft_rkt",
        "label": "HF + 2×EFT + RKT (L-OB:HF / L-IB:EFT / R-IB:EFT / R-OB:RKT)",
        "stations": {"l_outboard": "hf_4rnd",     "l_inboard": "eft_230", "r_inboard": "eft_230", "r_outboard": "rocket_m261"},
    },
    {
        "id":    "hf_eft_eft_eo",
        "label": "HF + 2×EFT + EO (L-OB:HF / L-IB:EFT / R-IB:EFT / R-OB:EO)",
        "stations": {"l_outboard": "hf_4rnd",     "l_inboard": "eft_230", "r_inboard": "eft_230", "r_outboard": "eo_launcher"},
    },
    {
        "id":    "clean",
        "label": "Clean (all empty)",
        "stations": {"l_outboard": "none",        "l_inboard": "none",    "r_inboard": "none",    "r_outboard": "none"},
    },
]

STATION_LABELS = {
    "l_inboard":  "L Inboard",
    "r_inboard":  "R Inboard",
    "l_outboard": "L Outboard",
    "r_outboard": "R Outboard",
}


def compute_atf(stations: dict[str, str]) -> tuple[float, float]:
    """
    Compute ATF multiplying factor from 4 station store assignments.

    Parameters
    ----------
    stations : dict with keys "l_inboard", "r_inboard", "l_outboard", "r_outboard"
               each value is a store id from STORES (or "none")

    Returns
    -------
    (delta_f_total, atf)
      delta_f_total = NO_WEAPONS_ΔF + Σ station_ΔF  (sq. ft., 0.00 for baseline)
      atf           = 1.00 + delta_f_total / 100.0   (1.000 for baseline)
    """
    delta_f = NO_WEAPONS_DELTA_F
    for station, store_id in stations.items():
        store = STORES.get(store_id, STORES["none"])
        if "inboard" in station:
            delta_f += store.delta_f_inboard
        else:
            delta_f += store.delta_f_outboard

    atf = round(1.0 + delta_f / 100.0, 3)
    return round(delta_f, 3), atf
