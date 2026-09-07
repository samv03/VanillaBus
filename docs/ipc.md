# VanillaBus IPC contract

Electron **main** talks to `vanillabus-engine` over a Unix domain socket.
The renderer never sees this socket and must not open SocketCAN or parse DBC.
T3+ maps status and bus commands onto `window.vanillabus` (see
[docs/preload.md](preload.md)).

## Transport

- Stream of frames: **4-byte big-endian unsigned length** + **UTF-8 JSON**.
- Length is the JSON byte count only (not including the header).
- Maximum payload: **1 MiB**. Length `0` or `> 1 MiB` is rejected; the engine
  sends `engine.error` and closes that connection. The process stays up.
- Socket path is chosen by main:
  - `$XDG_RUNTIME_DIR/vanillabus/engine-<pid>.sock` when that directory is usable
  - otherwise a **0700** directory from `mkdtemp` (never a world-writable
    predictable path such as `/tmp/vanillabus.sock`)
- Socket file mode **0600**. Engine is passed `--ipc <path>` and listens.

## Envelope

```json
{ "type": "engine.hello", "id": "optional", "payload": {} }
```

`id` is echoed on request/response. Events may omit it.

## Live

| Type | Direction | Payload |
| --- | --- | --- |
| `engine.hello` | engine → main on connect; also request/response | `{ "name": "vanillabus-engine", "version": "…", "backends": ["socketcan"] }` |
| `engine.heartbeat` | engine event, ~2s | `{ "ts_us": <int microseconds> }` |
| `engine.error` | engine event / failed request | `{ "code": "<str>", "message": "<str>" }` |
| `bus.list` | request/response | `{ "interfaces": [{ "name", "kind", "state", "driver"?, "vendor"?, "module"?, "blacklist"?, "blacklist_reason"? }], "warnings"? }` — `name`/`kind`/`state` stay required. Optional T15 vendor metadata and host-level Peak/Kvaser SDK blacklist warnings. |
| `bus.open` | request `{ "name", "bitrate"? }` → `{ "busId" }` | Bind only if the iface exists and is UP. Several buses may be open at once (one handle per iface). `bitrate` optional; ignored for vcan. Missing/down/already-open → `engine.error` (`iface_not_found` / `iface_down` / `iface_already_open`). Never `ip link set up`. |
| `bus.close` | request `{ "busId" }` → `{ "ok": true }` | Tears down only that `busId` (RX pump, DBC, rate keys, cyclic jobs). Other open buses stay up. Reopen after close is allowed (new `busId`). |
| `rx.batch` | engine event | `{ "frames": [FrameEvent, …], "dropped": <int> }` — after `bus.open`, ≤16 ms or ≤500 frames. `rate_ms` is last inter-arrival ms, or `null` on the first sample per `(busId, can_id, is_eff)`. Known IDs may include `decode: { name, signals }` when a DBC is bound. |
| `dbc.load` | request `{ "busId", "path" }` → `{ "ok": true, "message_count", "catalog"? }` | One DBC per open busId, loaded with cantools. Optional `catalog` lists message/signal names for the Graph picker. Path must resolve under the project/fixtures allowlist. Failures: `engine.error` (`path_not_allowed`, `dbc_not_found`, `dbc_invalid`, `bus_not_found`). |
| `dbc.clear` | request `{ "busId" }` → `{ "ok": true }` | Unload the DBC for that bus. Idempotent if none is loaded. |
| `tx.send` | request raw `{ "busId", "can_id", "data", … }` **or** DBC `{ "busId", "message", "signals" }` → `{ "ok": true }` | One-shot TX on an open bus. Hex `data` may include spaces. DBC pack uses the cantools database already loaded for `busId` (no parse in the renderer). Failures: `engine.error` (`bus_not_found`, `invalid_payload`, `tx_failed`, `dbc_not_loaded`, `unknown_message`, `pack_failed`). Echoes a FrameEvent with `dir=tx` onto `rx.batch` so Trace can show TX (SocketCAN recv-own-msgs stays off). |
| `tx.cyclic.start` | request raw `{ "busId", "can_id", "data", "period_ms", … }` **or** DBC `{ "busId", "message", "signals", "period_ms" }` → `{ "job_id" }` | Engine-owned periodic TX. DBC jobs pack once at start and repeat the raw frame. `period_ms` ≥ 1. Missed ticks are skipped (stretch) instead of bursting. |
| `tx.cyclic.stop` | request `{ "job_id" }` → `{ "ok": true }` | Stop one cyclic job (raw or DBC). Unknown id → `job_not_found`. `bus.close` stops every job on that busId. |

Unknown request types get `engine.error` with `code: "not_implemented"`.

See [privileges.md](privileges.md) for pre-UP / no-root rules and
[socketcan-vendors.md](socketcan-vendors.md) for the SocketCAN adapter
matrix. `bus.list` extra fields are optional; older clients that only
read `name` / `kind` / `state` keep working.

## FrameEvent (`rx.batch` / TX echo)

`busId`, `ifName`, `can_id`, `data` (hex, no spaces), `dlc`, `is_eff`, `is_fd`,
`brs`, `is_rtr`, `is_err`, `dir` (`rx`\|`tx`), `ts_us` (integer microseconds,
software clock), `rate_ms` = last `(Δts_us)/1000` for key `(busId, can_id,
is_eff)`, or `null` until a second sample. Not EMA. `is_fd` is not part of the
key until FD is enabled. Rate state for a `busId` is cleared on `bus.close`.

`decode` is optional: `{ "name": "<DBC message>", "signals": { "<sig>": <value> },
"units": { "<sig>": "<unit>" } }` when a DBC is bound and the CAN ID is known.
`units` is omitted or empty when the DBC has no unit strings. Unknown IDs (or
decode failures) keep the raw frame and set `decode` to `null`. The renderer
never parses DBC.

If the engine RX queue backs up, oldest frames are dropped and `dropped` counts
them. The Trace UI also keeps a 20_000-frame drop-oldest ring so renderer
memory stays bounded.

See `shared/ipc-schema.json` for the machine-readable shapes.
