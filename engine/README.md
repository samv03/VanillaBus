# vanillabus-engine

Python package for the VanillaBus CAN engine.

Listens on a Unix domain socket (`--ipc <path>`) and speaks length-prefixed
JSON. After `bus.open` a recv thread emits `rx.batch` (≤16 ms or ≤500
frames). T6 fills `rate_ms` as the last inter-arrival (`(Δts_us)/1000`) per
`(busId, can_id, is_eff)`. T7 loads one DBC per busId (`dbc.load` /
`dbc.clear`) via **cantools** and attaches `decode` (`name`, `signals`,
`units`) on known RX frames. Unknown IDs stay raw. T12 adds raw `tx.send`
and engine-owned `tx.cyclic.start` / `tx.cyclic.stop`. T13 packs DBC
payloads (`message` + `signals`) with cantools using the DBC already
bound to `busId`, then sends the raw frame. Successful TX is echoed
with `dir=tx` onto `rx.batch`. T14 keeps several buses open at once;
each `busId` has an independent DBC / RX pump / rate / TX jobs. Close
clears only that busId's rate, DBC, and cyclic jobs.

The engine binds an iface only if it already exists and is UP. It never
`ip link set up`. See [docs/privileges.md](../docs/privileges.md).
`bus.list` adds driver / vendor / blacklist metadata from sysfs and
`/etc/modprobe.d` (Peak chardev / Kvaser LinuxCAN). Vendor SocketCAN
matrix: [docs/socketcan-vendors.md](../docs/socketcan-vendors.md).

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
python3 scripts/test-vendor-metadata.py
python3 scripts/test-rx-batch.py
python3 scripts/test-rate-ms.py
python3 scripts/test-dbc-unpack.py
python3 scripts/test-tx.py
python3 scripts/test-tx-dbc.py
python3 scripts/test-multibus.py
```

The M1 desktop smoke (`npm run test:smoke` from the repo root) also spawns
this engine, opens `vcan0` when it is UP, loads `fixtures/dbc/sample.dbc`,
and checks `decode.name` + `rate_ms` on `rx.batch`. See
[docs/smoke.md](../docs/smoke.md).
