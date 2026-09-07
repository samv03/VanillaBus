#!/usr/bin/env bash
# T10 M1 Electron headless / Xvfb smoke stub.
#
# Proves the desktop process can start against a built tree (engine.hello)
# under Xvfb when a display is missing. Exits 0 with SKIP when:
#   - vcan0 is not UP
#   - neither DISPLAY nor xvfb-run is available
#   - the Electron build output is missing (run npm run build first)
#
# CI example:
#   sudo apt-get install -y xvfb
#   npm run build
#   xvfb-run -a npm run test:smoke:electron
#
# This stub does not drive the Trace UI. The vertical-slice asserts live in
# `npm run test:smoke` (synthetic N2 always; live decode/rate when vcan is UP).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

skip() {
  echo "SKIP electron smoke: $1"
  exit 0
}

vcan0_up() {
  local flags type_path value
  flags="/sys/class/net/vcan0/flags"
  type_path="/sys/class/net/vcan0/type"
  [[ -f "$flags" && -f "$type_path" ]] || return 1
  [[ "$(tr -d '[:space:]' < "$type_path")" == "280" ]] || return 1
  value="$(tr -d '[:space:]' < "$flags")"
  # IFF_UP is bit 0 of the kernel flags word (hex or decimal).
  [[ $((value & 1)) -eq 1 ]]
}

if ! vcan0_up; then
  skip "vcan0 is not UP on this host. Bring it up with: sudo ./scripts/setup-vcan.sh"
fi

if [[ ! -f "$ROOT/out/main/index.js" ]]; then
  skip "built Electron main missing (out/main/index.js). Run npm run build first."
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
  skip "no DISPLAY and no xvfb-run. For CI: sudo apt-get install -y xvfb && xvfb-run -a npm run test:smoke:electron"
fi

ELECTRON_BIN="$ROOT/node_modules/.bin/electron"
if [[ ! -x "$ELECTRON_BIN" ]]; then
  skip "local electron binary missing. Run npm install first."
fi

export VANILLABUS_SMOKE=1
export VANILLABUS_SMOKE_MS="${VANILLABUS_SMOKE_MS:-8000}"
export ELECTRON_DISABLE_SANDBOX=1

run_electron() {
  local -a cmd
  cmd=("$ELECTRON_BIN" . --no-sandbox --disable-gpu)
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM 20 "${cmd[@]}"
  else
    "${cmd[@]}"
  fi
}

echo "M1 Electron smoke: launching built app (VANILLABUS_SMOKE=1, vcan0 UP)"
if [[ "$have_display" -eq 1 ]]; then
  run_electron
else
  # xvfb-run is a new process — inline the electron argv, do not call a function.
  if command -v timeout >/dev/null 2>&1; then
    xvfb-run -a --server-args="-screen 0 1280x720x24" \
      timeout --signal=TERM 20 \
      "$ELECTRON_BIN" . --no-sandbox --disable-gpu
  else
    xvfb-run -a --server-args="-screen 0 1280x720x24" \
      "$ELECTRON_BIN" . --no-sandbox --disable-gpu
  fi
fi

echo "M1 Electron smoke: engine.hello path exited 0"
