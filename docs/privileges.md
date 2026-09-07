# Privileges and interface bring-up (T4 / T15)

VanillaBus **never** runs Electron as root. The engine binds an iface that
is already UP; it does **not** bring SocketCAN interfaces up by itself.

## Rule: the iface must already be UP before `bus.open`

`bus.open` binds an existing SocketCAN/vcan interface with python-can. If the
name is missing or the iface is **down**, the engine returns a structured
`engine.error` (`iface_not_found` / `iface_down`) and does **not** run
`ip link set up` or set a kernel bitrate.

Bring the interface up **before** opening it from the app.

### Virtual CAN

```bash
sudo ./scripts/setup-vcan.sh          # creates vcan0 + vcan1 and sets them UP
# or a single iface:
sudo ./scripts/setup-vcan.sh vcan0
# or, if the iface already exists:
sudo ip link set up vcan0
```

### Physical SocketCAN (Peak / Kvaser / IXXAT)

```bash
sudo modprobe peak_usb                # or kvaser_usb / ix_usb_can
sudo ip link set can0 up type can bitrate 500000
```

See [socketcan-vendors.md](socketcan-vendors.md) for the module matrix and
SDK blacklist uninstall notes. Then:

```bash
python3 scripts/test-bus-open.py      # list → open → close → reopen
# or npm run test:bus
```

On a machine without vcan, that script still checks `iface_not_found` and
**skips** the live open/reopen path with a clear message. Creating vcan in CI
requires `sudo` / `CAP_NET_ADMIN` (documented in `scripts/setup-vcan.sh`).

## What the engine will not do

- `ip link add` / `ip link set up` / `ip link set can0 type can bitrate …`
- `modprobe vcan` / `modprobe peak_usb`
- Prompt for a password from Electron
- Run the desktop process or the engine as root

Bitrate on `bus.open` is optional. For **vcan** it is ignored. For a physical
`can*` iface it is passed to python-can only; the kernel bitrate must already
have been configured out of band.

## Optional: `pkexec` for `setup-vcan.sh`

`scripts/setup-vcan.sh` needs root / `CAP_NET_ADMIN`. Prefer a one-shot
polkit prompt on that script — not on Electron:

```bash
pkexec "$PWD/scripts/setup-vcan.sh"
```

A site-local polkit action can allow this helper for a desktop user.
Do **not** mark the Electron binary as allowed, and do not wrap
`npm run dev` in `pkexec`.

## Optional: `setcap` (engine helper only — never Electron)

If you need file capabilities so a **small helper** can `ip link set up`
without a password:

```bash
# Example only — VanillaBus still will not auto-up ifaces.
# Prefer a dedicated wrapper, not the system python3 interpreter.
sudo setcap cap_net_admin,cap_net_raw=ep /usr/local/bin/vanillabus-can-up
```

`cap_net_admin,cap_net_raw=ep` on the **engine** is an operator choice
for a wrapped `vanillabus-engine` binary. Do **not** `setcap` Electron,
the renderer, or `/usr/bin/python3` (that would grant every Python
process those caps).

T16 hardening may add a real helper + policy. Until then, operators use
`scripts/setup-vcan.sh` / `ip` / `can-utils` and then `bus.list` /
`bus.open`.

## Never run Electron as root

`sudo npm run dev` / `sudo electron` is unsupported. Root Electron can
read the user's files and bypass the UDS 0600 socket. Bring ifaces up
with sudo/`pkexec`/`setcap` **outside** the desktop process, then start
VanillaBus as the normal user.
