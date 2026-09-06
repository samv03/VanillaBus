# VanillaBus architecture (T1 stub)

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + future engine spawn       │
│  preload → contextBridge stub (T1 empty-ish)│
│  renderer → React UI (hello window only)    │
└──────────────────┬──────────────────────────┘
                   │ later: IPC per shared/ipc-schema.json
┌──────────────────▼──────────────────────────┐
│ vanillabus-engine (pip install -e engine/)  │
│  can_engine/  SocketCAN + DBC (not in T1)   │
└─────────────────────────────────────────────┘
```

## Process split

- **Renderer** is a React view. It must not talk to SocketCAN or parse DBC.
- **Main** owns the window and will later spawn/supervise the engine.
- **Preload** will expose a narrow, schema-aligned API (`engine.hello`,
  `heartbeat`, `bus.*`, `dbc.load`, `rx.batch`, `tx.*`).
- **Engine** is a Python package. All bus I/O and DBC work belongs here.

## T1 vs later

T1 is an installable scaffold: hello window + editable Python package +
IPC schema stub + host/vcan scripts. No live IPC, no CAN I/O, and no
Trace/Graph/Transmit UI.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
