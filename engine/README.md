# vanillabus-engine

Python package for the VanillaBus CAN engine.

Listens on a Unix domain socket (`--ipc <path>`) and speaks length-prefixed
JSON. T4 implements `engine.hello`, `engine.heartbeat`, `engine.error`, and
`bus.list` / `bus.open` / `bus.close` via **python-can** SocketCAN.

The engine binds an iface only if it already exists and is UP. It never
`ip link set up`. See [docs/privileges.md](../docs/privileges.md).

## Install (editable)

From the repository root:

```bash
python3 -m pip install -e engine/
```

This pulls in `python-can`.

## Run

```bash
python3 -m can_engine --ipc "$XDG_RUNTIME_DIR/vanillabus-test.sock"
```

Electron main normally spawns this process. Prove the handshake and bus RPCs
without Electron:

```bash
python3 scripts/test-ipc-hello.py
python3 scripts/test-bus-open.py
```
