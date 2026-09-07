# Unpack / pack goldens

Expected cantools decode (T7) and encode (T13) for the fixture DBCs.
Unpack is used by `scripts/test-dbc-unpack.py`. Pack + pack→unpack
round-trip is used by `scripts/test-tx-dbc.py`.

| File | DBC | Coverage |
| --- | --- | --- |
| `sample_unpack.json` | `fixtures/dbc/sample.dbc` | `EngineStatus`, `VehicleSpeed`, unknown ID |
| `mux_unpack.json` | `fixtures/dbc/mux.dbc` | mux m0 (`CoolantTemp`), mux m1 (`FuelPressure`), unknown ID |
| `sample_pack.json` | `fixtures/dbc/sample.dbc` | `EngineStatus` nominal + zeros, `VehicleSpeed` 80 |
| `mux_pack.json` | `fixtures/dbc/mux.dbc` | mux m0 (`CoolantTemp`), mux m1 (`FuelPressure`) |
