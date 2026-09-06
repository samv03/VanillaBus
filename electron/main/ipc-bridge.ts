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
  type RxBatch
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
  rxBatch: 'vanillabus:rx-batch'
} as const

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
