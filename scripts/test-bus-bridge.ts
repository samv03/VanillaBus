import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EngineRequestError } from '../electron/main/engineClient'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

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
  'listBuses / openBus missing iface / optional vcan0 open-close-reopen',
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

      const listed = await supervisor.listBuses()
      assert.equal(listed.ok, true)
      assert.ok(Array.isArray(listed.interfaces))
      for (const iface of listed.interfaces) {
        assert.equal(typeof iface.name, 'string')
        assert.equal(typeof iface.kind, 'string')
        assert.ok(iface.state === 'up' || iface.state === 'down')
      }

      await assert.rejects(
        () => supervisor.openBus('vb_missing0'),
        (error: unknown) => {
          assert.ok(error instanceof EngineRequestError)
          assert.equal(error.code, 'iface_not_found')
          return true
        }
      )

      const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
      if (!vcan || vcan.state !== 'up') {
        t.diagnostic(
          'SKIP vcan0 open/close/reopen: vcan0 is not UP. sudo ./scripts/setup-vcan.sh'
        )
        return
      }

      const first = await supervisor.openBus('vcan0', 500_000)
      assert.equal(first.ok, true)
      assert.ok(first.busId.length > 0)
      await supervisor.closeBus(first.busId)
      const second = await supervisor.openBus('vcan0')
      assert.notEqual(second.busId, first.busId)
      await supervisor.closeBus(second.busId)
    } finally {
      supervisor.stop()
    }
  }
)
