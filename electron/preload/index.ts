import { contextBridge, ipcRenderer } from 'electron'

export type EngineHello = {
  name: string
  version: string
  backends: string[]
}

export type EngineStatus = {
  connected: boolean
  hello: EngineHello | null
}

type StatusListener = (status: EngineStatus) => void

/**
 * Narrow preload surface. Engine connection status comes from engine.hello.
 * SocketCAN / DBC stay out of the renderer.
 */
const api = {
  version: '0.1.0',
  getEngineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('vanillabus:engine-status'),
  onEngineStatus: (listener: StatusListener): (() => void) => {
    const wrapped = (_event: unknown, status: EngineStatus): void => {
      listener(status)
    }
    ipcRenderer.on('vanillabus:engine-status', wrapped)
    return () => {
      ipcRenderer.removeListener('vanillabus:engine-status', wrapped)
    }
  }
} as const

contextBridge.exposeInMainWorld('vanillabus', api)
