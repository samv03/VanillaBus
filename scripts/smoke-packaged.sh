#!/usr/bin/env bash
# Headless engine.hello smoke against a linux-unpacked electron-builder tree.
#
# Does not require vcan — hello is enough to prove the packaged spawn path
# (resources/engine + host python3). Exits 0 with SKIP when artifacts, Python
# deps, or a display/Xvfb are missing.
#
#   npm run dist
#   xvfb-run -a npm run test:smoke:packaged

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

skip() {
  echo "SKIP packaged smoke: $1"
  exit 0
}

BIN="$(find "$ROOT/dist/linux-unpacked" -maxdepth 1 -type f -executable \( -name vanillabus -o -name VanillaBus \) 2>/dev/null | head -n 1 || true)"
if [[ -z "$BIN" || ! -x "$BIN" ]]; then
  skip "linux-unpacked binary missing. Run npm run dist first."
fi

ENGINE="$ROOT/dist/linux-unpacked/resources/engine/can_engine/__main__.py"
if [[ ! -f "$ENGINE" ]]; then
  skip "bundled engine missing at dist/linux-unpacked/resources/engine (extraResources)."
fi

PYTHON_BIN="${VANILLABUS_PYTHON:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1 && [[ ! -x "$PYTHON_BIN" ]]; then
  skip "python3 not found. Packaged VanillaBus uses host Python (see docs/packaging.md)."
fi
if ! "$PYTHON_BIN" -c 'import can, cantools' >/dev/null 2>&1; then
  skip "python-can/cantools missing. Install host deps (docs/packaging.md) then retry."
fi

have_display=0
if [[ -n "${DISPLAY:-}" ]]; then
  have_display=1
fi
have_xvfb=0
if command -v xvfb-run >/dev/null 2>&1; then
  have_xvfb=1
fi
if [[ "$have_display" -eq 0 && "$have_xvfb" -eq 0 ]]; then
  skip "no DISPLAY and no xvfb-run. For CI: sudo apt-get install -y xvfb && xvfb-run -a npm run test:smoke:packaged"
fi

export VANILLABUS_SMOKE=1
export VANILLABUS_SMOKE_MS="${VANILLABUS_SMOKE_MS:-8000}"
export ELECTRON_DISABLE_SANDBOX=1

run_bin() {
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM 25 "$BIN" --no-sandbox --disable-gpu
  else
    "$BIN" --no-sandbox --disable-gpu
  fi
}

echo "Packaged Electron smoke: $BIN (VANILLABUS_SMOKE=1, host $PYTHON_BIN)"
if [[ "$have_display" -eq 1 ]]; then
  run_bin
else
  if command -v timeout >/dev/null 2>&1; then
    xvfb-run -a --server-args="-screen 0 1280x720x24" \
      timeout --signal=TERM 25 \
      "$BIN" --no-sandbox --disable-gpu
  else
    xvfb-run -a --server-args="-screen 0 1280x720x24" \
      "$BIN" --no-sandbox --disable-gpu
  fi
fi

echo "Packaged Electron smoke: engine.hello path exited 0"
