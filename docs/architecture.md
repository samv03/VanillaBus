# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → window.vanillabus (typed)        │
│  renderer → shell (Trace | Graph | Transmit)│
└──────────────────┬──────────────────────────┘
                   │ UDS: 4-byte BE length + JSON
                   │ (see docs/ipc.md)
┌──────────────────▼──────────────────────────┐
│ vanillabus-engine  (python3 -m can_engine)  │
│  can_engine/  python-can SocketCAN + cantools DBC unpack
└─────────────────────────────────────────────┘
```

## Process split

- **Renderer** is a React view with a sticky top-tab shell (Trace | Graph |
  Transmit) and one shared bus/DBC header. Tab state is the URL hash
  (`#trace`, `#graph`, `#transmit`). Switching tabs does not respawn the
  engine. It must not talk to SocketCAN or parse DBC.
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

## T8 vs later

T8 is app chrome only: top tabs plus a shared header (bus dropdown,
Connect/Disconnect, DBC path + Load, engine/bus pills). Trace still hosts the
T5–T7 RX stub. Graph is a T11 placeholder; Transmit is a T12/T13 placeholder.
It is not virtualized Trace (T9), uPlot (T11), or TX send/pack (T12/T13).
T4–T7 bus/RX/`rate_ms`/DBC unpack stay as they are. The engine does not bring
interfaces up or set bitrate via `CAP_NET_ADMIN`.

Layout (T8): top tabs, not a left rail. Theme is dark engineering
(`#0d1117` / `#161b22`); IDs, hex, and rate use monospace.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
