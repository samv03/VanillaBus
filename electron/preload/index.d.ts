export interface EngineHello {
  readonly name: string
  readonly version: string
  readonly backends: string[]
}

export interface EngineStatus {
  readonly connected: boolean
  readonly hello: EngineHello | null
}

export interface VanillaBusApi {
  readonly version: string
  getEngineStatus: () => Promise<EngineStatus>
  onEngineStatus: (listener: (status: EngineStatus) => void) => () => void
}

declare global {
  interface Window {
    vanillabus: VanillaBusApi
  }
}

export {}
