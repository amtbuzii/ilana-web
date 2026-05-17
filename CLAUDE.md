# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ILANA is an AH-64D Apache helicopter mission planner — a web reimplementation of the Einat VB6 desktop tool. It calculates flight performance (fuel burn, torque, PA, OGE/IGE feasibility) across waypoints and renders interactive maps with offline terrain/elevation data.

## Development Commands

### Start both servers (recommended)
```bash
./start.sh          # Linux/Mac: creates venv, installs deps, starts backend (port 8000) + frontend (port 5173)
build.bat           # Windows equivalent
```

### Backend only
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### Frontend only
```bash
cd frontend
npm install
npm run dev         # http://localhost:5173 (proxies /api → localhost:8000)
npm run build       # production build to frontend/dist/
```

### Tests
```bash
cd backend && source venv/bin/activate && pytest tests/test_scenarios.py -v
# Run single test:
pytest tests/test_scenarios.py::test_einat1_saraf_lb_2bidons -v
```

## Architecture

### Data Flow
1. User edits waypoints/aircraft config in React frontend
2. Frontend POSTs to `/api/calculate` with full flight plan
3. Backend simulates flight leg-by-leg (5-second timesteps), interpolating from binary performance tables
4. Backend returns per-leg and per-waypoint results (fuel, torque, PA, OGE/IGE)
5. Frontend renders interactive Leaflet map + results table

### Frontend (`frontend/src/`)
- **`App.jsx`** — Root state: multi-route array, active route, waypoints, results. LocalStorage persistence under key `raner_x_v3`. Route colors from `ROUTE_COLORS`.
- **`api.js`** — Thin wrappers for all REST endpoints
- **`theme.jsx`** — Dark/light theme context (green military CRT vs blue modern); persisted in localStorage
- **`components/MapView.jsx`** — Leaflet map with offline tiles (Carto/Topo/ELEV), numbered markers, route polyline, leg arrows, background routes for non-active routes
- **`components/WaypointPanel.jsx`** — Waypoint list with UTM↔lat/lon conversion
- **`components/RoutePanel.jsx`** — Multi-route management, per-route aircraft variant (LB/Peten/ALPHA), weight, fuel, stores
- **`components/ResultsTable.jsx`** — Per-waypoint/leg results with terrain profile chart
- **`components/WingStoresPanel.jsx`** — 4-station drag config (L/R inboard/outboard) + ATF multiplier

### Backend (`backend/app/`)
- **`main.py`** — All FastAPI endpoints, DEM tile generation/caching, SPA fallback, startup lifespan (load perf tables, open SRTM VRT, pre-warm DEM cache zoom 0–8)
- **`performance.py`** — Simulation engine: leg-by-leg torque/FF lookup, drag correction (`rcfnc`), fuel burn accumulation
- **`parsers.py`** — Binary VB6 Variant format table readers; bilinear interpolation (`OgFnc` equivalent)
- **`models.py`** — Pydantic request/response schemas
- **`drag.py`** — Wing store presets and ATF drag multiplier computation
- **`wca.py`** — Warning/Caution/Advisory alert generation

### Key API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/calculate` | Full flight plan simulation |
| POST | `/api/csp/fuel-from-oge`, `/csp/fuel-from-ige` | Fuel solvers |
| GET | `/api/elevation` | Ground elevation at lat/lon |
| POST | `/api/terrain-profile` | Elevation samples along route |
| GET | `/api/dem-tiles/{z}/{x}/{y}.png` | Hypsometric heatmap tiles (generated + cached) |
| POST | `/api/utm-to-latlon`, `/api/latlon-to-utm` | Coordinate conversion |

### External Data (outside repo, at `../data/`)
- `tiles/` — Carto Voyager PNG tiles (zoom 0–11)
- `topo_tiles/` — OpenTopoMap PNG tiles (zoom 0–14)
- `dem_tiles/` — SRTM HGT files (90m resolution)
- `dem_tile_cache/` — Auto-generated elevation heatmap PNGs (cached on demand)
- `srtm.vrt` — GDAL VRT mosaic of DEM tiles
- `data_perf/` — Binary performance tables bundled into `backend/` (oge, pa, cruise, cruiseLB, paLB, paALPHA, ffALPHA, atf)

## Critical Design Constraints

**VB6 fidelity is the primary correctness requirement.** `performance.py` and `parsers.py` are faithful ports of the Einat VB6 binary — any changes to the simulation engine must pass the regression tests in `tests/test_scenarios.py` within ±3 lb tolerance on GW/fuel (VB6 Single vs Python Double precision). Torque, FF, OGE/IGE, and PA must match exactly.

**Offline-first.** All map tiles and elevation data are pre-downloaded. The app is designed for field use without internet. Do not introduce dependencies on external tile CDNs or APIs in the core map view.

**PyInstaller compatibility.** `main.py` and path resolution code must remain compatible with both dev (relative paths) and frozen (PyInstaller `sys._MEIPASS`) layouts.

## Deployment

### Desktop Executables
Build with PyInstaller from repo root (`venv` active):
```bash
pyinstaller ilana.spec --noconfirm --clean       # Builds ilana.exe
pyinstaller ilana-local.spec --noconfirm --clean # Builds ilana-local.exe
```

Two variants are available for different deployment scenarios:

| Executable | Behavior | Best For |
|-----------|----------|----------|
| **`ilana.exe`** | Runs directly from network share | Network installs; simple, no setup |
| **`ilana-local.exe`** | Auto-copies to `%LOCALAPPDATA%\Ilana\` on first run from network | Slow/unreliable networks; field deployments |

Both variants:
- Keep the 20 GB `data/` folder on the network share (symlink or referenced via `data_path.txt`)
- Run the same backend/frontend code
- Detect data location via `ILANA_DATA_DIR` env var or `data_path.txt` in the exe directory

Output: `dist/ilana/` and `dist/ilana-local/` — copy your `data/` folder into each, then zip and ship.

### Cloud
- **Render.com**: `render.yaml` defines backend service; set `ALLOWED_ORIGINS` env var for CORS

### Frontend
- Standard SPA; backend serves `frontend/dist/index.html` as fallback for unmatched routes
