import { contextBridge, ipcRenderer } from 'electron'
import type {
  EngineConnectionEvent,
  EngineInfo,
  Unsubscribe,
  VanillaBusApi
} from '../../shared/engine'

const ENGINE_INFO_CHANNEL = 'vanillabus:engine-info'
const ENGINE_EVENT_CHANNEL = 'vanillabus:engine-event'

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const wrapped = (_event: unknown, payload: T): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

/**
 * `window.vanillabus` — typed, narrow bridge.
 * Engine identity comes from engine.hello. No Node, fs, SocketCAN, or DBC.
 */
const api: VanillaBusApi = {
  version: '0.1.0',
  getEngineInfo: (): Promise<EngineInfo> => ipcRenderer.invoke(ENGINE_INFO_CHANNEL),
  onEngineStatus: (listener): Unsubscribe => subscribe<EngineInfo>(ENGINE_INFO_CHANNEL, listener),
  onEngineEvent: (listener): Unsubscribe =>
    subscribe<EngineConnectionEvent>(ENGINE_EVENT_CHANNEL, listener),
  onConnected: (listener): Unsubscribe =>
    subscribe<EngineConnectionEvent>(ENGINE_EVENT_CHANNEL, (event) => {
      if (event.type === 'connected') {
        listener(event.info)
      }
    }),
  onDisconnected: (listener): Unsubscribe =>
    subscribe<EngineConnectionEvent>(ENGINE_EVENT_CHANNEL, (event) => {
      if (event.type === 'disconnected') {
        listener(event.info)
      }
    })
}

contextBridge.exposeInMainWorld('vanillabus', api)
