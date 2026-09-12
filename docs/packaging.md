# Packaging and host setup

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
npm ci                                # preferred — Electron 37.x from the lockfile
# or: npm install
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

`npm run build` plus `electron .` (or `electron-vite preview`) still runs
the compiled tree from the repo (cwd = checkout). Linux installers are
built with **electron-builder** (next section). Stay on the Electron 37.x
pin below; do **not** `npm audit fix --force` to chase Electron 41.

## Linux packages (AppImage / `.deb`)

`npm run dist` (alias `dist:linux`) runs `electron-vite build` then
electron-builder for **AppImage** and **deb** (Ubuntu 22.04 / 24.04).
Artifacts land in **`dist/`** (gitignored):

```text
dist/VanillaBus-0.1.0-x86_64.AppImage
dist/vanillabus_0.1.0_amd64.deb
dist/linux-unpacked/vanillabus          # unpacked tree used by test:smoke:packaged
dist/linux-unpacked/resources/engine/   # Python sources, outside asar
```

`${arch}` for AppImage is `x86_64` (not `x64`). The Linux / window icon is
Sam’s concept A (VB monogram with a bus/trace cut) at **`build/icon.png`**
(1024×1024) plus **`build/icons/`** (`16`–`1024`). `electron-builder.yml`
sets `directories.buildResources: build`, `linux.icon: icons`, and copies
the master to `resources/icon.png` so `BrowserWindow` matches in the
packaged app. `npm run dist` / `dist:linux` / `dist:dir` picks the set up
on the next package. Rebuild the rasters with
`python3 scripts/render-app-icon.py` after changing `build/icon-concept-a.png`.
Do not add proprietary icon packs.

```bash
npm ci
npm run typecheck
npm run dist                  # or: npm run dist:linux
# unpacked tree only (no AppImage/.deb; useful for CI smoke):
npm run dist:dir
```

Do **not** `sudo npm run dist`. Building `.deb` may need `fakeroot` on the
host (`sudo apt install -y fakeroot`). electron-builder downloads its own
packaging helpers; it must not bump Electron off **37.10.3**.

CI does **not** have to run full `dist` (AppImage + deb are heavy). A
cheap gate is `test:engine-paths` plus, when artifacts exist,
`test:smoke:packaged`.

### Engine spawn in the packaged app

VanillaBus still launches **host `python3 -m can_engine`**. The smallest
solid packaging choice:

- Bundle **engine sources** as electron-builder `extraResources`
  (`resources/engine`, **outside asar** — Python cannot import from asar).
- Do **not** ship a portable venv or freeze python-can into the AppImage.
- Do **not** `setcap` or run Electron as root.

`EngineSupervisor` resolves the tree in this order:

1. `VANILLABUS_ENGINE_ROOT` if set
2. `$resourcesPath/engine` when `can_engine/__main__.py` is there (packaged)
3. `<cwd>/engine` (`npm run dev`, `electron .`, tests)

Python binary:

1. `VANILLABUS_PYTHON` if set
2. `$XDG_DATA_HOME/vanillabus/venv/bin/python3` (default
   `~/.local/share/vanillabus/venv/bin/python3`) when that file exists
   **and** the venv also has `bin/pip` (a failed `python3 -m venv` can
   leave a broken tree; install `python3-venv` first)
3. `python3` on `PATH`

Install engine **dependencies** once per user (PEP 668 on Ubuntu 24.04
makes a venv the reliable path):

```bash
python3 -m venv ~/.local/share/vanillabus/venv
~/.local/share/vanillabus/venv/bin/pip install 'python-can>=4.3' 'cantools>=39.4'
```

From a git checkout you can still `python3 -m pip install -e engine/`
(or `--user` / `--break-system-packages` where you already do that). Do
**not** `pip install -e` the AppImage mount — it is ephemeral.

`.deb` users may instead:

```bash
python3 -m pip install --user -e /opt/VanillaBus/resources/engine
# or point VANILLABUS_PYTHON at a venv that installed those deps
```

If `python-can` / `cantools` are missing, main logs a clear error and
keeps retrying. The header stays disconnected until the deps exist.

Packaged `dbc.load` allowlists paths under **`$HOME`** (`VANILLABUS_ROOT`).
Put DBC files in your home directory (or set `VANILLABUS_ROOT`). Unpackaged
dev still allowlists the git checkout + `fixtures/` as before.

### Run the package (never as root)

```bash
# AppImage (user, not sudo). chmod +x once. libfuse2 may be required to
# mount AppImages on some hosts; the linux-unpacked tree does not need FUSE.
# Without FUSE: ./dist/VanillaBus-0.1.0-x86_64.AppImage --appimage-extract-and-run
./dist/VanillaBus-0.1.0-x86_64.AppImage

# .deb
sudo dpkg -i dist/vanillabus_0.1.0_amd64.deb   # installs the files
vanillabus                                       # then run as your user

# Unpacked (same spawn path as the packages)
./dist/linux-unpacked/vanillabus
```

**Never** `sudo` the AppImage, `vanillabus`, or `linux-unpacked` binary.
Do not `setcap` those binaries. SocketCAN bring-up stays
[privileges.md](privileges.md) / `scripts/setup-vcan.sh`. Host
`can-utils`, vcan, and GTK/Chromium libs from the list above are still
required; a package does not replace them.

Headless hello (no vcan needed):

```bash
npm run dist          # or dist:dir
xvfb-run -a npm run test:smoke:packaged
```

`test:smoke:packaged` **SKIP**s (exit 0) when the unpacked tree, Python
deps, or a display/Xvfb is missing.

## Electron pin (37.x)

VanillaBus is pinned to **Electron 37.x** (`37.10.3` in `package.json` and
`package-lock.json`). `electron-vite` 5 works on this line. The plan does
not require Electron 41.

**Do not run `npm audit fix --force`.** `--force` ignores semver and can
major-bump Electron. A host previously ended up with **local**
`node_modules` on 41.x while the repo still declared 37.x. Inspect with
`npm audit` and bump dependencies deliberately. Prefer `npm ci` so the
lockfile is what gets installed.

`npm audit` currently lists Electron CVEs whose advertised fix is a
**semver-major** bump (not a 37.x patch). On this pin it wanted Electron
**44.x** (`isSemVerMajor: true`) — the same class of drift as the 41.x
host bump. Leave those advisories until an intentional Electron line
change.

Confirm:

```bash
npx electron --version    # expect v37.x
npm ls electron           # expect electron@37.10.3
npm run test:electron-pin # offline package.json + lockfile (+ node_modules) check
./scripts/check-host.sh
```

### Recover a polluted host

If the installed Electron major is not 37.x:

```bash
rm -rf node_modules
# Recreate package-lock.json only if you *intend* to change pins.
# Otherwise leave it alone so npm ci restores 37.10.3.
npm ci                    # preferred — installs the lockfile
# or: npm install
npx electron --version    # expect v37.x
npm ls electron
```

## Tests that gate persist

```bash
npm run test:persist                  # store round-trip + restore helpers (offline)
```

Keep `npm run typecheck`, `npm run build`, and the prior suites green
(`test:harden`, `test:multibus`, `test:smoke`, …). The operator scorecard
(which of those are live vcan PASS vs still OPEN, including the M4
rewrite trigger) is [release-gate.md](release-gate.md).

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
