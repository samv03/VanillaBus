import { BrowserWindow, ipcMain } from 'electron'
import {
  connectionEventFromTransition,
  engineInfoFromStatus,
  type BusCloseResult,
  type BusListResult,
  type BusOpenResult,
  type DbcClearResult,
  type DbcLoadResult,
  type EngineErrorPayload,
  type EngineInfo,
  type EngineStatus,
  type RxBatch,
  type SignalValue,
  type TxCyclicStartRequest,
  type TxCyclicStartResult,
  type TxCyclicStopResult,
  type TxSendRequest,
  type TxSendResult
} from '../../shared/engine'
import { EngineRequestError } from './engineClient'
import type { EngineSupervisor } from './engineSupervisor'

/** IPC channels for the preload context bridge. Renderer never sees the UDS. */
export const VANILLABUS_IPC = {
  engineInfo: 'vanillabus:engine-info',
  engineEvent: 'vanillabus:engine-event',
  busList: 'vanillabus:bus-list',
  busOpen: 'vanillabus:bus-open',
  busClose: 'vanillabus:bus-close',
  dbcLoad: 'vanillabus:dbc-load',
  dbcClear: 'vanillabus:dbc-clear',
  txSend: 'vanillabus:tx-send',
  txCyclicStart: 'vanillabus:tx-cyclic-start',
  txCyclicStop: 'vanillabus:tx-cyclic-stop',
  rxBatch: 'vanillabus:rx-batch'
} as const

function parseOptionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function parseTxSignals(raw: unknown): Record<string, SignalValue> | null {
  if (raw === null || raw === undefined) {
    return {}
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const signals: Record<string, SignalValue> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length === 0) {
      return null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      signals[key] = value
    } else if (typeof value === 'string' || typeof value === 'boolean') {
      signals[key] = value
    } else {
      return null
    }
  }
  return signals
}

function parseTxSendRequest(
  raw: unknown
): { ok: true; request: TxSendRequest } | { ok: false; error: EngineErrorPayload } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: { code: 'invalid_payload', message: 'sendFrame requires an object' } }
  }
  const record = raw as Record<string, unknown>
  if (typeof record.busId !== 'string' || record.busId.length === 0) {
    return { ok: false, error: { code: 'invalid_payload', message: 'sendFrame requires busId' } }
  }
  if (typeof record.message === 'string' && record.message.length > 0) {
    const signals = parseTxSignals(record.signals)
    if (signals === null) {
      return { ok: false, error: { code: 'invalid_payload', message: 'sendFrame signals must be name → value' } }
    }
    return { ok: true, request: { busId: record.busId, message: record.message, signals } }
  }
  if (typeof record.can_id !== 'number' || !Number.isInteger(record.can_id) || record.can_id < 0) {
    return { ok: false, error: { code: 'invalid_payload', message: 'sendFrame requires integer can_id or message' } }
  }
  if (typeof record.data !== 'string') {
    return { ok: false, error: { code: 'invalid_payload', message: 'sendFrame requires data hex' } }
  }
  const request: TxSendRequest = {
    busId: record.busId,
    can_id: record.can_id,
    data: record.data,
    dlc: typeof record.dlc === 'number' && Number.isInteger(record.dlc) ? record.dlc : undefined,
    is_eff: parseOptionalBool(record.is_eff),
    is_rtr: parseOptionalBool(record.is_rtr),
    is_fd: parseOptionalBool(record.is_fd),
    brs: parseOptionalBool(record.brs)
  }
  return { ok: true, request }
}

function parseTxCyclicStartRequest(
  raw: unknown
): { ok: true; request: TxCyclicStartRequest } | { ok: false; error: EngineErrorPayload } {
  const parsed = parseTxSendRequest(raw)
  if (!parsed.ok) {
    return parsed
  }
  const record = raw as Record<string, unknown>
  if (typeof record.period_ms !== 'number' || !Number.isInteger(record.period_ms) || record.period_ms < 1) {
    return { ok: false, error: { code: 'invalid_payload', message: 'startCyclic requires period_ms >= 1' } }
  }
  return { ok: true, request: { ...parsed.request, period_ms: record.period_ms } }
}

function asError(error: unknown): EngineErrorPayload {
  if (error instanceof EngineRequestError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: 'internal', message: error.message }
  }
  return { code: 'internal', message: String(error) }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

/**
 * Map engine-host status, bus RPCs, and DBC load/clear onto the preload API.
 * Hello / heartbeat / respawn stay in the supervisor.
 */
export function registerIpcBridge(supervisor: EngineSupervisor): void {
  ipcMain.handle(
    VANILLABUS_IPC.engineInfo,
    (): EngineInfo => engineInfoFromStatus(supervisor.getStatus())
  )

  ipcMain.handle(VANILLABUS_IPC.busList, async (): Promise<BusListResult> => {
    try {
      return await supervisor.listBuses()
    } catch (error) {
      return { ok: false, error: asError(error) }
    }
  })

  ipcMain.handle(
    VANILLABUS_IPC.busOpen,
    async (_event, name: unknown, bitrate?: unknown): Promise<BusOpenResult> => {
      if (typeof name !== 'string' || name.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'openBus requires a name' } }
      }
      const parsedBitrate = typeof bitrate === 'number' && Number.isInteger(bitrate) ? bitrate : undefined
      try {
        return await supervisor.openBus(name, parsedBitrate)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.busClose,
    async (_event, busId: unknown): Promise<BusCloseResult> => {
      if (typeof busId !== 'string' || busId.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'closeBus requires a busId' } }
      }
      try {
        return await supervisor.closeBus(busId)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.dbcLoad,
    async (_event, busId: unknown, path: unknown): Promise<DbcLoadResult> => {
      if (typeof busId !== 'string' || busId.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'loadDbc requires a busId' } }
      }
      if (typeof path !== 'string' || path.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'loadDbc requires a path' } }
      }
      try {
        return await supervisor.loadDbc(busId, path)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.dbcClear,
    async (_event, busId: unknown): Promise<DbcClearResult> => {
      if (typeof busId !== 'string' || busId.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'clearDbc requires a busId' } }
      }
      try {
        return await supervisor.clearDbc(busId)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.txSend,
    async (_event, request: unknown): Promise<TxSendResult> => {
      const parsed = parseTxSendRequest(request)
      if (!parsed.ok) {
        return parsed
      }
      try {
        return await supervisor.sendFrame(parsed.request)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.txCyclicStart,
    async (_event, request: unknown): Promise<TxCyclicStartResult> => {
      const parsed = parseTxCyclicStartRequest(request)
      if (!parsed.ok) {
        return parsed
      }
      try {
        return await supervisor.startCyclic(parsed.request)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  ipcMain.handle(
    VANILLABUS_IPC.txCyclicStop,
    async (_event, jobId: unknown): Promise<TxCyclicStopResult> => {
      if (typeof jobId !== 'string' || jobId.length === 0) {
        return { ok: false, error: { code: 'invalid_payload', message: 'stopCyclic requires a job_id' } }
      }
      try {
        return await supervisor.stopCyclic(jobId)
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    }
  )

  supervisor.onRxBatch((batch: RxBatch) => {
    broadcast(VANILLABUS_IPC.rxBatch, batch)
  })

  let previous: EngineStatus = supervisor.getStatus()
  supervisor.onStatus((status) => {
    const info = engineInfoFromStatus(status)
    broadcast(VANILLABUS_IPC.engineInfo, info)

    const event = connectionEventFromTransition(previous, status)
    previous = status
    if (event) {
      broadcast(VANILLABUS_IPC.engineEvent, event)
    }
  })
}
