# ilana-local.spec — PyInstaller spec for Ilana with network-share auto-copy
#
# This spec builds ilana-local.exe, which automatically copies itself to the
# local drive (%LOCALAPPDATA%\Ilana\) when launched from a network share.
# Use this if you want the app to handle network path issues transparently.
#
# Usage (from repo root, with venv active):
#   pyinstaller ilana-local.spec --noconfirm --clean
#
# For network-agnostic deployment, use ilana.spec instead (runs from network).

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

# ── Collect rasterio (GDAL) support files and native DLLs ────────────────────
rasterio_datas    = collect_data_files("rasterio")
rasterio_binaries = collect_dynamic_libs("rasterio")

# ── Collect pyproj (PROJ) support files ──────────────────────────────────────
pyproj_datas      = collect_data_files("pyproj")
pyproj_binaries   = collect_dynamic_libs("pyproj")

# ── All collected data ────────────────────────────────────────────────────────
all_datas = (
    rasterio_datas
    + pyproj_datas
    + collect_data_files("numpy")
    # React SPA built by Vite → bundled as frontend_dist/ in the package
    + [("frontend/dist",     "frontend_dist")]
    # Small binary performance tables
    + [("backend/data_perf", "data_perf")]
)

a = Analysis(
    ["backend/launcher.py"],
    pathex=[".", "backend"],   # "backend" lets PyInstaller find the app package
    binaries=rasterio_binaries + pyproj_binaries,
    datas=all_datas,
    hiddenimports=[
        # Starlette / FastAPI internals
        "starlette.routing",
        "starlette.middleware",
        "starlette.staticfiles",
        "starlette.responses",
        "starlette.background",
        "fastapi.routing",
        "fastapi.staticfiles",
        "fastapi.responses",
        # uvicorn
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.main",
        # pydantic v2
        "pydantic_core",
        "pydantic.v1",
        # rasterio / GDAL
        "rasterio._shim",
        "rasterio.crs",
        "rasterio.transform",
        "rasterio.windows",
        "rasterio.enums",
        # pyproj
        "pyproj.transformer",
        "pyproj._crs",
        # numpy
        "numpy.core._multiarray_umath",
        "numpy.core._multiarray_tests",
        # Pillow image formats
        "PIL.PngImagePlugin",
        "PIL.JpegImagePlugin",
        # HTTP internals used by uvicorn
        "h11",
        "email.mime.text",
        "email.mime.multipart",
        # App modules
        "app.main",
        "app.parsers",
        "app.models",
        "app.performance",
        "app.drag",
        "app.wca",
    ],
    excludes=[
        "tkinter.test",
        "unittest",
        "xmlrpc",
        "doctest",
        "pdb",
        "distutils",
        "setuptools",
        "pip",
        "matplotlib",
        "scipy",
        "pandas",
        "IPython",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="ilana-local",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX can corrupt GDAL/PROJ DLLs — keep off
    console=False,      # No terminal window
    exclude_binaries=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="ilana-local",
)
