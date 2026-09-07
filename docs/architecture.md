# VanillaBus architecture

VanillaBus is a SocketCAN-first desktop bus monitor.

```
┌─────────────────────────────────────────────┐
│ Electron desktop (npm run dev)              │
│  main  → window + engine spawn / restart    │
│  preload → window.vanillabus (typed)        │
│  renderer → shell + Trace + Graph + Transmit│
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
  engine. Trace is a virtualized table (react-virtuoso) over a 20_000-frame
  drop-oldest ring. Graph is a uPlot live plot over the same `rx.batch`
  decode stream (independent pause, 10–30 Hz UI decimation). Transmit is
  raw one-shot + cyclic TX (T12) and DBC pack/encode (T13). The renderer
  must not talk to SocketCAN or parse DBC.
- **Main** owns the window, the Unix-socket path, and the engine supervisor
  (spawn, log disconnect, respawn, request/response). T16 hardens
  backpressure, OOM caps, IPC framing, and restart under load — see
  [hardening.md](hardening.md).
- **Preload** exposes `window.vanillabus`: engine status plus `listBuses` /
  `openBus` / `closeBus` / `loadDbc` / `clearDbc` / `sendFrame` /
  `startCyclic` / `stopCyclic` / `onRxBatch`. No raw sockets or SocketCAN
  handles. Types live in `shared/engine.ts`.
- **ipc-bridge** (main) maps supervisor host events, bus/DBC/TX RPCs, and
  `rx.batch` onto those preload channels.
- **Engine** is a Python package. All bus I/O and DBC unpack belong here
  (python-can + cantools). After `bus.open` a recv thread batches frames onto
  IPC. Several buses may be open at once (T14): each `busId` has its own
  RX pump, DBC, rate keys, and cyclic TX jobs. `tx.send` / `tx.cyclic.*`
  are engine-owned SocketCAN sends (raw bytes or cantools-packed DBC
  signals) on that `busId` only. Successful TX is echoed with `dir=tx`
  onto **that** bus's RX queue. `dbc.load` binds one DBC per busId.
  Interfaces must already be UP; see [privileges.md](privileges.md).

## T9 vs later

T8 is app chrome: top tabs plus a shared header (bus dropdown,
Connect/Disconnect, DBC path + Load, engine/bus pills). T9 replaces the T5 RX
stub with a production virtualized Trace (`react-virtuoso`): filter, pause,
clear, scroll lock, expandable DBC signals, and a 20_000-frame drop-oldest
ring. T10 is the M1 exit smoke: one bus, fixture DBC, `rate_ms`, and the N2
<50 ms first-paint gate (`npm run test:smoke`). Graph is T11 (uPlot + DBC
signal picker). Transmit T12 is raw one-shot + cyclic TX; T13 fills DBC pack.
T14 (M3) is concurrent multi-bus + one DBC per bus (`npm run test:multibus`).
T15 adds the vendor SocketCAN matrix, `bus.list` driver/vendor/blacklist
metadata, and privilege / CAN FD docs — still SocketCAN-only, no vendor
SDKs. T16 (M4 start) hardens RX drop-oldest + `dropped`, batch ≤16–33 ms
or ≤500 frames, queue / Trace / Graph / rate-key caps, IPC oversized and
partial-read rejection, and supervisor restart under load
(`npm run test:harden`). T4–T7 bus/RX/`rate_ms`/DBC unpack stay as they
are. The engine does not bring interfaces up or set bitrate via
`CAP_NET_ADMIN`. See [smoke.md](smoke.md) for the Xvfb/headless CI path,
[hardening.md](hardening.md) for T16, and
[socketcan-vendors.md](socketcan-vendors.md) for Peak / Kvaser / IXXAT.

Layout (T8): top tabs, not a left rail. Theme is dark engineering
(`#0d1117` / `#161b22`); IDs, hex, and rate use monospace.

Linux SocketCAN (`can0`, `vcan0`) is the first-class backend. There is no
`native/can-helper` tree and no Peak/Kvaser/IXXAT proprietary SDK in this
repository. Peak and Kvaser use mainline `peak_usb` / `kvaser_usb`; IXXAT
is HMS SocketCAN OOT/DKMS (`ix_usb_can`) on Ubuntu 22.04 and 24.04.
