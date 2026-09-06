# Unpack goldens

Expected cantools decode for the T7 fixtures. Used by `scripts/test-dbc-unpack.py`.

| File | DBC | Coverage |
| --- | --- | --- |
| `sample_unpack.json` | `fixtures/dbc/sample.dbc` | `EngineStatus`, `VehicleSpeed`, unknown ID |
| `mux_unpack.json` | `fixtures/dbc/mux.dbc` | mux m0 (`CoolantTemp`), mux m1 (`FuelPressure`), unknown ID |
