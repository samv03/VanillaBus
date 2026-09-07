# VanillaBus

SocketCAN-first desktop bus monitor. T8 is a dedicated app shell: top tabs
**Trace | Graph | Transmit** and one shared bus/DBC header (dropdown,
Connect/Disconnect, DBC path + Load, status pills). Tab state is the URL
hash (`#trace`, `#graph`, `#transmit`); switching tabs does not tear down
the engine. T9 replaces the T5 RX stub with a **virtualized Trace**
(`react-virtuoso`): filter, Pause, Clear, scroll lock, expandable DBC
signals, and a bounded 20_000-frame drop-oldest ring. Graph is a live
**uPlot** signal plot (T11): DBC picker, 10s/30s/60s window, independent
Pause, UI-side 10–30 Hz decimation, and a memory-bounded sample window.
Transmit T12 is **raw one-shot + cyclic TX** (amber Send / client-side Tx
footer). T13 fills the DBC pack column: pick a catalog message, edit
signals, Send / Start cyclic — cantools encodes in the engine. T14
(**M3**) opens **two or more buses at once** (`vcan0` + `vcan1`), each
with its own DBC, RX thread, rate tracker, and TX jobs. Closing one bus
does not tear down the other. TX on A never appears as RX on B unless
you add a kernel `can-gw` bridge. T15 documents vendor SocketCAN
(Peak / Kvaser mainline, IXXAT OOT/DKMS) and enriches `bus.list` with
driver / vendor / blacklist metadata. T16 (**M4 start**) hardens
drop-oldest RX + a visible `dropped` counter, batch ≤16–33 ms or ≤500
frames, OOM caps, IPC oversized/partial-read rejection, and engine
restart under load (`npm run test:harden`). See
[docs/hardening.md](docs/hardening.md).

After `bus.open`, `vanillabus-engine` recv()s on that python-can bus and
emits `rx.batch` (≤16–33 ms or ≤500 frames). T6 fills `rate_ms` as the last
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

VanillaBus talks to Linux SocketCAN first (`can0`, `vcan0`, …). PEAK and
Kvaser use **mainline** `peak_usb` / `kvaser_usb`. IXXAT is HMS SocketCAN
**OOT/DKMS** (`ix_usb_can`) on both Ubuntu 22.04 and 24.04 — there is no
`CONFIG_CAN_IXXAT_USB` in those distro kernels. Do **not** install Peak
chardev or Kvaser LinuxCAN (they blacklist SocketCAN). Vendor SDKs
(PCAN-Basic, CANlib, ECI) are out of scope. See
[docs/socketcan-vendors.md](docs/socketcan-vendors.md) and the CAN FD
checklist [docs/can-fd.md](docs/can-fd.md).

## Privilege / pre-UP (MVP)

The engine **binds only**. It will not `ip link set up`, set a kernel bitrate,
or run as root. Bring the iface up first:

```bash
sudo ./scripts/setup-vcan.sh          # creates vcan0 + vcan1 and sets them UP
```

Opening a missing or down iface returns structured `engine.error`
(`iface_not_found` / `iface_down`) and does not crash. See
[docs/privileges.md](docs/privileges.md) for `pkexec` of
`scripts/setup-vcan.sh` and optional `setcap cap_net_admin,cap_net_raw=ep`
on an **engine helper** — never Electron as root.

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
Connect a second iface the same way (select `vcan1`, Connect). Open-bus
chips switch the **active** bus for DBC Load and the Graph target.
**Load** (header DBC path) calls `dbc.load` on the active `busId` only.
Inject frames on either open iface and they appear in the virtualized
Trace table (Bus column = ifName). The **Graph** tab plots
numeric `decode.signals` in uPlot (10s/30s/60s window, Pause is independent
of Trace). In `npm run dev`, Graph has a Demo button for synthetic series.

The IPC socket lives under `$XDG_RUNTIME_DIR/vanillabus/` (mode 0600), or a
private 0700 `mkstemp` directory — not a world-writable predictable `/tmp` path.

See [docs/preload.md](docs/preload.md) for the API shape.

## Tests

```bash
python3 scripts/test-ipc-hello.py     # T2 hello / heartbeat (or npm run test:ipc)
npm run test:bridge                   # T3 disconnect / respawn
python3 scripts/test-bus-open.py      # T4 list / missing error / optional vcan
# or: npm run test:bus
npm run test:vendor                   # T15 vendor metadata + blacklist (offline)
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
npm run test:graph                    # T11 decimation / pause / window (tsx)
npm run test:tx                       # T12 raw TX + cyclic ±10% (SKIP live if no vcan)
# or: python3 scripts/test-tx.py
npm run test:tx-dbc                   # T13 golden pack + cyclic DBC ±10% (SKIP live if no vcan)
# or: python3 scripts/test-tx-dbc.py
npm run test:tx-bridge                # T12/T13 hex/period helpers + supervisor TX (tsx)
npm run test:multibus                 # T14 two buses + DBC isolation (python + tsx)
npm run test:harden                   # T16 backpressure / OOM / IPC / restart
npm run test:smoke                    # T10 M1 Trace+DBC+rate + N2 (tsx)
# or: npm run test:m1                 # test:smoke + Electron/Xvfb stub
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
`test:smoke` reuses that N2 helper (`shared/traceN2.ts`) and adds the
DBC + `rate_ms` live slice.

`test:graph` always checks UI-side decimation (a 1 kHz synthetic burst
collapses to 10–30 samples/s), Graph pause freeze (Trace can still
append), and drop-oldest window capacity. Mux frames only contribute
signals present on `decode.signals`. If `vcan0` is UP it also loads
`sample.dbc`, injects EngineStatus, and asserts live Graph samples. If
not, it prints `SKIP vcan0 graph` and still exits 0.

`test-tx.py` (`npm run test:tx`) always checks TX payload schema, cyclic
deadline math (skip-missed-tick / stretch), RecordingBus one-shot echo
(`dir=tx`), and a 50 ms cyclic job whose median interval is within
**±10%**. If `vcan0` is UP it also opens the iface, `tx.send`s `0x5A1`,
asserts a peer python-can/`candump` recv, checks `rx.batch` for the TX id,
and measures a 100 ms cyclic job to ±10%. If not, it prints
`SKIP vcan0 TX inject` and still exits 0.

`test-tx-dbc.py` (`npm run test:tx-dbc`) always checks golden pack vectors
for `sample.dbc` / `mux.dbc` (pack then unpack matches expected signals),
unknown message / pack failure / no DBC, RecordingBus DBC one-shot echo
with decode, and a 50 ms cyclic DBC job within **±10%**. If `vcan0` is UP
it loads `sample.dbc`, `tx.send`s `{ message, signals }`, asserts the
packed `EngineStatus` frame on a peer, and measures 100 ms cyclic DBC
to ±10%. If not, it prints `SKIP vcan0 DBC TX inject` and still exits 0.

`test:harden` (`npm run test:harden`) always checks the T16 bounds offline:
flush policy (≤16–33 ms or ≤500 frames), engine RX queue cap 4096 with a
visible `rx.batch.dropped` counter, rate-key cap, DBC path traversal,
IPC oversized / malformed / partial-read (no hang), Trace 20k flood,
Graph window + series caps, and supervisor restart under IPC load.
If `vcan0` is UP it also floods a live bus and kills the engine under
RX/TX load, then asserts reconnect + `rx.batch`. If not, it prints
`SKIP vcan0 harden` and still exits 0.

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

## Multi-bus (T14 / M3)

`BusManager` keeps one python-can handle, RX pump, DBC, rate keys, and
cyclic TX jobs per `busId`. The header can have several ifaces open;
the selected chip/dropdown is the DBC + Graph + default TX target.

```bash
sudo ./scripts/setup-vcan.sh          # vcan0 and vcan1 UP
npm run test:multibus
```

What `test:multibus` does:

1. **Synthetic (always).** Two RecordingBuses: load `sample.dbc` on A and
   `mux.dbc` on B; TX on A is not sent or echoed on B; `bus.close(A)`
   leaves B's pump/DBC/jobs running; a second `bus.open vcan0` returns
   `iface_already_open`; `drain_rx` is fair so a hot bus cannot hide B.
   Trace/Graph unit checks (`scripts/test-multibus.ts`) keep the ring
   keyed by `busId`/`ifName` and plot only the selected bus.
2. **Live vcan (optional).** If **both** `vcan0` and `vcan1` are UP:
   engine IPC opens both, loads different DBCs, `tx.send`s on A, a peer
   on A sees the frame and a peer on B does **not**, RX decode uses the
   per-bus DBC, and closing A does not stop B.
3. **SKIP if either iface is missing.** Live steps print a clear message
   and still exit 0:

```text
SKIP vcan0+vcan1 multi-bus: vcan0 and/or vcan1 is not UP on this host. Bring both up with: sudo ./scripts/setup-vcan.sh
```

### Graph / Transmit targeting

- **Trace** shows every open bus. The Bus column is `ifName`. Filter
  `vcan0` / `vcan1` to isolate a column.
- **Graph** plots decoded signals from the **header-selected open bus
  only**. Switching the active bus swaps that bus's DBC catalog and
  drops the previous bus's samples. Other buses stay in Trace.
- **Transmit** Raw send dropdown lists open buses (synced from the
  header). DBC pack encodes with **that bus's** loaded DBC. Cyclic jobs
  are tagged with `busId`; `Disconnect` on A stops only A's jobs.

## M1 smoke

T10 packages the single-bus **Trace + DBC + `rate_ms`** slice as a runnable
smoke. How to run it:

```bash
npm install
python3 -m pip install -e engine/
npm run test:smoke          # required M1 gate
# optional alias that also runs the Electron stub:
npm run test:m1
```

What `test:smoke` does:

1. **N2 (always).** Reuses the T9 first-paint instrumentation
   (`shared/traceN2.ts`, same path as `test:trace`): a synthetic ≤2 kfps
   stream (32-frame / 16 ms batches) is appended to the 20_000-frame ring
   and only the visible window (~24 rows) is painted. First-paint and every
   later batch must stay **<50 ms**. Measured numbers print as
   `M1 N2 synthetic first-paint … ms`.
2. **Interactive under load (always).** After that fill, filter / pause /
   clear must stay under the same 50 ms budget. In the app the Trace
   toolbar (filter, Pause, Clear, scroll lock) stays usable because
   virtualization paints only the visible rows — this is the automated
   stand-in for “UI remains interactive under load.”
3. **Live vcan (optional).** If `vcan0` is UP: spawn the engine,
   `bus.open vcan0`, `dbc.load fixtures/dbc/sample.dbc`, inject
   `EngineStatus` (`cansend` / python-can), and assert `rx.batch` frames
   have `decode.name` plus numeric `rate_ms` after enough samples. Live
   first-paint of the first `rx.batch` is also gated at <50 ms. A 2 kfps
   burst is attempted when extra batches arrive.
4. **SKIP if no vcan.** Live steps print a clear message and still exit 0:

```text
SKIP vcan0 M1 smoke: vcan0 is not UP on this host. Bring it up with: sudo ./scripts/setup-vcan.sh
```

Bring the iface up first if you want the live slice:

```bash
sudo ./scripts/setup-vcan.sh
npm run test:smoke
```

### Xvfb / headless Electron (CI)

`test:smoke` does not need a display. The optional desktop stub is for CI
runners that should prove Electron can start headless:

```bash
sudo apt-get install -y xvfb
npm run build
xvfb-run -a npm run test:smoke:electron
```

`scripts/smoke-electron.sh` sets `VANILLABUS_SMOKE=1`, launches the **built**
app (`out/main/index.js`), waits for `engine.hello`, and exits 0. The
window is not shown. It **exits 0 with SKIP** when there is no display and
no `xvfb-run`, when `vcan0` is not UP, or when the build output is
missing. Full GUI Trace driving is not required for M1; without a display
the stub is SKIP, not a failure.

See [docs/smoke.md](docs/smoke.md) for the CI job sketch.

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

## Transmit (verify TX)

```bash
sudo ./scripts/setup-vcan.sh
# in the app: Connect vcan0 → Transmit tab → Send 0x7E0
candump vcan0
```

The wire frame should appear on the peer. Trace shows a `dir=tx` echo for
the same ID. Cyclic **Start** / **Stop** is owned by the engine (period ms,
median within ±10% on a quiet host; stretch is documented if the scheduler
overruns). After **Load** `fixtures/dbc/sample.dbc`, the DBC pack column
sends `EngineStatus` / `VehicleSpeed` by signal values (engine cantools
pack). Both Raw and DBC cyclic jobs appear in the Active jobs list.

## Helper scripts

```bash
./scripts/check-host.sh
sudo ./scripts/setup-vcan.sh          # vcan0 + vcan1 UP for bus.open + multi-bus
```

## Layout

```
package.json
electron/main/          # window + engine spawn / UDS client + ipc-bridge
electron/preload/       # window.vanillabus (status + bus + DBC + TX + onRxBatch)
electron/renderer/      # React shell + Trace + Graph + Transmit
engine/pyproject.toml   # vanillabus-engine (python-can + cantools)
engine/can_engine/      # framing server + SocketCAN + RX/TX + DBC unpack
shared/engine.ts        # renderer/host types
shared/appTabs.ts       # typed re-export of Trace | Graph | Transmit helpers
shared/appTabs.mjs      # same helpers for plain `node` (no tsx / --test)
shared/ipc-schema.json  # locked IPC types
scripts/                # check-host, setup-vcan, hello + bus + rx + dbc + M1 + T14 multi-bus
fixtures/dbc/           # sample + mux + invalid DBC (engine-side only)
fixtures/golden/        # unpack + pack vectors for sample + mux
docs/architecture.md
docs/hardening.md       # T16 backpressure, OOM caps, IPC, restart
docs/ipc.md
docs/preload.md
docs/privileges.md      # pre-UP, pkexec, setcap — never Electron as root
docs/socketcan-vendors.md  # T15 Peak/Kvaser/IXXAT SocketCAN matrix
docs/can-fd.md          # T15 FD checklist (docs only)
docs/smoke.md           # T10 M1 smoke + Xvfb/headless CI notes
```

See [docs/ipc.md](docs/ipc.md) for the framing contract. Message types:
`engine.hello`, `engine.heartbeat`, `engine.error`, `bus.list` / `bus.open` /
`bus.close`, `dbc.load` / `dbc.clear`, `rx.batch`, `tx.send`,
`tx.cyclic.start` / `tx.cyclic.stop`. Frame timestamps are `ts_us`
(microseconds); `rate_ms` is `(Δts_us)/1000`.
