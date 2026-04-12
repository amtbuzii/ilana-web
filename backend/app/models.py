"""
Pydantic request/response models for the Einat-web flight planning API.

FlightPlanRequest   — client-supplied mission parameters (variant, weight, fuel, waypoints).
FlightPlanResponse  — computed per-leg and per-waypoint performance results.

Variable names (e.g. atf, oat_c, n_bidons) are kept identical to the VB6
source (Sim.frm) to make cross-referencing straightforward.
"""

from pydantic import BaseModel, Field
from typing import Literal, Optional


class WcaThresholds(BaseModel):
    """All three WCA levels are independently configurable and enable/disable-able."""
    # Warnings
    warnings_enabled:            bool  = True
    warn_delta_torque_pct:       float = Field(default=5.0,     ge=0,     le=50)
    warn_cruise_torque_pct:      float = Field(default=100.0,  ge=0,     le=200)
    warn_min_fuel_lbs:           float = Field(default=350.0,  ge=0,     le=6000)
    warn_max_gw_lbs:             float = Field(default=22500.0, ge=10000, le=30000)
    # Cautions — per-condition enable flags
    cautions_enabled:                bool  = True   # kept for API compat; ignored in favour of per-condition flags
    caution_delta_torque_enabled:    bool  = True
    caution_delta_torque_pct:        float = Field(default=10.0,  ge=0, le=20)
    caution_cruise_torque_enabled:   bool  = True
    caution_cruise_torque_pct:       float = Field(default=96.0,  ge=0, le=100)
    caution_terrain_enabled:         bool  = True
    caution_terrain_margin_ft:       float = Field(default=100.0, ge=0, le=2000)
    # Advisories — per-condition enable flags (all disabled by default)
    advisories_enabled:              bool  = False  # kept for API compat
    advisory_delta_torque_enabled:   bool  = False
    advisory_delta_torque_pct:       float = Field(default=15.0,  ge=0, le=20)
    advisory_cruise_torque_enabled:  bool  = False
    advisory_cruise_torque_pct:      float = Field(default=92.0,  ge=0, le=100)
    advisory_fuel_enabled:           bool  = False
    advisory_min_fuel_lbs:           float = Field(default=550.0, ge=0, le=6000)


class WcaAlert(BaseModel):
    level:     Literal['WARNING', 'CAUTION', 'ADVISORY']
    code:      str        # e.g. 'DELTA_TRQ_WARNING'
    wpt_index: int
    wpt_name:  str
    message:   str
    value:     float      # measured value that triggered the alert
    limit:     float      # threshold that was breached


class Waypoint(BaseModel):
    name: str
    lat: float
    lon: float
    alt_ft: float = Field(ge=0, le=20000)
    airspeed_kts: float = Field(ge=0, le=200)
    oat_c: float = Field(ge=-50, le=60)                   # outside air temperature (°C)
    atf: float = Field(default=1.0, ge=0.5, le=1.5)       # aerodynamic trim factor (stores drag multiplier)
    hold_type: Optional[Literal['ground', 'hover', 'endurance', 'apu']] = None
    hold_min: float = Field(default=0.0, ge=0)             # hold duration (minutes)
    hold_speed_kts: float = Field(default=80.0, ge=0, le=200)  # airspeed during endurance hold
    spare_pct: int = Field(default=0, ge=-5, le=40)        # fuel consumption margin (% added to FF)
    wind_dir: int = Field(default=0, ge=0, le=360)         # wind FROM direction, degrees clockwise from north
    wind_speed_kts: float = Field(default=0.0, ge=0, le=200)


class FlightPlanRequest(BaseModel):
    variant: Literal["peten", "LB", "ALPHA"] = "LB"       # aircraft/table variant
    empty_weight_lbs: float = Field(ge=10000, le=25000)
    initial_fuel_lbs: float = Field(ge=0, le=6000)
    etf_eng1: float = Field(default=0.95, ge=0.5, le=1.0) # engine temperature factor, engine 1
    etf_eng2: float = Field(default=0.95, ge=0.5, le=1.0) # engine temperature factor, engine 2
    n_bidons: int = Field(default=0, ge=0, le=4)           # number of external fuel tanks; maps to cDRAGxb (Einat.ini lines 5-8)
    delta_f: Optional[float] = Field(default=None)         # total stores ΔF (sq. ft.) from wing-stores panel; overrides n_bidons drag when provided
    csp_index: Optional[int] = Field(default=None, ge=0)   # Calculation Start Point — waypoint index with known fuel
    csp_fuel: Optional[float] = Field(default=None, ge=0, le=6000)  # fuel on board at CSP (lbs)
    waypoints: list[Waypoint] = Field(min_length=2)
    wca_thresholds: WcaThresholds = Field(default_factory=WcaThresholds)


class LegResult(BaseModel):
    from_name: str
    to_name: str
    distance_nm: float
    leg_time_min: float
    pressure_alt_ft: float
    torque_required_pct: float
    fuel_flow_lb_hr: float
    fuel_burned_lbs: float
    fuel_remaining_lbs: float
    gross_weight_lbs: float
    pa_available_pct: float
    oge_torque_required_pct: float
    oge_feasible: bool
    me_speed_kts: float = 0.0         # max-endurance speed (min torque) at mid-leg
    me_ff_lb_hr: float = 0.0          # fuel flow at max-endurance speed
    max_roc_fpm: float = 0.0          # max rate of climb (ft/min) at mid-leg
    leg_direction_deg: float = 0.0    # initial compass bearing, degrees
    wind_dir: int = 0
    wind_speed_kts: float = 0.0
    ige_torque_required_pct: float = 0.0
    spare_pct: int = 0
    alt_from_ft: float = 0.0
    alt_to_ft: float = 0.0
    tas_kts: float = 0.0
    oat_c: float = 0.0
    climb_fpm: float = 0.0            # actual altitude rate on this leg (ft/min)


class WaypointResult(BaseModel):
    name: str
    lat: float
    lon: float
    alt_ft: float
    gross_weight_lbs: float
    fuel_remaining_lbs: float
    pa_available_pct: float
    oge_torque_required_pct: float
    oge_feasible: bool
    ige_torque_required_pct: float = 0.0
    cruise_torque_pct: float = 0.0    # torque required for cruise (with outbound dxrc correction)
    fuel_flow_lb_hr: float = 0.0
    spare_pct: float = 0.0
    tas_kts: float = 0.0
    oat_c: float = 0.0
    max_roc_fpm: float = 0.0          # altitude rate of the outbound leg (ft/min)
    cum_dist_nm: float = 0.0
    cum_time_min: float = 0.0
    hold_type: Optional[str] = None
    hold_min: float = 0.0
    hold_fuel_burned_lbs: float = 0.0
    wind_dir: int = 0
    wind_speed_kts: float = 0.0
    se_min_speed_kts: Optional[int] = None   # min level-flight speed on one engine (kts); 0 = can hover; None = N/A
    de_min_speed_kts: Optional[int] = None   # min level-flight speed on two engines (kts); 0 = can hover; None = N/A


class StopAlert(BaseModel):
    level:   Literal['WARNING', 'CAUTION']
    code:    str
    message: str
    lat:     float
    lon:     float


class FlightPlanResponse(BaseModel):
    legs: list[LegResult]
    waypoints: list[WaypointResult]
    total_distance_nm: float
    total_time_min: float
    total_fuel_burned_lbs: float
    alerts: list[WcaAlert] = Field(default_factory=list)
    has_warnings: bool = False
    has_active_cautions: bool = False
    has_active_advisories: bool = False
    stop_alert: Optional[StopAlert] = None   # set when calculation was halted mid-leg
