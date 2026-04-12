"""
launcher.py — PyInstaller entry point for the Ilana desktop app.

Responsibilities:
  1. Set GDAL_DATA / PROJ_DATA env vars so rasterio and pyproj find their
     support files inside the frozen bundle.
  2. Detect if a previous instance is already running; if so, just open the
     browser and exit (prevents port conflicts on double-click).
  3. Find a free TCP port (default 8000, fallback 8001-8010).
  4. Start the FastAPI/uvicorn server in a background thread.
  5. Wait until the server is accepting connections.
  6. Open the default browser at http://localhost:<port>.
  7. Block the main thread so the process stays alive.
"""

import os
import sys
import socket
import threading
import time
import webbrowser
from pathlib import Path

# ── 1. Locate the bundle support tree ────────────────────────────────────────
# sys._MEIPASS = directory where PyInstaller extracted the bundle contents.
# In development (plain Python), fall back to the launcher's own directory.

_MEIPASS = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))


# ── 2. Set GDAL_DATA and PROJ_DATA before importing rasterio / pyproj ────────

def _find_dir(base: Path, *candidates: str) -> str | None:
    for c in candidates:
        p = base / c
        if p.is_dir():
            return str(p)
    return None


gdal_data = _find_dir(_MEIPASS, "rasterio/gdal_data", "rasterio")
if gdal_data:
    os.environ.setdefault("GDAL_DATA", gdal_data)

proj_data = _find_dir(_MEIPASS, "pyproj/proj_data", "pyproj")
if proj_data:
    os.environ.setdefault("PROJ_DATA", proj_data)
    os.environ.setdefault("PROJ_LIB",  proj_data)  # older GDAL reads PROJ_LIB


# ── 3. Detect already-running instance ───────────────────────────────────────

def _server_running(port: int) -> bool:
    try:
        import urllib.request
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/health", timeout=1
        ) as r:
            return r.status == 200
    except Exception:
        return False


if _server_running(8000):
    webbrowser.open("http://localhost:8000")
    sys.exit(0)


# ── 4. Find a free port (prefer 8000) ────────────────────────────────────────

PORT = 8000
for _p in range(8000, 8011):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _s:
        try:
            _s.bind(("127.0.0.1", _p))
            PORT = _p
            break
        except OSError:
            pass


# ── 5. Start uvicorn in a daemon thread ──────────────────────────────────────
# Import uvicorn and the app *inside* the thread so all os.environ mutations
# above are visible to rasterio/pyproj when they initialise.

def _run_server() -> None:
    import uvicorn
    from app.main import app  # noqa: F401
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="warning",
        access_log=False,
    )


_server_thread = threading.Thread(target=_run_server, daemon=True, name="uvicorn")
_server_thread.start()


# ── 6. Wait for server to be ready ───────────────────────────────────────────

_deadline = time.monotonic() + 30.0
while time.monotonic() < _deadline:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.3):
            break
    except OSError:
        time.sleep(0.2)
else:
    # Server didn't start in time — show error dialog and quit
    try:
        import tkinter as tk
        from tkinter import messagebox
        _root = tk.Tk()
        _root.withdraw()
        messagebox.showerror(
            "Ilana — startup error",
            f"Server did not start on port {PORT} within 30 seconds.\n"
            "Try disabling antivirus / Windows Defender temporarily,\n"
            "or check if another application is blocking port {PORT}.",
        )
    except Exception:
        pass
    sys.exit(1)


# ── 7. Open browser ──────────────────────────────────────────────────────────

webbrowser.open(f"http://localhost:{PORT}")


# ── 8. Keep process alive until user closes it ───────────────────────────────

try:
    _server_thread.join()
except KeyboardInterrupt:
    sys.exit(0)
