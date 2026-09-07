#!/usr/bin/env bash
# Offline assert: package.json + lockfile (+ installed tree) stay on Electron 37.x.
# Do not run `npm audit fix --force` — it can major-bump Electron on a host.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Policy pin for this repo. Bump only with an intentional Electron line change.
EXPECTED_MAJOR=37

extract_major() {
  local s="$1"
  if [[ "$s" =~ ([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    printf '\n'
  fi
}

json_get() {
  node -p "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is required to read package.json / package-lock.json"
  exit 1
fi

spec="$(json_get "require('./package.json').devDependencies.electron")"
lock_spec="$(json_get "require('./package-lock.json').packages[''].devDependencies.electron")"
lock_ver="$(json_get "require('./package-lock.json').packages['node_modules/electron'].version")"

spec_major="$(extract_major "$spec")"
lock_spec_major="$(extract_major "$lock_spec")"
lock_ver_major="$(extract_major "$lock_ver")"

echo "Electron pin check (offline)"
echo "  package.json        ${spec}"
echo "  lockfile declared   ${lock_spec}"
echo "  lockfile resolved   ${lock_ver}"

fail=0

if [[ -z "$spec" || "$spec" == "undefined" ]]; then
  echo "FAIL: package.json is missing devDependencies.electron"
  fail=1
fi
if [[ "$spec_major" != "$EXPECTED_MAJOR" ]]; then
  echo "FAIL: package.json electron major is ${spec_major:-missing}, expected ${EXPECTED_MAJOR}.x"
  fail=1
fi
if [[ "$lock_spec" != "$spec" ]]; then
  echo "FAIL: package.json (${spec}) and lockfile declared (${lock_spec}) disagree"
  fail=1
fi
if [[ "$lock_spec_major" != "$EXPECTED_MAJOR" ]]; then
  echo "FAIL: lockfile declared electron major is ${lock_spec_major:-missing}, expected ${EXPECTED_MAJOR}.x"
  fail=1
fi
if [[ "$lock_ver_major" != "$EXPECTED_MAJOR" ]]; then
  echo "FAIL: lockfile resolved electron is ${lock_ver}, expected ${EXPECTED_MAJOR}.x"
  fail=1
fi

if [[ -f node_modules/electron/package.json ]]; then
  installed="$(json_get "require('./node_modules/electron/package.json').version")"
  installed_major="$(extract_major "$installed")"
  echo "  node_modules        ${installed}"
  if [[ "$installed_major" != "$EXPECTED_MAJOR" ]]; then
    echo "FAIL: installed electron is ${installed}, expected ${EXPECTED_MAJOR}.x"
    echo "Host is polluted (often by npm audit fix --force). Recover:"
    echo "  rm -rf node_modules"
    echo "  npm ci"
    echo "  npx electron --version   # expect v${EXPECTED_MAJOR}.x"
    echo "  npm ls electron"
    fail=1
  elif [[ "$installed" != "$lock_ver" ]]; then
    echo "FAIL: installed ${installed} != lockfile ${lock_ver}"
    echo "Recover: rm -rf node_modules && npm ci"
    fail=1
  fi
else
  echo "  node_modules        not installed (skipped)"
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "PASS: Electron ${EXPECTED_MAJOR}.x pin is consistent"
