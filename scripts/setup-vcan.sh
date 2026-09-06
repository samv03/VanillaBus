#!/usr/bin/env bash
# Create a virtual CAN interface and set it UP.
# VanillaBus T4 bus.open binds this iface only; it never runs this script
# and never `ip link set up` from Electron or the engine. Requires root /
# CAP_NET_ADMIN (sudo or a later pkexec helper — not the desktop process).

set -euo pipefail

IFACE="${1:-vcan0}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "setup-vcan.sh needs root (e.g. sudo $0 ${IFACE})"
  exit 1
fi

if ! command -v ip >/dev/null 2>&1; then
  echo "ip (iproute2) is required. sudo apt install -y iproute2"
  exit 1
fi

if ! lsmod | grep -q '^vcan'; then
  if ! modprobe vcan; then
    echo "Could not load the vcan module. Install linux-headers-\$(uname -r) and can-utils."
    exit 1
  fi
fi

if ! ip link show "$IFACE" >/dev/null 2>&1; then
  ip link add dev "$IFACE" type vcan
fi

ip link set up "$IFACE"
ip link show "$IFACE"
echo "Virtual CAN interface ${IFACE} is up. VanillaBus can bus.list / bus.open it now."
echo "Do not start Electron as root. See docs/privileges.md."
