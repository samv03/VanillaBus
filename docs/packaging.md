# Packaging and host setup (T17)

How to run, build, and package VanillaBus on **Ubuntu 22.04 or 24.04**.
This is the documented host. Other distros may work; they are not gated.

VanillaBus is an Electron desktop plus a Python engine. **Never run Electron
as root** (`sudo npm run dev`, `sudo electron`, pkexec on the desktop binary).
The engine binds SocketCAN only; iface bring-up stays out of band. See
[privileges.md](privileges.md), [hardening.md](hardening.md), and
[socketcan-vendors.md](socketcan-vendors.md).

## Host packages

```bash
sudo apt update
sudo apt install -y \
  can-utils iproute2 build-essential linux-headers-$(uname -r) \
  python3 python3-pip python3-venv \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libsecret-1-0 libasound2t64 libgbm1
```

On Ubuntu 22.04 the ALSA package is `libasound2` (no `t64` suffix). If
`libasound2t64` is missing:

```bash
sudo apt install -y libasound2
```

**Node.js 20+** is required (`package.json` `engines.node`). Distro Node is
often too old. Use nvm or NodeSource — see the README.

Optional for headless CI / `test:smoke:electron`:

```bash
sudo apt install -y xvfb
```

Confirm the machine:

```bash
./scripts/check-host.sh
```

## Virtual CAN

```bash
sudo ./scripts/setup-vcan.sh          # vcan0 + vcan1 UP
# or: sudo ./scripts/setup-vcan.sh vcan0
```

`setup-vcan.sh` needs root / `CAP_NET_ADMIN`. Prefer `pkexec` of **that
script**, never of Electron. Opening a missing or down iface returns
`iface_not_found` / `iface_down` and does not crash.

## Develop

From the repository root (your user, not root):

```bash
npm install
python3 -m pip install -e engine/     # python-can + cantools
npm run dev                           # Electron + Vite + vanillabus-engine
```

After `engine.hello` the header shows **Engine Connected**. Last-used bus
names and DBC paths are restored as **hints**. Click **Connect** / **Load**
yourself — the app does not auto-bind a down iface.

UI persist lives in Electron `userData` as `vanillabus-ui.json` (typically
`~/.config/vanillabus/vanillabus-ui.json`). Override the file for tests
with `VANILLABUS_STORE_PATH`.

## Build / preview

```bash
npm run typecheck
npm run build                         # electron-vite → out/main, out/preload, out/renderer
npx electron .                        # run the built app (same cwd, still not root)
# or:
npm run preview
```

There is no electron-builder / AppImage / `.deb` pipeline in this repo yet.
`npm run build` plus `electron .` (or `electron-vite preview`) is the
supported packaged-from-source path. A later release gate can add
electron-builder; do **not** `npm audit fix --force` to chase Electron 41.

## Tests that gate persist

```bash
npm run test:persist                  # store round-trip + restore helpers (offline)
```

Keep `npm run typecheck`, `npm run build`, and the prior suites green
(`test:harden`, `test:multibus`, `test:smoke`, …).

## Privilege reminder

| Action | Who |
| --- | --- |
| `ip link set up` / bitrate / `modprobe` | operator / `setup-vcan.sh` / optional engine helper |
| `bus.open` / `dbc.load` / TX | vanillabus-engine (user) |
| Desktop window / persist | Electron (user) |

Do not `setcap` the Electron binary. Optional `setcap
cap_net_admin,cap_net_raw=ep` belongs on a **small helper**, not the UI.
Vendor Peak/Kvaser/IXXAT proprietary SDKs stay out of tree — SocketCAN
only ([socketcan-vendors.md](socketcan-vendors.md)).
