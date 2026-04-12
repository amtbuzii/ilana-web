@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  build.bat — Build the Ilana Windows desktop package
REM
REM  Run from the repo root:  ilana-web\build.bat
REM
REM  Prerequisites (one-time setup):
REM    1. Install Python 3.11 64-bit  https://python.org
REM    2. Install Node.js 18+         https://nodejs.org
REM    3. Create and activate a venv:
REM         python -m venv venv
REM         venv\Scripts\activate
REM    Then run this script.
REM ============================================================

echo.
echo  ====================================================
echo   Ilana — Windows Desktop Build
echo  ====================================================
echo.

REM ── Check required tools ─────────────────────────────────────────────────────
where python >nul 2>&1 || (
    echo ERROR: python not found on PATH.
    echo Install Python 3.11 64-bit from https://python.org and try again.
    exit /b 1
)
where npm >nul 2>&1 || (
    echo ERROR: npm not found on PATH.
    echo Install Node.js 18+ from https://nodejs.org and try again.
    exit /b 1
)

REM ── [1/4] Install Python dependencies ────────────────────────────────────────
echo [1/4] Installing Python dependencies...
pip install -r backend\requirements.txt
if errorlevel 1 ( echo ERROR: pip install failed & exit /b 1 )

pip install pyinstaller pyinstaller-hooks-contrib
if errorlevel 1 ( echo ERROR: could not install PyInstaller & exit /b 1 )

REM ── [2/4] Build React frontend ───────────────────────────────────────────────
echo.
echo [2/4] Building React frontend...
cd frontend
call npm install
if errorlevel 1 ( cd .. & echo ERROR: npm install failed & exit /b 1 )
call npm run build
if errorlevel 1 ( cd .. & echo ERROR: npm run build failed & exit /b 1 )
cd ..

if not exist frontend\dist\index.html (
    echo ERROR: Vite build did not produce frontend\dist\index.html
    exit /b 1
)
echo   Frontend built OK.

REM ── [3/4] Run PyInstaller ────────────────────────────────────────────────────
echo.
echo [3/4] Running PyInstaller ^(this may take a few minutes^)...
pyinstaller ilana.spec --noconfirm --clean
if errorlevel 1 ( echo ERROR: PyInstaller failed & exit /b 1 )

if not exist dist\ilana\ilana.exe (
    echo ERROR: dist\ilana\ilana.exe was not produced.
    exit /b 1
)
echo   PyInstaller build OK.

REM ── [4/4] Done ───────────────────────────────────────────────────────────────
echo.
echo  ====================================================
echo   BUILD COMPLETE
echo  ====================================================
echo.
echo  Output folder:  dist\ilana\
echo.
echo  Next steps:
echo    1. Copy your  data\  folder into dist\ilana\
echo       (contains srtm.vrt, dem_tiles\, tiles\, topo_tiles\)
echo    2. Test by running:  dist\ilana\ilana.exe
echo    3. Zip  dist\ilana\  and send to the target machine.
echo       The user just unzips and double-clicks ilana.exe.
echo.

endlocal
