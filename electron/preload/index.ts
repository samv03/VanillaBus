import { contextBridge, ipcRenderer } from 'electron'
import type {
  BusCloseResult,
  BusListResult,
  BusOpenResult,
  EngineConnectionEvent,
  EngineInfo,
  RxBatch,
  Unsubscribe,
  VanillaBusApi
} from '../../shared/engine'

const ENGINE_INFO_CHANNEL = 'vanillabus:engine-info'
const ENGINE_EVENT_CHANNEL = 'vanillabus:engine-event'
const BUS_LIST_CHANNEL = 'vanillabus:bus-list'
const BUS_OPEN_CHANNEL = 'vanillabus:bus-open'
const BUS_CLOSE_CHANNEL = 'vanillabus:bus-close'
const RX_BATCH_CHANNEL = 'vanillabus:rx-batch'

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
    }),
  listBuses: (): Promise<BusListResult> => ipcRenderer.invoke(BUS_LIST_CHANNEL),
  openBus: (name: string, bitrate?: number): Promise<BusOpenResult> =>
    ipcRenderer.invoke(BUS_OPEN_CHANNEL, name, bitrate),
  closeBus: (busId: string): Promise<BusCloseResult> => ipcRenderer.invoke(BUS_CLOSE_CHANNEL, busId),
  onRxBatch: (listener): Unsubscribe => subscribe<RxBatch>(RX_BATCH_CHANNEL, listener)
}

contextBridge.exposeInMainWorld('vanillabus', api)
