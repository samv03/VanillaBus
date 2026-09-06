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
| `bus.list` | request/response | `{ "interfaces": [{ "name", "kind", "state": "up"\|"down" }] }` |
| `bus.open` | request `{ "name", "bitrate"? }` → `{ "busId" }` | Bind only if the iface exists and is UP. `bitrate` optional; ignored for vcan. Missing/down → `engine.error` (`iface_not_found` / `iface_down`). Never `ip link set up`. |
| `bus.close` | request `{ "busId" }` → `{ "ok": true }` | Reopen after close is allowed (new `busId`). |

Unknown request types get `engine.error` with `code: "not_implemented"`.

See [docs/privileges.md](privileges.md) for pre-UP / no-root rules.

## Reserved (schema only; no DBC/RX/TX runtime in T4)

`dbc.load` · `dbc.clear` · `rx.batch` · `tx.send` ·
`tx.cyclic.start` · `tx.cyclic.stop`

## Frame object (for later `rx.batch` / `tx.*`)

`can_id`, `data` (hex), `dlc`, `is_eff`, `is_fd`, `brs`, `dir` (`rx`\|`tx`),
`ts_us` (integer microseconds), `rate_ms` = `(Δts_us)/1000` or `null` until a
second sample for that `can_id`.

See `shared/ipc-schema.json` for the machine-readable shapes.
