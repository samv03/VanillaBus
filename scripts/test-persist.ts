/**
 * T17 persist: sanitize / restore helpers + JSON userData store round-trip.
 * Always offline (no Electron window, no SocketCAN).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { persistFilePath, UserStore } from '../electron/main/userStore'
import {
  buildPersistSnapshot,
  cyclicJobDefinitionId,
  dbcPathForBus,
  DEFAULT_PERSIST,
  formatRememberedBusLabel,
  jobsToDefinitions,
  mergeRememberedNames,
  PERSIST_FILENAME,
  rememberedEmptyListText,
  rememberedRestoreText,
  sanitizePersist,
  upsertBusHint
} from '../shared/persist'

test('sanitizePersist fills defaults and drops junk', () => {
  assert.deepEqual(sanitizePersist(null), DEFAULT_PERSIST)
  assert.deepEqual(sanitizePersist('nope'), DEFAULT_PERSIST)
  const cleaned = sanitizePersist({
    version: 99,
    lastBusName: '  can0  ',
    lastDbcPath: 'fixtures/dbc/mux.dbc',
    buses: [
      { name: 'can0', dbcPath: '/tmp/a.dbc' },
      { name: 'can0', dbcPath: 'dup' },
      { name: '', dbcPath: 'x' },
      { name: 3 }
    ],
    trace: { filter: '0x100', paused: true, scrollLock: false },
    graph: { windowSec: 60, selected: ['EngineStatus.EngineSpeed', '', 'EngineStatus.EngineSpeed'] },
    txRaw: { busName: 'can0', idHex: '0x123', dataHex: '11 22', mode: 'cyclic', periodMs: 50, isEff: true },
    txDbc: { message: 'EngineStatus', values: { EngineSpeed: '800' }, periodMs: 20 },
    cyclicJobs: [
      { type: 'Raw', ifName: 'can0', canId: 0x7e0, isEff: false, data: '02100c', periodMs: 100 },
      { type: 'nope', ifName: 'can0', canId: 1, periodMs: 1 }
    ]
  })
  assert.equal(cleaned.version, 1)
  assert.equal(cleaned.lastBusName, 'can0')
  assert.equal(cleaned.lastDbcPath, 'fixtures/dbc/mux.dbc')
  assert.equal(cleaned.buses.length, 1)
  assert.equal(cleaned.buses[0]?.dbcPath, '/tmp/a.dbc')
  assert.equal(cleaned.trace.filter, '0x100')
  assert.equal(cleaned.trace.paused, true)
  assert.equal(cleaned.trace.scrollLock, false)
  assert.equal(cleaned.graph.windowSec, 60)
  assert.deepEqual(cleaned.graph.selected, ['EngineStatus.EngineSpeed'])
  assert.equal(cleaned.txRaw.mode, 'cyclic')
  assert.equal(cleaned.txRaw.periodMs, 50)
  assert.equal(cleaned.txDbc.message, 'EngineStatus')
  assert.equal(cleaned.cyclicJobs.length, 1)
  assert.equal(cleaned.cyclicJobs[0]?.type, 'Raw')
})

test('sanitizePersist rejects a bad graph window and empty iface names', () => {
  const cleaned = sanitizePersist({
    graph: { windowSec: 15, selected: [1, 'ok'] },
    lastBusName: '',
    buses: [{ name: '   ' }]
  })
  assert.equal(cleaned.graph.windowSec, DEFAULT_PERSIST.graph.windowSec)
  assert.deepEqual(cleaned.graph.selected, ['ok'])
  assert.equal(cleaned.lastBusName, DEFAULT_PERSIST.lastBusName)
  assert.deepEqual(cleaned.buses, [])
})

test('restore helpers merge remembered names and never invent auto-open', () => {
  const snapshot = buildPersistSnapshot({
    lastBusName: 'vcan0',
    lastDbcPath: 'fixtures/dbc/sample.dbc',
    buses: [
      { name: 'vcan0', dbcPath: 'fixtures/dbc/sample.dbc' },
      { name: 'vcan1', dbcPath: 'fixtures/dbc/mux.dbc' }
    ],
    trace: DEFAULT_PERSIST.trace,
    graph: { windowSec: 10, selected: ['VehicleSpeed.Speed'] },
    txRaw: DEFAULT_PERSIST.txRaw,
    txDbc: DEFAULT_PERSIST.txDbc,
    cyclicJobs: [
      { type: 'DBC', ifName: 'vcan0', canId: 0x100, isEff: false, data: '', message: 'EngineStatus', periodMs: 100 }
    ]
  })
  assert.equal(dbcPathForBus(snapshot, 'vcan1'), 'fixtures/dbc/mux.dbc')
  assert.equal(dbcPathForBus(snapshot, 'can9'), 'fixtures/dbc/sample.dbc')
  assert.deepEqual(mergeRememberedNames(['can0'], snapshot.buses, 'vcan0'), [
    'can0',
    'vcan0',
    'vcan1'
  ])
  assert.match(rememberedRestoreText(snapshot), /Not auto-connected/)
  assert.match(rememberedEmptyListText(snapshot), /setup-vcan\.sh/)
  assert.equal(formatRememberedBusLabel('vcan0', undefined, false, true), 'vcan0 (remembered)')
  assert.equal(
    formatRememberedBusLabel('vcan0', { kind: 'vcan', state: 'down' }, false, true),
    'vcan0 (vcan, down)'
  )
  const defs = jobsToDefinitions([
    {
      type: 'Raw',
      ifName: 'vcan0',
      canId: 0x7e0,
      isEff: false,
      data: 'aa',
      periodMs: 40
    }
  ])
  assert.equal(defs[0]?.periodMs, 40)
  assert.equal(cyclicJobDefinitionId(2), 'remembered-2')
})

test('upsertBusHint updates DBC path and caps uniqueness', () => {
  let buses = upsertBusHint([], 'vcan0')
  buses = upsertBusHint(buses, 'vcan0', 'fixtures/dbc/sample.dbc')
  buses = upsertBusHint(buses, 'vcan1', 'fixtures/dbc/mux.dbc')
  assert.equal(buses[0]?.name, 'vcan1')
  assert.equal(buses.find((item) => item.name === 'vcan0')?.dbcPath, 'fixtures/dbc/sample.dbc')
  buses = upsertBusHint(buses, 'vcan0')
  assert.equal(buses.find((item) => item.name === 'vcan0')?.dbcPath, 'fixtures/dbc/sample.dbc')
})

test('UserStore load/save round-trips on a temp path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vanillabus-persist-'))
  try {
    const store = UserStore.fromUserData(dir)
    assert.equal(store.filePath, persistFilePath(dir))
    assert.equal(store.filePath.endsWith(PERSIST_FILENAME), true)
    assert.deepEqual(store.load(), DEFAULT_PERSIST)

    const saved = store.save(
      buildPersistSnapshot({
        lastBusName: 'vcan0',
        lastDbcPath: 'fixtures/dbc/sample.dbc',
        buses: [{ name: 'vcan0', dbcPath: 'fixtures/dbc/sample.dbc' }],
        opened: [{ name: 'vcan1', dbcPath: null }],
        trace: { filter: 'Engine', paused: false, scrollLock: true },
        graph: { windowSec: 30, selected: ['EngineStatus.EngineTemp'] },
        txRaw: { ...DEFAULT_PERSIST.txRaw, idHex: '0x5A1' },
        txDbc: { message: 'VehicleSpeed', values: { Speed: '42' }, periodMs: 80 },
        cyclicJobs: [
          { type: 'Raw', ifName: 'vcan0', canId: 0x5a1, isEff: false, data: 'dead', periodMs: 25 }
        ]
      })
    )
    const again = store.load()
    assert.deepEqual(again, saved)
    assert.equal(again.lastBusName, 'vcan0')
    assert.equal(again.txRaw.idHex, '0x5A1')
    assert.equal(again.txDbc.values.Speed, '42')
    assert.ok(again.buses.some((item) => item.name === 'vcan1'))
    assert.equal(again.cyclicJobs[0]?.canId, 0x5a1)
    assert.equal(again.trace.filter, 'Engine')
    assert.deepEqual(again.graph.selected, ['EngineStatus.EngineTemp'])
    const onDisk = JSON.parse(readFileSync(store.filePath, 'utf8')) as { version: number }
    assert.equal(onDisk.version, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('UserStore treats corrupt JSON as defaults and then overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vanillabus-persist-bad-'))
  try {
    const store = UserStore.fromUserData(dir)
    writeFileSync(store.filePath, '{not-json', 'utf8')
    assert.deepEqual(store.load(), DEFAULT_PERSIST)
    const saved = store.save({
      ...DEFAULT_PERSIST,
      lastBusName: 'can0',
      buses: [{ name: 'can0', dbcPath: null }]
    })
    assert.equal(store.load().lastBusName, 'can0')
    assert.equal(saved.buses[0]?.name, 'can0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
