/**
 * T12 TX bridge: hex/period helpers + supervisor IPC schema.
 *
 * Synthetic path always runs (no CAN required).
 *
 * If vcan0 is UP, EngineSupervisor sendFrame / startCyclic is exercised and
 * rx.batch must include the TX id. Otherwise:
 *
 *   SKIP vcan0 TX: vcan0 is not UP. sudo ./scripts/setup-vcan.sh
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'
import type { FrameEvent, RxBatch } from '../shared/engine'
import {
  nextCyclicDeadline,
  parseCanIdHex,
  parseDataHex,
  periodErrorRatio,
  withinPeriodTolerance
} from '../shared/txFormat'

test('parseCanIdHex / parseDataHex / cyclic timer math', () => {
  const id = parseCanIdHex('0x7E0')
  assert.equal(id.ok, true)
  if (id.ok) {
    assert.equal(id.value, 0x7e0)
    assert.equal(id.isEffHint, false)
  }
  const ext = parseCanIdHex('1ABCDE')
  assert.equal(ext.ok, true)
  if (ext.ok) {
    assert.equal(ext.isEffHint, true)
  }
  assert.equal(parseCanIdHex('').ok, false)
  assert.equal(parseCanIdHex('xyz').ok, false)

  const data = parseDataHex('02 10 0C 00')
  assert.equal(data.ok, true)
  if (data.ok) {
    assert.equal(data.hex, '02100c00')
    assert.equal(data.bytes, 4)
  }
  assert.equal(parseDataHex('210').ok, false)
  assert.equal(parseDataHex('').ok, true)

  assert.equal(nextCyclicDeadline(1.0, 1.0, 0.1), 1.1)
  assert.equal(nextCyclicDeadline(1.25, 1.0, 0.1), 1.3)
  assert.ok(Math.abs(periodErrorRatio(110, 100) - 0.1) < 1e-12)
  assert.equal(withinPeriodTolerance(110, 100), true)
  assert.equal(withinPeriodTolerance(130, 100), false)
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

function collectTx(
  supervisor: EngineSupervisor,
  canId: number,
  timeoutMs: number
): Promise<FrameEvent[]> {
  return new Promise((resolve) => {
    const found: FrameEvent[] = []
    const timer = setTimeout(() => {
      off()
      resolve(found)
    }, timeoutMs)
    const off = supervisor.onRxBatch((batch: RxBatch) => {
      for (const frame of batch.frames) {
        if (frame.can_id === canId) {
          found.push(frame)
        }
      }
    })
    void timer
  })
}

test('tx.send missing bus / invalid payload via EngineSupervisor', { timeout: 20_000 }, async (t) => {
  if (process.platform !== 'linux') {
    t.skip('engine supervisor is Linux-only')
    return
  }

  const supervisor = new EngineSupervisor()
  supervisor.start()
  try {
    await waitForConnected(supervisor, 10_000)

    await assert.rejects(
      () => supervisor.sendFrame({ busId: 'missing-bus', can_id: 0x100, data: '00' }),
      (error: unknown) => {
        assert.ok(error instanceof EngineRequestError)
        assert.equal(error.code, 'bus_not_found')
        return true
      }
    )

    const listed = await supervisor.listBuses()
    const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
    if (!vcan || vcan.state !== 'up') {
      t.diagnostic('SKIP vcan0 TX: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
      return
    }

    const opened = await supervisor.openBus('vcan0')
    const pending = collectTx(supervisor, 0x5a1, 800)
    await supervisor.sendFrame({
      busId: opened.busId,
      can_id: 0x5a1,
      data: '02100c00',
      is_eff: false
    })
    const frames = await pending
    assert.ok(
      frames.some((frame) => frame.dir === 'tx' || frame.can_id === 0x5a1),
      'expected TX echo or loopback RX for 0x5A1'
    )
    const started = await supervisor.startCyclic({
      busId: opened.busId,
      can_id: 0x5a1,
      data: '02100c00',
      period_ms: 100,
      is_eff: false
    })
    assert.ok(started.job_id.length > 0)
    await new Promise((resolve) => setTimeout(resolve, 250))
    await supervisor.stopCyclic(started.job_id)
    await supervisor.closeBus(opened.busId)
  } finally {
    supervisor.stop()
  }
})

test('tx.send DBC pack / unknown message via EngineSupervisor', { timeout: 20_000 }, async (t) => {
  if (process.platform !== 'linux') {
    t.skip('engine supervisor is Linux-only')
    return
  }

  const supervisor = new EngineSupervisor()
  supervisor.start()
  try {
    await waitForConnected(supervisor, 10_000)

    await assert.rejects(
      () =>
        supervisor.sendFrame({
          busId: 'missing-bus',
          message: 'EngineStatus',
          signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 }
        }),
      (error: unknown) => {
        assert.ok(error instanceof EngineRequestError)
        assert.equal(error.code, 'bus_not_found')
        return true
      }
    )

    const listed = await supervisor.listBuses()
    const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
    if (!vcan || vcan.state !== 'up') {
      t.diagnostic('SKIP vcan0 DBC TX: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
      return
    }

    const opened = await supervisor.openBus('vcan0')
    await assert.rejects(
      () =>
        supervisor.sendFrame({
          busId: opened.busId,
          message: 'EngineStatus',
          signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 }
        }),
      (error: unknown) => {
        assert.ok(error instanceof EngineRequestError)
        assert.equal(error.code, 'dbc_not_loaded')
        return true
      }
    )

    const loaded = await supervisor.loadDbc(opened.busId, 'fixtures/dbc/sample.dbc')
    assert.ok(loaded.catalog.some((message) => message.name === 'EngineStatus'))
    const engine = loaded.catalog.find((message) => message.name === 'EngineStatus')
    assert.ok(engine?.signals.some((signal) => signal.name === 'EngineSpeed' && signal.unit === 'rpm'))

    await assert.rejects(
      () => supervisor.sendFrame({ busId: opened.busId, message: 'GhostFrame', signals: {} }),
      (error: unknown) => {
        assert.ok(error instanceof EngineRequestError)
        assert.equal(error.code, 'unknown_message')
        return true
      }
    )

    const pending = collectTx(supervisor, 0x100, 800)
    await supervisor.sendFrame({
      busId: opened.busId,
      message: 'EngineStatus',
      signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 }
    })
    const frames = await pending
    assert.ok(
      frames.some((frame) => frame.can_id === 0x100 && (frame.dir === 'tx' || frame.decode?.name === 'EngineStatus')),
      'expected packed EngineStatus TX echo'
    )
    const started = await supervisor.startCyclic({
      busId: opened.busId,
      message: 'EngineStatus',
      signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 },
      period_ms: 100
    })
    assert.ok(started.job_id.length > 0)
    await new Promise((resolve) => setTimeout(resolve, 250))
    await supervisor.stopCyclic(started.job_id)
    await supervisor.closeBus(opened.busId)
  } finally {
    supervisor.stop()
  }
})
