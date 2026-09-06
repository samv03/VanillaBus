# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → window.vanillabus (typed)        │
│  renderer → status + SocketCAN list/open    │
└──────────────────┬──────────────────────────┘
                   │ UDS: 4-byte BE length + JSON
                   │ (see docs/ipc.md)
┌──────────────────▼──────────────────────────┐
│ vanillabus-engine  (python3 -m can_engine)  │
│  can_engine/  python-can SocketCAN + DBC later
└─────────────────────────────────────────────┘
```

## Process split

- **Renderer** is a React view. It must not talk to SocketCAN or parse DBC.
- **Main** owns the window, the Unix-socket path, and a **minimal** engine
  supervisor (spawn, log disconnect, respawn, request/response). Full
  hardening is later (T16).
- **Preload** exposes `window.vanillabus`: engine status plus `listBuses` /
  `openBus` / `closeBus`. No raw sockets, fs, or SocketCAN handles. Types
  live in `shared/engine.ts`.
- **ipc-bridge** (main) maps supervisor host events and bus RPCs onto those
  preload channels.
- **Engine** is a Python package. All bus I/O belongs here (python-can
  SocketCAN). Interfaces must already be UP; see [privileges.md](privileges.md).

## T4 vs later

T4 implements `bus.list` / `bus.open` / `bus.close` (iface map + `busId`).
It does not stream RX, load DBC, or ship Trace/Graph/Transmit UI. It does
not bring interfaces up or set bitrate via `CAP_NET_ADMIN`.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
