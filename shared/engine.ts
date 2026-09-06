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

/**
 * Narrow context-bridge API exposed as `window.vanillabus`.
 * No bus.list/open, DBC, fs, or SocketCAN surface.
 */
export type VanillaBusApi = {
  readonly version: string
  getEngineInfo: () => Promise<EngineInfo>
  onEngineStatus: (listener: (info: EngineInfo) => void) => Unsubscribe
  onEngineEvent: (listener: (event: EngineConnectionEvent) => void) => Unsubscribe
  onConnected: (listener: (info: EngineInfo) => void) => Unsubscribe
  onDisconnected: (listener: (info: EngineInfo) => void) => Unsubscribe
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
