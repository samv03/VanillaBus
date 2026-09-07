# VanillaBus hardening (T16)

Backpressure, memory bounds, IPC safety, and engine restart under load.
Polish / persist is T17 and is out of scope here.

## RX backpressure

The engine recv thread (`RxPump`) uses a **drop-oldest** queue of at most
**4096** frames per open bus. Overflow increments a cumulative `dropped`
counter that is copied onto every `rx.batch` payload.

The IPC flush loop emits `rx.batch` when **≤16 ms** have passed *or*
**≤500 frames** are ready, whichever first. Under flood it drains and
sends 500-frame batches immediately (still ≤500). A trickle waits the
16 ms idle interval, so pending frames never sit longer than **33 ms**.

The Trace toolbar and Graph footer show `dropped` when it is non-zero
(engine drops + Trace ring overflow).

## Memory bounds

| Buffer | Cap | Policy |
| --- | --- | --- |
| Engine RX queue (per bus) | 4096 | drop-oldest |
| `rx.batch` | 500 frames | flush / split |
| Rate tracker keys | 8192 | evict oldest unique IDs |
| Trace ring | 20_000 | drop-oldest (UI) |
| Graph samples | `windowSec × Hz + 2` | trim + hard cap |
| Graph series | 256 | evict idle (unselected) |
| Graph catalog | 512 | evict idle (unselected) |

Sustained unique-ID or high-rate flood must not grow these structures
past the caps. Filter rebuild cost over a full 20k Trace ring is left
for T17.

## IPC safety

Length-prefixed JSON (4-byte BE + UTF-8):

- Length `0` or `> 1 MiB` → `engine.error` (`invalid_length` /
  `payload_too_large`) and the session closes. The engine process stays up.
- Partial header or payload after the first byte times out in **2 s**
  instead of hanging the session.
- Malformed JSON is rejected the same way.
- Socket path stays under `$XDG_RUNTIME_DIR/vanillabus/` (0700) or a
  private `mkstemp` dir — never a world-writable predictable `/tmp` path.
- DBC paths must resolve under the project / fixtures allowlist
  (including `..` and symlink escapes).

Main also caps in-flight engine RPCs at **128** (`backpressure`).

## Engine restart under load

`EngineSupervisor` already respawns on crash (T2/T3). T16 adds a load
path: kill the child while RX/TX or IPC requests are in flight. Pending
RPCs reject with `engine_disconnected`; the UI observes Disconnected then
Connected. After hello, `bus.list` / reopen / further `rx.batch` work
without a hung request.

Open-bus state lives in the engine process, so a restart clears opens,
DBC bindings, and cyclic TX. The shell reconnects; the user (or a later
persist task) re-opens buses.

## How to run harden tests

```bash
npm run test:harden
```

This is offline-first:

1. `python3 scripts/test-harden.py` — flush policy, RX queue cap, drop
   counter, rate-key cap, IPC oversized / malformed / partial-read, DBC
   traversal, pump restart under a synthetic flood.
2. `tsx --test scripts/test-harden.ts` — FrameDecoder, IPC path, Trace
   20k flood, Graph caps, supervisor restart under IPC load.

If `vcan0` is UP, both scripts also run a live flood / restart-under-load
slice. If not, they print `SKIP` and still exit 0.

Prior suites stay green (`typecheck`, `build`, `test:rx`, `test:bridge`,
`test:trace`, `test:graph`, `test:smoke`, …). Do not `npm audit fix --force`
to chase Electron majors.

See [ipc.md](ipc.md) for the framing contract and
[architecture.md](architecture.md) for process split.
