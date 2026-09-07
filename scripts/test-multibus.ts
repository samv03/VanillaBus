/**
 * T14 multi-bus UI helpers: Trace ring keyed by busId/ifName, Graph
 * follows the selected bus, header selection helpers.
 *
 * Always synthetic (no CAN required). Live isolation lives in
 * scripts/test-multibus.py.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FrameEvent, RxBatch } from '../shared/engine'
import { GraphStore } from '../shared/graphStore'
import {
  findOpenedByName,
  formatBusOptionLabel,
  remainingSelectedBus
} from '../shared/multiBus'
import { applyRxBatch } from '../shared/traceControl'
import { frameMatchesFilter } from '../shared/traceFilter'
import { FrameRing } from '../shared/traceRing'

function makeFrame(overrides: Partial<FrameEvent> = {}): FrameEvent {
  return {
    busId: 'bus-a',
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

test('header helpers label open buses and keep the other selection on close', () => {
  const opened = [
    { busId: 'id-a', name: 'vcan0' },
    { busId: 'id-b', name: 'vcan1' }
  ]
  assert.equal(findOpenedByName(opened, 'vcan1')?.busId, 'id-b')
  assert.equal(formatBusOptionLabel('vcan0', { kind: 'vcan', state: 'up' }, true), 'vcan0 (vcan, up, open)')
  assert.equal(formatBusOptionLabel('vcan1', { kind: 'vcan', state: 'up' }, false), 'vcan1 (vcan, up)')
  assert.equal(remainingSelectedBus(opened, 'id-a', 'vcan0'), 'vcan1')
  assert.equal(remainingSelectedBus(opened, 'id-a', 'vcan1'), 'vcan1')
  assert.equal(remainingSelectedBus(opened, 'id-missing', 'vcan0'), 'vcan0')
})

test('Trace ring keeps Bus (ifName) + busId for frames from both buses', () => {
  const ring = new FrameRing(32)
  const dropped = applyRxBatch(ring, {
    frames: [
      makeFrame({ busId: 'id-a', ifName: 'vcan0', can_id: 0x100 }),
      makeFrame({
        busId: 'id-b',
        ifName: 'vcan1',
        can_id: 0x200,
        decode: {
          name: 'MuxStatus',
          signals: { MuxId: 0, CoolantTemp: 25, Counter: 7 },
          units: { CoolantTemp: 'degC' }
        }
      })
    ],
    dropped: 0
  } satisfies RxBatch)
  assert.equal(dropped, 0)
  assert.equal(ring.size, 2)
  assert.equal(ring.at(0).frame.ifName, 'vcan0')
  assert.equal(ring.at(0).frame.busId, 'id-a')
  assert.equal(ring.at(1).frame.ifName, 'vcan1')
  assert.equal(ring.at(1).frame.busId, 'id-b')
  assert.equal(ring.at(0).frame.decode?.name, 'EngineStatus')
  assert.equal(ring.at(1).frame.decode?.name, 'MuxStatus')
  assert.equal(frameMatchesFilter(ring.at(0).frame, 'vcan0'), true)
  assert.equal(frameMatchesFilter(ring.at(1).frame, 'vcan1'), true)
  assert.equal(frameMatchesFilter(ring.at(0).frame, 'vcan1'), false)
})

test('Graph plots only the selected busId', () => {
  const store = new GraphStore()
  store.setActiveBus('id-a')
  store.applyDbcCatalog([
    {
      name: 'EngineStatus',
      can_id: 0x100,
      signals: [{ name: 'EngineSpeed', unit: 'rpm' }]
    }
  ])
  store.setSelected(['EngineStatus.EngineSpeed'])
  store.appendBatch({
    frames: [
      makeFrame({
        busId: 'id-a',
        ifName: 'vcan0',
        ts_us: 1_000,
        decode: {
          name: 'EngineStatus',
          signals: { EngineSpeed: 100 },
          units: { EngineSpeed: 'rpm' }
        }
      }),
      makeFrame({
        busId: 'id-b',
        ifName: 'vcan1',
        ts_us: 2_000,
        can_id: 0x200,
        decode: {
          name: 'MuxStatus',
          signals: { CoolantTemp: 25 },
          units: { CoolantTemp: 'degC' }
        }
      }),
      makeFrame({
        busId: 'id-a',
        ifName: 'vcan0',
        ts_us: 3_000,
        decode: {
          name: 'EngineStatus',
          signals: { EngineSpeed: 200 },
          units: { EngineSpeed: 'rpm' }
        }
      })
    ],
    dropped: 0
  })
  assert.equal(store.messageCount, 2)
  assert.equal(store.activeBusId, 'id-a')
  const samples = store.samples('EngineStatus.EngineSpeed')
  assert.ok(samples.length >= 1)
  assert.ok(samples.every((sample) => sample.ts_us !== 2_000))
  assert.equal(store.samples('MuxStatus.CoolantTemp').length, 0)

  store.setActiveBus('id-b')
  assert.equal(store.activeBusId, 'id-b')
  assert.equal(store.samples('EngineStatus.EngineSpeed').length, 0)
  store.applyDbcCatalog([
    {
      name: 'MuxStatus',
      can_id: 0x200,
      signals: [{ name: 'CoolantTemp', unit: 'degC' }]
    }
  ])
  store.setSelected(['MuxStatus.CoolantTemp'])
  store.appendBatch({
    frames: [
      makeFrame({
        busId: 'id-b',
        ifName: 'vcan1',
        ts_us: 4_000,
        can_id: 0x200,
        decode: {
          name: 'MuxStatus',
          signals: { CoolantTemp: 30 },
          units: { CoolantTemp: 'degC' }
        }
      })
    ],
    dropped: 0
  })
  assert.ok(store.sampleCount('MuxStatus.CoolantTemp') >= 1)
})
