# DBC fixtures

Engine-side only. The renderer never parses these files.

| File | Purpose |
| --- | --- |
| `sample.dbc` | Classic messages (`EngineStatus` 0x100, `VehicleSpeed` 0x101) |
| `mux.dbc` | Basic multiplex: `MuxId` + `CoolantTemp` (m0) / `FuelPressure` (m1) |
| `invalid.dbc` | Allowlisted path that must fail `dbc.load` with `engine.error` |

Unpack vectors live in [`fixtures/golden/`](../golden/).
