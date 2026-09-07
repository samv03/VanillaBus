/**
 * T17 UI persist snapshot. Pure helpers — no Electron, SocketCAN, or DBC parse.
 *
 * The renderer remembers last-used iface names, per-bus DBC paths, Trace/Graph
 * prefs, Transmit drafts, and cyclic *definitions*. Main writes JSON under
 * userData. Restore never auto-opens a bus or starts a live cyclic job.
 */

import { formatBusOptionLabel } from './multiBus'
import { GRAPH_DEFAULT_WINDOW_SEC, isGraphWindowSec, type GraphWindowSec } from './graphWindow'

export const PERSIST_VERSION = 1 as const
export const PERSIST_FILENAME = 'vanillabus-ui.json'

export const PERSIST_MAX_BUSES = 16
export const PERSIST_MAX_SELECTED = 32
export const PERSIST_MAX_JOBS = 32
export const PERSIST_MAX_FILTER = 200
export const PERSIST_MAX_PATH = 512
export const PERSIST_MAX_IFACE = 32
export const PERSIST_MAX_HEX = 160
export const PERSIST_MAX_SIGNAL_KEYS = 64

export type PersistedBusHint = {
  readonly name: string
  readonly dbcPath: string | null
}

export type PersistedTracePrefs = {
  readonly filter: string
  readonly paused: boolean
  readonly scrollLock: boolean
}

export type PersistedGraphPrefs = {
  readonly windowSec: GraphWindowSec
  readonly selected: readonly string[]
}

export type PersistedSendMode = 'oneshot' | 'cyclic'

export type PersistedRawDraft = {
  readonly busName: string
  readonly idHex: string
  readonly dataHex: string
  readonly mode: PersistedSendMode
  readonly periodMs: number
  readonly isEff: boolean
  readonly isRtr: boolean
  readonly isFd: boolean
}

export type PersistedDbcDraft = {
  readonly message: string
  readonly values: Readonly<Record<string, string>>
  readonly periodMs: number
}

export type PersistedCyclicJob = {
  readonly type: 'Raw' | 'DBC'
  readonly ifName: string
  readonly canId: number
  readonly isEff: boolean
  readonly data: string
  readonly message?: string
  readonly periodMs: number
}

export type PersistSnapshot = {
  readonly version: typeof PERSIST_VERSION
  readonly lastBusName: string
  readonly lastDbcPath: string
  readonly buses: readonly PersistedBusHint[]
  readonly trace: PersistedTracePrefs
  readonly graph: PersistedGraphPrefs
  readonly txRaw: PersistedRawDraft
  readonly txDbc: PersistedDbcDraft
  readonly cyclicJobs: readonly PersistedCyclicJob[]
}

export const DEFAULT_PERSIST: PersistSnapshot = {
  version: PERSIST_VERSION,
  lastBusName: 'vcan0',
  lastDbcPath: 'fixtures/dbc/sample.dbc',
  buses: [],
  trace: {
    filter: '',
    paused: false,
    scrollLock: true
  },
  graph: {
    windowSec: GRAPH_DEFAULT_WINDOW_SEC,
    selected: []
  },
  txRaw: {
    busName: 'vcan0',
    idHex: '0x7E0',
    dataHex: '02 10 0C 00 00 00 00 00',
    mode: 'oneshot',
    periodMs: 100,
    isEff: false,
    isRtr: false,
    isFd: false
  },
  txDbc: {
    message: '',
    values: {},
    periodMs: 100
  },
  cyclicJobs: []
}

function clampString(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return fallback
  }
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function optionalPath(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const path = clampString(value, PERSIST_MAX_PATH)
  return path.length > 0 ? path : null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeBusHint(raw: unknown): PersistedBusHint | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const name = clampString(record.name, PERSIST_MAX_IFACE)
  if (name.length === 0) {
    return null
  }
  return { name, dbcPath: optionalPath(record.dbcPath) }
}

function sanitizeTrace(raw: unknown): PersistedTracePrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PERSIST.trace
  }
  const record = raw as Record<string, unknown>
  return {
    filter: clampString(record.filter, PERSIST_MAX_FILTER, ''),
    paused: asBool(record.paused, false),
    scrollLock: asBool(record.scrollLock, true)
  }
}

function sanitizeGraph(raw: unknown): PersistedGraphPrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PERSIST.graph
  }
  const record = raw as Record<string, unknown>
  const windowSec =
    typeof record.windowSec === 'number' && isGraphWindowSec(record.windowSec)
      ? record.windowSec
      : GRAPH_DEFAULT_WINDOW_SEC
  const selected: string[] = []
  if (Array.isArray(record.selected)) {
    for (const item of record.selected) {
      const key = clampString(item, 96)
      if (key.length === 0 || selected.includes(key)) {
        continue
      }
      selected.push(key)
      if (selected.length >= PERSIST_MAX_SELECTED) {
        break
      }
    }
  }
  return { windowSec, selected }
}

function sanitizeRawDraft(raw: unknown): PersistedRawDraft {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PERSIST.txRaw
  }
  const record = raw as Record<string, unknown>
  return {
    busName: clampString(record.busName, PERSIST_MAX_IFACE, DEFAULT_PERSIST.txRaw.busName),
    idHex: clampString(record.idHex, 24, DEFAULT_PERSIST.txRaw.idHex),
    dataHex: clampString(record.dataHex, PERSIST_MAX_HEX, DEFAULT_PERSIST.txRaw.dataHex),
    mode: record.mode === 'cyclic' ? 'cyclic' : 'oneshot',
    periodMs: clampInt(record.periodMs, 1, 3_600_000, 100),
    isEff: asBool(record.isEff, false),
    isRtr: asBool(record.isRtr, false),
    isFd: asBool(record.isFd, false)
  }
}

function sanitizeDbcDraft(raw: unknown): PersistedDbcDraft {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PERSIST.txDbc
  }
  const record = raw as Record<string, unknown>
  const values: Record<string, string> = {}
  if (record.values !== null && typeof record.values === 'object' && !Array.isArray(record.values)) {
    for (const [key, value] of Object.entries(record.values as Record<string, unknown>)) {
      const name = clampString(key, 64)
      if (name.length === 0) {
        continue
      }
      values[name] = clampString(value, 64, '')
      if (Object.keys(values).length >= PERSIST_MAX_SIGNAL_KEYS) {
        break
      }
    }
  }
  return {
    message: clampString(record.message, 96, ''),
    values,
    periodMs: clampInt(record.periodMs, 1, 3_600_000, 100)
  }
}

function sanitizeJob(raw: unknown): PersistedCyclicJob | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const type = record.type === 'DBC' ? 'DBC' : record.type === 'Raw' ? 'Raw' : null
  if (type === null) {
    return null
  }
  const ifName = clampString(record.ifName, PERSIST_MAX_IFACE)
  if (ifName.length === 0) {
    return null
  }
  if (typeof record.canId !== 'number' || !Number.isInteger(record.canId) || record.canId < 0) {
    return null
  }
  const message = clampString(record.message, 96)
  return {
    type,
    ifName,
    canId: record.canId,
    isEff: asBool(record.isEff, record.canId > 0x7ff),
    data: clampString(record.data, PERSIST_MAX_HEX, ''),
    message: message.length > 0 ? message : undefined,
    periodMs: clampInt(record.periodMs, 1, 3_600_000, 100)
  }
}

/** Coerce unknown JSON into a complete snapshot. Corrupt / partial files survive. */
export function sanitizePersist(raw: unknown): PersistSnapshot {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PERSIST
  }
  const record = raw as Record<string, unknown>
  const buses: PersistedBusHint[] = []
  if (Array.isArray(record.buses)) {
    for (const item of record.buses) {
      const hint = sanitizeBusHint(item)
      if (!hint || buses.some((existing) => existing.name === hint.name)) {
        continue
      }
      buses.push(hint)
      if (buses.length >= PERSIST_MAX_BUSES) {
        break
      }
    }
  }
  const cyclicJobs: PersistedCyclicJob[] = []
  if (Array.isArray(record.cyclicJobs)) {
    for (const item of record.cyclicJobs) {
      const job = sanitizeJob(item)
      if (!job) {
        continue
      }
      cyclicJobs.push(job)
      if (cyclicJobs.length >= PERSIST_MAX_JOBS) {
        break
      }
    }
  }
  const lastBusName = clampString(record.lastBusName, PERSIST_MAX_IFACE, DEFAULT_PERSIST.lastBusName)
  const lastDbcPath = clampString(record.lastDbcPath, PERSIST_MAX_PATH, DEFAULT_PERSIST.lastDbcPath)
  return {
    version: PERSIST_VERSION,
    lastBusName,
    lastDbcPath,
    buses,
    trace: sanitizeTrace(record.trace),
    graph: sanitizeGraph(record.graph),
    txRaw: sanitizeRawDraft(record.txRaw),
    txDbc: sanitizeDbcDraft(record.txDbc),
    cyclicJobs
  }
}

export function upsertBusHint(
  buses: readonly PersistedBusHint[],
  name: string,
  dbcPath?: string | null
): PersistedBusHint[] {
  const cleanName = clampString(name, PERSIST_MAX_IFACE)
  if (cleanName.length === 0) {
    return [...buses]
  }
  const nextPath = dbcPath === undefined ? undefined : optionalPath(dbcPath)
  const existing = buses.find((item) => item.name === cleanName)
  const hint: PersistedBusHint = {
    name: cleanName,
    dbcPath: nextPath === undefined ? (existing?.dbcPath ?? null) : nextPath
  }
  const rest = buses.filter((item) => item.name !== cleanName)
  return [hint, ...rest].slice(0, PERSIST_MAX_BUSES)
}

export function dbcPathForBus(snapshot: PersistSnapshot, busName: string): string {
  const hint = snapshot.buses.find((item) => item.name === busName)
  if (hint?.dbcPath) {
    return hint.dbcPath
  }
  return snapshot.lastDbcPath || DEFAULT_PERSIST.lastDbcPath
}

/** Listed ifaces first, then remembered names that are not listed. */
export function mergeRememberedNames(
  listed: readonly string[],
  remembered: readonly PersistedBusHint[],
  selectedBus: string
): readonly string[] {
  const names: string[] = []
  const push = (name: string): void => {
    const clean = name.trim()
    if (clean.length === 0 || names.includes(clean)) {
      return
    }
    names.push(clean)
  }
  for (const name of listed) {
    push(name)
  }
  for (const hint of remembered) {
    push(hint.name)
  }
  push(selectedBus)
  return names
}

export function isRememberedName(
  remembered: readonly PersistedBusHint[],
  name: string
): boolean {
  return remembered.some((item) => item.name === name)
}

export function formatRememberedBusLabel(
  name: string,
  meta:
    | {
        readonly kind?: string
        readonly state?: string
        readonly vendor?: string
        readonly blacklist?: boolean
      }
    | undefined,
  open: boolean,
  remembered: boolean
): string {
  const base = formatBusOptionLabel(name, meta, open)
  if (!remembered || open || meta) {
    return base
  }
  return `${name} (remembered)`
}

export function rememberedRestoreText(snapshot: PersistSnapshot): string {
  if (snapshot.buses.length === 0) {
    return `Remembered ${snapshot.lastBusName}. Not connected — click Connect when the iface is UP.`
  }
  const bits = snapshot.buses.map((item) => {
    const dbc = item.dbcPath ? item.dbcPath.split(/[\\/]/).pop() : null
    return dbc ? `${item.name} (${dbc})` : item.name
  })
  return `Remembered ${bits.join(', ')}. Not auto-connected — click Connect when the iface is UP.`
}

export function rememberedEmptyListText(snapshot: PersistSnapshot): string {
  const names =
    snapshot.buses.length > 0
      ? snapshot.buses.map((item) => item.name).join(', ')
      : snapshot.lastBusName
  return `No SocketCAN interfaces up. Remembered ${names}. Bring the iface up with sudo ./scripts/setup-vcan.sh, then Connect.`
}

export function cyclicJobDefinitionId(index: number): string {
  return `remembered-${index}`
}

export function jobsToDefinitions(
  jobs: readonly {
    readonly type: 'Raw' | 'DBC'
    readonly ifName: string
    readonly canId: number
    readonly isEff: boolean
    readonly data: string
    readonly message?: string
    readonly periodMs: number
  }[]
): PersistedCyclicJob[] {
  const definitions: PersistedCyclicJob[] = []
  for (const job of jobs) {
    const sanitized = sanitizeJob(job)
    if (sanitized) {
      definitions.push(sanitized)
    }
    if (definitions.length >= PERSIST_MAX_JOBS) {
      break
    }
  }
  return definitions
}

export type PersistBuildInput = {
  readonly lastBusName: string
  readonly lastDbcPath: string
  readonly buses: readonly PersistedBusHint[]
  readonly opened?: readonly { readonly name: string; readonly dbcPath: string | null }[]
  readonly trace: PersistedTracePrefs
  readonly graph: PersistedGraphPrefs
  readonly txRaw: PersistedRawDraft
  readonly txDbc: PersistedDbcDraft
  readonly cyclicJobs: readonly PersistedCyclicJob[]
}

/** Build a sanitized snapshot from live UI state (for save). */
export function buildPersistSnapshot(input: PersistBuildInput): PersistSnapshot {
  let buses = [...input.buses]
  if (input.opened) {
    for (const item of input.opened) {
      buses = upsertBusHint(buses, item.name, item.dbcPath)
    }
  }
  if (input.lastBusName.trim().length > 0) {
    buses = upsertBusHint(buses, input.lastBusName)
  }
  return sanitizePersist({
    version: PERSIST_VERSION,
    lastBusName: input.lastBusName,
    lastDbcPath: input.lastDbcPath,
    buses,
    trace: input.trace,
    graph: input.graph,
    txRaw: input.txRaw,
    txDbc: input.txDbc,
    cyclicJobs: input.cyclicJobs
  })
}
