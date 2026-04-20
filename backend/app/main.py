"""
FastAPI backend for the Ilana / Einat-web mission planner.

Endpoints:
  POST /api/calculate           — Full flight plan calculation
  POST /api/csp/fuel-from-oge   — CSP fuel solver (OGE target)
  POST /api/csp/fuel-from-ige   — CSP fuel solver (IGE target)
  GET  /api/data-status         — Offline data availability summary
  GET  /api/data-coverage       — Detailed tile/DEM coverage breakdown
  GET  /api/drag/config         — Available stores, presets, station labels
  POST /api/drag/compute        — Compute ATF from station configuration
  GET  /api/elevation           — Ground elevation at a lat/lon point
  POST /api/terrain-profile     — Elevation profile along a route
  GET  /api/dem-tiles/{z}/{x}/{y}.png — Elevation heatmap tile (generated + cached)
  POST /api/utm-to-latlon       — UTM → WGS84
  POST /api/latlon-to-utm       — WGS84 → UTM
  GET  /health                  — Health check
  /data/*                       — Static file mount: offline tiles + SRTM files
"""

import asyncio
import math as _math
import sys as _sys
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pyproj import Transformer

from .drag import STORES, PRESETS, STATION_LABELS, NO_WEAPONS_DELTA_F, compute_atf
from .models import (FlightPlanRequest, FlightPlanResponse, LegResult, WaypointResult, WcaAlert, StopAlert,
                     SuggestClimbSpeedRequest, SuggestClimbSpeedResponse)
from .wca import evaluate_wca
from .performance import calculate_flight_plan, fuel_from_oge, suggest_climb_speed

# ── App setup ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_prewarm_task())
    yield


app = FastAPI(title="Einat Web API", version="1.0.0", lifespan=lifespan)

import os as _os
_ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"]
_EXTRA = _os.environ.get("ALLOWED_ORIGINS", "")   # comma-separated extra origins from env
if _EXTRA:
    _ALLOWED_ORIGINS += [o.strip() for o in _EXTRA.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── PyInstaller / frozen path resolution ─────────────────────────────────────

def _bundle_root() -> Path:
    """Exe directory when frozen (data/ lives here), project root in dev."""
    if getattr(_sys, "frozen", False):
        # ILANA_DATA_DIR is set by the network-share launcher; data_path.txt
        # is its persisted fallback (survives re-launches without the env var).
        override = _os.environ.get("ILANA_DATA_DIR")
        if not override:
            cfg = Path(_sys.executable).parent / "data_path.txt"
            if cfg.exists():
                try:
                    override = cfg.read_text(encoding="utf-8").strip() or None
                except Exception:
                    pass
        if override:
            return Path(override).parent
        return Path(_sys.executable).parent
    return Path(__file__).parent.parent.parent.parent

def _meipass() -> Path:
    """Unpacked bundle tree when frozen, project root in dev."""
    if getattr(_sys, "frozen", False):
        return Path(_sys._MEIPASS)
    return Path(__file__).parent.parent.parent.parent

# ── Static data directory ─────────────────────────────────────────────────────
# Serves offline map tiles and SRTM elevation files.
# Structure under data/:
#   tiles/              — Carto Voyager PNG tiles  (download_tiles.py)
#   topo_tiles/         — OpenTopoMap PNG tiles    (download_tiles.py --style topo)
#   dem_tiles/          — SRTM3 HGT files, 90m     (download_dem.py)
#   dem_tiles_30m/      — SRTM1 HGT files, 30m     (download_dem.py --resolution 1arc)
#   srtm.vrt            — 90m VRT mosaic
#   srtm30.vrt          — 30m VRT mosaic (if downloaded)
#   dem_tile_cache/     — Generated elevation heatmap PNG tiles

_DATA_ROOT = _bundle_root() / "data"
if _DATA_ROOT.exists():
    app.mount("/data", StaticFiles(directory=str(_DATA_ROOT)), name="data")

# ── Frontend static files (React SPA) ────────────────────────────────────────
# In the frozen bundle, Vite's dist/ is collected into _MEIPASS/frontend_dist/.
# In dev, it lives at frontend/dist/ relative to the repo root.

from fastapi.responses import FileResponse as _FileResponse

def _frontend_dist() -> Path:
    if getattr(_sys, "frozen", False):
        return _meipass() / "frontend_dist"
    return Path(__file__).parent.parent.parent / "frontend" / "dist"

_FRONTEND_DIST = _frontend_dist()
# SPA mount is added at the very BOTTOM of this file (after all API routes)
# so that /api/* and /data/* routes always take priority.


# ── SRTM elevation sources ────────────────────────────────────────────────────
# Two sources are maintained independently. Queries prefer 30m where available
# and fall back to 90m for areas not covered by the 30m dataset.

_srtm_30m_src = None   # rasterio dataset for srtm30.vrt (1 arc-second, ~30m)
_srtm_90m_src = None   # rasterio dataset for srtm.vrt   (3 arc-second, ~90m)


def _open_srtm_30m():
    """Lazily open the 30m SRTM VRT. Returns None if not available."""
    global _srtm_30m_src
    if _srtm_30m_src is None:
        p = _DATA_ROOT / "srtm30.vrt"
        if p.exists():
            try:
                import rasterio
                _srtm_30m_src = rasterio.open(p)
            except Exception:
                pass
    return _srtm_30m_src


def _open_srtm_90m():
    """Lazily open the 90m SRTM VRT (or .tif fallback). Returns None if not available."""
    global _srtm_90m_src
    if _srtm_90m_src is None:
        for p in [_DATA_ROOT / "srtm.vrt", _DATA_ROOT / "srtm.tif"]:
            if p.exists():
                try:
                    import rasterio
                    _srtm_90m_src = rasterio.open(p)
                    break
                except Exception:
                    pass
    return _srtm_90m_src


def _any_srtm():
    """Return True if any SRTM source is available."""
    return _open_srtm_30m() is not None or _open_srtm_90m() is not None


def _read_window(src, lon_min: float, lat_min: float, lon_max: float, lat_max: float, size: int):
    """Read a geographic window from a rasterio source resampled to size×size pixels.

    Returns (data, nodata_mask) where data is a float32 array in metres,
    or (None, None) if the window falls outside coverage or an error occurs.
    """
    try:
        from rasterio.enums import Resampling
        from rasterio.windows import from_bounds
        nd     = src.nodata if src.nodata is not None else -32768
        window = from_bounds(lon_min, lat_min, lon_max, lat_max, src.transform)
        data   = src.read(1, window=window, out_shape=(size, size),
                          resampling=Resampling.bilinear).astype(float)
        nmask  = np.abs(data - nd) < 1   # True where pixel is nodata
        data[nmask] = 0.0
        data[data < 0] = 0.0
        return data, nmask
    except Exception:
        return None, None


def _sample_src(src, lat: float, lon: float):
    """Sample a single point from a rasterio source. Returns metres or None."""
    try:
        from rasterio.transform import rowcol
        from rasterio.windows import Window
        row, col = rowcol(src.transform, lon, lat)
        if 0 <= row < src.height and 0 <= col < src.width:
            v  = float(src.read(1, window=Window(col, row, 1, 1))[0, 0])
            nd = src.nodata if src.nodata is not None else -32768
            if abs(v - nd) >= 1:
                return max(v, 0.0)
    except Exception:
        pass
    return None


def _sample_elev_m(lat: float, lon: float):
    """Return the best available elevation in metres at (lat, lon).

    Prefers 30m data; falls back to 90m for areas not covered.
    Returns None if no SRTM data is loaded.
    """
    src30 = _open_srtm_30m()
    if src30:
        v = _sample_src(src30, lat, lon)
        if v is not None:
            return v
    src90 = _open_srtm_90m()
    if src90:
        return _sample_src(src90, lat, lon)
    return None


def _check_terrain_clearance(wpts_raw: list[dict], margin_ft: float = 100.0,
                             step_km: float = 2.0) -> list[dict]:
    """Sample terrain along each leg and emit a CAUTION if terrain exceeds the
    interpolated flight altitude by more than margin_ft.

    margin_ft absorbs DSM inaccuracy (±90 m ≈ ±295 ft at worst; 100 ft default
    is a reasonable lower bound).  step_km sets sampling density.
    """
    if not _any_srtm() or len(wpts_raw) < 2:
        return []
    from pyproj import Geod
    g = Geod(ellps="WGS84")
    alerts = []
    for i in range(len(wpts_raw) - 1):
        w_from = wpts_raw[i]
        w_to   = wpts_raw[i + 1]
        lat1, lon1, alt1 = float(w_from['lat']), float(w_from['lon']), float(w_from['alt_ft'])
        lat2, lon2, alt2 = float(w_to['lat']),   float(w_to['lon']),   float(w_to['alt_ft'])
        _, _, dist_m = g.inv(lon1, lat1, lon2, lat2)
        n_int = max(2, int(dist_m / 1000.0 / step_km))
        pts = g.npts(lon1, lat1, lon2, lat2, n_int - 1)   # interior points only
        max_breach_ft = 0.0
        for j, (ilon, ilat) in enumerate(pts):
            frac = (j + 1) / n_int
            interp_alt_ft = alt1 + frac * (alt2 - alt1)
            v = _sample_elev_m(ilat, ilon)
            if v is None:
                continue
            terrain_ft = v * 3.28084
            breach = terrain_ft - interp_alt_ft
            if breach > max_breach_ft:
                max_breach_ft = breach
        if max_breach_ft > margin_ft:
            name = w_to.get('name', f'WP{i + 2}')
            alerts.append({
                'level':     'CAUTION',
                'code':      'TERRAIN_CLEARANCE',
                'wpt_index': i + 1,
                'wpt_name':  name,
                'message':   (f'Leg {i + 1}→{i + 2}: terrain may exceed flight path '
                              f'by ≈{round(max_breach_ft)} ft (margin {round(margin_ft)} ft)'),
                'value':     round(max_breach_ft, 1),
                'limit':     round(margin_ft, 1),
            })
    return alerts


# ── Elevation heatmap colormap ─────────────────────────────────────────────────
# Hypsometric tint used to render /api/dem-tiles.
# Each entry: [elevation_m, R, G, B]
_ELEV_STOPS = [
    [-500,  20,  30, 100],   # deep water
    [   0,  35,  90, 190],   # sea level / coast
    [   1,  40, 130,  45],   # lowland
    [ 200,  75, 165,  55],   # plains
    [ 500, 155, 180,  60],   # hills
    [1000, 205, 145,  60],   # uplands
    [1500, 185, 105,  50],   # highlands
    [2000, 155,  75,  55],   # mountains
    [3000, 180, 170, 160],   # high mountains
    [4000, 215, 210, 205],   # alpine
    [5500, 248, 248, 248],   # snow / ice
]


def _elev_to_rgb(data_m: np.ndarray) -> np.ndarray:
    """Convert a 2-D elevation array (metres) to an H×W×3 uint8 RGB image."""
    h, w = data_m.shape
    rgb  = np.zeros((h, w, 3), dtype=np.float32)
    for i in range(len(_ELEV_STOPS) - 1):
        e0, e1 = _ELEV_STOPS[i][0],   _ELEV_STOPS[i + 1][0]
        c0, c1 = _ELEV_STOPS[i][1:],  _ELEV_STOPS[i + 1][1:]
        mask   = (data_m >= e0) & (data_m < e1)
        if not np.any(mask):
            continue
        t = np.clip((data_m[mask] - e0) / (e1 - e0), 0.0, 1.0)
        for ch in range(3):
            rgb[mask, ch] = c0[ch] + t * (c1[ch] - c0[ch])
    top = data_m >= _ELEV_STOPS[-1][0]
    if np.any(top):
        rgb[top] = _ELEV_STOPS[-1][1:]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def _tile_bounds(z: int, x: int, y: int):
    """Convert Web Mercator tile indices to (lon_min, lat_min, lon_max, lat_max)."""
    n       = 2 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = _math.degrees(_math.atan(_math.sinh(_math.pi * (1 - 2 * y / n))))
    lat_min = _math.degrees(_math.atan(_math.sinh(_math.pi * (1 - 2 * (y + 1) / n))))
    return lon_min, lat_min, lon_max, lat_max


def _tile_xy_to_lon(x: int, z: int) -> float:
    return x / 2 ** z * 360.0 - 180.0


def _tile_xy_to_lat(y: int, z: int) -> float:
    n = _math.pi - 2 * _math.pi * y / 2 ** z
    return _math.degrees(_math.atan(_math.sinh(n)))


def _render_dem_tile(z: int, x: int, y: int) -> bytes:
    """Generate one 256×256 RGBA elevation heatmap PNG, merging 30m and 90m data.

    Tiles are cached to data/dem_tile_cache/{z}/{x}/{y}.png on first generation.
    Runs in a thread pool (called via asyncio.to_thread).
    """
    import io
    from PIL import Image

    cache_path = _DATA_ROOT / "dem_tile_cache" / str(z) / str(x) / f"{y}.png"
    if cache_path.exists():
        return cache_path.read_bytes()

    src30 = _open_srtm_30m()
    src90 = _open_srtm_90m()
    if src30 is None and src90 is None:
        raise RuntimeError("SRTM not available")

    lon_min, lat_min, lon_max, lat_max = _tile_bounds(z, x, y)
    SIZE   = 256
    data, nodata_mask = None, None

    # Read 30m data first
    if src30:
        data, nodata_mask = _read_window(src30, lon_min, lat_min, lon_max, lat_max, SIZE)

    # Fill gaps with 90m where 30m has nodata or is unavailable
    if src90 and (data is None or np.any(nodata_mask)):
        data90, nm90 = _read_window(src90, lon_min, lat_min, lon_max, lat_max, SIZE)
        if data90 is not None:
            if data is None:
                data, nodata_mask = data90, nm90
            else:
                fill = nodata_mask & ~nm90
                data[fill]  = data90[fill]
                nodata_mask = nodata_mask & nm90

    if data is None:
        # Tile is entirely outside coverage — return transparent PNG
        buf = io.BytesIO()
        Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)).save(buf, format="PNG")
        return buf.getvalue()

    rgb  = _elev_to_rgb(data)
    alpha = np.where(nodata_mask, 0, 215).astype(np.uint8)
    rgba  = np.dstack([rgb, alpha])

    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    png_bytes = buf.getvalue()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(png_bytes)
    return png_bytes


# ── Startup: pre-warm DEM tile cache ─────────────────────────────────────────

async def _prewarm_task():
    """Generate all zoom 0–8 DEM tiles for the covered region (UTM zones 34–40).

    Runs in the background after server start; roughly 350 tiles, < 60 s.
    Subsequent map renders at low zoom are instant because the cache is warm.
    """
    if not _any_srtm():
        return
    LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 17.0, 61.0, 7.0, 62.0
    for z in range(9):
        n     = 2 ** z
        x_min = int((LON_MIN + 180) / 360 * n)
        x_max = int((LON_MAX + 180) / 360 * n)
        y_min = int((1 - _math.log(_math.tan(_math.radians(LAT_MAX)) + 1 / _math.cos(_math.radians(LAT_MAX))) / _math.pi) / 2 * n)
        y_max = int((1 - _math.log(_math.tan(_math.radians(LAT_MIN)) + 1 / _math.cos(_math.radians(LAT_MIN))) / _math.pi) / 2 * n)
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                cache_path = _DATA_ROOT / "dem_tile_cache" / str(z) / str(x) / f"{y}.png"
                if not cache_path.exists():
                    try:
                        await asyncio.to_thread(_render_dem_tile, z, x, y)
                    except Exception:
                        pass
                await asyncio.sleep(0)   # yield to event loop after each tile


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Flight planning ───────────────────────────────────────────────────────────

@app.post("/api/calculate", response_model=FlightPlanResponse)
def calculate(req: FlightPlanRequest):
    """Run a full flight plan calculation and return per-leg and per-waypoint results."""
    if len(req.waypoints) < 2:
        raise HTTPException(400, "At least 2 waypoints required")
    try:
        acft_etf = (req.etf_eng1 + req.etf_eng2) / 2.0
        legs_raw, wpts_raw, stop_info = calculate_flight_plan(
            variant=req.variant,
            empty_weight_lbs=req.empty_weight_lbs,
            initial_fuel_lbs=req.initial_fuel_lbs,
            waypoints=req.waypoints,
            acft_etf=acft_etf,
            n_bidons=req.n_bidons,
            delta_f=req.delta_f,
            csp_index=req.csp_index,
            csp_fuel=req.csp_fuel,
            thresholds=req.wca_thresholds,
        )
    except Exception as e:
        raise HTTPException(500, f"Calculation error: {e}")

    legs = [LegResult(**l) for l in legs_raw]
    wpts = [WaypointResult(**w) for w in wpts_raw]

    thr         = req.wca_thresholds
    alert_dicts = evaluate_wca(wpts_raw, thr)
    if thr is None or thr.caution_terrain_enabled:
        margin = thr.caution_terrain_margin_ft if thr is not None else 100.0
        alert_dicts = alert_dicts + _check_terrain_clearance(wpts_raw, margin_ft=margin)
    stop_alert  = StopAlert(**stop_info) if stop_info else None

    alerts = [WcaAlert(**a) for a in alert_dicts]

    return FlightPlanResponse(
        legs=legs,
        waypoints=wpts,
        total_distance_nm=round(sum(l.distance_nm for l in legs), 2),
        total_time_min=round(sum(l.leg_time_min for l in legs), 1),
        total_fuel_burned_lbs=round(sum(l.fuel_burned_lbs for l in legs), 1),
        alerts=alerts,
        has_warnings=stop_alert is not None and stop_alert.level == 'WARNING',
        has_active_cautions=stop_alert is not None and stop_alert.level == 'CAUTION',
        has_active_advisories=any(a.level == 'ADVISORY' for a in alerts),
        stop_alert=stop_alert,
    )


@app.post("/api/csp/fuel-from-oge")
def csp_fuel_from_oge_endpoint(body: dict):
    """Return the fuel load (lbs) that produces the requested OGE torque % at the given conditions."""
    from .parsers import load_tables
    try:
        variant    = str(body.get("variant", "LB"))
        alt_ft     = float(body["alt_ft"])
        oat_c      = float(body["oat_c"])
        empty_wt   = float(body["empty_weight_lbs"])
        target_oge = float(body["target_oge_pct"])
        n_bidons   = int(body.get("n_bidons", 2))
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"Bad request: {e}")
    _, _, _, oge_tbl = load_tables(variant)
    fuel = fuel_from_oge(oge_tbl, alt_ft, oat_c, empty_wt, target_oge, n_bidons)
    if fuel is None:
        raise HTTPException(400, "OGE target outside computable GW range (14 000–21 000 lb)")
    return {"fuel_lbs": fuel}


@app.post("/api/csp/fuel-from-ige")
def csp_fuel_from_ige_endpoint(body: dict):
    """Return the fuel load (lbs) that produces the requested IGE torque %.

    Relationship: IGE = 0.82 · OGE + 0.82  →  OGE = (IGE − 0.82) / 0.82
    """
    from .parsers import load_tables
    try:
        variant    = str(body.get("variant", "LB"))
        alt_ft     = float(body["alt_ft"])
        oat_c      = float(body["oat_c"])
        empty_wt   = float(body["empty_weight_lbs"])
        target_ige = float(body["target_ige_pct"])
        n_bidons   = int(body.get("n_bidons", 2))
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"Bad request: {e}")
    target_oge = (target_ige - 0.82) / 0.82
    _, _, _, oge_tbl = load_tables(variant)
    fuel = fuel_from_oge(oge_tbl, alt_ft, oat_c, empty_wt, target_oge, n_bidons)
    if fuel is None:
        raise HTTPException(400, "IGE target outside computable GW range (14 000–21 000 lb)")
    return {"fuel_lbs": fuel}


@app.post("/api/suggest-climb-speed", response_model=SuggestClimbSpeedResponse)
def suggest_climb_speed_endpoint(req: SuggestClimbSpeedRequest):
    """Find the maximum TAS ≤ 120 kts that allows a failed climb/level leg to pass WCA checks."""
    try:
        acft_etf = (req.etf_eng1 + req.etf_eng2) / 2.0
        found, best_tas = suggest_climb_speed(
            variant=req.variant,
            empty_weight_lbs=req.empty_weight_lbs,
            fuel_at_departure_lbs=req.fuel_at_departure_lbs,
            wfrom=req.wfrom,
            wto=req.wto,
            acft_etf=acft_etf,
            n_bidons=req.n_bidons,
            delta_f=req.delta_f,
            thresholds=req.wca_thresholds,
        )
    except Exception as e:
        raise HTTPException(500, f"Suggestion error: {e}")

    original_kts = int(round(req.wfrom.airspeed_kts))
    if found and best_tas is not None:
        msg = f"Max speed for this leg: {best_tas} kts (original: {original_kts} kts)"
    else:
        msg = f"No feasible speed found — even 40 kts exceeds torque limits at this leg."

    return SuggestClimbSpeedResponse(
        found=found,
        suggested_tas_kts=best_tas if found else None,
        original_tas_kts=req.wfrom.airspeed_kts,
        message=msg,
    )


# ── Offline data status ───────────────────────────────────────────────────────

@app.get("/api/data-status")
def data_status():
    """Return a summary of which offline datasets are present and their coverage."""
    tiles_dir = _DATA_ROOT / "tiles"
    tiles_ok  = tiles_dir.exists() and any(tiles_dir.rglob("*.png"))

    topo_dir  = _DATA_ROOT / "topo_tiles"
    topo_ok   = topo_dir.exists() and any(topo_dir.rglob("*.png"))

    srtm_ok  = _any_srtm()
    srtm_res = "30 m" if _open_srtm_30m() else ("90 m" if _open_srtm_90m() else None)

    def dir_mb(d):
        try:
            return round(sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) / 1024 / 1024)
        except Exception:
            return None

    tile_count  = sum(1 for _ in tiles_dir.rglob("*.png")) if tiles_ok else 0
    mb_tiles    = dir_mb(tiles_dir) if tiles_ok else None
    topo_count  = sum(1 for _ in topo_dir.rglob("*.png")) if topo_ok else 0
    mb_topo     = dir_mb(topo_dir) if topo_ok else None

    # Derive map tile geographic bounds from the highest-zoom directory present
    map_bounds = None
    if tiles_ok:
        zoom_dirs = sorted(
            (int(d.name) for d in tiles_dir.iterdir() if d.is_dir() and d.name.isdigit()),
            reverse=True,
        )
        if zoom_dirs:
            z     = zoom_dirs[0]
            z_dir = tiles_dir / str(z)
            xs    = [int(d.name) for d in z_dir.iterdir() if d.is_dir() and d.name.isdigit()]
            if xs:
                ys = [int(f.stem) for x in xs
                      for f in (z_dir / str(x)).glob("*.png") if f.stem.isdigit()]
                if ys:
                    map_bounds = {
                        "zoom_min": zoom_dirs[-1], "zoom_max": z,
                        "lon_min": _tile_xy_to_lon(min(xs),     z),
                        "lon_max": _tile_xy_to_lon(max(xs) + 1, z),
                        "lat_min": _tile_xy_to_lat(max(ys) + 1, z),
                        "lat_max": _tile_xy_to_lat(min(ys),     z),
                    }
                    map_bounds = {k: round(v, 1) if isinstance(v, float) else v
                                  for k, v in map_bounds.items()}

    # Derive topo tile geographic bounds
    topo_bounds = None
    if topo_ok:
        zoom_dirs_t = sorted(
            (int(d.name) for d in topo_dir.iterdir() if d.is_dir() and d.name.isdigit()),
            reverse=True,
        )
        if zoom_dirs_t:
            z     = zoom_dirs_t[0]
            z_dir = topo_dir / str(z)
            xs    = [int(d.name) for d in z_dir.iterdir() if d.is_dir() and d.name.isdigit()]
            if xs:
                ys = [int(f.stem) for x in xs
                      for f in (z_dir / str(x)).glob("*.png") if f.stem.isdigit()]
                if ys:
                    topo_bounds = {
                        "zoom_min": zoom_dirs_t[-1], "zoom_max": z,
                        "lon_min": _tile_xy_to_lon(min(xs),     z),
                        "lon_max": _tile_xy_to_lon(max(xs) + 1, z),
                        "lat_min": _tile_xy_to_lat(max(ys) + 1, z),
                        "lat_max": _tile_xy_to_lat(min(ys),     z),
                    }
                    topo_bounds = {k: round(v, 1) if isinstance(v, float) else v
                                   for k, v in topo_bounds.items()}

    # Derive DEM bounds from HGT filenames
    dem_dir   = _DATA_ROOT / "dem_tiles"
    dem_count = 0
    dem_bounds = None
    if dem_dir.exists():
        lats, lons = [], []
        for f in dem_dir.glob("*.hgt"):
            n = f.stem.upper()
            try:
                lats.append(int(n[1:3]) * (1 if n[0] == "N" else -1))
                lons.append(int(n[4:7]) * (1 if n[3] == "E" else -1))
            except (ValueError, IndexError):
                pass
        dem_count = len(lats)
        if lats:
            dem_bounds = {
                "lat_min": min(lats), "lat_max": max(lats) + 1,
                "lon_min": min(lons), "lon_max": max(lons) + 1,
            }

    # DEM size: sum both 90m and 30m directories
    dem_size_mb = (dir_mb(_DATA_ROOT / "dem_tiles") or 0) + (dir_mb(_DATA_ROOT / "dem_tiles_30m") or 0) or None

    return {
        "map_tiles": {
            "available":  tiles_ok,
            "tile_count": tile_count if tiles_ok else None,
            "size_mb":    mb_tiles,
            "bounds":     map_bounds,
        },
        "topo_tiles": {
            "available":  topo_ok,
            "tile_count": topo_count if topo_ok else None,
            "size_mb":    mb_topo,
            "bounds":     topo_bounds,
        },
        "elevation": {
            "available":  srtm_ok,
            "tile_count": dem_count or None,
            "resolution": srtm_res,
            "size_mb":    dem_size_mb,
            "bounds":     dem_bounds,
        },
    }


@app.get("/api/data-coverage")
def data_coverage():
    """Return detailed coverage: per-zoom tile counts for maps, tile list for DEM."""
    tiles_dir = _DATA_ROOT / "tiles"
    dem_dir   = _DATA_ROOT / "dem_tiles"

    zoom_stats = {}
    if tiles_dir.exists():
        for z_dir in sorted(tiles_dir.iterdir()):
            if not z_dir.is_dir() or not z_dir.name.isdigit():
                continue
            z   = int(z_dir.name)
            xs  = [int(x.name) for x in z_dir.iterdir() if x.is_dir() and x.name.isdigit()]
            if not xs:
                continue
            ys  = [int(f.stem) for x_dir in z_dir.iterdir() if x_dir.is_dir()
                   for f in x_dir.glob("*.png") if f.stem.isdigit()]
            zoom_stats[z] = {
                "tiles":   len(list(z_dir.rglob("*.png"))),
                "lon_min": round(_tile_xy_to_lon(min(xs),     z), 2),
                "lon_max": round(_tile_xy_to_lon(max(xs) + 1, z), 2),
                "lat_min": round(_tile_xy_to_lat(max(ys) + 1, z), 2) if ys else None,
                "lat_max": round(_tile_xy_to_lat(min(ys),     z), 2) if ys else None,
            }

    dem_tiles = []
    if dem_dir.exists():
        for f in sorted(dem_dir.glob("*.hgt")):
            name = f.stem.upper()
            try:
                lat = int(name[1:3]) * (1 if name[0] == "N" else -1)
                lon = int(name[4:7]) * (1 if name[3] == "E" else -1)
                dem_tiles.append({"name": name, "lat": lat, "lon": lon,
                                   "size_kb": round(f.stat().st_size / 1024)})
            except (ValueError, IndexError):
                pass
        dem_tiles.sort(key=lambda t: (-t["lat"], t["lon"]))

    return {"zoom_stats": zoom_stats, "dem_tiles": dem_tiles}


# ── Wing stores / drag ────────────────────────────────────────────────────────

@app.get("/api/drag/config")
def drag_config():
    """Return available stores, presets, and station labels for the drag UI."""
    return {
        "station_labels":      STATION_LABELS,
        "no_weapons_delta_f":  NO_WEAPONS_DELTA_F,
        "stores": [
            {"id": s.id, "label": s.label, "pylon_types": list(s.pylon_types)}
            for s in STORES.values()
        ],
        "presets": PRESETS,
    }


@app.post("/api/drag/compute")
def drag_compute(body: dict):
    """Compute total ΔF and ATF multiplier from a 4-station store configuration."""
    stations = body.get("stations", {})
    required = {"l_inboard", "r_inboard", "l_outboard", "r_outboard"}
    missing  = required - set(stations.keys())
    if missing:
        raise HTTPException(400, f"Missing stations: {missing}")
    delta_f, atf = compute_atf(stations)
    return {"delta_f": delta_f, "atf": atf}


# ── Elevation queries ─────────────────────────────────────────────────────────

@app.get("/api/elevation")
async def elevation(lat: float, lon: float):
    """Return ground elevation in feet at a lat/lon point.

    Uses 30m data where available, falls back to 90m elsewhere.
    Returns elevation_ft=0 if outside coverage.
    """
    v = _sample_elev_m(lat, lon)
    if v is not None:
        elev_ft = round(v * 3.28084)
        return {"elevation_ft": elev_ft, "default_alt_ft": elev_ft + 1000}
    if not _any_srtm():
        return {"elevation_ft": 0, "default_alt_ft": 1000, "warning": "SRTM file not found"}
    return {"elevation_ft": 0, "default_alt_ft": 1000}


@app.post("/api/terrain-profile")
async def terrain_profile(body: dict):
    """Return a sampled elevation profile along a multi-leg route.

    Body: { waypoints: [{lat, lon}, ...], step_km: float }
    Response: { points: [{lat, lon, dist_nm, elev_ft, missing}, ...] }

    Points are sampled every step_km km (clamped to 0.5–50 km).
    Elevation uses 30m data where available, 90m elsewhere.
    """
    from pyproj import Geod
    waypoints = body.get("waypoints", [])
    step_km   = max(0.5, min(50.0, float(body.get("step_km", 1.0))))
    if len(waypoints) < 2:
        return {"points": []}

    def _compute():
        g      = Geod(ellps="WGS84")
        sample_pts: list[tuple[float, float, float]] = []   # (lat, lon, cum_dist_nm)
        cum_nm = 0.0

        for i in range(len(waypoints) - 1):
            lat1 = float(waypoints[i]["lat"]);   lon1 = float(waypoints[i]["lon"])
            lat2 = float(waypoints[i+1]["lat"]); lon2 = float(waypoints[i+1]["lon"])
            _, _, dist_m = g.inv(lon1, lat1, lon2, lat2)
            seg_nm = abs(dist_m) / 1852.0
            n_int  = max(1, int(abs(dist_m) / 1000.0 / step_km))

            if i == 0:
                sample_pts.append((lat1, lon1, 0.0))
            if n_int > 1:
                for j, (ilon, ilat) in enumerate(g.npts(lon1, lat1, lon2, lat2, n_int - 1)):
                    sample_pts.append((ilat, ilon, cum_nm + (j + 1) / n_int * seg_nm))
            cum_nm += seg_nm
            sample_pts.append((lat2, lon2, cum_nm))

        # Deduplicate adjacent identical points
        deduped = [sample_pts[0]]
        for pt in sample_pts[1:]:
            if pt[:2] != deduped[-1][:2]:
                deduped.append(pt)

        points = []
        for lat, lon, d in deduped:
            v = _sample_elev_m(lat, lon)
            points.append({
                "lat":     round(lat, 6),
                "lon":     round(lon, 6),
                "dist_nm": round(d, 3),
                "elev_ft": round(v * 3.28084) if v is not None else 0,
                "missing": v is None,
            })
        return points

    points = await asyncio.to_thread(_compute)
    return {"points": points}


@app.get("/api/dem-tiles/{z}/{x}/{y}.png")
async def dem_tile(z: int, x: int, y: int):
    """Serve an elevation heatmap tile as a 256×256 RGBA PNG.

    Tiles are generated on demand (merging 30m + 90m SRTM) and cached to disk.
    Generation runs in a thread pool to avoid blocking the async event loop.
    """
    cache_path = _DATA_ROOT / "dem_tile_cache" / str(z) / str(x) / f"{y}.png"
    if cache_path.exists():
        return Response(content=cache_path.read_bytes(), media_type="image/png")
    if not _any_srtm():
        raise HTTPException(404, "SRTM not available")
    try:
        png_bytes = await asyncio.to_thread(_render_dem_tile, z, x, y)
    except RuntimeError as e:
        raise HTTPException(404, str(e))
    return Response(content=png_bytes, media_type="image/png")


# ── Coordinate conversion ─────────────────────────────────────────────────────

@app.post("/api/utm-to-latlon")
def utm_to_latlon(body: dict):
    """Convert UTM easting/northing to WGS84 lat/lon. Default zone: 36N."""
    try:
        zone     = int(body.get("zone", 36))
        easting  = float(body["easting"])
        northing = float(body["northing"])
        hemi     = body.get("hemisphere", "N")
        epsg     = 32600 + zone if hemi == "N" else 32700 + zone
        lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform(easting, northing)
        return {"lat": round(lat, 6), "lon": round(lon, 6)}
    except Exception as e:
        raise HTTPException(400, f"Conversion error: {e}")


@app.post("/api/latlon-to-utm")
def latlon_to_utm(body: dict):
    """Convert WGS84 lat/lon to UTM. Zone is auto-detected from longitude unless overridden."""
    try:
        lat  = float(body["lat"])
        lon  = float(body["lon"])
        zone = int(body["zone"]) if "zone" in body else int((lon + 180) / 6) + 1
        hemi = "N" if lat >= 0 else "S"
        epsg = 32600 + zone if hemi == "N" else 32700 + zone
        easting, northing = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform(lon, lat)
        return {"zone": zone, "hemisphere": hemi,
                "easting": round(easting, 1), "northing": round(northing, 1)}
    except Exception as e:
        raise HTTPException(400, f"Conversion error: {e}")

# ── SPA static mount (must be last — catches everything not matched above) ────
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="spa")
