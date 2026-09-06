# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → window.vanillabus (typed)        │
│  renderer → Connected / Disconnected UX     │
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
- **Preload** exposes `window.vanillabus`: `getEngineInfo()`, status
  subscribe, and connected / disconnected events derived from `engine.hello`.
  No bus, DBC, fs, or SocketCAN surface. Types live in `shared/engine.ts`.
- **ipc-bridge** (main) maps supervisor host events onto those preload
  channels. T2 hello / heartbeat / respawn stay in the supervisor.
- **Engine** is a Python package. All bus I/O and DBC work belongs here.

## T2 vs later

T2 wires live IPC: `engine.hello`, `engine.heartbeat`, `engine.error`,
length-prefixed framing, and a hello integration script. T3 formalizes the
preload context-bridge and Connected / Disconnected renderer states. Neither
opens SocketCAN, loads DBC, or ships Trace/Graph/Transmit UI.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser SDK in this repository.
