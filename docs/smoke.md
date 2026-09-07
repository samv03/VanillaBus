# M1 smoke (T10)

Single-bus **Trace + DBC + rate_ms** vertical slice. This is the M1 exit
gate. It does not add Graph (T11) or Transmit (T12/T13).

## `npm run test:smoke`

Orchestrated Node smoke (`scripts/test-smoke.ts`). Always:

1. Reuses the T9 N2 first-paint path (`shared/traceN2.ts` /
   `shared/tracePaint.ts`): append a ≤2 kfps synthetic stream (32-frame /
   16 ms batches) and paint only the visible window (~24 rows) + HTML proxy.
2. Asserts first-paint and every subsequent batch stay **<50 ms**.
3. After that fill, asserts filter / pause / clear stay under the same
   50 ms budget (model-level “UI stays interactive under load”).

If `vcan0` is UP:

1. Spawn `vanillabus-engine` via `EngineSupervisor`.
2. `bus.open vcan0`.
3. `dbc.load fixtures/dbc/sample.dbc`.
4. Inject `EngineStatus` (`0x100` / `E8035A0A00000000`) with python-can
   (or `cansend` if python-can is missing).
5. Assert `rx.batch` frames carry `decode.name === "EngineStatus"` and a
   numeric `rate_ms` after enough samples.
6. Time live first-paint of the first `rx.batch`, plus a 2 kfps burst when
   extra batches arrive.

If `vcan0` is not UP the live step prints:

```text
SKIP vcan0 M1 smoke: vcan0 is not UP on this host. Bring it up with: sudo ./scripts/setup-vcan.sh
```

and still exits 0. Synthetic N2 is never skipped.

`npm run test:m1` runs `test:smoke` then the Electron stub below.

## Xvfb / headless Electron (CI)

Full GUI Trace driving is optional. CI should still have a **headless
Electron hello** path so the desktop process can start without a real
display.

```bash
sudo apt-get install -y xvfb
npm run build
xvfb-run -a npm run test:smoke:electron
```

`scripts/smoke-electron.sh` launches the **built** app with
`VANILLABUS_SMOKE=1`. Main waits for `engine.hello` and exits 0. The
window is not shown.

The stub **exits 0 with SKIP** when any of these are true:

- `vcan0` is not UP (`sudo ./scripts/setup-vcan.sh`)
- neither `DISPLAY` nor `xvfb-run` is available
- `out/main/index.js` is missing (`npm run build` first)
- the local `electron` binary is missing (`npm install` first)

Without a display and without Xvfb:

```text
SKIP electron smoke: no DISPLAY and no xvfb-run. For CI: sudo apt-get install -y xvfb && xvfb-run -a npm run test:smoke:electron
```

Creating vcan in CI needs `sudo` / `CAP_NET_ADMIN`. This repo does not
sudo from the smoke. Many runners will therefore SKIP the live / Electron
steps and still pass on the synthetic N2 gate.

## Suggested CI job

```bash
npm ci
python3 -m pip install -e engine/
npm run typecheck
npm run build
npm run test:trace
npm run test:smoke          # N2 always; live SKIP without vcan
xvfb-run -a npm run test:smoke:electron   # SKIP without vcan / build
```
