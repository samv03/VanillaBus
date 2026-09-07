import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  connectionEventFromTransition,
  DISCONNECTED_ENGINE_INFO,
  engineInfoFromStatus,
  type EngineHello,
  type EngineStatus
} from '../shared/engine'
import { EngineSupervisor } from '../electron/main/engineSupervisor'

const HELLO: EngineHello = {
  name: 'vanillabus-engine',
  version: '0.1.0',
  backends: ['socketcan']
}

function waitFor(
  supervisor: EngineSupervisor,
  connected: boolean,
  timeoutMs: number
): Promise<EngineStatus> {
  const current = supervisor.getStatus()
  if (current.connected === connected) {
    return Promise.resolve(current)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out waiting for connected=${connected}`))
    }, timeoutMs)
    const unsubscribe = supervisor.onStatus((status) => {
      if (status.connected === connected) {
        clearTimeout(timer)
        unsubscribe()
        resolve(status)
      }
    })
  })
}

test('engineInfoFromStatus flattens hello when connected', () => {
  const info = engineInfoFromStatus({ connected: true, hello: HELLO })
  assert.equal(info.connected, true)
  assert.equal(info.name, 'vanillabus-engine')
  assert.equal(info.version, '0.1.0')
  assert.deepEqual(info.backends, ['socketcan'])
  assert.deepEqual(info.hello, HELLO)
})

test('engineInfoFromStatus is disconnected without hello', () => {
  assert.deepEqual(engineInfoFromStatus({ connected: false, hello: null }), DISCONNECTED_ENGINE_INFO)
  assert.deepEqual(engineInfoFromStatus({ connected: true, hello: null }), DISCONNECTED_ENGINE_INFO)
})

test('connectionEventFromTransition emits connected and disconnected only on change', () => {
  const offline: EngineStatus = { connected: false, hello: null }
  const online: EngineStatus = { connected: true, hello: HELLO }

  assert.equal(connectionEventFromTransition(offline, offline), null)
  assert.equal(connectionEventFromTransition(online, online), null)

  const up = connectionEventFromTransition(offline, online)
  assert.ok(up)
  assert.equal(up.type, 'connected')
  assert.equal(up.info.version, '0.1.0')

  const down = connectionEventFromTransition(online, offline)
  assert.ok(down)
  assert.equal(down.type, 'disconnected')
  assert.equal(down.info.connected, false)
  assert.equal(down.info.name, null)
})

test(
  'killing the engine child reaches Disconnected then Connected after respawn',
  { timeout: 20_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
      return
    }

    const supervisor = new EngineSupervisor()
    const seen: boolean[] = [supervisor.getStatus().connected]
    const off = supervisor.onStatus((status) => {
      if (seen[seen.length - 1] !== status.connected) {
        seen.push(status.connected)
      }
    })

    supervisor.start()
    try {
      const first = await waitFor(supervisor, true, 10_000)
      assert.equal(first.hello?.name, 'vanillabus-engine')
      assert.equal(first.hello?.version, '0.1.0')
      assert.deepEqual(first.hello?.backends, ['socketcan'])

      const pid = supervisor.getEnginePid()
      assert.ok(pid, 'expected a live engine PID')
      process.kill(pid, 'SIGKILL')

      const down = await waitFor(supervisor, false, 5_000)
      assert.equal(down.hello, null)
      assert.equal(engineInfoFromStatus(down).connected, false)

      const up = await waitFor(supervisor, true, 10_000)
      assert.equal(up.hello?.name, 'vanillabus-engine')
      assert.ok(seen.includes(false), 'Disconnected must be observed before respawn')
      assert.deepEqual(seen.slice(0, 3), [false, true, false])
      assert.equal(seen[seen.length - 1], true)
    } finally {
      off()
      supervisor.stop()
    }
  }
)

test(
  'killing the engine under IPC load reconnects without hanging requests',
  { timeout: 25_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
      return
    }

    const supervisor = new EngineSupervisor()
    supervisor.start()
    try {
      await waitFor(supervisor, true, 10_000)

      const inflight: Promise<string>[] = []
      const load = setInterval(() => {
        inflight.push(supervisor.listBuses().then(() => 'ok', () => 'err'))
      }, 8)

      await new Promise((resolve) => setTimeout(resolve, 40))
      const pid = supervisor.getEnginePid()
      assert.ok(pid, 'expected a live engine PID')
      process.kill(pid, 'SIGKILL')

      await waitFor(supervisor, false, 5_000)
      const up = await waitFor(supervisor, true, 10_000)
      clearInterval(load)
      assert.equal(up.hello?.name, 'vanillabus-engine')

      const settled = await Promise.all(inflight)
      assert.ok(
        settled.every((item) => item === 'ok' || item === 'err'),
        'in-flight requests must settle (no deadlock)'
      )
      const listed = await supervisor.listBuses()
      assert.ok(Array.isArray(listed.interfaces))
    } finally {
      supervisor.stop()
    }
  }
)
