import { BrowserWindow, ipcMain } from 'electron'
import {
  connectionEventFromTransition,
  engineInfoFromStatus,
  type EngineInfo,
  type EngineStatus
} from '../../shared/engine'
import type { EngineSupervisor } from './engineSupervisor'

/** IPC channels for the preload context bridge. Renderer never sees the UDS. */
export const VANILLABUS_IPC = {
  engineInfo: 'vanillabus:engine-info',
  engineEvent: 'vanillabus:engine-event'
} as const

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

/**
 * Map engine-host status onto the narrow preload API.
 * T2 hello / heartbeat / respawn stay in the supervisor; this file only relays.
 */
export function registerIpcBridge(supervisor: EngineSupervisor): void {
  ipcMain.handle(
    VANILLABUS_IPC.engineInfo,
    (): EngineInfo => engineInfoFromStatus(supervisor.getStatus())
  )

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
