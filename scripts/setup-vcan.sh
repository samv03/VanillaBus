#!/usr/bin/env bash
# Create a virtual CAN interface for later VanillaBus SocketCAN work.
# T1 does not open this interface from the app.

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
echo "Virtual CAN interface ${IFACE} is up. The T1 UI does not use it yet."
