# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → window.vanillabus (typed)        │
│  renderer → status + list/open + RX stub    │
└──────────────────┬──────────────────────────┘
                   │ UDS: 4-byte BE length + JSON
                   │ (see docs/ipc.md)
┌──────────────────▼──────────────────────────┐
│ vanillabus-engine  (python3 -m can_engine)  │
│  can_engine/  python-can SocketCAN + cantools DBC unpack
└─────────────────────────────────────────────┘
```

## Process split

- **Renderer** is a React view. It must not talk to SocketCAN or parse DBC.
- **Main** owns the window, the Unix-socket path, and a **minimal** engine
  supervisor (spawn, log disconnect, respawn, request/response). Full
  hardening is later (T16).
- **Preload** exposes `window.vanillabus`: engine status plus `listBuses` /
  `openBus` / `closeBus` / `loadDbc` / `clearDbc` / `onRxBatch`. No raw
  sockets or SocketCAN handles. Types live in `shared/engine.ts`.
- **ipc-bridge** (main) maps supervisor host events, bus/DBC RPCs, and
  `rx.batch` onto those preload channels.
- **Engine** is a Python package. All bus I/O and DBC unpack belong here
  (python-can + cantools). After `bus.open` a recv thread batches frames onto
  IPC. `dbc.load` binds one DBC per busId. Interfaces must already be UP; see
  [privileges.md](privileges.md).

## T7 vs later

T7 loads a DBC per open busId and attaches `decode` (`name` + `signals`) on
known RX frames. Unknown IDs stay raw. It is not production Trace (T9), Graph
(T11), or TX pack (T13). T4–T6 bus/RX/`rate_ms` stay as they are. The engine
does not bring interfaces up or set bitrate via `CAP_NET_ADMIN`.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
