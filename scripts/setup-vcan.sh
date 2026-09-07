#!/usr/bin/env bash
# Create virtual CAN interface(s) and set them UP.
# VanillaBus bus.open binds these ifaces only; it never runs this script
# and never `ip link set up` from Electron or the engine. Requires root /
# CAP_NET_ADMIN (sudo or a later pkexec helper — not the desktop process).
#
# Default (no args): vcan0 and vcan1 for T14 multi-bus.
# With args: only those names (e.g. sudo ./scripts/setup-vcan.sh vcan0).

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "setup-vcan.sh needs root (e.g. sudo $0 ${*:-vcan0 vcan1})"
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

if [[ "$#" -eq 0 ]]; then
  IFACES=(vcan0 vcan1)
else
  IFACES=("$@")
fi

bring_up() {
  local iface="$1"
  if ! ip link show "$iface" >/dev/null 2>&1; then
    ip link add dev "$iface" type vcan
  fi
  ip link set up "$iface"
  ip link show "$iface"
  echo "Virtual CAN interface ${iface} is up. VanillaBus can bus.list / bus.open it now."
}

for iface in "${IFACES[@]}"; do
  bring_up "$iface"
done

echo "Do not start Electron as root. See docs/privileges.md."
if [[ "${#IFACES[@]}" -gt 1 ]]; then
  echo "Multi-bus: connect ${IFACES[*]} in the header (one DBC per bus). Buses are isolated unless you add a can-gw bridge."
fi
