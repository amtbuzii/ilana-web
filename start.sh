#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Setting up backend venv ==="
cd "$ROOT/backend"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
venv/bin/pip install -r requirements.txt -q

echo "=== Installing frontend dependencies ==="
cd "$ROOT/frontend"
npm install --silent

echo ""
echo "=== Starting backend (port 8000) ==="
cd "$ROOT/backend"
venv/bin/uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "=== Starting frontend (port 5173) ==="
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
