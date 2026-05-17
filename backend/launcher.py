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

All errors are written to ilana.log next to the exe so failures are diagnosable
even when the app runs without a console window.
"""

import os
import sys
import socket
import threading
import time
import webbrowser
import traceback
from pathlib import Path

# ── Log file (next to the exe, or next to this script in dev) ────────────────
_EXE_DIR = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
_LOG_PATH = _EXE_DIR / "ilana.log"

def _log(msg: str) -> None:
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except Exception:
        pass

_log("=== Ilana startup ===")
_log(f"Python {sys.version}")
_log(f"Frozen: {getattr(sys, 'frozen', False)}")
_log(f"Executable: {sys.executable}")

# With console=False on Windows, sys.stdout/stderr are None.
# Redirect them to the log file so any library that writes to them doesn't crash.
if sys.stdout is None:
    sys.stdout = open(_LOG_PATH, "a", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(_LOG_PATH, "a", encoding="utf-8")


# ── 1. Locate the bundle support tree ────────────────────────────────────────
_MEIPASS = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
_log(f"_MEIPASS: {_MEIPASS}")


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
    _log(f"GDAL_DATA: {gdal_data}")
else:
    _log("GDAL_DATA: not found")

proj_data = _find_dir(_MEIPASS, "pyproj/proj_data", "pyproj")
if proj_data:
    os.environ.setdefault("PROJ_DATA", proj_data)
    os.environ.setdefault("PROJ_LIB",  proj_data)
    _log(f"PROJ_DATA: {proj_data}")
else:
    _log("PROJ_DATA: not found")


# ── 3. Windows asyncio event loop fix ────────────────────────────────────────
# uvicorn requires SelectorEventLoop on Windows (ProactorEventLoop is default
# on Python 3.8+ and causes "no running event loop" errors).
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    _log("asyncio: WindowsSelectorEventLoopPolicy set")


# ── 4. Network-share detection: copy app to local drive (ilana-local only) ───
# Windows blocks localhost socket binding for executables run from network shares.
# Two exe variants:
#   • ilana.exe — runs from network share (simple, no setup)
#   • ilana-local.exe — copies to %LOCALAPPDATA%\Ilana\ on first run
# Only ilana-local.exe performs the copy; ilana.exe runs directly from network.

def _is_network_path(path: Path) -> bool:
    s = str(path)
    if s.startswith("\\\\") or s.startswith("//"):
        return True
    if sys.platform == "win32" and len(s) >= 2 and s[1] == ":" and s[2:3] in ("\\", "/"):
        try:
            import ctypes
            DRIVE_REMOTE = 4
            drive_type = ctypes.windll.kernel32.GetDriveTypeW(s[:3])
            return drive_type == DRIVE_REMOTE
        except Exception:
            pass
    return False


def _get_local_app_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "Ilana"


def _app_needs_copy(src_exe: Path, dst_exe: Path) -> bool:
    if not dst_exe.exists():
        return True
    try:
        return abs(src_exe.stat().st_mtime - dst_exe.stat().st_mtime) > 2
    except Exception:
        return True


_exe_stem = Path(sys.executable).stem
_should_copy = _exe_stem == "ilana-local"

if getattr(sys, "frozen", False) and sys.platform == "win32" and _is_network_path(_EXE_DIR) and _should_copy:
    _log(f"Network path detected: {_EXE_DIR} — copying to local drive")

    _local_app = _get_local_app_dir()
    _exe_name  = Path(sys.executable).name
    _local_exe = _local_app / _exe_name
    _src_exe   = Path(sys.executable)

    if _app_needs_copy(_src_exe, _local_exe):
        _log(f"Copying bundle to {_local_app} (excluding data\\)...")

        _copy_win = None
        try:
            import tkinter as _tk
            _copy_win = _tk.Tk()
            _copy_win.title("Ilana — Setup")
            _copy_win.geometry("420x90")
            _copy_win.resizable(False, False)
            _tk.Label(
                _copy_win,
                text="Copying Ilana to local drive for first use…\nThis takes about a minute. Please wait.",
                pady=14, padx=18, justify="left",
            ).pack(anchor="w")
            _copy_win.update()
        except Exception:
            pass

        try:
            import shutil as _shutil
            if _local_app.exists():
                _shutil.rmtree(str(_local_app))
            _shutil.copytree(
                str(_EXE_DIR), str(_local_app),
                ignore=_shutil.ignore_patterns("data"),
            )
            _log("Copy complete")
        except Exception as _e:
            _log(f"Copy failed: {_e}")
        finally:
            if _copy_win:
                try:
                    _copy_win.destroy()
                except Exception:
                    pass
    else:
        _log("Local copy is up to date — skipping copy")

    # Persist the data directory path so the local copy always finds it
    _data_dir = str(_EXE_DIR / "data")
    try:
        (_local_app / "data_path.txt").write_text(_data_dir, encoding="utf-8")
    except Exception as _e:
        _log(f"Could not write data_path.txt: {_e}")

    if _local_exe.exists():
        import subprocess as _subprocess
        _env = os.environ.copy()
        _env["ILANA_DATA_DIR"] = _data_dir
        _log(f"Re-launching {_local_exe} with ILANA_DATA_DIR={_data_dir}")
        _subprocess.Popen(
            [str(_local_exe)], env=_env, cwd=str(_local_app),
            creationflags=0x00000008,  # DETACHED_PROCESS
        )
        sys.exit(0)
    else:
        _log("WARNING: local exe not found after copy — continuing from network (may fail)")
elif getattr(sys, "frozen", False) and sys.platform == "win32" and _is_network_path(_EXE_DIR):
    _log(f"Running from network path: {_EXE_DIR} (use ilana-local.exe to copy to local drive)")


# ── 5. Detect already-running instance ───────────────────────────────────────

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
    _log("Existing instance detected on 8000 — opening browser and exiting")
    webbrowser.open("http://localhost:8000")
    sys.exit(0)


# ── 5. Find a free port (prefer 8000) ────────────────────────────────────────

PORT = 8000
for _p in range(8000, 8011):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _s:
        try:
            _s.bind(("127.0.0.1", _p))
            PORT = _p
            break
        except OSError:
            pass

_log(f"Using port: {PORT}")


# ── 6. Start uvicorn in a daemon thread ──────────────────────────────────────
# Import uvicorn and the app *inside* the thread so all os.environ mutations
# above are visible to rasterio/pyproj when they initialise.
# Any exception is caught and written to the log so the startup timeout
# error message can point the user to ilana.log.

_server_error: list[str] = []   # filled by the thread on failure

def _run_server() -> None:
    try:
        _log("Server thread: importing uvicorn...")
        import uvicorn
        _log("Server thread: importing app...")
        from app.main import app  # noqa: F401
        _log("Server thread: starting uvicorn...")
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=PORT,
            log_config=None,    # disable uvicorn's log formatter (crashes when stdout is None)
            access_log=False,
        )
        _log("Server thread: uvicorn exited normally")
    except Exception:
        err = traceback.format_exc()
        _log(f"Server thread CRASHED:\n{err}")
        _server_error.append(err)


_server_thread = threading.Thread(target=_run_server, daemon=True, name="uvicorn")
_server_thread.start()


# ── 7. Wait for server to be ready ───────────────────────────────────────────

_deadline = time.monotonic() + 30.0
while time.monotonic() < _deadline:
    # If the thread already died with an error, no point waiting
    if _server_error:
        break
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.3):
            _log("Server is ready")
            break
    except OSError:
        time.sleep(0.2)
else:
    _log("Timeout waiting for server")
    err_detail = _server_error[0] if _server_error else "(no error captured — check antivirus / port conflict)"
    try:
        import tkinter as tk
        from tkinter import messagebox
        _root = tk.Tk()
        _root.withdraw()
        messagebox.showerror(
            "Ilana — startup error",
            f"Server did not start on port {PORT}.\n\n"
            f"Check the log for details:\n{_LOG_PATH}\n\n"
            f"Common causes:\n"
            f"• Antivirus blocking the process\n"
            f"• Port {PORT} already in use\n"
            f"• Missing DLL (Visual C++ Redistributable)",
        )
    except Exception:
        pass
    sys.exit(1)


# ── 8. Open browser ──────────────────────────────────────────────────────────

_log(f"Opening browser at http://localhost:{PORT}")
webbrowser.open(f"http://localhost:{PORT}")


# ── 9. Keep process alive until user closes it ───────────────────────────────

try:
    _server_thread.join()
except KeyboardInterrupt:
    _log("Shutdown via KeyboardInterrupt")
    sys.exit(0)
