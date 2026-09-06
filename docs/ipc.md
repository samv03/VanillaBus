# VanillaBus IPC contract (T2)

Electron **main** talks to `vanillabus-engine` over a Unix domain socket.
The renderer never sees this socket and must not open SocketCAN or parse DBC.

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

## Live in T2

| Type | Direction | Payload |
| --- | --- | --- |
| `engine.hello` | engine → main on connect; also request/response | `{ "name": "vanillabus-engine", "version": "…", "backends": ["socketcan"] }` |
| `engine.heartbeat` | engine event, ~2s | `{ "ts_us": <int microseconds> }` |
| `engine.error` | engine event | `{ "code": "<str>", "message": "<str>" }` |

Unknown request types get `engine.error` with `code: "not_implemented"`.

## Reserved (schema only; no SocketCAN/DBC/TX runtime in T2)

`bus.list` · `bus.open` · `bus.close` · `dbc.load` · `dbc.clear` ·
`rx.batch` · `tx.send` · `tx.cyclic.start` · `tx.cyclic.stop`

## Frame object (for later `rx.batch` / `tx.*`)

`can_id`, `data` (hex), `dlc`, `is_eff`, `is_fd`, `brs`, `dir` (`rx`\|`tx`),
`ts_us` (integer microseconds), `rate_ms` = `(Δts_us)/1000` or `null` until a
second sample for that `can_id`.

See `shared/ipc-schema.json` for the machine-readable shapes.
