# Preload API (`window.vanillabus`)

The renderer talks to the engine **only** through this context-bridge surface.
It is typed in `shared/engine.ts` and implemented by `electron/preload/index.ts`.
Main maps supervisor status and bus RPCs onto it in `electron/main/ipc-bridge.ts`.

There is no `window.vanillabusApi` alias. Use `window.vanillabus`.

## Shape

```ts
window.vanillabus = {
  version: string                      // preload bridge version (0.1.0)
  getEngineInfo(): Promise<EngineInfo>
  onEngineStatus(listener): Unsubscribe
  onEngineEvent(listener): Unsubscribe  // { type: 'connected' | 'disconnected', info }
  onConnected(listener): Unsubscribe
  onDisconnected(listener): Unsubscribe
  listBuses(): Promise<BusListResult>
  openBus(name, bitrate?): Promise<BusOpenResult>
  closeBus(busId): Promise<BusCloseResult>
  loadDbc(busId, path): Promise<DbcLoadResult>
  clearDbc(busId): Promise<DbcClearResult>
  sendFrame(request): Promise<TxSendResult>
  startCyclic(request): Promise<TxCyclicStartResult>
  stopCyclic(jobId): Promise<TxCyclicStopResult>
  onRxBatch(listener): Unsubscribe       // { frames, dropped }
}
```

`EngineInfo` (mirrors IPC `engine.hello` + connection flag):

| Field | Connected | Disconnected |
| --- | --- | --- |
| `connected` | `true` | `false` |
| `name` | `vanillabus-engine` | `null` |
| `version` | hello version (e.g. `0.1.0`) | `null` |
| `backends` | `["socketcan"]` | `[]` |
| `hello` | `{ name, version, backends }` | `null` |

Bus results are tagged `{ ok: true, … }` or
`{ ok: false, error: { code, message } }` so a down/missing iface does not
throw through the renderer. Engine codes include `iface_not_found`,
`iface_down`, `bus_not_found`, `engine_disconnected`.

`loadDbc` / `clearDbc` return `{ ok: true, message_count, catalog }` /
`{ ok: true }` or `{ ok: false, error: { code, message } }`. `catalog` is
the DBC message/signal list for the Graph picker (empty if omitted).
Engine codes include `path_not_allowed`, `dbc_not_found`, `dbc_invalid`,
and `bus_not_found`. The renderer forwards a repo-relative fixture path;
cantools runs in the engine. Catalog entries may include optional
`min` / `max` / `initial` for the Transmit DBC pack column. Graph never
invents mux branches — it only plots numeric values present on
`decode.signals`.

The renderer never receives Unix-socket frames, SocketCAN handles, or DBC
objects. Trace displays `decode.name` / `decode.signals` / `decode.units`
from `rx.batch` in an expandable row.

## IPC channels (main ↔ preload)

| Channel | Kind | Payload |
| --- | --- | --- |
| `vanillabus:engine-info` | invoke + event | `EngineInfo` |
| `vanillabus:engine-event` | event | `EngineConnectionEvent` |
| `vanillabus:bus-list` | invoke | `BusListResult` |
| `vanillabus:bus-open` | invoke | `BusOpenResult` |
| `vanillabus:bus-close` | invoke | `BusCloseResult` |
| `vanillabus:dbc-load` | invoke | `DbcLoadResult` |
| `vanillabus:dbc-clear` | invoke | `DbcClearResult` |
| `vanillabus:tx-send` | invoke | `TxSendResult` |
| `vanillabus:tx-cyclic-start` | invoke | `TxCyclicStartResult` |
| `vanillabus:tx-cyclic-stop` | invoke | `TxCyclicStopResult` |
| `vanillabus:rx-batch` | event | `RxBatch` (`frames`, `dropped`) |

T2 engine IPC (`engine.hello`, `engine.heartbeat`, respawn) is unchanged.
`rx.batch` still carries T5 frames, T6 `rate_ms`, and optional T7 `decode`.
T9 Trace virtualizes that stream (filter / pause / clear / scroll lock).
T11 Graph subscribes to the same `rx.batch` with its own pause and a
10–30 Hz uPlot redraw.

## Observing Disconnected

1. `npm run dev` — the shared header **Engine Connected** pill lights after
   hello. The pill is on every tab.
2. Kill the engine: `pkill -f 'python3 -m can_engine'`.
3. The badge flips to **Disconnected**.
4. Main respawns the engine (~750 ms). After the next hello the badge is
   **Connected** again.

Automated: `npm run test:bridge` starts the supervisor, waits for hello, kills
the child PID, and asserts a `disconnected` then `connected` transition.

## List / open / close

1. Bring up an iface: `sudo ./scripts/setup-vcan.sh`
2. The header bus dropdown lists `vcan0` after hello (`bus.list`).
3. **Connect** returns a `busId`. **Disconnect** then **Connect** again works.
4. Connect a missing name (e.g. type `vb_missing0`) — status shows `iface_not_found`.

Automated: `npm run test:bus` and `npm run test:bus-bridge`.

## Virtualized Trace

1. Bring up and Connect vcan0 as above. Load `fixtures/dbc/sample.dbc`.
2. Inject frames from another terminal:
   `cansend vcan0 100#E8035A0A00000000` or `cangen vcan0 -n 20 -I 123`.
3. The Trace table should show Time / Bus / ID / Name / DLC / Data / Rate (ms) /
   Dir within ~200 ms. Expand a named row for signal name / value / unit.
   Filter, Pause, Clear, and Scroll lock stay interactive under load. The ring
   keeps at most 20_000 frames (drop-oldest).

Automated: `npm run test:trace` (synthetic first-paint + optional live vcan N2).
M1 vertical slice: `npm run test:smoke` (same N2 path + DBC name / `rate_ms`;
live SKIP if vcan0 is not UP). Headless Electron hello:
`xvfb-run -a npm run test:smoke:electron` (SKIP without display/vcan/build).
Also `npm run test:rx` / `test:rx-bridge` (skip live if vcan0 is not UP).
Rate median: `npm run test:rate`.

## DBC load / unpack

1. Open vcan0 as above.
2. Set the header DBC path to `fixtures/dbc/sample.dbc` (or `mux.dbc`) and **Load**.
3. Inject a known ID, e.g. `cansend vcan0 100#E8035A0A00000000` — Trace shows
   `EngineStatus`; expand the row for `EngineSpeed` / value / `rpm`.
4. Inject an unknown ID (`cansend vcan0 7FF#DEADBEEF`) — the row stays raw.

Automated: `npm run test:dbc` and `npm run test:dbc-bridge`.

## Raw transmit (T12)

1. Connect vcan0 as above. Open the **Transmit** tab.
2. Raw send: ID `0x7E0`, data hex, **Send** (single-shot) or **Start** (cyclic, period ms).
3. Active cyclic jobs lists engine-owned jobs; **Stop** ends one by `job_id`.
4. The client-side footer shows Tx count / Errors / Last Tx (no Bus Load %).
5. Switch to Trace — the TX echo (`dir=tx`) should appear for that ID. A peer
   `candump vcan0` / python-can recv also sees the wire frame.

DBC pack: pick a catalog message, edit physical signal values, **Send**
or **Start cyclic**. The engine encodes with cantools (unknown message /
pack failure → `engine.error`). Active jobs lists both Raw and DBC rows.

Automated: `npm run test:tx` (T12 raw + cyclic), `npm run test:tx-dbc`
(golden pack + cyclic DBC ±10%; SKIP live if no vcan), and
`npm run test:tx-bridge`.

## Graph (T11)

1. Connect a bus and **Load** a DBC as above (or use DEV **Demo** on Graph).
2. Open the **Graph** tab. The left picker lists catalog signals from
   `dbc.load` plus any `decode.signals` already seen on `rx.batch`.
3. Check signals to plot. Window chips set 10s / 30s / 60s of history.
   **Pause** freezes Graph only — Trace keeps its own pause.
4. uPlot redraws at 10–30 Hz. Samples older than the window are dropped.
   Multiplexed signals appear only when they are present on `decode.signals`.

Automated: `npm run test:graph` (synthetic decimation / pause / window;
live SKIP if vcan0 is not UP).
