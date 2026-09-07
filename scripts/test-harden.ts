/**
 * T16 hardening (host / UI): FrameDecoder, IPC path, Trace/Graph caps,
 * supervisor restart under load.
 *
 * Synthetic path always runs. Live vcan restart-under-RX/TX is SKIP if
 * vcan0 is not UP.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_PENDING_REQUESTS } from '../electron/main/engineClient'
import { encodeMessage, FrameDecoder, MAX_FRAME_BYTES, ProtocolError } from '../electron/main/framing'
import { createIpcSocketPath } from '../electron/main/ipcPath'
import { EngineSupervisor } from '../electron/main/engineSupervisor'
import type { FrameEvent, RxBatch } from '../shared/engine'
import { GraphStore } from '../shared/graphStore'
import { GRAPH_CATALOG_MAX, GRAPH_SERIES_MAX, maxSamplesForWindow } from '../shared/graphWindow'
import { applyRxBatch } from '../shared/traceControl'
import { FrameRing, TRACE_RING_CAPACITY } from '../shared/traceRing'

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
      signals: { EngineSpeed: 250, EngineTemp: 50 },
      units: { EngineSpeed: 'rpm', EngineTemp: 'degC' }
    },
    ...overrides
  }
}

function waitFor(
  supervisor: EngineSupervisor,
  connected: boolean,
  timeoutMs: number
): Promise<void> {
  if (supervisor.getStatus().connected === connected) {
    return Promise.resolve()
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
        resolve()
      }
    })
  })
}

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

test('FrameDecoder rejects oversized / zero / malformed and buffers partials', () => {
  const decoder = new FrameDecoder()
  const hello = encodeMessage({ type: 'engine.hello', payload: { name: 'x' } })
  assert.deepEqual(decoder.push(hello.subarray(0, 3)), [])
  const rest = decoder.push(hello.subarray(3))
  assert.equal(rest.length, 1)
  assert.equal(rest[0]?.type, 'engine.hello')

  const over = Buffer.alloc(4)
  over.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
  const overDec = new FrameDecoder()
  assert.throws(
    () => overDec.push(over),
    (error: unknown) => error instanceof ProtocolError && error.code === 'payload_too_large'
  )

  const zero = Buffer.alloc(4)
  const zeroDec = new FrameDecoder()
  assert.throws(
    () => zeroDec.push(zero),
    (error: unknown) => error instanceof ProtocolError && error.code === 'invalid_length'
  )

  const badJson = Buffer.from('{not-json', 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(badJson.length, 0)
  const badDec = new FrameDecoder()
  assert.throws(
    () => badDec.push(Buffer.concat([header, badJson])),
    (error: unknown) => error instanceof ProtocolError && error.code === 'invalid_json'
  )
})

test('createIpcSocketPath stays off world-writable XDG', () => {
  const dirty = mkdtempSync(join(tmpdir(), 'vb-world-'))
  chmodSync(dirty, 0o777)
  const prev = process.env.XDG_RUNTIME_DIR
  process.env.XDG_RUNTIME_DIR = dirty
  try {
    const path = createIpcSocketPath(process.pid)
    assert.ok(!path.startsWith(dirty + '/'), `must not use world-writable XDG: ${path}`)
    assert.ok(path.includes('vanillabus-') || path.includes('engine.sock'))
  } finally {
    if (prev === undefined) {
      delete process.env.XDG_RUNTIME_DIR
    } else {
      process.env.XDG_RUNTIME_DIR = prev
    }
  }
  assert.equal(MAX_PENDING_REQUESTS, 128)
})

test('Trace ring holds 20k under a 25k synthetic flood', () => {
  assert.equal(TRACE_RING_CAPACITY, 20_000)
  const ring = new FrameRing(TRACE_RING_CAPACITY)
  const flood = 25_000
  const frames: FrameEvent[] = []
  for (let index = 0; index < flood; index += 1) {
    frames.push(
      makeFrame({
        ts_us: 1_700_000_000_000_000 + index,
        can_id: 0x100 + (index % 64)
      })
    )
  }
  const dropped = applyRxBatch(ring, frames, false)
  assert.equal(ring.size, TRACE_RING_CAPACITY)
  assert.equal(dropped, flood - TRACE_RING_CAPACITY)
  assert.equal(ring.droppedOldest, flood - TRACE_RING_CAPACITY)
  assert.equal(ring.at(0).frame.ts_us, 1_700_000_000_000_000 + (flood - TRACE_RING_CAPACITY))
})

test('Graph sample window and series caps hold under flood', () => {
  const store = new GraphStore()
  store.setHz(20)
  store.setWindowSec(10)
  store.setSelected(['Flood0.Sig'])

  const start = 5_000_000_000_000
  const periodUs = 1_000
  const frames: FrameEvent[] = []
  for (let index = 0; index < 8_000; index += 1) {
    const series = index < 400 ? index : index % 40
    frames.push(
      makeFrame({
        ts_us: start + index * periodUs,
        can_id: series,
        decode: {
          name: `Flood${series}`,
          signals: { Sig: index },
          units: {}
        }
      })
    )
  }
  store.appendBatch({ frames, dropped: 17 })
  assert.equal(store.engineDropped, 17)
  assert.ok(store.seriesCount() <= GRAPH_SERIES_MAX, `series ${store.seriesCount()} > ${GRAPH_SERIES_MAX}`)
  assert.ok(
    store.catalogEntries().length <= GRAPH_CATALOG_MAX,
    `catalog ${store.catalogEntries().length} > ${GRAPH_CATALOG_MAX}`
  )
  assert.ok(
    store.maxSeriesLength() <= maxSamplesForWindow(10, 20),
    `samples ${store.maxSeriesLength()} over window bound`
  )
  assert.ok(store.sampleCount('Flood0.Sig') > 0)
})

test(
  'supervisor restart under IPC load reconnects without hung requests',
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
      await new Promise((resolve) => setTimeout(resolve, 50))
      const pid = supervisor.getEnginePid()
      assert.ok(pid, 'expected a live engine PID')
      process.kill(pid, 'SIGKILL')
      await waitFor(supervisor, false, 5_000)
      await waitFor(supervisor, true, 10_000)
      clearInterval(load)
      const settled = await Promise.all(inflight)
      assert.ok(settled.every((item) => item === 'ok' || item === 'err'))
      const listed = await supervisor.listBuses()
      assert.ok(Array.isArray(listed.interfaces))
    } finally {
      supervisor.stop()
    }
  }
)

test(
  'supervisor restart under vcan RX/TX load resumes (SKIP if no vcan)',
  { timeout: 30_000 },
  async (t) => {
    if (process.platform !== 'linux') {
      t.skip('engine supervisor is Linux-only')
      return
    }
    if (!vcan0Up()) {
      t.diagnostic('SKIP vcan0 harden: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
      console.log('SKIP vcan0 harden: vcan0 is not UP on this host.')
      return
    }

    const supervisor = new EngineSupervisor()
    const batches: RxBatch[] = []
    const offRx = supervisor.onRxBatch((batch) => {
      batches.push(batch)
    })
    supervisor.start()
    try {
      await waitFor(supervisor, true, 10_000)
      const listed = await supervisor.listBuses()
      const vcan = listed.interfaces.find((iface) => iface.name === 'vcan0')
      if (!vcan || vcan.state !== 'up') {
        t.diagnostic('SKIP vcan0 harden: vcan0 is not UP. sudo ./scripts/setup-vcan.sh')
        console.log('SKIP vcan0 harden: vcan0 is not UP on this host.')
        return
      }

      const opened = await supervisor.openBus('vcan0')
      const cyclic = await supervisor.startCyclic({
        busId: opened.busId,
        can_id: 0x5A2,
        data: '01020304',
        period_ms: 10
      })
      for (let index = 0; index < 20; index += 1) {
        injectVcanFrame(0x42C, 'aabbccdd')
      }

      const pid = supervisor.getEnginePid()
      assert.ok(pid, 'expected a live engine PID')
      process.kill(pid, 'SIGKILL')
      await waitFor(supervisor, false, 5_000)
      await waitFor(supervisor, true, 10_000)

      batches.length = 0
      const reopened = await supervisor.openBus('vcan0')
      assert.ok(reopened.busId)
      injectVcanFrame(0x42D, '11223344')
      const deadline = Date.now() + 500
      let matched = false
      while (Date.now() < deadline && !matched) {
        matched = batches.some((batch) =>
          batch.frames.some((frame) => frame.can_id === 0x42d && frame.dir === 'rx')
        )
        if (!matched) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      assert.equal(matched, true, 'expected rx.batch after restart-under-load reopen')
      assert.ok(typeof cyclic.job_id === 'string')
      await supervisor.closeBus(reopened.busId)
    } finally {
      offRx()
      supervisor.stop()
    }
  }
)
