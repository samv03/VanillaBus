# Final MVP release gate

Operator / developer scorecard for VanillaBus **final MVP**. This is the
canonical list used for CoS scoring. It does **not** invent timings: live
PASS below is a **narrative** from **sam-X570** (Ubuntu + vcan) as of
**2026-09-12**, plus the automated suites that already exist in-tree.
Unproven or not formally written up stays **OPEN**.

Documented host: **Ubuntu 22.04 or 24.04**. Electron stays on the **37.x**
pin (`37.10.3`). See [packaging.md](packaging.md).

## Canonical gate (quote)

Ship the SocketCAN-first desktop when these are true:

1. **Trace** stays usable with **more than one bus** open (virtualized
   table, filter / Pause / Clear, per-row `ifName`, DBC decode).
2. **Graph** plots decoded signals live (uPlot, DBC picker, independent
   Pause, UI-side decimation).
3. **Transmit** sends **raw and DBC-packed** one-shot + cyclic frames on
   the targeted bus.
4. **DBC mux** unpacks multiplexed messages (`fixtures/dbc/mux.dbc`).
5. **Isolation** — TX / RX / DBC / cyclic jobs on bus A never leak onto
   bus B unless the operator adds a kernel `can-gw` bridge.
6. **Multi-bus** — two or more ifaces open at once (`vcan0` + `vcan1`);
   closing one does not tear down the other.
7. **Vendor docs** — Peak / Kvaser mainline and IXXAT OOT/DKMS are
   documented; `bus.list` carries driver / vendor / blacklist metadata.
   Proprietary SDKs stay out of tree.
8. **Native rewrite decision** — keep the Python engine **or** trigger a
   native rewrite from the **M4 load** numbers (N2 / N4 / N3 below). The
   decision is **not** “ship native now”; it is “measure, then decide.”

Supporting M4 product work already in tree (not a substitute for item 8):
T16 harden (`test:harden`) and T17 persist (`test:persist`). Linux
**AppImage / `.deb`** plus the concept-A dock / header mark are packaging
exits, not a rewrite trigger.

## Scorecard (2026-09-12)

Status language:

| Tag | Meaning |
| --- | --- |
| **PASS (vcan)** | Live path ran on **sam-X570** with `vcan0` (and `vcan1` where required). Same scripts SKIP live and still exit 0 when those ifaces are down. |
| **PASS (offline)** | Suite always runs; no host CAN required. |
| **OPEN** | Not claimed. No formal write-up and/or no captured numbers. Do not treat as PASS. |

This repository has **no** GitHub Actions workflow that `sudo`s vcan. CI
hosts without `CAP_NET_ADMIN` will SKIP live slices. Do not read a green
offline job as “live vcan PASS.”

| Gate | What it is | Evidence | Status |
| --- | --- | --- | --- |
| **T9 / T10 Trace + N2 / smoke** | Virtualized Trace; M1 smoke = Trace + DBC + `rate_ms` + N2 first-paint | `test:trace`, `test:smoke` (synthetic always; live vcan on sam-X570) | **PASS (vcan)** |
| **T11 Graph** | Live uPlot + DBC picker + decimation | `test:graph` live on sam-X570 | **PASS (vcan)** |
| **T12 / T13 Transmit** | Raw + DBC one-shot and cyclic; cyclic median **±10%** | `test:tx`, `test:tx-dbc` live on sam-X570 | **PASS (vcan)** — cyclic ±10%, **not** N3 latency |
| **T7 DBC mux** | Golden unpack of `mux.dbc` (m0 / m1) + allowlist | `test:dbc` (golden always; live sample.dbc inject on sam-X570) | **PASS (vcan)** |
| **T14 isolation** | TX on A is not RX on B; per-bus DBC | `test:multibus` live after the peer-listen-before-`tx.send` fix | **PASS (vcan)** |
| **T14 multi-bus** | Concurrent `vcan0` + `vcan1`; close A leaves B | Same suite; needs **both** ifaces UP | **PASS (vcan)** |
| **T15 vendor docs** | Peak / Kvaser / IXXAT matrix + `bus.list` metadata | [socketcan-vendors.md](socketcan-vendors.md), `test:vendor` (offline) | **PASS (offline)** |
| **T16 harden** | Drop-oldest, `dropped`, batch ≤16–33 ms or ≤500, OOM caps, IPC reject, restart under load | `test:harden` live flood + kill-under-load on sam-X570 | **PASS (vcan)** |
| **T17 persist** | Remembered buses / DBC / prefs / TX drafts (hints only) | `test:persist` (offline) | **PASS (offline)** |
| **Packaging + icons** | AppImage / `.deb`, concept-A dock + header mark | PRs **#20–#22**; `npm run dist`, `test:app-icon`, `test:header-logo`, `test:engine-paths` | **PASS (offline / package)** |
| **M4 load / rewrite trigger** | Formal pass/fail vs **N2 / N4 / N3** (see below) | Suites exist as **proxies**; no signed write-up with explicit trigger numbers | **OPEN** |
| **Physical adapter (≥1)** | Real Peak / Kvaser / IXXAT (or other SocketCAN) dongle | Manual only. Not run for this scorecard. | **OPEN** |

Do **not** claim physical hardware PASS.

## Re-run the gates (Ubuntu)

User, not root, except `setup-vcan.sh`. Never `sudo npm run dist` or
`sudo` the AppImage. Node **20+**, Python **3.10+**, Electron **37.x**
from `npm ci`.

```bash
# 0. Host + vcan (live slices SKIP without this)
sudo apt update
sudo apt install -y can-utils iproute2 build-essential linux-headers-$(uname -r) \
  python3 python3-pip python3-venv
# Node 20+ — see README (nvm or NodeSource) if `node -v` is too old
sudo ./scripts/setup-vcan.sh          # vcan0 + vcan1 UP
./scripts/check-host.sh

# 1. Install (lockfile + engine)
npm ci
python3 -m pip install -e engine/

# 2. Offline / always-on suites
npm run typecheck
npm run test:electron-pin
npm run test:vendor
npm run test:dbc                      # T7 mux goldens (no vcan required)
npm run test:persist
npm run test:app-icon
npm run test:header-logo
npm run test:engine-paths

# 3. Live vcan gates (SKIP live + exit 0 if ifaces are down)
npm run test:trace                    # T9 + N2 first-paint
npm run test:smoke                    # T10 M1 + N2
npm run test:graph                    # T11
npm run test:rate                     # T6 rate_ms (±1 ms synthetic, ±2 ms live)
npm run test:tx                       # T12 raw + cyclic ±10%
npm run test:tx-dbc                   # T13 DBC pack + cyclic ±10%
npm run test:multibus                 # T14 isolation + two buses (needs vcan0 AND vcan1)
npm run test:harden                   # T16 flood + restart under load

# 4. Packages (heavy; not required on every CI job)
npm run dist                          # AppImage + .deb → dist/
# optional headless hello against linux-unpacked:
# sudo apt install -y xvfb
# xvfb-run -a npm run test:smoke:packaged
```

Bring-up reminder (engine binds only):

```bash
ip -br link show vcan0 vcan1
# if missing / DOWN:
sudo ./scripts/setup-vcan.sh
```

Host deps, Electron pin recovery, and “never Electron as root” stay in
[packaging.md](packaging.md). M1 / Xvfb notes: [smoke.md](smoke.md).
T16 bounds: [hardening.md](hardening.md).

## M4 load / native-rewrite trigger

Item 8 of the gate is a **decision**, not a merge. Keep
`python3 -m can_engine` unless measured load **fails** the NFRs below on
the documented host. There is still **no** `native/can-helper` tree and
no vendor SDK ([architecture.md](architecture.md)).

The CoS names three NFRs. Map them to what we actually run today, and
what is still missing for a signed trigger write-up.

### N2 — Trace 2 kfps, UI remains responsive

**Target (product):** at ≤ **2 000** frames/s the Trace UI stays
interactive (filter / Pause / Clear usable; no multi-second freeze).

**What we have:**

| Command | What it measures | Pass bar in code |
| --- | --- | --- |
| `npm run test:trace` | Synthetic 2 kfps stream (32 frames / 16 ms batches) into the 20k ring; paints **visible window only** (~24 rows + HTML proxy). Optional live 2 kfps burst on `vcan0`. | First-paint and every later batch **< 50 ms** (`shared/traceN2.ts`) |
| `npm run test:smoke` | Same N2 helper, plus filter / pause / clear under that fill; live DBC + `rate_ms` if `vcan0` is UP | Same **< 50 ms** budget |
| `npm run test:harden` | 20k Trace flood + live RX flood / engine kill (if vcan) | Caps and reconnect — **not** a paint-ms table |

In `npm run dev`, the first live batch also logs
`[trace-n2] first-paint … ms` in the renderer console.

**What is still OPEN:** a deliberate write-up that records those printed
ms (synthetic + live) on **sam-X570**, states pass/fail vs N2, and says
whether the **real Electron window** (not only the HTML proxy) stayed
interactive at 2 kfps. The suites **PASS** as automated proxies; that is
**not** the same as a signed N2 trigger memo.

### N4 — `rate_ms` within ±1 ms

**Target (product):** last inter-arrival `rate_ms` (`(Δts_us)/1000`, not
EMA) stays within **±1 ms** of the known period after enough samples.

**What we have:**

| Command | What it measures | Pass bar in code |
| --- | --- | --- |
| `npm run test:rate` | Synthetic 51 frames at 10 ms → median `rate_ms` | **±1 ms** (`SYNTHETIC_TOLERANCE_MS`) |
| same, live `vcan0` | Inject ≥51 frames at ~10 ms | **±2 ms** (documented host scheduling jitter — **not** a hardware capture clock) |
| `npm run test:smoke` | Live `rate_ms` is **numeric** after enough samples | Presence, not ±1 ms |

**What is still OPEN:** a write-up that treats N4 as a rewrite trigger:
explicit pass/fail on sam-X570, and whether live **±2 ms** is accepted as
N4 or only the synthetic **±1 ms** counts. Do not paste invented medians
here.

### N3 — TX latency < 10 ms

**Target (product):** one-shot TX (click / `tx.send` → wire) stays under
**10 ms** on a quiet host.

**What we have:**

| Command | What it measures | Pass bar in code |
| --- | --- | --- |
| `npm run test:tx` | Schema, `dir=tx` echo, cyclic median interval | Cyclic **±10%** (50 ms synthetic / 100 ms live) |
| `npm run test:tx-dbc` | Golden pack + cyclic DBC | Same **±10%** |
| `npm run test:harden` | Restart while TX is in flight | Reconnect, not latency |

**What is still OPEN:** there is **no** in-repo assert that one-shot TX
is **< 10 ms**. Cyclic period tolerance is a **different** metric.
T12/T13 **PASS (vcan)** does **not** close N3. A rewrite-trigger memo
must add a measured one-shot path (or formally waive N3) before anyone
claims N3 PASS.

### How to decide (when the write-up exists)

1. Re-run the commands in this section on Ubuntu with vcan UP.
2. Record the numbers the scripts already print (N2 ms, `rate_ms`
   median, cyclic ±%). Do not invent extras.
3. For N3, either add a measured one-shot timing or mark N3 **OPEN** /
   waived in that memo.
4. **Keep Python** if N2 / N4 (and N3 if measured) pass.
5. **Trigger a native rewrite discussion** only if a named NFR fails on
   the documented host after a fair re-run — not because the write-up is
   missing.

Until that memo exists, item 8 stays **OPEN**. Missing paperwork is not a
fail, and it is not a pass.

## Physical adapter (manual, OPEN)

No dongle was scored for this write-up. If one is available, treat it as
a **manual** checklist, not a CI job:

1. Follow [socketcan-vendors.md](socketcan-vendors.md) (Peak `peak_usb`,
   Kvaser `kvaser_usb`, IXXAT `ix_usb_can` OOT/DKMS).
2. Confirm the vendor chardev / LinuxCAN stacks are **not** blacklisting
   SocketCAN (`bus.list` warnings).
3. Bring `can0` (or the real name) **UP** out of band
   ([privileges.md](privileges.md)) — classic bitrate is enough; FD is
   docs-only ([can-fd.md](can-fd.md)).
4. Connect in the header, Load a DBC, confirm Trace RX, one-shot TX vs
   `candump`, and that a second open vcan iface stays isolated.

Until that happens, physical adapter remains **OPEN**. vcan PASS is not
hardware PASS.

## Related docs

| Doc | Role |
| --- | --- |
| [architecture.md](architecture.md) | Process split; no native helper |
| [packaging.md](packaging.md) | Ubuntu run / `npm run dist` / Electron 37.x |
| [smoke.md](smoke.md) | T10 M1 + Xvfb |
| [hardening.md](hardening.md) | T16 bounds |
| [socketcan-vendors.md](socketcan-vendors.md) | T15 + physical bring-up |
| [privileges.md](privileges.md) | Pre-UP; never Electron as root |
| [can-fd.md](can-fd.md) | FD checklist (docs only) |
