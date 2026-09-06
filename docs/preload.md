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

`loadDbc` / `clearDbc` return `{ ok: true, message_count }` / `{ ok: true }` or
`{ ok: false, error: { code, message } }`. Engine codes include
`path_not_allowed`, `dbc_not_found`, `dbc_invalid`, and `bus_not_found`.
The renderer forwards a repo-relative fixture path; cantools runs in the engine.

The renderer never receives Unix-socket frames, SocketCAN handles, or DBC
objects. It may display `decode.name` / a few `decode.signals` from `rx.batch`.

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
| `vanillabus:rx-batch` | event | `RxBatch` (`frames`, `dropped`) |

T2 engine IPC (`engine.hello`, `engine.heartbeat`, respawn) is unchanged.
`rx.batch` is a T5 stub plus T6 `rate_ms` and optional T7 `decode`. Not Trace.

## Observing Disconnected

1. `npm run dev` — the shared header **Engine Connected** pill lights after
   hello (name + version stay on the Trace body). The pill is on every tab.
2. Kill the engine: `pkill -f 'python3 -m can_engine'`.
3. The badge flips to **Disconnected** and a `disconnected` event is logged.
4. Main respawns the engine (~750 ms). After the next hello the badge is
   **Connected** again and a `connected` event is logged.

Automated: `npm run test:bridge` starts the supervisor, waits for hello, kills
the child PID, and asserts a `disconnected` then `connected` transition.

## List / open / close

1. Bring up an iface: `sudo ./scripts/setup-vcan.sh`
2. Click **List buses** — `vcan0` should appear with kind `vcan` and state `up`.
3. **Open** returns a `busId`. **Close** then **Open** again works (new id).
4. Open a missing name (e.g. `vb_missing0`) — status shows `iface_not_found`.

Automated: `npm run test:bus` and `npm run test:bus-bridge`.

## Raw RX stub

1. Bring up and open vcan0 as above.
2. Inject frames from another terminal:
   `cansend vcan0 123#11223344` or `cangen vcan0 -n 20 -I 123`.
3. The **RX stub** list should show ID / name / DLC / data / time / Rate (ms) /
   a couple of signals within ~200 ms. The first frame per
   `(busId, can_id, is_eff)` shows `—` for rate; unknown IDs show `—` for name.

Automated: `npm run test:rx` and `npm run test:rx-bridge` (skip if vcan0 is not UP).
Rate median: `npm run test:rate` (synthetic timestamps; optional live vcan).

## DBC load / unpack

1. Open vcan0 as above.
2. Click **Sample DBC** or **Mux DBC** on the open bus (paths
   `fixtures/dbc/sample.dbc` / `fixtures/dbc/mux.dbc`).
3. Inject a known ID, e.g. `cansend vcan0 100#E8035A0A00000000` — the RX stub
   should show `EngineStatus` and `EngineSpeed=250`.
4. Inject an unknown ID (`cansend vcan0 7FF#DEADBEEF`) — the row stays raw.

Automated: `npm run test:dbc` and `npm run test:dbc-bridge`.
