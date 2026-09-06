# Preload API (`window.vanillabus`)

The renderer talks to the engine **only** through this context-bridge surface.
It is typed in `shared/engine.ts` and implemented by `electron/preload/index.ts`.
Main maps supervisor status onto it in `electron/main/ipc-bridge.ts`.

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

The renderer never receives Unix-socket frames, file paths, SocketCAN handles,
or DBC objects.

## IPC channels (main ↔ preload)

| Channel | Kind | Payload |
| --- | --- | --- |
| `vanillabus:engine-info` | invoke + event | `EngineInfo` |
| `vanillabus:engine-event` | event | `EngineConnectionEvent` |

T2 engine IPC (`engine.hello`, `engine.heartbeat`, respawn) is unchanged. This
bridge only relays host status.

## Observing Disconnected

1. `npm run dev` — badge shows **Connected** after hello, with name + version.
2. Kill the engine: `pkill -f 'python3 -m can_engine'`.
3. The badge flips to **Disconnected** and a `disconnected` event is logged.
4. Main respawns the engine (~750 ms). After the next hello the badge is
   **Connected** again and a `connected` event is logged.

Automated: `npm run test:bridge` starts the supervisor, waits for hello, kills
the child PID, and asserts a `disconnected` then `connected` transition.
