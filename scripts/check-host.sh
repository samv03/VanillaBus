#!/usr/bin/env bash
# Report whether this machine looks ready for VanillaBus development.
# T1 does not open a CAN bus; this is a host inventory helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ok=0
warn=0

note() {
  printf '  %-18s %s\n' "$1" "$2"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

echo "VanillaBus host check"
echo

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  note "os" "${PRETTY_NAME:-unknown}"
  case "${ID:-}-${VERSION_ID:-}" in
    ubuntu-22.04|ubuntu-24.04) ;;
    ubuntu-*)
      echo "  warning: Ubuntu 22.04/24.04 is the documented target"
      warn=1
      ;;
    *)
      echo "  warning: VanillaBus is documented for Ubuntu 22.04/24.04"
      warn=1
      ;;
  esac
else
  note "os" "unknown"
  warn=1
fi

if have node; then
  note "node" "$(node -v)"
else
  note "node" "MISSING"
  ok=1
fi

if have npm; then
  note "npm" "$(npm -v)"
else
  note "npm" "MISSING"
  ok=1
fi

if have python3; then
  note "python3" "$(python3 --version 2>&1)"
else
  note "python3" "MISSING"
  ok=1
fi

if have pip3 || python3 -m pip --version >/dev/null 2>&1; then
  note "pip" "$(python3 -m pip --version 2>&1 | awk '{print $1,$2}')"
else
  note "pip" "MISSING"
  ok=1
fi

for pkg in can-utils iproute2 build-essential; do
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
    note "$pkg" "installed"
  else
    note "$pkg" "not installed"
    warn=1
  fi
done

headers="linux-headers-$(uname -r)"
if dpkg-query -W -f='${Status}' "$headers" 2>/dev/null | grep -q 'install ok installed'; then
  note "linux-headers" "$headers"
else
  note "linux-headers" "missing $headers (needed to build CAN kernel modules)"
  warn=1
fi

if [[ -d /sys/class/net ]]; then
  can_ifaces="$(find /sys/class/net -maxdepth 1 -name 'can*' -o -name 'vcan*' | wc -l | tr -d ' ')"
  note "can/vcan ifaces" "$can_ifaces"
fi

for mod in peak_usb kvaser_usb ix_usb_can; do
  if modinfo "$mod" >/dev/null 2>&1; then
    note "$mod" "modinfo ok"
  else
    note "$mod" "not found (IXXAT is OOT/DKMS on 22.04/24.04)"
  fi
done

if [[ -f /etc/modprobe.d/blacklist-peak.conf ]] || [[ -f /etc/modprobe.d/pcan.conf ]]; then
  echo "  warning: Peak SDK blacklist present — see docs/socketcan-vendors.md"
  warn=1
fi
if [[ -f /etc/modprobe.d/kvaser.conf ]] && grep -q '^[[:space:]]*blacklist[[:space:]]\+kvaser_' /etc/modprobe.d/kvaser.conf 2>/dev/null; then
  echo "  warning: Kvaser LinuxCAN blacklist present — see docs/socketcan-vendors.md"
  warn=1
fi

if have node && [[ -f "$SCRIPT_DIR/check-electron-pin.sh" ]]; then
  echo
  if ! bash "$SCRIPT_DIR/check-electron-pin.sh"; then
    echo "  warning: Electron pin mismatch — see docs/packaging.md (do not npm audit fix --force)"
    ok=1
  fi
fi

echo
if [[ "$ok" -ne 0 ]]; then
  echo "Host is missing required Node/Python tools or the Electron pin does not match."
  echo "See docs/packaging.md — do not run npm audit fix --force."
  exit 1
fi

if [[ "$warn" -ne 0 ]]; then
  echo "Host can run the T1 desktop scaffold. Install apt packages before SocketCAN work:"
  echo "  sudo apt install -y can-utils iproute2 build-essential linux-headers-\$(uname -r)"
  exit 0
fi

echo "Host looks ready for VanillaBus development."
