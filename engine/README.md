# vanillabus-engine

Python package for the VanillaBus CAN engine.

T2 listens on a Unix domain socket (`--ipc <path>`) and speaks length-prefixed
JSON (`engine.hello`, `engine.heartbeat`, `engine.error`). SocketCAN I/O and
DBC decode are not implemented yet.

## Install (editable)

From the repository root:

```bash
python3 -m pip install -e engine/
```

## Run

```bash
python3 -m can_engine --ipc "$XDG_RUNTIME_DIR/vanillabus-test.sock"
```

Electron main normally spawns this process. Prove the handshake without Electron:

```bash
python3 scripts/test-ipc-hello.py
```
