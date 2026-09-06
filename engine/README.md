# vanillabus-engine

Python package for the VanillaBus CAN engine.

Listens on a Unix domain socket (`--ipc <path>`) and speaks length-prefixed
JSON. T5 adds a raw RX stub: after `bus.open` a recv thread emits `rx.batch`
(≤16 ms or ≤500 frames). T6 fills `rate_ms` as the last inter-arrival
(`(Δts_us)/1000`) per `(busId, can_id, is_eff)`. T7 loads one DBC per busId
(`dbc.load` / `dbc.clear`) via **cantools** and attaches `decode` on known
RX frames. Unknown IDs stay raw. Close clears that busId's rate and DBC
state.

The engine binds an iface only if it already exists and is UP. It never
`ip link set up`. See [docs/privileges.md](../docs/privileges.md).

## Install (editable)

From the repository root:

```bash
python3 -m pip install -e engine/
```

This pulls in `python-can` and `cantools`.

## Run

```bash
python3 -m can_engine --ipc "$XDG_RUNTIME_DIR/vanillabus-test.sock"
```

Electron main normally spawns this process. Prove the handshake, bus RPCs,
and DBC unpack without Electron:

```bash
python3 scripts/test-ipc-hello.py
python3 scripts/test-bus-open.py
python3 scripts/test-rx-batch.py
python3 scripts/test-rate-ms.py
python3 scripts/test-dbc-unpack.py
```
