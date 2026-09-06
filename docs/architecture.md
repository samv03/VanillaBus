# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → engine Connected status only     │
│  renderer → React UI (no CAN / no DBC)      │
└──────────────────┬──────────────────────────┘
                   │ UDS: 4-byte BE length + JSON
                   │ (see docs/ipc.md)
┌──────────────────▼──────────────────────────┐
│ vanillabus-engine  (python3 -m can_engine)  │
│  can_engine/  SocketCAN + DBC later         │
└─────────────────────────────────────────────┘
```

## Process split

- **Renderer** is a React view. It must not talk to SocketCAN or parse DBC.
- **Main** owns the window, the Unix-socket path, and a **minimal** engine
  supervisor (spawn, log disconnect, respawn). Full hardening is later (T16).
- **Preload** exposes a narrow API: app version + engine connection status
  derived from `engine.hello`. No bus or DBC surface.
- **Engine** is a Python package. All bus I/O and DBC work belongs here.

## T2 vs later

T2 wires live IPC: `engine.hello`, `engine.heartbeat`, `engine.error`,
length-prefixed framing, and a hello integration script. It does **not**
open SocketCAN, load DBC, or ship Trace/Graph/Transmit UI.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
