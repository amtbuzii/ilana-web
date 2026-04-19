"""
Flight performance calculations for AH-64D Peten (Apache).

Simulation method:
  Each leg is integrated in Intrvl=1/12 min timesteps (VB6 calcLEGfwd faithful).
  At every step the current gross weight, altitude, speed, and OAT are
  used to look up torque and fuel flow, then fuel is burned for that
  timestep.  This mirrors how Einat.exe simulates the flight.

Weight model:
  gross_weight   = empty_weight + fuel_remaining   (updated every step)
  fuel_remaining = fuel_remaining - fuel_flow × Intrvl / 60

TRQ / FF model (LB variant, VB6-faithful):
  trq_raw = LBTorqFinder(alt, oat, spd, gw)          via torque_tbl.query()
  q       = LBQFinder(alt, oat, spd)                  via torque_tbl.query_q()
  trq_adj = trq_raw + rcfnc(dxrc, gw) + q * drag     (drag = -0.81 for 2 bidons)
  ff      = FFfinder(alt, oat, min(100, trq_adj))     via torque_tbl.query_ff()
"""

import math
from pyproj import Geod
from .parsers import load_tables, rcfnc, _CDRAG, DEFAULT_N_BIDONS


def _rnd(x: float) -> int:
    """Round half down (matches VB6 Int() + 0.5 rounding): 95.5 → 95, 95.6 → 96."""
    return math.ceil(x - 0.5)

# ── Simulation timestep (VB6 calcLEGfwd: Intrvl = 1/12 minute) ───────────────
_INTRVL_MIN = 1.0 / 12.0          # minutes per integration step
_INTRVL_HR  = _INTRVL_MIN / 60.0  # hours per integration step

# ── Ground / APU fuel flow ────────────────────────────────────────────────────
_GROUND_FF_LB_HR = 475.0   # combined fuel flow, both engines running on ground (lb/hr)

_LL_GEODESIC: Geod | None = None


def _geodesic() -> Geod:
    """Lazy-initialise the WGS-84 geodesic object (avoids import cost at module load)."""
    global _LL_GEODESIC
    if _LL_GEODESIC is None:
        _LL_GEODESIC = Geod(ellps="WGS84")
    return _LL_GEODESIC


def haversine_nm(lat1, lon1, lat2, lon2) -> float:
    """Return the geodesic (WGS-84) distance between two lat/lon points in nautical miles."""
    _, _, dist_m = _geodesic().inv(lon1, lat1, lon2, lat2)
    return abs(dist_m) / 1852.0


def _leg_bearing(lat1, lon1, lat2, lon2) -> float:
    """Initial compass bearing (clockwise from north) from point 1 to point 2, degrees."""
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.degrees(math.atan2(x, y)) % 360


def _calc_vg(tas_kts: float, wind_spd: float, wind_dir_deg: float, bearing_deg: float) -> float:
    """
    Ground speed from velocity triangle — mirrors VB6 calcVG (Sim.frm line 6985).

    wind_dir_deg : FROM direction clockwise from north (standard met).
    bearing_deg  : leg compass bearing clockwise from north.

    VB6 uses screen coords where y increases southward, giving:
        LaneDir = bearing_rad - PI/2
    The original formula b = -2*W*cos((90+WINDDIR)*PI/180 - LaneDir)
    simplifies to b = 2*W*cos(bearing_rad - wind_dir_rad) in compass coords.
    """
    if wind_spd <= 0:
        return tas_kts
    bearing_rad = math.radians(bearing_deg)
    lane_dir    = bearing_rad - math.pi / 2          # VB6 screen-coord LaneDir
    b = -2.0 * wind_spd * math.cos(math.radians(90 + wind_dir_deg) - lane_dir)
    c = wind_spd ** 2 - tas_kts ** 2
    d = b ** 2 - 4.0 * c
    if d < 0:
        return 0.001                                  # wind exceeds TAS — stall
    return (-b + math.sqrt(d)) / 2.0


def _get_ff(torque_tbl, ff_tbl, alt_ft, oat_c, spd_kts, trq_adj):
    """Resolve fuel flow using table (preferred) or ALPHA ff_tbl."""
    if ff_tbl is not None:
        return ff_tbl.query(alt_ft, oat_c, spd_kts)
    return torque_tbl.query_ff(alt_ft, oat_c, trq_adj)


def _max_endurance_roc(torque_tbl, ff_tbl, pa_pct, alt_ft, oat_c, atf, gross_weight,
                       drag: float = 0.0):
    """
    Scan 40–160 kts in 5-kt steps for the minimum-torque (max endurance) speed.

    Returns (best_spd_kts, ff_lb_hr, max_roc_fpm).

    ROC formula (VB6 Sim.frm):
      max_roc_fpm = excess_torque_pct * 725806 / gross_weight_lbs
    The constant 725806 is the empirical climb-power coefficient for the AH-64D.
    """
    best_spd = 60.0
    best_trq = float('inf')
    best_trq_adj = float('inf')
    for spd in range(40, 165, 5):
        trq_raw = torque_tbl.query(alt_ft, oat_c, float(spd), atf, gross_weight)
        q       = torque_tbl.query_q(alt_ft, oat_c, float(spd))
        trq_adj = trq_raw + q * drag
        if trq_adj < best_trq:
            best_trq     = trq_adj
            best_trq_adj = trq_adj
            best_spd     = float(spd)
    me_ff = _get_ff(torque_tbl, ff_tbl, alt_ft, oat_c, best_spd, best_trq_adj)
    excess_trq = max(0.0, pa_pct - best_trq)
    roc_fpm = excess_trq * 725_806 / max(gross_weight, 1.0)
    return best_spd, round(me_ff, 1), round(roc_fpm, 0)


_CONE_ENGINE_CLIMB = 100.0   # fpm — VB6 coneENGINEclimb default (Sim.frm line 7477)


def calc_engine_min_speed(
    alt_ft: float, oat_c: float, gross_weight_lbs: float,
    pa_tbl, oge_tbl, torque_tbl,
    n_bidons: int = 2, acft_etf: float = 1.0,
    drag: float = 0.0, sngl: bool = True,
) -> int | None:
    """
    Minimum airspeed (kts) to maintain level flight on one engine (sngl=True)
    or two engines (sngl=False). Mirrors VB6 calcSE (Sim.frm line 6328).

    VB6 logic:
      PAfinder(se=1 or 0) × TR → PA
      PAtmp = PA / 2  (SE)  or  PA / 1  (DE)
      Cap: SE → 62.5%, DE → 100%
      OGE += RcFnc(coneENGINEclimb=100, gw)
      if PAtmp > OGE: return 0 (can hover)
      else iterate v=20..81 until trq(v) + q*drag + RcFnc <= PAtmp

    Returns:
        0       — can OGE hover (PA exceeds hover torque needed)
        20–81   — minimum level-flight airspeed (kts)
        None    — cannot maintain flight (N/A, v ≥ 82)
    """
    from .parsers import rcfnc as _rcfnc

    rating = 1 if sngl else 0
    pa = pa_tbl.query(alt_ft, oat_c, etf=acft_etf, rating=rating)

    # VB6: PAtmp = PA / (-Sngl*1+1); True=-1 in VB6 → /2 for SE, /1 for DE
    pa_limit = (pa / 2.0) if sngl else pa
    pa_limit = min(pa_limit, 62.5 if sngl else 100.0)

    # OGE with climb correction
    oge = oge_tbl.query(alt_ft, oat_c, gross_weight_lbs, n_bidons)
    rc_corr = _rcfnc(_CONE_ENGINE_CLIMB, gross_weight_lbs)
    if pa_limit > oge + rc_corr:
        return 0   # can hover

    for v in range(20, 82):
        trq_raw = torque_tbl.query(alt_ft, oat_c, float(v), 1.0, gross_weight_lbs)
        q       = torque_tbl.query_q(alt_ft, oat_c, float(v))
        trq     = trq_raw + q * drag + rc_corr
        if trq <= pa_limit:
            return v

    return None   # N/A


def _mk_stop(level: str, code: str, message: str, lat: float, lon: float) -> dict:
    return {'level': level, 'code': code, 'message': message, 'lat': round(lat, 6), 'lon': round(lon, 6)}


def _simulate_leg(wfrom, wto, torque_tbl, ff_tbl, fuel_remaining, empty_weight,
                  drag: float = 0.0, spare_pct: int = 0,
                  pa_tbl=None, acft_etf: float = 1.0, thresholds=None):
    """
    Integrate fuel burn over the leg in Intrvl=1/12 min steps (VB6 calcLEGfwd faithful).

    Speed is held constant at the departure waypoint TAS (per VB6 calcLEGfwd).
    Alt and OAT interpolate linearly along the leg.
    Wind (from departure waypoint) is used to compute ground speed vg via _calc_vg;
    leg time and fuel burn are based on vg, matching VB6 calcLEGfwd.

    Returns:
        fuel_remaining  : fuel on board at leg end (lbs)
        fuel_burned     : total fuel burned on this leg (lbs)
        leg_time_min    : leg duration (minutes, ground-speed based)
        avg_torque_pct  : average adjusted torque over the leg
        avg_ff_lb_hr    : average fuel flow over the leg
        dist_nm         : great-circle distance
        stop_info       : None if normal completion, or dict if stopped mid-leg by WCA check
    """
    dist_nm = haversine_nm(wfrom.lat, wfrom.lon, wto.lat, wto.lon)

    spd = wfrom.airspeed_kts   # VB6 uses departure-waypoint speed throughout leg
    if spd <= 0 or dist_nm == 0:
        return fuel_remaining, 0.0, 0.0, 0.0, 0.0, dist_nm, None

    # Ground speed via velocity triangle — VB6 calcVG (Sim.frm line 6985)
    bearing = _leg_bearing(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
    vg      = _calc_vg(spd,
                       getattr(wfrom, 'wind_speed_kts', 0.0),
                       getattr(wfrom, 'wind_dir', 0),
                       bearing)
    vg = max(1.0, vg)   # clamp: 0.001 (wind > TAS) → millions of steps → hang

    leg_time_min = dist_nm / vg * 60.0          # time based on ground speed
    n_steps = min(10_000, max(1, round(leg_time_min / _INTRVL_MIN)))  # safety cap
    dt_min = leg_time_min / n_steps
    dt_hr  = dt_min / 60.0

    # Altitude rate for RcFnc (constant per leg), clamped per VB6 line 6767
    dxrc = (wto.alt_ft - wfrom.alt_ft) / leg_time_min if leg_time_min > 0 else 0.0
    dxrc = max(-6000.0, min(8000.0, dxrc))

    fuel_start  = fuel_remaining
    torque_sum  = 0.0
    ff_sum      = 0.0

    # ── Departure WCA check (frac=0 — the loop uses mid-interval so this point
    #    is never reached inside the loop) ───────────────────────────────────────
    if thresholds is not None and pa_tbl is not None:
        pa_dep0    = pa_tbl.query(wfrom.alt_ft, wfrom.oat_c, etf=acft_etf)
        gw_dep0    = empty_weight + fuel_remaining
        trq_raw0   = torque_tbl.query(wfrom.alt_ft, wfrom.oat_c, spd, wfrom.atf, gw_dep0)
        q0         = torque_tbl.query_q(wfrom.alt_ft, wfrom.oat_c, spd)
        trq_adj0   = trq_raw0 + rcfnc(dxrc, gw_dep0) + q0 * drag
        margin0    = pa_dep0 - trq_adj0
        dep_stop   = None
        if gw_dep0 > thresholds.warn_max_gw_lbs:
            dep_stop = _mk_stop('WARNING', 'GROSS_WT',
                f'Gross weight {gw_dep0:,.0f} lbs — exceeds limit {thresholds.warn_max_gw_lbs:,.0f} lbs',
                wfrom.lat, wfrom.lon)
        elif margin0 <= thresholds.warn_delta_torque_pct:
            dep_stop = _mk_stop('WARNING', 'DELTA_TRQ',
                f'ΔTorque ≤ {thresholds.warn_delta_torque_pct}%',
                wfrom.lat, wfrom.lon)
        elif trq_adj0 >= thresholds.warn_cruise_torque_pct:
            dep_stop = _mk_stop('WARNING', 'CRUISE_TRQ',
                f'Cruise torque {trq_adj0:.1f}% ≥ {thresholds.warn_cruise_torque_pct}%',
                wfrom.lat, wfrom.lon)
        elif fuel_remaining <= thresholds.warn_min_fuel_lbs:
            dep_stop = _mk_stop('WARNING', 'FUEL',
                f'Fuel {fuel_remaining:.0f} lbs ≤ {thresholds.warn_min_fuel_lbs:.0f} lbs',
                wfrom.lat, wfrom.lon)
        elif thresholds.caution_delta_torque_enabled and margin0 <= thresholds.caution_delta_torque_pct:
            dep_stop = _mk_stop('CAUTION', 'DELTA_TRQ',
                f'ΔTorque ≤ {thresholds.caution_delta_torque_pct}%',
                wfrom.lat, wfrom.lon)
        elif thresholds.caution_cruise_torque_enabled and trq_adj0 >= thresholds.caution_cruise_torque_pct:
            dep_stop = _mk_stop('CAUTION', 'CRUISE_TRQ',
                f'Cruise torque {trq_adj0:.1f}% ≥ {thresholds.caution_cruise_torque_pct}%',
                wfrom.lat, wfrom.lon)
        if dep_stop is not None:
            return (fuel_remaining, 0.0, 0.0, trq_adj0, 0.0, 0.0, dep_stop)

    for step in range(n_steps):
        frac = (step + 0.5) / n_steps

        alt = wfrom.alt_ft + frac * (wto.alt_ft - wfrom.alt_ft)
        oat = wfrom.oat_c  + frac * (wto.oat_c  - wfrom.oat_c)
        atf = wfrom.atf    + frac * (wto.atf    - wfrom.atf)

        gw = empty_weight + fuel_remaining

        trq_raw = torque_tbl.query(alt, oat, spd, atf, gw)
        q       = torque_tbl.query_q(alt, oat, spd)
        rc_corr = rcfnc(dxrc, gw)
        trq_adj = trq_raw + rc_corr + q * drag

        ff = _get_ff(torque_tbl, ff_tbl, alt, oat, spd, trq_adj)
        ff_with_spare = ff * (1.0 + spare_pct / 100.0)   # VB6 line 6604

        fuel_remaining = max(0.0, fuel_remaining - ff_with_spare * dt_hr)
        torque_sum    += trq_adj
        ff_sum        += ff

        # ── Mid-step WCA check (VB6 checkFLIGHTDATA) ──────────────────────────
        if thresholds is not None and pa_tbl is not None:
            pa_step   = pa_tbl.query(alt, oat, etf=acft_etf)
            gw_step   = empty_weight + fuel_remaining
            margin    = pa_step - trq_adj   # PA headroom above cruise TRQ; small/negative = danger
            # interpolated position at start of this step
            pos_frac  = step / n_steps
            stop_lat  = wfrom.lat + pos_frac * (wto.lat - wfrom.lat)
            stop_lon  = wfrom.lon + pos_frac * (wto.lon - wfrom.lon)
            stop_info = None

            # Check most-severe first; exclusive zones via elif chain
            if gw_step > thresholds.warn_max_gw_lbs:
                stop_info = _mk_stop('WARNING', 'GROSS_WT',
                    f'Gross weight {gw_step:,.0f} lbs — exceeds limit {thresholds.warn_max_gw_lbs:,.0f} lbs',
                    stop_lat, stop_lon)
            elif margin <= thresholds.warn_delta_torque_pct:
                stop_info = _mk_stop('WARNING', 'DELTA_TRQ',
                    f'ΔTorque ≤ {thresholds.warn_delta_torque_pct}%',
                    stop_lat, stop_lon)
            elif trq_adj >= thresholds.warn_cruise_torque_pct:
                stop_info = _mk_stop('WARNING', 'CRUISE_TRQ',
                    f'Cruise torque {trq_adj:.1f}% ≥ {thresholds.warn_cruise_torque_pct}%',
                    stop_lat, stop_lon)
            elif fuel_remaining <= thresholds.warn_min_fuel_lbs:
                stop_info = _mk_stop('WARNING', 'FUEL',
                    f'Fuel {fuel_remaining:.0f} lbs ≤ {thresholds.warn_min_fuel_lbs:.0f} lbs',
                    stop_lat, stop_lon)
            elif thresholds.caution_delta_torque_enabled and margin <= thresholds.caution_delta_torque_pct:
                stop_info = _mk_stop('CAUTION', 'DELTA_TRQ',
                    f'ΔTorque ≤ {thresholds.caution_delta_torque_pct}%',
                    stop_lat, stop_lon)
            elif thresholds.caution_cruise_torque_enabled and trq_adj >= thresholds.caution_cruise_torque_pct:
                stop_info = _mk_stop('CAUTION', 'CRUISE_TRQ',
                    f'Cruise torque {trq_adj:.1f}% ≥ {thresholds.caution_cruise_torque_pct}%',
                    stop_lat, stop_lon)

            if stop_info is not None:
                # Partial leg: return up to this step
                partial_time   = (step / n_steps) * leg_time_min
                partial_dist   = (step / n_steps) * dist_nm
                partial_burned = fuel_start - fuel_remaining
                n_done = max(step, 1)
                return (fuel_remaining, partial_burned, partial_time,
                        torque_sum / n_done, ff_sum / n_done, partial_dist,
                        stop_info)

    fuel_burned    = fuel_start - fuel_remaining
    avg_torque_pct = torque_sum / n_steps
    avg_ff_lb_hr   = ff_sum    / n_steps

    return fuel_remaining, fuel_burned, leg_time_min, avg_torque_pct, avg_ff_lb_hr, dist_nm, None


def _simulate_leg_backward(wfrom, wto, torque_tbl, ff_tbl, fuel_remaining, empty_weight,
                           drag: float = 0.0, spare_pct: int = 0):
    """
    Backward fuel integration: same physics as _simulate_leg but fuel is added each step.

    wfrom = earlier waypoint (forward departure, backward destination)
    wto   = later waypoint   (forward arrival,   backward departure)
    fuel_remaining = fuel at wto (known); returns fuel at wfrom = wto + burned_forward

    The altitude profile follows wfrom→wto (same direction as forward).
    """
    dist_nm = haversine_nm(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
    spd     = wfrom.airspeed_kts
    if spd <= 0 or dist_nm == 0:
        return fuel_remaining, 0.0, 0.0, 0.0, 0.0, dist_nm, None

    bearing = _leg_bearing(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
    vg      = _calc_vg(spd, getattr(wfrom, 'wind_speed_kts', 0.0),
                       getattr(wfrom, 'wind_dir', 0), bearing)
    vg = max(1.0, vg)   # clamp: 0.001 (wind > TAS) → millions of steps → hang

    leg_time_min = dist_nm / vg * 60.0
    n_steps = min(10_000, max(1, round(leg_time_min / _INTRVL_MIN)))  # safety cap
    dt_hr   = leg_time_min / n_steps / 60.0

    dxrc = (wto.alt_ft - wfrom.alt_ft) / leg_time_min if leg_time_min > 0 else 0.0
    dxrc = max(-6000.0, min(8000.0, dxrc))

    fuel_start  = fuel_remaining
    torque_sum  = ff_sum = 0.0

    for step in range(n_steps):
        frac = (step + 0.5) / n_steps
        alt  = wfrom.alt_ft + frac * (wto.alt_ft - wfrom.alt_ft)
        oat  = wfrom.oat_c  + frac * (wto.oat_c  - wfrom.oat_c)
        atf  = wfrom.atf    + frac * (wto.atf    - wfrom.atf)
        gw   = empty_weight + fuel_remaining

        trq_raw = torque_tbl.query(alt, oat, spd, atf, gw)
        q       = torque_tbl.query_q(alt, oat, spd)
        trq_adj = trq_raw + rcfnc(dxrc, gw) + q * drag
        ff      = _get_ff(torque_tbl, ff_tbl, alt, oat, spd, trq_adj)

        fuel_remaining += ff * (1.0 + spare_pct / 100.0) * dt_hr   # ADD fuel
        torque_sum     += trq_adj
        ff_sum         += ff

    fuel_added     = fuel_remaining - fuel_start
    avg_torque_pct = torque_sum / n_steps
    avg_ff_lb_hr   = ff_sum    / n_steps

    return fuel_remaining, fuel_added, leg_time_min, avg_torque_pct, avg_ff_lb_hr, dist_nm, None


def suggest_climb_speed(
    variant: str,
    empty_weight_lbs: float,
    fuel_at_departure_lbs: float,
    wfrom,
    wto,
    acft_etf: float = 1.0,
    n_bidons: int = 0,
    delta_f=None,
    thresholds=None,
    max_tas: int = 120,
) -> tuple:
    """
    Binary search for the maximum TAS (kts, integer) ≤ max_tas that allows
    the departure WCA check (DELTA_TRQ / CRUISE_TRQ) to pass for the given leg.

    Uses a lightweight proxy object so wfrom is not mutated.
    Returns (found: bool, best_tas: int | None).
    """
    import types as _types

    torque_tbl, ff_tbl, pa_tbl, _ = load_tables(variant)
    drag = delta_f if delta_f is not None else _CDRAG.get(n_bidons, 0.0)

    _ATTRS = ('lat', 'lon', 'alt_ft', 'oat_c', 'atf', 'wind_speed_kts', 'wind_dir', 'spare_pct')
    base = {a: getattr(wfrom, a, 0) for a in _ATTRS}

    def _test(tas_kts: int) -> bool:
        proxy = _types.SimpleNamespace(**base, airspeed_kts=float(tas_kts))
        _, _, _, _, _, _, stop_info = _simulate_leg(
            proxy, wto, torque_tbl, ff_tbl, fuel_at_departure_lbs, empty_weight_lbs,
            drag=drag, spare_pct=int(getattr(wfrom, 'spare_pct', 0)),
            pa_tbl=pa_tbl, acft_etf=acft_etf, thresholds=thresholds,
        )
        if stop_info is None:
            return True
        return stop_info['code'] not in ('DELTA_TRQ', 'CRUISE_TRQ')

    original_tas = float(wfrom.airspeed_kts)
    lo = 40
    hi = int(min(original_tas - 1, float(max_tas)))
    if hi < lo:
        return False, None

    if not _test(lo):
        return False, None

    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        if _test(mid):
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1

    return True, best


def fuel_from_oge(oge_tbl, alt_ft: float, oat_c: float, empty_weight_lbs: float,
                  target_oge_pct: float, n_bidons: int) -> float | None:
    """
    Back-solve for fuel load (lbs) such that OGE torque required ≈ target_oge_pct.

    Walks the GW axis from 14 000 to 21 000 lb in 1 000-lb steps, linearly
    interpolating between the two bracketing gross weights.
    Returns None if the target falls outside the table's GW range.
    """
    prev_gw = prev_oge = None
    for gw in range(14_000, 22_000, 1_000):
        oge = oge_tbl.query(alt_ft, oat_c, float(gw), n_bidons)
        if prev_gw is not None and prev_oge != oge:
            lo, hi = (prev_oge, oge) if prev_oge <= oge else (oge, prev_oge)
            if lo <= target_oge_pct <= hi:
                t = (target_oge_pct - prev_oge) / (oge - prev_oge)
                gw_interp = prev_gw + t * 1_000.0
                return max(0.0, round(gw_interp - empty_weight_lbs))
        prev_gw, prev_oge = gw, oge
    return None


def calculate_flight_plan(
    variant: str,
    empty_weight_lbs: float,
    initial_fuel_lbs: float,         # used only when csp_index is None
    waypoints: list,
    acft_etf: float = 1.0,           # average engine temperature factor (ETF_eng1 + ETF_eng2) / 2
    n_bidons: int = DEFAULT_N_BIDONS,
    delta_f: float | None = None,    # total stores ΔF (sq. ft.); overrides n_bidons drag
    csp_index: int | None = None,    # Calculation Start Point index; triggers two-pass CSP mode
    csp_fuel: float | None = None,   # known fuel at CSP (lbs)
    thresholds=None,                 # WCA threshold object; None disables mid-leg checks
) -> tuple[list, list, dict | None]:
    """
    Compute per-leg and per-waypoint performance using VB6-faithful integration.

    Normal mode (csp_index is None):
      Integrates forward from waypoints[0] using initial_fuel_lbs.

    CSP mode (csp_index + csp_fuel provided):
      Two-pass: forward from CSP to last waypoint, then backward from CSP to
      waypoints[0], so that fuel at every waypoint is consistent with the known
      fuel at the Calculation Start Point.

    Drag selection:
      delta_f (sq. ft.) from wing-stores panel takes precedence over the
      cDRAGxb[n_bidons] fallback from Einat.ini lines 5–8.

    Returns (leg_results, wpt_results, stop_info) — lists of dicts matching LegResult /
    WaypointResult field names, plus stop_info (None or a WCA stop dict).
    """
    torque_tbl, ff_tbl, pa_tbl, oge_tbl = load_tables(variant)
    drag = delta_f if delta_f is not None else _CDRAG.get(n_bidons, 0.0)

    def _add_engine_speeds(wpt_dict: dict, gw: float) -> None:
        """Attach se_min_speed_kts and de_min_speed_kts to a waypoint result dict."""
        alt = wpt_dict['alt_ft']
        oat = wpt_dict['oat_c']
        wpt_dict['se_min_speed_kts'] = calc_engine_min_speed(
            alt, oat, gw, pa_tbl, oge_tbl, torque_tbl, n_bidons, acft_etf, drag, sngl=True)
        wpt_dict['de_min_speed_kts'] = calc_engine_min_speed(
            alt, oat, gw, pa_tbl, oge_tbl, torque_tbl, n_bidons, acft_etf, drag, sngl=False)

    # ── CSP (Calculation Start Point) mode ───────────────────────────────────
    use_csp = (csp_index is not None
               and 0 <= csp_index < len(waypoints)
               and csp_fuel is not None)
    if use_csp:
        n          = len(waypoints)
        wpt_results = [None] * n
        leg_results = [None] * (n - 1)

        def _wpt_entry(w, fuel, pa, oge, ige, trq, ff_disp, spare):
            gw = empty_weight_lbs + fuel
            d = dict(
                name=w.name, lat=w.lat, lon=w.lon, alt_ft=w.alt_ft,
                gross_weight_lbs=round(gw, 1),
                fuel_remaining_lbs=round(fuel, 1),
                pa_available_pct=_rnd(pa), oge_torque_required_pct=_rnd(oge),
                oge_feasible=pa >= oge, ige_torque_required_pct=_rnd(ige),
                cruise_torque_pct=round(trq), fuel_flow_lb_hr=round(ff_disp),
                spare_pct=spare, tas_kts=round(w.airspeed_kts, 1), oat_c=w.oat_c,
                max_roc_fpm=0.0, cum_dist_nm=0.0, cum_time_min=0.0,
                hold_type=getattr(w, 'hold_type', None), hold_min=getattr(w, 'hold_min', 0),
                hold_fuel_burned_lbs=0.0,
                wind_dir=getattr(w, 'wind_dir', 0),
                wind_speed_kts=getattr(w, 'wind_speed_kts', 0.0),
            )
            _add_engine_speeds(d, gw)
            return d

        # ── Initial CSP waypoint entry (TRQ updated on first fwd leg) ─────────
        w_csp       = waypoints[csp_index]
        gw_csp      = empty_weight_lbs + csp_fuel
        pa_csp      = pa_tbl.query(w_csp.alt_ft, w_csp.oat_c, etf=acft_etf)
        oge_csp     = oge_tbl.query(w_csp.alt_ft, w_csp.oat_c, gw_csp, n_bidons)
        ige_csp     = 0.82 * oge_csp + 0.82
        trq_csp_raw = torque_tbl.query(w_csp.alt_ft, w_csp.oat_c, w_csp.airspeed_kts, w_csp.atf, gw_csp)
        q_csp       = torque_tbl.query_q(w_csp.alt_ft, w_csp.oat_c, w_csp.airspeed_kts)
        trq_csp     = trq_csp_raw + q_csp * drag
        ff_csp      = _get_ff(torque_tbl, ff_tbl, w_csp.alt_ft, w_csp.oat_c, w_csp.airspeed_kts, trq_csp)
        wpt_results[csp_index] = _wpt_entry(
            w_csp, csp_fuel, pa_csp, oge_csp, ige_csp, trq_csp, round(ff_csp),
            getattr(w_csp, 'spare_pct', 0))

        # ── Forward pass: csp_index → end ─────────────────────────────────────
        fuel_remaining = csp_fuel
        csp_stop_info  = None
        for i in range(csp_index, n - 1):
            wfrom = waypoints[i]; wto = waypoints[i + 1]
            gw_dep = empty_weight_lbs + fuel_remaining
            spare  = getattr(wfrom, 'spare_pct', 0)

            fuel_remaining, fuel_burned, leg_time_min, avg_torque, avg_ff, dist_nm, stop_info = \
                _simulate_leg(wfrom, wto, torque_tbl, ff_tbl, fuel_remaining,
                               empty_weight_lbs, drag, spare,
                               pa_tbl=pa_tbl, acft_etf=acft_etf, thresholds=thresholds)
            gross_weight = empty_weight_lbs + fuel_remaining

            if leg_time_min > 0:
                spd_dep  = wfrom.airspeed_kts if wfrom.airspeed_kts > 0 else 1.0
                tas_time = dist_nm / spd_dep * 60.0
                dxrc_fwd = (wto.alt_ft - wfrom.alt_ft) / tas_time if tas_time > 0 else 0.0
                trq_d_raw = torque_tbl.query(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, wfrom.atf, gw_dep)
                q_d       = torque_tbl.query_q(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts)
                trq_d     = trq_d_raw + rcfnc(dxrc_fwd, gw_dep) + q_d * drag
                ff_d      = _get_ff(torque_tbl, ff_tbl, wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, trq_d)
                wpt_results[i]['cruise_torque_pct'] = round(trq_d)
                wpt_results[i]['fuel_flow_lb_hr']   = round(ff_d * (1.0 + spare / 100.0))
                wpt_results[i]['spare_pct']          = spare
                wpt_results[i]['max_roc_fpm']       = round(max(-6000.0, min(8000.0, dxrc_fwd)))

            pa_arr  = pa_tbl.query(wto.alt_ft, wto.oat_c, etf=acft_etf)
            oge_arr = oge_tbl.query(wto.alt_ft, wto.oat_c, gross_weight, n_bidons)
            ige_arr = 0.82 * oge_arr + 0.82
            mid_alt = (wfrom.alt_ft + wto.alt_ft) / 2
            mid_oat = (wfrom.oat_c  + wto.oat_c)  / 2
            mid_atf = (wfrom.atf    + wto.atf)    / 2
            mid_pa  = pa_tbl.query(mid_alt, mid_oat, etf=acft_etf)
            me_spd, me_ff, max_roc = _max_endurance_roc(
                torque_tbl, ff_tbl, mid_pa, mid_alt, mid_oat, mid_atf, gross_weight, drag)
            leg_brg  = _leg_bearing(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
            climb_fpm = max(-6000.0, min(8000.0,
                (wto.alt_ft - wfrom.alt_ft) / leg_time_min if leg_time_min > 0 else 0.0))

            leg_results[i] = dict(
                from_name=wfrom.name, to_name=wto.name,
                distance_nm=round(dist_nm, 2), leg_time_min=round(leg_time_min, 1),
                pressure_alt_ft=round(mid_alt, 0), torque_required_pct=round(avg_torque, 1),
                fuel_flow_lb_hr=round(avg_ff, 1), fuel_burned_lbs=round(fuel_burned, 1),
                fuel_remaining_lbs=round(fuel_remaining, 1),
                gross_weight_lbs=round(gross_weight, 1),
                pa_available_pct=_rnd(pa_arr), oge_torque_required_pct=_rnd(oge_arr),
                ige_torque_required_pct=_rnd(ige_arr), oge_feasible=pa_arr >= oge_arr,
                me_speed_kts=me_spd, me_ff_lb_hr=me_ff, max_roc_fpm=max_roc,
                leg_direction_deg=round(leg_brg, 1),
                wind_dir=getattr(wfrom, 'wind_dir', 0),
                wind_speed_kts=getattr(wfrom, 'wind_speed_kts', 0.0),
                spare_pct=spare, alt_from_ft=wfrom.alt_ft, alt_to_ft=wto.alt_ft,
                tas_kts=round(wfrom.airspeed_kts, 1), oat_c=round(mid_oat, 1),
                climb_fpm=round(climb_fpm),
            )

            hold_fuel = 0.0
            if wto.hold_type and wto.hold_min > 0:
                hold_time_hr = wto.hold_min / 60.0
                if wto.hold_type in ('ground', 'apu'):
                    hold_ff = _GROUND_FF_LB_HR
                elif wto.hold_type == 'hover':
                    hold_ff = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c,
                                      getattr(wto, 'hold_speed_kts', 0.0), oge_arr)
                else:
                    end_spd = getattr(wto, 'hold_speed_kts', 80.0)
                    etrq_raw = torque_tbl.query(wto.alt_ft, wto.oat_c, end_spd, wto.atf, gross_weight)
                    eq = torque_tbl.query_q(wto.alt_ft, wto.oat_c, end_spd)
                    hold_ff = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c,
                                      end_spd, etrq_raw + eq * drag)
                hold_fuel      = hold_ff * hold_time_hr
                fuel_remaining = max(0.0, fuel_remaining - hold_fuel)
                gross_weight   = empty_weight_lbs + fuel_remaining

            trq_arr_raw = torque_tbl.query(wto.alt_ft, wto.oat_c, wto.airspeed_kts, wto.atf, gross_weight)
            q_arr       = torque_tbl.query_q(wto.alt_ft, wto.oat_c, wto.airspeed_kts)
            trq_arr     = trq_arr_raw + q_arr * drag
            ff_arr      = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c, wto.airspeed_kts, trq_arr)
            arr_spare   = getattr(wto, 'spare_pct', 0)

            wpt_results[i + 1] = _wpt_entry(
                wto, fuel_remaining, pa_arr, oge_arr, ige_arr,
                trq_arr, round(ff_arr * (1.0 + arr_spare / 100.0)), arr_spare)
            wpt_results[i + 1]['hold_fuel_burned_lbs'] = round(hold_fuel, 1)

            if stop_info is not None:
                csp_stop_info = stop_info
                break

        # ── Backward pass: csp_index → WP0 ────────────────────────────────────
        fuel_remaining = csp_fuel
        for i in range(csp_index, 0, -1):
            wfrom = waypoints[i - 1]   # earlier WP (solving for its fuel)
            wto   = waypoints[i]       # later WP (fuel known from previous iteration)
            spare = getattr(wfrom, 'spare_pct', 0)

            fuel_at_wto = fuel_remaining
            fuel_remaining, fuel_added, leg_time_min, avg_torque, avg_ff, dist_nm, _ = \
                _simulate_leg_backward(wfrom, wto, torque_tbl, ff_tbl, fuel_remaining,
                                        empty_weight_lbs, drag, spare)
            gross_weight = empty_weight_lbs + fuel_remaining   # GW at wfrom

            pa_dep  = pa_tbl.query(wfrom.alt_ft, wfrom.oat_c, etf=acft_etf)
            oge_dep = oge_tbl.query(wfrom.alt_ft, wfrom.oat_c, gross_weight, n_bidons)
            ige_dep = 0.82 * oge_dep + 0.82
            mid_alt = (wfrom.alt_ft + wto.alt_ft) / 2
            mid_oat = (wfrom.oat_c  + wto.oat_c)  / 2
            mid_atf = (wfrom.atf    + wto.atf)    / 2
            mid_pa  = pa_tbl.query(mid_alt, mid_oat, etf=acft_etf)
            me_spd, me_ff, max_roc = _max_endurance_roc(
                torque_tbl, ff_tbl, mid_pa, mid_alt, mid_oat, mid_atf, gross_weight, drag)
            leg_brg   = _leg_bearing(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
            climb_fpm = max(-6000.0, min(8000.0,
                (wto.alt_ft - wfrom.alt_ft) / leg_time_min if leg_time_min > 0 else 0.0))

            leg_results[i - 1] = dict(
                from_name=wfrom.name, to_name=wto.name,
                distance_nm=round(dist_nm, 2), leg_time_min=round(leg_time_min, 1),
                pressure_alt_ft=round(mid_alt, 0), torque_required_pct=round(avg_torque, 1),
                fuel_flow_lb_hr=round(avg_ff, 1), fuel_burned_lbs=round(fuel_added, 1),
                fuel_remaining_lbs=round(fuel_at_wto, 1),
                gross_weight_lbs=round(gross_weight, 1),
                pa_available_pct=_rnd(pa_dep), oge_torque_required_pct=_rnd(oge_dep),
                ige_torque_required_pct=_rnd(ige_dep), oge_feasible=pa_dep >= oge_dep,
                me_speed_kts=me_spd, me_ff_lb_hr=me_ff, max_roc_fpm=max_roc,
                leg_direction_deg=round(leg_brg, 1),
                wind_dir=getattr(wfrom, 'wind_dir', 0),
                wind_speed_kts=getattr(wfrom, 'wind_speed_kts', 0.0),
                spare_pct=spare, alt_from_ft=wfrom.alt_ft, alt_to_ft=wto.alt_ft,
                tas_kts=round(wfrom.airspeed_kts, 1), oat_c=round(mid_oat, 1),
                climb_fpm=round(climb_fpm),
            )

            # TRQ at wfrom with outbound dxrc (wfrom → wto)
            spd_dep  = wfrom.airspeed_kts if wfrom.airspeed_kts > 0 else 1.0
            tas_time = dist_nm / spd_dep * 60.0
            dxrc_out = (wto.alt_ft - wfrom.alt_ft) / tas_time if tas_time > 0 else 0.0
            trq_d_raw = torque_tbl.query(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, wfrom.atf, gross_weight)
            q_d       = torque_tbl.query_q(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts)
            trq_d     = trq_d_raw + rcfnc(dxrc_out, gross_weight) + q_d * drag
            ff_d      = _get_ff(torque_tbl, ff_tbl, wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, trq_d)

            wpt_results[i - 1] = _wpt_entry(
                wfrom, fuel_remaining, pa_dep, oge_dep, ige_dep,
                trq_d, round(ff_d * (1.0 + spare / 100.0)), spare)
            wpt_results[i - 1]['max_roc_fpm'] = round(max(-6000.0, min(8000.0, dxrc_out)))

        # ── Post-process: cumulative distances from WP0 ────────────────────────
        cum_d = cum_t = 0.0
        for j in range(n):
            if wpt_results[j] is None:
                continue
            wpt_results[j]['cum_dist_nm']  = round(cum_d, 1)
            wpt_results[j]['cum_time_min'] = round(cum_t, 1)
            if j < n - 1 and leg_results[j] is not None:
                cum_d += leg_results[j]['distance_nm']
                cum_t += leg_results[j]['leg_time_min']

        return ([r for r in leg_results if r is not None],
                [w for w in wpt_results if w is not None],
                csp_stop_info)

    fuel_remaining = initial_fuel_lbs
    gross_weight   = empty_weight_lbs + fuel_remaining

    wpt_results = []
    leg_results = []

    # ── Waypoint 0 (departure) ────────────────────────────────────────────────
    w0      = waypoints[0]
    pa0     = pa_tbl.query(w0.alt_ft, w0.oat_c, etf=acft_etf)
    oge0    = oge_tbl.query(w0.alt_ft, w0.oat_c, gross_weight, n_bidons)
    ige0    = 0.82 * oge0 + 0.82   # VB6 OGfinder: IGE = 0.82*OGE + 0.82
    trq0_raw = torque_tbl.query(w0.alt_ft, w0.oat_c, w0.airspeed_kts, w0.atf, gross_weight)
    q0      = torque_tbl.query_q(w0.alt_ft, w0.oat_c, w0.airspeed_kts)
    trq0    = trq0_raw + q0 * drag
    ff0     = _get_ff(torque_tbl, ff_tbl, w0.alt_ft, w0.oat_c, w0.airspeed_kts, trq0)
    w0_dict = dict(
        name=w0.name, lat=w0.lat, lon=w0.lon, alt_ft=w0.alt_ft,
        gross_weight_lbs=round(gross_weight, 1),
        fuel_remaining_lbs=round(fuel_remaining, 1),
        pa_available_pct=_rnd(pa0),
        oge_torque_required_pct=_rnd(oge0),
        oge_feasible=pa0 >= oge0,
        ige_torque_required_pct=_rnd(ige0),
        cruise_torque_pct=round(trq0),
        fuel_flow_lb_hr=round(ff0),
        spare_pct=getattr(w0, 'spare_pct', 0),
        tas_kts=round(w0.airspeed_kts, 1),
        oat_c=w0.oat_c,
        max_roc_fpm=0.0,   # updated in leg loop (actual altitude rate outbound)
        cum_dist_nm=0.0,
        cum_time_min=0.0,
        wind_dir=getattr(w0, 'wind_dir', 0),
        wind_speed_kts=getattr(w0, 'wind_speed_kts', 0.0),
    )
    _add_engine_speeds(w0_dict, gross_weight)
    wpt_results.append(w0_dict)

    # ── Legs ──────────────────────────────────────────────────────────────────
    cum_dist_nm  = 0.0
    cum_time_min = 0.0
    plan_stop_info = None

    for i in range(len(waypoints) - 1):
        wfrom = waypoints[i]
        wto   = waypoints[i + 1]

        gw_dep = empty_weight_lbs + fuel_remaining   # GW at departure of this leg

        # ── Integrate this leg ─────────────────────────────────────────────
        spare = getattr(wfrom, 'spare_pct', 0)
        fuel_remaining, fuel_burned, leg_time_min, avg_torque, avg_ff, dist_nm, stop_info = \
            _simulate_leg(wfrom, wto, torque_tbl, ff_tbl, fuel_remaining, empty_weight_lbs, drag, spare,
                          pa_tbl=pa_tbl, acft_etf=acft_etf, thresholds=thresholds)

        gross_weight  = empty_weight_lbs + fuel_remaining
        cum_dist_nm  += dist_nm
        cum_time_min += leg_time_min

        # ── Update departure waypoint TRQ/FF with outbound rcfnc ──────────
        # VB6 calcLEGfwd: TRQ at each waypoint is computed with the
        # outbound dxrc (rate of altitude change for the departing leg).
        # Dxrc uses TAS-based air time (not ground-speed time) — this is
        # what the original VB6 computes, matching the "climb rate" column
        # in the reference CSV exactly.
        # Displayed FF includes spare (VB6 line 6779).
        if leg_time_min > 0:
            spd_dep   = wfrom.airspeed_kts if wfrom.airspeed_kts > 0 else 1.0
            tas_time  = dist_nm / spd_dep * 60.0   # TAS-based air time (minutes)
            dxrc_tas  = (wto.alt_ft - wfrom.alt_ft) / tas_time if tas_time > 0 else 0.0
            trq_d_raw = torque_tbl.query(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, wfrom.atf, gw_dep)
            q_d       = torque_tbl.query_q(wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts)
            trq_d     = trq_d_raw + rcfnc(dxrc_tas, gw_dep) + q_d * drag
            ff_d      = _get_ff(torque_tbl, ff_tbl, wfrom.alt_ft, wfrom.oat_c, wfrom.airspeed_kts, trq_d)
            wpt_results[i]['cruise_torque_pct'] = round(trq_d)
            wpt_results[i]['fuel_flow_lb_hr']   = round(ff_d * (1.0 + spare / 100.0))
            wpt_results[i]['spare_pct']          = spare
            dxrc_display = max(-6000.0, min(8000.0, dxrc_tas))   # VB6 clamp
            wpt_results[i]['max_roc_fpm']       = round(dxrc_display)

        # Arrival conditions
        pa_arr  = pa_tbl.query(wto.alt_ft, wto.oat_c, etf=acft_etf)
        oge_arr = oge_tbl.query(wto.alt_ft, wto.oat_c, gross_weight, n_bidons)
        ige_arr = 0.82 * oge_arr + 0.82   # VB6 OGfinder: IGE = 0.82*OGE + 0.82

        # Max endurance & ROC at mid-leg for the leg result
        mid_alt = (wfrom.alt_ft + wto.alt_ft) / 2
        mid_oat = (wfrom.oat_c  + wto.oat_c)  / 2
        mid_atf = (wfrom.atf    + wto.atf)    / 2
        mid_pa  = pa_tbl.query(mid_alt, mid_oat, etf=acft_etf)
        me_spd, me_ff, max_roc = _max_endurance_roc(
            torque_tbl, ff_tbl, mid_pa, mid_alt, mid_oat, mid_atf, gross_weight, drag)

        leg_bearing  = _leg_bearing(wfrom.lat, wfrom.lon, wto.lat, wto.lon)
        climb_fpm    = max(-6000.0, min(8000.0,
                           (wto.alt_ft - wfrom.alt_ft) / leg_time_min if leg_time_min > 0 else 0.0))
        leg_results.append(dict(
            from_name=wfrom.name,
            to_name=wto.name,
            distance_nm=round(dist_nm, 2),
            leg_time_min=round(leg_time_min, 1),
            pressure_alt_ft=round(mid_alt, 0),
            torque_required_pct=round(avg_torque, 1),
            fuel_flow_lb_hr=round(avg_ff, 1),
            fuel_burned_lbs=round(fuel_burned, 1),
            fuel_remaining_lbs=round(fuel_remaining, 1),
            gross_weight_lbs=round(gross_weight, 1),
            pa_available_pct=_rnd(pa_arr),
            oge_torque_required_pct=_rnd(oge_arr),
            ige_torque_required_pct=_rnd(ige_arr),
            oge_feasible=pa_arr >= oge_arr,
            me_speed_kts=me_spd,
            me_ff_lb_hr=me_ff,
            max_roc_fpm=max_roc,
            leg_direction_deg=round(leg_bearing, 1),
            wind_dir=getattr(wfrom, 'wind_dir', 0),
            wind_speed_kts=getattr(wfrom, 'wind_speed_kts', 0.0),
            spare_pct=getattr(wfrom, 'spare_pct', 0),
            alt_from_ft=wfrom.alt_ft,
            alt_to_ft=wto.alt_ft,
            tas_kts=round(wfrom.airspeed_kts, 1),
            oat_c=round(mid_oat, 1),
            climb_fpm=round(climb_fpm),
        ))

        # Per-waypoint performance at arrival conditions
        trq_arr_raw = torque_tbl.query(wto.alt_ft, wto.oat_c, wto.airspeed_kts, wto.atf, gross_weight)
        q_arr       = torque_tbl.query_q(wto.alt_ft, wto.oat_c, wto.airspeed_kts)
        trq_arr     = trq_arr_raw + q_arr * drag
        ff_arr      = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c, wto.airspeed_kts, trq_arr)

        # ── Hold at destination ────────────────────────────────────────────
        hold_fuel = 0.0
        if wto.hold_type and wto.hold_min > 0:
            hold_time_hr = wto.hold_min / 60.0
            if wto.hold_type in ('ground', 'apu'):
                hold_ff = _GROUND_FF_LB_HR
            elif wto.hold_type == 'hover':
                hold_ff = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c,
                                  getattr(wto, 'hold_speed_kts', 0.0), oge_arr)
            else:   # 'endurance'
                end_spd     = getattr(wto, 'hold_speed_kts', 80.0)
                end_trq_raw = torque_tbl.query(wto.alt_ft, wto.oat_c, end_spd, wto.atf, gross_weight)
                end_q       = torque_tbl.query_q(wto.alt_ft, wto.oat_c, end_spd)
                end_trq     = end_trq_raw + end_q * drag
                hold_ff     = _get_ff(torque_tbl, ff_tbl, wto.alt_ft, wto.oat_c, end_spd, end_trq)
            hold_fuel      = hold_ff * hold_time_hr
            fuel_remaining = max(0.0, fuel_remaining - hold_fuel)
            gross_weight   = empty_weight_lbs + fuel_remaining

        arr_dict = dict(
            name=wto.name, lat=wto.lat, lon=wto.lon, alt_ft=wto.alt_ft,
            gross_weight_lbs=round(gross_weight, 1),
            fuel_remaining_lbs=round(fuel_remaining, 1),
            pa_available_pct=_rnd(pa_arr),
            oge_torque_required_pct=_rnd(oge_arr),
            oge_feasible=pa_arr >= oge_arr,
            ige_torque_required_pct=_rnd(ige_arr),
            cruise_torque_pct=round(trq_arr),
            fuel_flow_lb_hr=round(ff_arr * (1.0 + spare / 100.0)),
            spare_pct=getattr(wto, 'spare_pct', 0),
            tas_kts=round(wto.airspeed_kts, 1),
            oat_c=wto.oat_c,
            max_roc_fpm=0.0,   # updated in next iteration
            cum_dist_nm=round(cum_dist_nm, 1),
            cum_time_min=round(cum_time_min, 1),
            hold_type=wto.hold_type,
            hold_min=wto.hold_min,
            hold_fuel_burned_lbs=round(hold_fuel, 1),
            wind_dir=getattr(wto, 'wind_dir', 0),
            wind_speed_kts=getattr(wto, 'wind_speed_kts', 0.0),
        )
        _add_engine_speeds(arr_dict, gross_weight)
        wpt_results.append(arr_dict)

        if stop_info is not None:
            plan_stop_info = stop_info
            break

    return ([r for r in leg_results if r is not None],
            [w for w in wpt_results if w is not None],
            plan_stop_info)
