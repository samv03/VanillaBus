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

export type FrameDir = 'rx' | 'tx'

/** Engine FrameEvent on rx.batch. rate_ms is null until T6. */
export type FrameEvent = {
  readonly busId: string
  readonly ifName: string
  readonly ts_us: number
  readonly can_id: number
  readonly dlc: number
  readonly data: string
  readonly is_eff: boolean
  readonly is_fd: boolean
  readonly brs: boolean
  readonly is_rtr: boolean
  readonly is_err: boolean
  readonly dir: FrameDir
  readonly rate_ms: number | null
}

export type RxBatch = {
  readonly frames: readonly FrameEvent[]
  readonly dropped: number
}

/**
 * Narrow context-bridge API exposed as `window.vanillabus`.
 * Bus list/open/close and rx.batch go through main → engine IPC.
 * No SocketCAN in the renderer.
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
  onRxBatch: (listener: (batch: RxBatch) => void) => Unsubscribe
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

export function parseFrameEvent(raw: unknown): FrameEvent | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  if (typeof record.busId !== 'string' || record.busId.length === 0) {
    return null
  }
  if (typeof record.ifName !== 'string' || record.ifName.length === 0) {
    return null
  }
  if (typeof record.ts_us !== 'number' || !Number.isFinite(record.ts_us)) {
    return null
  }
  if (typeof record.can_id !== 'number' || !Number.isInteger(record.can_id) || record.can_id < 0) {
    return null
  }
  if (typeof record.dlc !== 'number' || !Number.isInteger(record.dlc) || record.dlc < 0) {
    return null
  }
  if (typeof record.data !== 'string') {
    return null
  }
  if (
    typeof record.is_eff !== 'boolean' ||
    typeof record.is_fd !== 'boolean' ||
    typeof record.brs !== 'boolean' ||
    typeof record.is_rtr !== 'boolean' ||
    typeof record.is_err !== 'boolean'
  ) {
    return null
  }
  if (record.dir !== 'rx' && record.dir !== 'tx') {
    return null
  }
  if (record.rate_ms !== null && typeof record.rate_ms !== 'number') {
    return null
  }
  return {
    busId: record.busId,
    ifName: record.ifName,
    ts_us: record.ts_us,
    can_id: record.can_id,
    dlc: record.dlc,
    data: record.data,
    is_eff: record.is_eff,
    is_fd: record.is_fd,
    brs: record.brs,
    is_rtr: record.is_rtr,
    is_err: record.is_err,
    dir: record.dir,
    rate_ms: record.rate_ms === null ? null : record.rate_ms
  }
}

export function parseRxBatch(raw: unknown): RxBatch | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.frames)) {
    return null
  }
  const frames: FrameEvent[] = []
  for (const item of record.frames) {
    const frame = parseFrameEvent(item)
    if (frame) {
      frames.push(frame)
    }
  }
  const dropped = typeof record.dropped === 'number' && Number.isInteger(record.dropped) ? record.dropped : 0
  return { frames, dropped }
}
