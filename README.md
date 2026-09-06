# VanillaBus

SocketCAN-first desktop bus monitor. T5 is a throwaway raw RX stub: after
`bus.open`, `vanillabus-engine` recv()s on that python-can bus and emits
`rx.batch` (≤16 ms or ≤500 frames). T6 fills `rate_ms` as the last
inter-arrival (`(Δts_us)/1000`) per `(busId, can_id, is_eff)` — not EMA —
and the RX stub shows a Rate (ms) column. This is **not** production Trace
(T9) and does not decode DBC (T7).

## Requirements

Documented host: **Ubuntu 22.04 or 24.04**.

```bash
sudo apt update
sudo apt install -y can-utils iproute2 build-essential linux-headers-$(uname -r)
```

Also need a current **Node.js 20+** (npm) and **Python 3.10+** (pip).

VanillaBus talks to Linux SocketCAN first (`can0`, `vcan0`, …). Vendor SDKs
(Peak, Kvaser, …) are out of scope.

## Privilege / pre-UP (MVP)

The engine **binds only**. It will not `ip link set up`, set a kernel bitrate,
or run as root. Bring the iface up first:

```bash
sudo ./scripts/setup-vcan.sh          # creates vcan0 and sets it UP
```

Opening a missing or down iface returns structured `engine.error`
(`iface_not_found` / `iface_down`) and does not crash. See
[docs/privileges.md](docs/privileges.md). A later pkexec/`setcap` helper may
own `CAP_NET_ADMIN` — never Electron as root.

## Run the desktop app

From the repository root:

```bash
npm install
python3 -m pip install -e engine/   # installs python-can; main also sets PYTHONPATH=engine
npm run dev
```

`npm run dev` starts Vite, opens an Electron window titled **VanillaBus**, and
spawns `python3 -m can_engine --ipc <socket>`. After `engine.hello` the window
shows **Connected**. Use **List buses** / **Open** to call `bus.list` /
`bus.open` (result includes `busId`). Inject frames on the open iface and they
appear in the **RX stub** list.

The IPC socket lives under `$XDG_RUNTIME_DIR/vanillabus/` (mode 0600), or a
private 0700 `mkstemp` directory — not a world-writable predictable `/tmp` path.

See [docs/preload.md](docs/preload.md) for the API shape.

## Tests

```bash
python3 scripts/test-ipc-hello.py     # T2 hello / heartbeat (or npm run test:ipc)
npm run test:bridge                   # T3 disconnect / respawn
python3 scripts/test-bus-open.py      # T4 list / missing error / optional vcan
# or: npm run test:bus
npm run test:bus-bridge               # same path via EngineSupervisor
python3 scripts/test-rx-batch.py      # T5 frame map + drop-oldest + optional vcan
# or: npm run test:rx
npm run test:rx-bridge                # same RX path via EngineSupervisor
python3 scripts/test-rate-ms.py       # T6 rate_ms median (synthetic + optional vcan)
# or: npm run test:rate
```

`test-rx-batch.py` always checks FrameEvent mapping, drop-oldest, and ≤500
batching (no host CAN required). If `vcan0` is UP it opens the iface, injects
`0x42A` / `11223344`, and asserts `rx.batch` within 200 ms. If not, it prints
`SKIP vcan0 RX inject` and still exits 0.

`test-rate-ms.py` always checks last-interval `rate_ms` with synthetic
`ts_us` (51 frames at a 10 ms period → median within ±1 ms). The first
sample per key is `null`. `bus.close` clears that busId. If `vcan0` is UP
it also injects ≥51 frames at ~10 ms and asserts a live median within
**±2 ms** (scheduling jitter; documented). If not, it prints
`SKIP vcan0 rate inject` and still exits 0.

`test-bus-open.py` always asserts `bus.list` and that opening a missing name
returns `engine.error` / `iface_not_found`. If `vcan0` is UP it also opens,
closes, and reopens. If not, it prints:

```text
SKIP vcan0 open/close/reopen: vcan0 is not UP on this host.
Bring it up with: sudo ./scripts/setup-vcan.sh
```

Creating vcan in CI needs `sudo` / `CAP_NET_ADMIN`. This repo does not sudo
from the test.

## Inject frames (verify RX)

```bash
sudo ./scripts/setup-vcan.sh
# in the app: List buses → Open vcan0
cansend vcan0 123#11223344
cangen vcan0 -I 123 -L 4 -D 11223344 -n 50 -g 2
```

Frames should show in the RX stub (ID, DLC, data, time, Rate ms) within
~100–200 ms. The first frame of a key shows `—`; later frames show last
inter-arrival milliseconds.

## Helper scripts

```bash
./scripts/check-host.sh
sudo ./scripts/setup-vcan.sh          # vcan0 UP for bus.open + RX
```

## Layout

```
package.json
electron/main/          # window + engine spawn / UDS client + ipc-bridge
electron/preload/       # window.vanillabus (status + bus + onRxBatch)
electron/renderer/      # React status + list/open + RX stub log
engine/pyproject.toml   # vanillabus-engine (python-can)
engine/can_engine/      # framing server + hello + SocketCAN + RX pump
shared/engine.ts        # renderer/host types
shared/ipc-schema.json  # locked IPC types
scripts/                # check-host, setup-vcan, hello + bus + rx tests
fixtures/dbc/           # later DBC samples (engine-side only)
docs/architecture.md
docs/ipc.md
docs/preload.md
docs/privileges.md
```

See [docs/ipc.md](docs/ipc.md) for the framing contract. Message types:
`engine.hello`, `engine.heartbeat`, `engine.error`, `bus.list` / `bus.open` /
`bus.close`, `dbc.load` / `dbc.clear`, `rx.batch`, `tx.send`,
`tx.cyclic.start` / `tx.cyclic.stop`. Frame timestamps are `ts_us`
(microseconds); `rate_ms` is `(Δts_us)/1000`.
