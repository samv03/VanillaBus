# VanillaBus

SocketCAN-first desktop bus monitor. T8 is a dedicated app shell: top tabs
**Trace | Graph | Transmit** and one shared bus/DBC header (dropdown,
Connect/Disconnect, DBC path + Load, status pills). Tab state is the URL
hash (`#trace`, `#graph`, `#transmit`); switching tabs does not tear down
the engine. T9 replaces the T5 RX stub with a **virtualized Trace**
(`react-virtuoso`): filter, Pause, Clear, scroll lock, expandable DBC
signals, and a bounded 20_000-frame drop-oldest ring. Graph and Transmit
are placeholders (T11 / T12–T13).

After `bus.open`, `vanillabus-engine` recv()s on that python-can bus and
emits `rx.batch` (≤16 ms or ≤500 frames). T6 fills `rate_ms` as the last
inter-arrival (`(Δts_us)/1000`) per `(busId, can_id, is_eff)` — not EMA.
T7 binds one DBC per `busId` (`dbc.load` / `dbc.clear`) and unpacks known
IDs with **cantools** onto `decode` (`name` + `signals` + `units`). Unknown
IDs still flow through RX as raw frames.

## Requirements

Documented host: **Ubuntu 22.04 or 24.04**.

```bash
sudo apt update
sudo apt install -y can-utils iproute2 build-essential linux-headers-$(uname -r)
```

**Node.js 20+ is required** on Ubuntu hosts (`package.json` `engines.node`).
Electron, Vite, and `tsx` all need it. **Python 3.10+** (pip) is also
required.

Ubuntu distro Node is often far older than 18. On those hosts:

- `tsx` crashes: `SyntaxError: Unexpected token '.'` inside `tsx/dist/cli.mjs`
- `node --test` fails: `node: bad option: --test` (the test runner landed in 18)

Install **Node 20 LTS** with nvm or NodeSource before `npm run dev` / typecheck /
bridge tests:

```bash
# nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# new shell, then:
nvm install 20
nvm use 20

# or NodeSource (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

`npm run test:shell` is a tiny diagnostic (`node scripts/test-shell-tabs.mjs`)
and does not use `tsx` or `node --test`. The full app still needs Node 20.

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
python3 -m pip install -e engine/   # installs python-can + cantools; main also sets PYTHONPATH=engine
npm run dev
```

`npm run dev` starts Vite, opens an Electron window titled **VanillaBus**, and
spawns `python3 -m can_engine --ipc <socket>`. After `engine.hello` the shared
header shows **Engine Connected**. The same header is on Trace, Graph, and
Transmit. Use the bus dropdown + **Connect** to call `bus.list` / `bus.open`.
**Load** (header DBC path) calls `dbc.load`. Inject frames on the open iface
and they appear in the virtualized Trace table.

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
python3 scripts/test-dbc-unpack.py    # T7 golden unpack + mux + allowlist
# or: npm run test:dbc
npm run test:dbc-bridge               # parseFrameEvent decode + supervisor load/clear (tsx)
npm run test:shell                    # T8 hash tabs — plain node, no tsx / --test
npm run test:trace                    # T9 ring / filter / N2 first-paint (tsx)
```

`test:shell` runs `node scripts/test-shell-tabs.mjs` (assert + `shared/appTabs.mjs`,
prints `PASS`). It is only a diagnostic for the hash helpers. Bridge tests still
use tsx and need Node 20+.

`test:trace` always instruments N2 first-paint on a synthetic 2 kfps stream
(32-frame / 16 ms batches, same cadence as the engine). It appends to the
20_000-frame ring and paints only the visible window (~24 rows) + a tiny HTML
proxy — not all rows. First-paint and every subsequent batch must stay
**<50 ms**. If `vcan0` is UP it also injects a 2 kfps burst and times the
same paint path on the first `rx.batch`. If not, it prints
`SKIP vcan0 trace N2` and still exits 0. In `npm run dev`, the first live
batch also logs `[trace-n2] first-paint … ms` to the renderer console.

`test-rx-batch.py` always checks FrameEvent mapping, drop-oldest, and ≤500
batching (no host CAN required). If `vcan0` is UP it opens the iface, injects
`0x42A` / `11223344`, and asserts `rx.batch` within 200 ms. If not, it prints
`SKIP vcan0 RX inject` and still exits 0.

`test-dbc-unpack.py` always checks golden unpack vectors for
`fixtures/dbc/sample.dbc` and `fixtures/dbc/mux.dbc` (including mux m0/m1),
unknown CAN IDs staying raw, path allowlist, and `invalid.dbc` →
`engine.error` / `dbc_invalid`. If `vcan0` is UP it also loads the sample DBC
over IPC and asserts decode on `rx.batch`. If not, it prints
`SKIP vcan0 DBC inject` and still exits 0.

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
# in the app: Connect vcan0 → Load fixtures/dbc/sample.dbc
cansend vcan0 100#E8035A0A00000000   # EngineStatus (decoded)
cansend vcan0 7FF#DEADBEEF           # unknown ID (raw)
cangen vcan0 -I 123 -L 4 -D 11223344 -n 50 -g 2
```

Frames should show in Trace (Time, Bus, ID, Name, DLC, Data, Rate ms, Dir)
within ~100–200 ms. Known IDs show the DBC message name; expand the row for
signal name / value / unit. Unknown IDs stay raw. The UI ring holds at most
**20_000** frames and drops the oldest.

## Helper scripts

```bash
./scripts/check-host.sh
sudo ./scripts/setup-vcan.sh          # vcan0 UP for bus.open + RX
```

## Layout

```
package.json
electron/main/          # window + engine spawn / UDS client + ipc-bridge
electron/preload/       # window.vanillabus (status + bus + DBC + onRxBatch)
electron/renderer/      # React shell (tabs + shared header) + virtualized Trace
engine/pyproject.toml   # vanillabus-engine (python-can + cantools)
engine/can_engine/      # framing server + SocketCAN + RX pump + DBC unpack
shared/engine.ts        # renderer/host types
shared/appTabs.ts       # typed re-export of Trace | Graph | Transmit helpers
shared/appTabs.mjs      # same helpers for plain `node` (no tsx / --test)
shared/ipc-schema.json  # locked IPC types
scripts/                # check-host, setup-vcan, hello + bus + rx + dbc tests
fixtures/dbc/           # sample + mux + invalid DBC (engine-side only)
fixtures/golden/        # unpack vectors for sample + mux
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
