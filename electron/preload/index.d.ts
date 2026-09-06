export interface VanillaBusApi {
  readonly version: string
}

declare global {
  interface Window {
    vanillabus: VanillaBusApi
  }
}

export {}
