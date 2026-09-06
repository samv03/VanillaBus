import type { VanillaBusApi } from '../../shared/engine'

export type {
  EngineConnectionEvent,
  EngineConnectionEventType,
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
