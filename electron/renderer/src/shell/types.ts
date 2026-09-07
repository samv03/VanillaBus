import type {
  DbcCatalogMessage,
  EngineConnectionEvent,
  EngineErrorPayload
} from '../../../../shared/engine'

export type EventLogItem = {
  readonly at: string
  readonly type: EngineConnectionEvent['type']
}

export type OpenedDbc = {
  readonly path: string
  readonly messageCount: number
  readonly catalog: readonly DbcCatalogMessage[]
}

export type OpenedBus = {
  readonly busId: string
  readonly name: string
  readonly dbc: OpenedDbc | null
}

export type BusActionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'error'; readonly error: EngineErrorPayload }

export function formatError(error: EngineErrorPayload): string {
  return `${error.code}: ${error.message}`
}

export function formatStatus(status: BusActionStatus): string {
  if (status.kind === 'idle') {
    return 'List or open an interface to see the engine result.'
  }
  if (status.kind === 'ok') {
    return status.text
  }
  return formatError(status.error)
}
