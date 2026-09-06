import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parseFrameEvent, parseRxBatch, type RxBatch } from '../shared/engine'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

const SAMPLE_FRAME = {
  busId: 'bus-1',
  ifName: 'vcan0',
  ts_us: 1_700_000_000_000_123,
  can_id: 0x123,
  dlc: 2,
  data: 'abcd',
  is_eff: false,
  is_fd: false,
  brs: false,
  is_rtr: false,
  is_err: false,
  dir: 'rx' as const,
  rate_ms: null
}

test('parseFrameEvent / parseRxBatch accept T5 FrameEvent fields', () => {
  const frame = parseFrameEvent(SAMPLE_FRAME)
  assert.ok(frame)
  assert.equal(frame.can_id, 0x123)
  assert.equal(frame.rate_ms, null)
  assert.equal(frame.is_rtr, false)
  assert.equal(frame.is_err, false)

  const batch = parseRxBatch({ frames: [SAMPLE_FRAME], dropped: 3 })
  assert.ok(batch)
  assert.equal(batch.frames.length, 1)
  assert.equal(batch.dropped, 3)
  assert.equal(parseFrameEvent({ ...SAMPLE_FRAME, dir: 'RX' }), null)
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

function injectVcanFrame(canId: number, dataHex: string): void {
  const script = `
import sys
try:
    import can
except ImportError:
    sys.exit(2)
bus = can.Bus(interface="socketcan", channel="vcan0")
bus.send(can.Message(arbitration_id=${canId}, data=bytes.fromhex("${dataHex}"), is_extended_id=False))
bus.shutdown()
`
  const viaPython = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  if (viaPython.status === 0) {
    return
  }
  const viaCansend = spawnSync(
    'cansend',
    ['vcan0', `${canId.toString(16).toUpperCase().padStart(3, '0')}#${dataHex}`],
    { encoding: 'utf8' }
  )
  if (viaCansend.status !== 0) {
    throw new Error(viaPython.stderr || viaCansend.stderr || 'frame inject failed')
  }
}

test(
  'open vcan0 then receive rx.batch for an injected can_id',
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
        t.diagnostic('SKIP vcan0 RX inject: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        return
      }

      const opened = await supervisor.openBus('vcan0')
      const canId = 0x42a
      const started = Date.now()
      injectVcanFrame(canId, '11223344')

      const deadline = Date.now() + 200
      let matched = false
      while (Date.now() < deadline && !matched) {
        matched = batches.some((batch) =>
          batch.frames.some((frame) => frame.can_id === canId && frame.dir === 'rx')
        )
        if (!matched) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      assert.equal(matched, true, 'expected rx.batch with can_id 0x42A within 200 ms')
      const frame = batches.flatMap((batch) => [...batch.frames]).find((item) => item.can_id === canId)
      assert.ok(frame)
      assert.equal(frame.ifName, 'vcan0')
      assert.equal(frame.busId, opened.busId)
      assert.equal(frame.data, '11223344')
      assert.equal(frame.rate_ms, null)
      assert.ok(Date.now() - started <= 200)
      await supervisor.closeBus(opened.busId)
    } finally {
      offRx()
      supervisor.stop()
    }
  }
)
