# VanillaBus

SocketCAN-first desktop bus monitor. T2 wires live IPC between Electron main
and `vanillabus-engine` (length-prefixed JSON on a Unix domain socket). CAN I/O,
DBC decode, and Trace/Graph/Transmit UI are **not** implemented yet.

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
python3 -m pip install -e engine/   # optional; main also sets PYTHONPATH=engine
npm run dev
```

`npm run dev` starts Vite, opens an Electron window titled **VanillaBus**, and
spawns `python3 -m can_engine --ipc <socket>`. The window shows **Engine:
Connected** after `engine.hello`. If the engine process dies, main logs the
disconnect and respawns it.

The IPC socket lives under `$XDG_RUNTIME_DIR/vanillabus/` (mode 0600), or a
private 0700 `mkstemp` directory — not a world-writable predictable `/tmp` path.

## Hello / heartbeat test (no Electron)

```bash
python3 scripts/test-ipc-hello.py
```

or `npm run test:ipc`. The script starts the engine, prints the `engine.hello`
payload, checks a hello round-trip and a heartbeat, then proves a malformed
length does not crash the process.

## Helper scripts

```bash
./scripts/check-host.sh
sudo ./scripts/setup-vcan.sh          # creates vcan0; unused by the T2 UI
```

## Layout

```
package.json
electron/main/          # window + engine spawn / UDS client
electron/preload/       # engine Connected status only
electron/renderer/      # React + Vite UI (no CAN / DBC)
engine/pyproject.toml   # vanillabus-engine
engine/can_engine/      # framing server + hello/heartbeat
shared/ipc-schema.json  # locked IPC types
scripts/                # check-host, setup-vcan, test-ipc-hello
fixtures/dbc/           # later DBC samples (engine-side only)
docs/architecture.md
docs/ipc.md
```

See [docs/ipc.md](docs/ipc.md) for the framing contract. Message types:
`engine.hello`, `engine.heartbeat`, `engine.error`, `bus.list` / `bus.open` /
`bus.close`, `dbc.load` / `dbc.clear`, `rx.batch`, `tx.send`,
`tx.cyclic.start` / `tx.cyclic.stop`. Frame timestamps are `ts_us`
(microseconds); `rate_ms` is `(Δts_us)/1000`.
