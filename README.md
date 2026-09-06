# VanillaBus

SocketCAN-first desktop bus monitor. T1 is an installable Electron + React +
Vite + TypeScript scaffold and a Python `vanillabus-engine` package. CAN I/O,
DBC decode, Trace/Graph/Transmit UI, and live IPC are **not** implemented yet.

## Requirements

Documented host: **Ubuntu 22.04 or 24.04**.

```bash
sudo apt update
sudo apt install -y can-utils iproute2 build-essential linux-headers-$(uname -r)
```

Also need a current **Node.js 20+** (npm) and **Python 3.10+** (pip).

VanillaBus talks to Linux SocketCAN first (`can0`, `vcan0`, …). Vendor SDKs
(Peak, Kvaser, …) are out of scope.

## Run the desktop app

From the repository root:

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and opens an Electron window titled **VanillaBus**.

## Install the engine

From the repository root:

```bash
python3 -m pip install -e engine/
```

That installs the `vanillabus-engine` package (import name `can_engine`) in
editable mode. Confirm with:

```bash
python3 -c "from can_engine import hello; print(hello())"
```

## Helper scripts

```bash
./scripts/check-host.sh
sudo ./scripts/setup-vcan.sh          # creates vcan0; unused by the T1 UI
```

## Layout

```
package.json
electron/main/          # Electron main process
electron/preload/       # contextBridge stub
electron/renderer/      # React + Vite UI
engine/pyproject.toml   # vanillabus-engine
engine/can_engine/      # Python package (placeholders)
shared/ipc-schema.json  # future IPC types
scripts/                # check-host.sh, setup-vcan.sh
fixtures/dbc/           # later DBC samples (engine-side only)
docs/architecture.md
```

See [docs/architecture.md](docs/architecture.md) for the process split.
IPC names reserved in `shared/ipc-schema.json`: `engine.hello`, `heartbeat`,
`bus.list` / `bus.open` / `bus.close`, `dbc.load`, `rx.batch`, `tx.send`,
`tx.cyclic.start` / `tx.cyclic.stop`.
