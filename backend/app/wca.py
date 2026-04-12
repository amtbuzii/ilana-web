# WCA evaluation engine — pure function, no I/O, no side effects.
"""
Advisory-only WCA evaluation for a completed flight plan.

WARNING and CAUTION levels come exclusively from the simulation (stop_info /
mid-leg checks in performance.py), matching VB6 Sim.frm behaviour.
evaluate_wca only emits ADVISORY alerts — informational blue markers shown on
the map and in the table without stopping the calculation.
"""

_LEVEL_ORDER = {'WARNING': 0, 'CAUTION': 1, 'ADVISORY': 2}


def evaluate_wca(wpt_results: list[dict], thresholds) -> list[dict]:
    """
    Evaluate ADVISORY-level WCA alerts for a completed flight plan.

    WARNING and CAUTION are produced by the simulation loop (stop_info).
    This function only emits ADVISORY alerts so the table and map markers
    stay consistent with the simulation result.

    Returns:
        Flat list of ADVISORY alert dicts, sorted by waypoint index.
    """
    if thresholds is None:
        return []

    raw: list[dict] = []

    for i, w in enumerate(wpt_results):
        name       = w.get('name', f'WP{i + 1}')
        fuel       = float(w.get('fuel_remaining_lbs', 9999))
        cruise_trq = float(w.get('cruise_torque_pct', 0))
        pa         = float(w.get('pa_available_pct', 100))
        margin     = pa - cruise_trq

        # ── Delta-Torque advisory ─────────────────────────────────────────────
        if thresholds.advisory_delta_torque_enabled and margin <= thresholds.advisory_delta_torque_pct:
            raw.append(_mk('ADVISORY', 'DELTA_TRQ', i, name,
                f'ΔTorque ≤ {thresholds.advisory_delta_torque_pct}%',
                margin, thresholds.advisory_delta_torque_pct))

        # ── Cruise Torque advisory ────────────────────────────────────────────
        if thresholds.advisory_cruise_torque_enabled and cruise_trq >= thresholds.advisory_cruise_torque_pct:
            raw.append(_mk('ADVISORY', 'CRUISE_TRQ', i, name,
                f'Cruise torque {cruise_trq:.1f}% ≥ advisory limit {thresholds.advisory_cruise_torque_pct}%',
                cruise_trq, thresholds.advisory_cruise_torque_pct))

        # ── Fuel advisory ─────────────────────────────────────────────────────
        if thresholds.advisory_fuel_enabled and fuel <= thresholds.advisory_min_fuel_lbs:
            raw.append(_mk('ADVISORY', 'FUEL', i, name,
                f'Fuel {fuel:.0f} lbs (advisory ≤ {thresholds.advisory_min_fuel_lbs:.0f} lbs)',
                fuel, thresholds.advisory_min_fuel_lbs))

    return sorted(raw, key=lambda a: a['wpt_index'])


def _mk(level: str, family: str, idx: int, name: str,
        msg: str, value: float, limit: float) -> dict:
    return {
        'level':     level,
        'code':      f'{family}_{level}',
        'wpt_index': idx,
        'wpt_name':  name,
        'message':   msg,
        'value':     round(value, 2),
        'limit':     limit,
    }
