# Privileges and interface bring-up (T4)

VanillaBus **never** runs Electron or `vanillabus-engine` as root, and it does
**not** bring SocketCAN interfaces up by itself.

## MVP rule: the iface must already be UP

`bus.open` binds an existing SocketCAN/vcan interface with python-can. If the
name is missing or the iface is **down**, the engine returns a structured
`engine.error` (`iface_not_found` / `iface_down`) and does **not** run
`ip link set up` or set a kernel bitrate.

Bring the interface up **before** opening it from the app:

```bash
sudo ./scripts/setup-vcan.sh          # creates vcan0 + vcan1 and sets them UP
# or a single iface:
sudo ./scripts/setup-vcan.sh vcan0
# or, if the iface already exists:
sudo ip link set up vcan0
```

Then:

```bash
python3 scripts/test-bus-open.py      # list → open → close → reopen
# or npm run test:bus
```

On a machine without vcan, that script still checks `iface_not_found` and
**skips** the live open/reopen path with a clear message. Creating vcan in CI
requires `sudo` / `CAP_NET_ADMIN` (documented in `scripts/setup-vcan.sh`).

## What the engine will not do

- `ip link add` / `ip link set up` / `ip link set can0 type can bitrate …`
- `modprobe vcan`
- Prompt for a password from Electron
- Run the desktop process or the engine as root

Bitrate on `bus.open` is optional. For **vcan** it is ignored. For a physical
`can*` iface it is passed to python-can only; the kernel bitrate must already
have been configured out of band.

## Later (not T4): pkexec / setcap

If a future task needs to create/up an iface or set bitrate, do it in a
**small helper** with a polkit (`pkexec`) policy or `setcap cap_net_admin`
on that helper — not on Electron, not on the renderer, and not by launching
the whole app as root.

Until then, operators use `scripts/setup-vcan.sh` (or their own `ip`/`can-utils`
commands) and then `bus.list` / `bus.open`.
