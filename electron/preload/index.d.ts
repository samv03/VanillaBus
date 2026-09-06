import type { VanillaBusApi } from '../../shared/engine'

export type {
  BusCloseResult,
  BusCommandError,
  BusInterface,
  BusInterfaceState,
  BusListResult,
  BusOpenResult,
  EngineConnectionEvent,
  EngineConnectionEventType,
  EngineErrorPayload,
  EngineHello,
  EngineInfo,
  EngineStatus,
  Unsubscribe,
  VanillaBusApi
} from '../../shared/engine'

declare global {
  interface Window {
    /** Narrow context-bridge API. See docs/preload.md. */
    vanillabus: VanillaBusApi
  }
}

export {}
