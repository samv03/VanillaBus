import type { VanillaBusApi } from '../../shared/engine'

export type {
  BusCloseResult,
  BusCommandError,
  BusInterface,
  BusInterfaceState,
  BusListResult,
  BusOpenResult,
  DbcClearResult,
  DbcLoadResult,
  EngineConnectionEvent,
  EngineConnectionEventType,
  EngineErrorPayload,
  EngineHello,
  EngineInfo,
  EngineStatus,
  FrameDecode,
  FrameDir,
  FrameEvent,
  RxBatch,
  TxCyclicStartRequest,
  TxCyclicStartResult,
  TxCyclicStopResult,
  TxDbcSendRequest,
  TxRawSendRequest,
  TxSendRequest,
  TxSendResult,
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
