/**
 * T9 virtualized Trace: ring / filter / pause + N2 first-paint.
 *
 * Synthetic path always runs (no CAN required) and asserts first-paint of the
 * visible window at ≤2 kfps is under 50 ms.
 *
 * N2 constants / measureVisiblePaint live in shared/traceN2.ts so T10
 * `test:smoke` can reuse the same first-paint gate.
 *
 * If vcan0 is UP, a live burst is injected and the same paint path is timed
 * on the first rx.batch. Otherwise:
 *
 *   SKIP vcan0 trace N2: vcan0 is not UP on this host.
 *   Bring it up with: sudo ./scripts/setup-vcan.sh
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import type { FrameEvent, RxBatch } from '../shared/engine'
import { applyRxBatch } from '../shared/traceControl'
import { collectMatchingIndices, frameMatchesFilter, visibleCount } from '../shared/traceFilter'
import { formatCanIdPrefixed, formatDataHex, formatRateMs } from '../shared/traceFormat'
import { paintVisibleWindow, TRACE_VISIBLE_ROW_BUDGET } from '../shared/tracePaint'
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

const LIVE_CAN_ID = 0x321

function makeFrame(overrides: Partial<FrameEvent> = {}): FrameEvent {
  return {
    busId: 'bus-1',
    ifName: 'vcan0',
    ts_us: 1_700_000_000_000_000,
    can_id: 0x100,
    dlc: 8,
    data: 'e8035a0a00000000',
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

function makeBatch(count: number, startTs: number, startId = 0x100): FrameEvent[] {
  const frames: FrameEvent[] = []
  for (let index = 0; index < count; index += 1) {
    const canId = startId + (index % 8)
    frames.push(
      makeFrame({
        ts_us: startTs + index * 500,
        can_id: canId,
        rate_ms: index === 0 ? null : 0.5,
        decode:
          canId === 0x100
            ? {
                name: 'EngineStatus',
                signals: { EngineSpeed: 250 + index, EngineTemp: 50, OilPressure: 20 },
                units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
              }
            : null
      })
    )
  }
  return frames
}

function firstPaintMs(ring: FrameRing, frames: readonly FrameEvent[], filter = ''): number {
  const measured = measureVisiblePaint(ring, frames, filter)
  assert.ok(measured.html.startsWith('<table>'))
  assert.equal(
    measured.rows.length,
    Math.min(TRACE_VISIBLE_ROW_BUDGET, visibleCount(ring, collectMatchingIndices(ring, filter)))
  )
  return measured.elapsedMs
}

test('FrameRing drops oldest at documented capacity', () => {
  const ring = new FrameRing(4)
  assert.equal(TRACE_RING_CAPACITY, 20_000)
  const dropped = ring.append(makeBatch(6, 1_000))
  assert.equal(ring.size, 4)
  assert.equal(dropped, 2)
  assert.equal(ring.droppedOldest, 2)
  assert.equal(ring.at(0).frame.ts_us, 1_000 + 2 * 500)
  ring.clear()
  assert.equal(ring.size, 0)
})

test('filter matches ID hex / decimal and DBC name', () => {
  const named = makeFrame({ can_id: 0x100, decode: { name: 'EngineStatus', signals: {}, units: {} } })
  const other = makeFrame({ can_id: 0x7e0, decode: null })
  assert.equal(frameMatchesFilter(named, ''), true)
  assert.equal(frameMatchesFilter(named, '100'), true)
  assert.equal(frameMatchesFilter(named, '0x100'), true)
  assert.equal(frameMatchesFilter(named, 'engine'), true)
  assert.equal(frameMatchesFilter(named, '7E0'), false)
  assert.equal(frameMatchesFilter(other, '7e0'), true)
  assert.equal(frameMatchesFilter(other, '256'), false)

  const ring = new FrameRing(16)
  ring.append([named, other])
  const hits = collectMatchingIndices(ring, 'engine')
  assert.deepEqual(hits, [0])
  assert.equal(collectMatchingIndices(ring, ''), null)
})

test('pause skips append; clear empties the ring', () => {
  const ring = new FrameRing(32)
  assert.equal(applyRxBatch(ring, makeBatch(4, 1_000), true), 0)
  assert.equal(ring.size, 0)
  assert.equal(applyRxBatch(ring, makeBatch(4, 1_000), false), 0)
  assert.equal(ring.size, 4)
  ring.clear()
  assert.equal(ring.size, 0)
})

test('painted window columns include time/bus/id/name/dlc/data/rate/dir', () => {
  const ring = new FrameRing(32)
  ring.append([
    makeFrame({ dir: 'tx', rate_ms: 20, ifName: 'vcan0' }),
    makeFrame({ can_id: 0x7ff, decode: null, dir: 'rx', rate_ms: null })
  ])
  const rows = paintVisibleWindow(ring, { followNewest: false, visibleBudget: 8 })
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.id, formatCanIdPrefixed(0x100, false))
  assert.equal(rows[0]?.bus, 'vcan0')
  assert.equal(rows[0]?.name, 'EngineStatus')
  assert.equal(rows[0]?.data, formatDataHex('e8035a0a00000000'))
  assert.equal(rows[0]?.rate, formatRateMs(20))
  assert.equal(rows[0]?.dir, 'tx')
  assert.equal(rows[1]?.name, '—')
  assert.equal(rows[1]?.rate, '—')
  assert.ok(rows[0]?.time.includes('.'))
})

test('N2 synthetic first-paint <50 ms at ≤2k fps (visible window only)', () => {
  const ring = new FrameRing(TRACE_RING_CAPACITY)
  const first = makeBatch(N2_FRAMES_PER_BATCH, 2_000_000)
  const firstMs = firstPaintMs(ring, first)
  assert.ok(
    firstMs < N2_FIRST_PAINT_MS,
    n2BudgetMessage(firstMs, `first-paint (batch ${N2_FRAMES_PER_BATCH} frames @ ${N2_FPS} fps)`)
  )

  const batchTimes: number[] = [firstMs]
  const batches = Math.ceil(N2_FPS / N2_FRAMES_PER_BATCH)
  for (let index = 1; index < batches; index += 1) {
    const frames = makeBatch(N2_FRAMES_PER_BATCH, 2_000_000 + index * N2_FRAMES_PER_BATCH * 500)
    batchTimes.push(firstPaintMs(ring, frames))
  }
  const maxMs = Math.max(...batchTimes)
  const medianMs = [...batchTimes].sort((a, b) => a - b)[Math.floor(batchTimes.length / 2)] ?? 0
  assert.ok(maxMs < N2_FIRST_PAINT_MS, n2BudgetMessage(maxMs, 'max batch paint'))
  assert.ok(ring.size <= TRACE_RING_CAPACITY)
  assert.ok(ring.size >= Math.min(N2_FPS, TRACE_RING_CAPACITY))
  console.log(
    `N2 synthetic first-paint ${firstMs.toFixed(2)} ms; median ${medianMs.toFixed(2)} ms; max ${maxMs.toFixed(2)} ms; ring ${ring.size}/${TRACE_RING_CAPACITY}; ${N2_FRAMES_PER_BATCH} frames/batch @ ${N2_FPS} fps`
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

function injectVcanBurst(count: number, canId: number, periodUs: number): void {
  const script = `
import sys, time
try:
    import can
except ImportError:
    sys.exit(2)
bus = can.Bus(interface="socketcan", channel="vcan0")
msg = can.Message(arbitration_id=${canId}, data=bytes.fromhex("11223344"), is_extended_id=False)
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
  throw new Error(viaPython.stderr || 'vcan burst inject failed')
}

test(
  'N2 live vcan first-paint of first rx.batch (SKIP if no vcan)',
  { timeout: 20_000 },
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
        t.diagnostic('SKIP vcan0 trace N2: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        console.log('SKIP vcan0 trace N2: vcan0 is not UP on this host.')
        return
      }

      const opened = await supervisor.openBus('vcan0')
      const ring = new FrameRing(TRACE_RING_CAPACITY)
      injectVcanBurst(N2_FPS, LIVE_CAN_ID, 500)

      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && batches.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.ok(batches.length > 0, 'expected at least one rx.batch from vcan burst')
      const first = batches[0]!
      const paintMs = firstPaintMs(ring, first.frames)
      assert.ok(paintMs < N2_FIRST_PAINT_MS, n2BudgetMessage(paintMs, 'live first-paint'))
      console.log(
        `N2 live first-paint ${paintMs.toFixed(2)} ms; first batch ${first.frames.length} frames; later batches ${batches.length}`
      )
      await supervisor.closeBus(opened.busId)
    } finally {
      offRx()
      supervisor.stop()
    }
  }
)
