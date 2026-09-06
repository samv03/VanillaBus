import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFrameEvent, parseRxBatch } from '../shared/engine'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

const SAMPLE_FRAME = {
  busId: 'bus-1',
  ifName: 'vcan0',
  ts_us: 1_700_000_000_000_123,
  can_id: 0x100,
  dlc: 8,
  data: 'e8035a0a00000000',
  is_eff: false,
  is_fd: false,
  brs: false,
  is_rtr: false,
  is_err: false,
  dir: 'rx' as const,
  rate_ms: null
}

test('parseFrameEvent accepts optional decode and unknown-ID null', () => {
  const raw = parseFrameEvent(SAMPLE_FRAME)
  assert.ok(raw)
  assert.equal(raw.decode, null)

  const decoded = parseFrameEvent({
    ...SAMPLE_FRAME,
    decode: {
      name: 'EngineStatus',
      signals: { EngineSpeed: 250, EngineTemp: 50, OilPressure: 20 },
      units: { EngineSpeed: 'rpm', EngineTemp: 'degC', OilPressure: 'kPa' }
    }
  })
  assert.ok(decoded)
  assert.equal(decoded.decode?.name, 'EngineStatus')
  assert.equal(decoded.decode?.signals.EngineSpeed, 250)
  assert.equal(decoded.decode?.units.EngineSpeed, 'rpm')

  const unknown = parseFrameEvent({ ...SAMPLE_FRAME, can_id: 0x7ff, decode: null })
  assert.ok(unknown)
  assert.equal(unknown.decode, null)

  const batch = parseRxBatch({
    frames: [
      SAMPLE_FRAME,
      { ...SAMPLE_FRAME, decode: { name: 'EngineStatus', signals: { EngineSpeed: 250 } } }
    ],
    dropped: 0
  })
  assert.ok(batch)
  assert.equal(batch.frames[0]?.decode, null)
  assert.equal(batch.frames[1]?.decode?.name, 'EngineStatus')
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

test(
  'loadDbc allowlist / missing bus via EngineSupervisor',
  { timeout: 20_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
      return
    }

    const supervisor = new EngineSupervisor()
    supervisor.start()
    try {
      await waitForConnected(supervisor, 10_000)

      await assert.rejects(
        () => supervisor.loadDbc('missing-bus', 'fixtures/dbc/sample.dbc'),
        (error: unknown) => {
          assert.ok(error instanceof EngineRequestError)
          assert.equal(error.code, 'bus_not_found')
          return true
        }
      )

      const listed = await supervisor.listBuses()
      const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
      if (!vcan || vcan.state !== 'up') {
        t.diagnostic('SKIP vcan0 DBC load: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        return
      }

      const opened = await supervisor.openBus('vcan0')
      await assert.rejects(
        () => supervisor.loadDbc(opened.busId, '/tmp/vanillabus-evil.dbc'),
        (error: unknown) => {
          assert.ok(error instanceof EngineRequestError)
          assert.equal(error.code, 'path_not_allowed')
          return true
        }
      )
      await assert.rejects(
        () => supervisor.loadDbc(opened.busId, 'fixtures/dbc/invalid.dbc'),
        (error: unknown) => {
          assert.ok(error instanceof EngineRequestError)
          assert.equal(error.code, 'dbc_invalid')
          return true
        }
      )
      const loaded = await supervisor.loadDbc(opened.busId, 'fixtures/dbc/sample.dbc')
      assert.equal(loaded.ok, true)
      assert.equal(loaded.message_count, 2)
      await supervisor.clearDbc(opened.busId)
      await supervisor.closeBus(opened.busId)
    } finally {
      supervisor.stop()
    }
  }
)
