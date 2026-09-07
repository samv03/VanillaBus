/**
 * T11 Graph: UI-side decimation (10–30 Hz), pause freeze, window capacity.
 *
 * Synthetic path always runs (no CAN required).
 *
 * If vcan0 is UP, a live EngineStatus burst is ingested after dbc.load and
 * the same store path is asserted. Otherwise:
 *
 *   SKIP vcan0 graph: vcan0 is not UP on this host.
 *   Bring it up with: sudo ./scripts/setup-vcan.sh
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import type { FrameEvent, RxBatch } from '../shared/engine'
import { parseDbcCatalog } from '../shared/engine'
import { catalogEntriesFromDbc, numericDecodeSignals } from '../shared/graphCatalog'
import { decimatePoints, shouldReplaceLastSample } from '../shared/graphDecimate'
import { graphSignalKey } from '../shared/graphKeys'
import { GraphStore } from '../shared/graphStore'
import { applyRxBatch } from '../shared/traceControl'
import { FrameRing, TRACE_RING_CAPACITY } from '../shared/traceRing'
import {
  GRAPH_MAX_HZ,
  GRAPH_MIN_HZ,
  clampGraphHz,
  graphRedrawIntervalMs,
  graphSampleIntervalUs,
  maxSamplesForWindow
} from '../shared/graphWindow'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

const ENGINE_STATUS_ID = 0x100
const ENGINE_STATUS_DATA = 'e8035a0a00000000'

function makeFrame(overrides: Partial<FrameEvent> = {}): FrameEvent {
  return {
    busId: 'bus-1',
    ifName: 'vcan0',
    ts_us: 1_700_000_000_000_000,
    can_id: ENGINE_STATUS_ID,
    dlc: 8,
    data: ENGINE_STATUS_DATA,
    is_eff: false,
    is_fd: false,
    brs: false,
    is_rtr: false,
    is_err: false,
    dir: 'rx',
    rate_ms: 10,
    decode: {
      name: 'EngineStatus',
      signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 },
      units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
    },
    ...overrides
  }
}

function batchOf(frames: FrameEvent[]): RxBatch {
  return { frames, dropped: 0 }
}

function burst(count: number, startUs: number, periodUs: number, valueAt: (i: number) => number): RxBatch {
  const frames: FrameEvent[] = []
  for (let index = 0; index < count; index += 1) {
    frames.push(
      makeFrame({
        ts_us: startUs + index * periodUs,
        rate_ms: index === 0 ? null : periodUs / 1000,
        decode: {
          name: 'EngineStatus',
          signals: { EngineSpeed: valueAt(index), EngineTemp: 80, OilPressure: 20 },
          units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
        }
      })
    )
  }
  return batchOf(frames)
}

test('decimation rate stays inside 10–30 Hz on a 1 kHz synthetic burst', () => {
  const hz = 20
  const intervalUs = graphSampleIntervalUs(hz)
  assert.equal(intervalUs, 50_000)
  assert.ok(clampGraphHz(5) === GRAPH_MIN_HZ)
  assert.ok(clampGraphHz(120) === GRAPH_MAX_HZ)

  const raw = []
  for (let index = 0; index < 1000; index += 1) {
    raw.push({ ts_us: index * 1000, value: index })
  }
  const kept = decimatePoints(raw, intervalUs)
  assert.ok(
    kept.length >= GRAPH_MIN_HZ && kept.length <= GRAPH_MAX_HZ,
    `expected 10–30 samples over 1 s, got ${kept.length}`
  )
  assert.equal(shouldReplaceLastSample(0, 10_000, intervalUs), true)
  assert.equal(shouldReplaceLastSample(0, 50_000, intervalUs), false)

  const redrawMs = graphRedrawIntervalMs(hz)
  assert.ok(redrawMs >= 33 && redrawMs <= 100, `redraw interval ${redrawMs} ms outside 10–30 Hz`)

  const store = new GraphStore()
  store.setHz(hz)
  store.setSelected(['EngineStatus.EngineSpeed'])
  store.appendBatch(burst(1000, 2_000_000_000_000, 1000, (i) => 1000 + i))
  const count = store.sampleCount('EngineStatus.EngineSpeed')
  assert.ok(
    count >= GRAPH_MIN_HZ && count <= GRAPH_MAX_HZ + 1,
    `store decimation expected 10–30 samples, got ${count}`
  )
})

test('pause freezes Graph samples while Trace can still append', () => {
  const start = 3_000_000_000_000
  const store = new GraphStore()
  const ring = new FrameRing(TRACE_RING_CAPACITY)
  store.setSelected(['EngineStatus.EngineSpeed'])
  store.appendBatch(burst(20, start, 50_000, (i) => 2000 + i))
  const frozen = store.samples('EngineStatus.EngineSpeed').map((sample) => sample.value)

  store.setPaused(true)
  const later = burst(20, start + 2_000_000, 50_000, (i) => 9000 + i)
  store.appendBatch(later)
  applyRxBatch(ring, later.frames, false)
  assert.deepEqual(
    store.samples('EngineStatus.EngineSpeed').map((sample) => sample.value),
    frozen
  )
  assert.ok(ring.size > 0, 'Trace ring should accept frames while Graph is paused')

  store.setPaused(false)
  const resume = burst(8, start + 4_000_000, 50_000, (i) => 400 + i)
  store.appendBatch(resume)
  applyRxBatch(ring, resume.frames, true)
  assert.ok(store.sampleCount('EngineStatus.EngineSpeed') > frozen.length)
  assert.equal(ring.size, later.frames.length)
})

test('window chips bound memory: oldest samples drop outside the window', () => {
  const store = new GraphStore()
  store.setHz(20)
  store.setWindowSec(60)
  store.setSelected(['EngineStatus.EngineSpeed'])

  const start = 4_000_000_000_000
  const periodUs = 50_000
  const sixtySeconds = 60 * 20
  store.appendBatch(burst(sixtySeconds, start, periodUs, (i) => i))
  assert.ok(store.sampleCount('EngineStatus.EngineSpeed') > 200)
  assert.ok(store.maxSeriesLength() <= maxSamplesForWindow(60, 20))

  store.setWindowSec(10)
  const kept = store.samples('EngineStatus.EngineSpeed')
  assert.ok(kept.length > 0)
  const now = store.plotNowUs()
  const oldest = kept[0]!.ts_us
  assert.ok(oldest >= now - 10_000_000 - periodUs, `oldest ${oldest} outside 10s of ${now}`)
  assert.ok(
    kept.length <= maxSamplesForWindow(10, 20),
    `10s window held ${kept.length} samples, bound ${maxSamplesForWindow(10, 20)}`
  )
  for (const sample of kept) {
    assert.ok(sample.ts_us >= now - 10_000_000 - periodUs)
  }
})

test('mux: only numeric decode.signals are sampled (no invented mux branch)', () => {
  const store = new GraphStore()
  store.applyDbcCatalog([
    {
      name: 'MuxStatus',
      can_id: 512,
      signals: [
        { name: 'MuxId', unit: '' },
        { name: 'CoolantTemp', unit: 'degC' },
        { name: 'FuelPressure', unit: 'kPa' },
        { name: 'Counter', unit: '' }
      ]
    }
  ])
  store.setSelected(['MuxStatus.CoolantTemp', 'MuxStatus.FuelPressure'])

  const mux0 = makeFrame({
    can_id: 512,
    data: '008a020700000000',
    decode: {
      name: 'MuxStatus',
      signals: { MuxId: 0, Counter: 7, CoolantTemp: 25 },
      units: { CoolantTemp: 'degC' }
    }
  })
  const mux1 = makeFrame({
    ts_us: mux0.ts_us + 100_000,
    can_id: 512,
    data: '01d2040900000000',
    decode: {
      name: 'MuxStatus',
      signals: { MuxId: 1, Counter: 9, FuelPressure: 1234 },
      units: { FuelPressure: 'kPa' }
    }
  })

  assert.deepEqual(
    numericDecodeSignals(mux0.decode!).map(([name]) => name),
    ['MuxId', 'Counter', 'CoolantTemp']
  )
  store.appendBatch(batchOf([mux0, mux1]))
  assert.equal(store.sampleCount('MuxStatus.CoolantTemp'), 1)
  assert.equal(store.sampleCount('MuxStatus.FuelPressure'), 1)
  assert.equal(store.samples('MuxStatus.CoolantTemp')[0]?.value, 25)
  assert.equal(store.samples('MuxStatus.FuelPressure')[0]?.value, 1234)
  assert.equal(graphSignalKey('MuxStatus', 'CoolantTemp'), 'MuxStatus.CoolantTemp')
})

test('DBC catalog parse lists known signals before RX', () => {
  const catalog = parseDbcCatalog([
    {
      name: 'EngineStatus',
      can_id: 256,
      signals: [
        { name: 'EngineSpeed', unit: 'rpm' },
        { name: 'EngineTemp', unit: 'degC' }
      ]
    }
  ])
  const entries = catalogEntriesFromDbc(catalog)
  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.key, 'EngineStatus.EngineSpeed')
  const store = new GraphStore()
  store.applyDbcCatalog(catalog)
  store.setSelected(['EngineStatus.EngineSpeed'])
  assert.equal(store.catalogEntries().length, 2)
  assert.equal(store.sampleCount('EngineStatus.EngineSpeed'), 0)
})

function vcan0Up(): boolean {
  const flags = spawnSync('cat', ['/sys/class/net/vcan0/flags'], { encoding: 'utf8' })
  const type = spawnSync('cat', ['/sys/class/net/vcan0/type'], { encoding: 'utf8' })
  if (flags.status !== 0 || type.status !== 0) {
    return false
  }
  if (type.stdout.trim() !== '280') {
    return false
  }
  const value = Number.parseInt(flags.stdout.trim(), 16)
  return Number.isFinite(value) && (value & 1) === 1
}

function waitForConnected(supervisor: EngineSupervisor, timeoutMs: number): Promise<void> {
  if (supervisor.getStatus().connected) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('timed out waiting for engine hello'))
    }, timeoutMs)
    const unsubscribe = supervisor.onStatus((status) => {
      if (status.connected) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}

function injectEngineStatus(count: number, periodUs: number): void {
  const script = `
import sys, time
try:
    import can
except ImportError:
    sys.exit(2)
bus = can.Bus(interface="socketcan", channel="vcan0")
msg = can.Message(arbitration_id=${ENGINE_STATUS_ID}, data=bytes.fromhex("${ENGINE_STATUS_DATA}"), is_extended_id=False)
start = time.perf_counter()
period = ${periodUs} / 1_000_000
for i in range(${count}):
    bus.send(msg)
    target = start + (i + 1) * period
    now = time.perf_counter()
    if target > now:
        time.sleep(target - now)
bus.shutdown()
`
  const viaPython = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  if (viaPython.status === 0) {
    return
  }
  throw new Error(viaPython.stderr || 'vcan EngineStatus inject failed')
}

test(
  'live vcan Graph ingest after dbc.load (SKIP if no vcan)',
  { timeout: 20_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
      return
    }
    if (!vcan0Up()) {
      t.diagnostic('SKIP vcan0 graph: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
      console.log('SKIP vcan0 graph: vcan0 is not UP on this host.')
      return
    }

    const supervisor = new EngineSupervisor()
    const batches: RxBatch[] = []
    const offRx = supervisor.onRxBatch((batch) => {
      batches.push(batch)
    })
    supervisor.start()
    try {
      await waitForConnected(supervisor, 10_000)
      let listed
      try {
        listed = await supervisor.listBuses()
      } catch (error) {
        assert.ok(error instanceof EngineRequestError)
        throw error
      }
      const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
      if (!vcan || vcan.state !== 'up') {
        t.diagnostic('SKIP vcan0 graph: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        console.log('SKIP vcan0 graph: vcan0 is not UP on this host.')
        return
      }

      const opened = await supervisor.openBus('vcan0')
      const loaded = await supervisor.loadDbc(opened.busId, 'fixtures/dbc/sample.dbc')
      assert.equal(loaded.ok, true)
      assert.ok(loaded.catalog.some((message) => message.name === 'EngineStatus'))
      const store = new GraphStore()
      store.applyDbcCatalog(loaded.catalog)
      store.setSelected(['EngineStatus.EngineSpeed'])

      injectEngineStatus(24, 10_000)
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && batches.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.ok(batches.length > 0, 'expected at least one rx.batch from vcan burst')
      for (const item of batches) {
        store.appendBatch(item)
      }
      assert.ok(
        store.sampleCount('EngineStatus.EngineSpeed') > 0,
        'expected EngineSpeed samples from live decode.signals'
      )
      await supervisor.closeBus(opened.busId)
    } finally {
      offRx()
      supervisor.stop()
    }
  }
)
