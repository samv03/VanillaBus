/**
 * T10 M1 exit smoke: single-bus Trace + DBC + rate_ms vertical slice.
 *
 * Always (no CAN required):
 *   - N2 synthetic first-paint <50 ms at ≤2 kfps (same path as test:trace)
 *   - filter / pause / clear stay cheap after a 2 kfps fill
 *
 * If vcan0 is UP:
 *   - spawn engine, bus.open vcan0, dbc.load sample.dbc
 *   - inject EngineStatus traffic
 *   - assert rx.batch frames have decode.name + rate_ms
 *   - time live first-paint of the first rx.batch
 *
 * Otherwise:
 *
 *   SKIP vcan0 M1 smoke: vcan0 is not UP on this host.
 *   Bring it up with: sudo ./scripts/setup-vcan.sh
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import type { FrameEvent, RxBatch } from '../shared/engine'
import { applyRxBatch } from '../shared/traceControl'
import { collectMatchingIndices, visibleCount } from '../shared/traceFilter'
import { TRACE_VISIBLE_ROW_BUDGET } from '../shared/tracePaint'
import {
  measureVisiblePaint,
  N2_FIRST_PAINT_MS,
  N2_FPS,
  N2_FRAMES_PER_BATCH,
  n2BudgetMessage
} from '../shared/traceN2'
import { FrameRing, TRACE_RING_CAPACITY } from '../shared/traceRing'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'
const ENGINE_STATUS_ID = 0x100
const ENGINE_STATUS_DATA = 'e8035a0a00000000'
const ENGINE_STATUS_NAME = 'EngineStatus'
const RATE_PERIOD_MS = 10
const RATE_SAMPLE_COUNT = 24
const LIVE_N2_CAN_ID = 0x321

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
      name: ENGINE_STATUS_NAME,
      signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 },
      units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
    },
    ...overrides
  }
}

function makeBatch(count: number, startTs: number, startId = ENGINE_STATUS_ID): FrameEvent[] {
  const frames: FrameEvent[] = []
  for (let index = 0; index < count; index += 1) {
    const canId = startId + (index % 8)
    frames.push(
      makeFrame({
        ts_us: startTs + index * 500,
        can_id: canId,
        rate_ms: index === 0 ? null : 0.5,
        decode:
          canId === ENGINE_STATUS_ID
            ? {
                name: ENGINE_STATUS_NAME,
                signals: { EngineSpeed: 250 + index, EngineTemp: 50, OilPressure: 20 },
                units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
              }
            : null
      })
    )
  }
  return frames
}

function runSyntheticN2(): { firstMs: number; medianMs: number; maxMs: number; ring: FrameRing } {
  const ring = new FrameRing(TRACE_RING_CAPACITY)
  const first = measureVisiblePaint(ring, makeBatch(N2_FRAMES_PER_BATCH, 2_000_000))
  const batchTimes: number[] = [first.elapsedMs]
  const batches = Math.ceil(N2_FPS / N2_FRAMES_PER_BATCH)
  for (let index = 1; index < batches; index += 1) {
    const frames = makeBatch(N2_FRAMES_PER_BATCH, 2_000_000 + index * N2_FRAMES_PER_BATCH * 500)
    batchTimes.push(measureVisiblePaint(ring, frames).elapsedMs)
  }
  const maxMs = Math.max(...batchTimes)
  const medianMs = [...batchTimes].sort((a, b) => a - b)[Math.floor(batchTimes.length / 2)] ?? 0
  return { firstMs: first.elapsedMs, medianMs, maxMs, ring }
}

test('M1 N2 synthetic first-paint <50 ms at ≤2k fps (visible window)', () => {
  const { firstMs, medianMs, maxMs, ring } = runSyntheticN2()
  assert.ok(firstMs < N2_FIRST_PAINT_MS, n2BudgetMessage(firstMs, 'first-paint'))
  assert.ok(maxMs < N2_FIRST_PAINT_MS, n2BudgetMessage(maxMs, 'max batch paint'))
  assert.ok(ring.size <= TRACE_RING_CAPACITY)
  assert.ok(ring.size >= Math.min(N2_FPS, TRACE_RING_CAPACITY))

  const named = measureVisiblePaint(ring, [], '')
  assert.ok(named.rows.some((row) => row.name === ENGINE_STATUS_NAME))
  assert.ok(named.rows.some((row) => row.rate !== '—'))

  console.log(
    `M1 N2 synthetic first-paint ${firstMs.toFixed(2)} ms; median ${medianMs.toFixed(2)} ms; max ${maxMs.toFixed(2)} ms; ring ${ring.size}/${TRACE_RING_CAPACITY}; ${N2_FRAMES_PER_BATCH} frames/batch @ ${N2_FPS} fps`
  )
})

test('M1 Trace stays interactive after 2k fps synthetic load', () => {
  const { ring } = runSyntheticN2()
  const started = performance.now()
  const hits = collectMatchingIndices(ring, 'engine')
  const rows = measureVisiblePaint(ring, [], 'engine').rows
  const filterMs = performance.now() - started
  assert.ok(filterMs < N2_FIRST_PAINT_MS, n2BudgetMessage(filterMs, 'filter+paint'))
  assert.ok(hits !== null && hits.length > 0)
  assert.equal(rows.length, Math.min(TRACE_VISIBLE_ROW_BUDGET, visibleCount(ring, hits)))
  assert.ok(rows.every((row) => row.name === ENGINE_STATUS_NAME || row.name === '—'))
  assert.ok(rows.some((row) => row.name === ENGINE_STATUS_NAME))

  const sizeBefore = ring.size
  assert.equal(applyRxBatch(ring, makeBatch(N2_FRAMES_PER_BATCH, 9_000_000), true), 0)
  assert.equal(ring.size, sizeBefore, 'pause must not append under load')

  const clearStarted = performance.now()
  ring.clear()
  const clearMs = performance.now() - clearStarted
  assert.equal(ring.size, 0)
  assert.ok(clearMs < N2_FIRST_PAINT_MS, n2BudgetMessage(clearMs, 'clear'))
  console.log(
    `M1 interactive under load: filter+paint ${filterMs.toFixed(2)} ms; clear ${clearMs.toFixed(2)} ms; paused append skipped`
  )
})

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

function injectVcanFrames(count: number, canId: number, dataHex: string, periodUs: number): void {
  const script = `
import sys, time
try:
    import can
except ImportError:
    sys.exit(2)
bus = can.Bus(interface="socketcan", channel="vcan0")
msg = can.Message(arbitration_id=${canId}, data=bytes.fromhex("${dataHex}"), is_extended_id=False)
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
  if (viaPython.status === 2) {
    for (let index = 0; index < count; index += 1) {
      const sent = spawnSync(
        'cansend',
        ['vcan0', `${canId.toString(16).toUpperCase().padStart(3, '0')}#${dataHex.toUpperCase()}`],
        { encoding: 'utf8' }
      )
      if (sent.status !== 0) {
        throw new Error(sent.stderr || 'cansend inject failed')
      }
      if (periodUs > 0 && index + 1 < count) {
        spawnSync('python3', ['-c', `import time; time.sleep(${periodUs / 1_000_000})`])
      }
    }
    return
  }
  throw new Error(viaPython.stderr || viaPython.stdout || 'vcan inject failed')
}

async function waitForFrames(
  batches: RxBatch[],
  predicate: (frame: FrameEvent) => boolean,
  minCount: number,
  timeoutMs: number
): Promise<FrameEvent[]> {
  const deadline = Date.now() + timeoutMs
  const matched: FrameEvent[] = []
  let seen = 0
  while (Date.now() < deadline && matched.length < minCount) {
    while (seen < batches.length && matched.length < minCount) {
      const batch = batches[seen]!
      seen += 1
      for (const frame of batch.frames) {
        if (predicate(frame)) {
          matched.push(frame)
        }
      }
    }
    if (matched.length < minCount) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return matched
}

test(
  'M1 live vcan0 + sample DBC decode/rate + N2 (SKIP if no vcan)',
  { timeout: 30_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
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
        t.diagnostic('SKIP vcan0 M1 smoke: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        console.log(
          'SKIP vcan0 M1 smoke: vcan0 is not UP on this host. Bring it up with: sudo ./scripts/setup-vcan.sh'
        )
        return
      }

      const opened = await supervisor.openBus('vcan0')
      const loaded = await supervisor.loadDbc(opened.busId, SAMPLE_DBC)
      assert.equal(loaded.ok, true)
      assert.ok(loaded.message_count >= 1)

      const beforeDecode = batches.length
      injectVcanFrames(RATE_SAMPLE_COUNT, ENGINE_STATUS_ID, ENGINE_STATUS_DATA, RATE_PERIOD_MS * 1000)
      const decoded = await waitForFrames(
        batches,
        (frame) => frame.can_id === ENGINE_STATUS_ID && frame.busId === opened.busId,
        RATE_SAMPLE_COUNT,
        4_000
      )
      assert.ok(
        decoded.length >= 2,
        `expected EngineStatus frames on rx.batch after inject, got ${decoded.length} (batches after open: ${batches.length - beforeDecode})`
      )
      const named = decoded.filter((frame) => frame.decode?.name === ENGINE_STATUS_NAME)
      assert.ok(named.length > 0, 'expected decode.name EngineStatus on rx.batch after dbc.load')
      const rated = decoded.filter((frame) => typeof frame.rate_ms === 'number' && Number.isFinite(frame.rate_ms))
      assert.ok(rated.length > 0, 'expected numeric rate_ms after enough EngineStatus samples')
      console.log(
        `M1 live decode/rate: ${named.length} named EngineStatus, ${rated.length} rate_ms samples (first rate ${rated[0]?.rate_ms ?? '—'})`
      )

      const ring = new FrameRing(TRACE_RING_CAPACITY)
      const firstLive = batches[beforeDecode] ?? batches[0]
      assert.ok(firstLive, 'expected at least one rx.batch from vcan inject')
      const livePaint = measureVisiblePaint(ring, firstLive.frames)
      assert.ok(
        livePaint.elapsedMs < N2_FIRST_PAINT_MS,
        n2BudgetMessage(livePaint.elapsedMs, 'live first-paint')
      )
      assert.ok(livePaint.rows.some((row) => row.name === ENGINE_STATUS_NAME || row.rate !== '—'))

      const burstStart = batches.length
      injectVcanFrames(N2_FPS, LIVE_N2_CAN_ID, '11223344', 500)
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && batches.length === burstStart) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      if (batches.length > burstStart) {
        const burst = batches[burstStart]!
        const burstPaint = measureVisiblePaint(new FrameRing(TRACE_RING_CAPACITY), burst.frames)
        assert.ok(
          burstPaint.elapsedMs < N2_FIRST_PAINT_MS,
          n2BudgetMessage(burstPaint.elapsedMs, 'live 2kfps first-paint')
        )
        console.log(
          `M1 N2 live first-paint ${livePaint.elapsedMs.toFixed(2)} ms (decode batch ${firstLive.frames.length}); 2kfps burst ${burstPaint.elapsedMs.toFixed(2)} ms (batch ${burst.frames.length})`
        )
      } else {
        console.log(
          `M1 N2 live first-paint ${livePaint.elapsedMs.toFixed(2)} ms (decode batch ${firstLive.frames.length}); SKIP 2kfps burst (no extra rx.batch)`
        )
      }

      await supervisor.closeBus(opened.busId)
    } finally {
      offRx()
      supervisor.stop()
    }
  }
)
