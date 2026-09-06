/**
 * Shared types for the Electron preload bridge (`window.vanillabus`).
 *
 * These mirror the T2 IPC hello / connection status that main already speaks
 * with vanillabus-engine. The renderer may import this module for types and
 * pure helpers only — no Node, fs, SocketCAN, or DBC.
 */

export type EngineHello = {
  readonly name: string
  readonly version: string
  readonly backends: readonly string[]
}

/** Internal host snapshot (hello payload + connected flag). */
export type EngineStatus = {
  readonly connected: boolean
  readonly hello: EngineHello | null
}

/**
 * Renderer-facing engine snapshot from `getEngineInfo()` / status subscribe.
 * Flattened hello fields plus the original hello object when connected.
 */
export type EngineInfo = {
  readonly connected: boolean
  readonly name: string | null
  readonly version: string | null
  readonly backends: readonly string[]
  readonly hello: EngineHello | null
}

export type EngineConnectionEventType = 'connected' | 'disconnected'

export type EngineConnectionEvent = {
  readonly type: EngineConnectionEventType
  readonly info: EngineInfo
}

export type Unsubscribe = () => void

export type EngineErrorPayload = {
  readonly code: string
  readonly message: string
}

export type BusInterfaceState = 'up' | 'down'

/** SocketCAN/vcan iface from engine bus.list. */
export type BusInterface = {
  readonly name: string
  readonly kind: string
  readonly state: BusInterfaceState
}

export type BusListOk = {
  readonly ok: true
  readonly interfaces: readonly BusInterface[]
}

export type BusOpenOk = {
  readonly ok: true
  readonly busId: string
}

export type BusCloseOk = {
  readonly ok: true
}

export type BusCommandError = {
  readonly ok: false
  readonly error: EngineErrorPayload
}

export type BusListResult = BusListOk | BusCommandError
export type BusOpenResult = BusOpenOk | BusCommandError
export type BusCloseResult = BusCloseOk | BusCommandError

/**
 * Narrow context-bridge API exposed as `window.vanillabus`.
 * Bus list/open/close go through main → engine IPC. No SocketCAN in the renderer.
 */
export type VanillaBusApi = {
  readonly version: string
  getEngineInfo: () => Promise<EngineInfo>
  onEngineStatus: (listener: (info: EngineInfo) => void) => Unsubscribe
  onEngineEvent: (listener: (event: EngineConnectionEvent) => void) => Unsubscribe
  onConnected: (listener: (info: EngineInfo) => void) => Unsubscribe
  onDisconnected: (listener: (info: EngineInfo) => void) => Unsubscribe
  listBuses: () => Promise<BusListResult>
  openBus: (name: string, bitrate?: number) => Promise<BusOpenResult>
  closeBus: (busId: string) => Promise<BusCloseResult>
}

export const DISCONNECTED_ENGINE_INFO: EngineInfo = {
  connected: false,
  name: null,
  version: null,
  backends: [],
  hello: null
}

export function engineInfoFromStatus(status: EngineStatus): EngineInfo {
  if (!status.connected || status.hello === null) {
    return DISCONNECTED_ENGINE_INFO
  }
  return {
    connected: true,
    name: status.hello.name,
    version: status.hello.version,
    backends: status.hello.backends,
    hello: status.hello
  }
}

export function connectionEventFromTransition(
  previous: EngineStatus,
  next: EngineStatus
): EngineConnectionEvent | null {
  if (previous.connected === next.connected) {
    return null
  }
  return {
    type: next.connected ? 'connected' : 'disconnected',
    info: engineInfoFromStatus(next)
  }
}
