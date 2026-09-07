import type { DbcCatalogMessage, FrameDecode, FrameEvent } from './engine'
import { graphSignalKey } from './graphKeys'

export type GraphCatalogEntry = {
  readonly key: string
  readonly messageName: string
  readonly canId: number
  readonly signalName: string
  readonly unit: string
  readonly seen: boolean
}

export type GraphCatalogGroup = {
  readonly messageName: string
  readonly canId: number
  readonly signals: readonly GraphCatalogEntry[]
}

export function catalogEntriesFromDbc(
  messages: readonly DbcCatalogMessage[]
): GraphCatalogEntry[] {
  const entries: GraphCatalogEntry[] = []
  for (const message of messages) {
    for (const signal of message.signals) {
      entries.push({
        key: graphSignalKey(message.name, signal.name),
        messageName: message.name,
        canId: message.can_id,
        signalName: signal.name,
        unit: signal.unit,
        seen: false
      })
    }
  }
  return entries
}

export function catalogEntriesFromDecode(
  canId: number,
  decode: FrameDecode
): GraphCatalogEntry[] {
  const entries: GraphCatalogEntry[] = []
  for (const signalName of Object.keys(decode.signals)) {
    entries.push({
      key: graphSignalKey(decode.name, signalName),
      messageName: decode.name,
      canId,
      signalName,
      unit: decode.units[signalName] ?? '',
      seen: true
    })
  }
  return entries
}

export function mergeCatalogEntry(
  existing: GraphCatalogEntry | undefined,
  incoming: GraphCatalogEntry
): GraphCatalogEntry {
  if (!existing) {
    return incoming
  }
  return {
    key: existing.key,
    messageName: incoming.messageName || existing.messageName,
    canId: incoming.canId || existing.canId,
    signalName: incoming.signalName || existing.signalName,
    unit: incoming.unit || existing.unit,
    seen: existing.seen || incoming.seen
  }
}

export function groupCatalogByMessage(
  entries: readonly GraphCatalogEntry[]
): GraphCatalogGroup[] {
  const groups = new Map<string, GraphCatalogEntry[]>()
  const order: string[] = []
  for (const entry of entries) {
    const id = `${entry.canId}:${entry.messageName}`
    const list = groups.get(id)
    if (list) {
      list.push(entry)
    } else {
      groups.set(id, [entry])
      order.push(id)
    }
  }
  return order.map((id) => {
    const signals = groups.get(id) ?? []
    const first = signals[0]
    return {
      messageName: first?.messageName ?? id,
      canId: first?.canId ?? 0,
      signals
    }
  })
}

export function filterCatalog(
  entries: readonly GraphCatalogEntry[],
  query: string
): GraphCatalogEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return [...entries]
  }
  return entries.filter((entry) => {
    const hex = `0x${entry.canId.toString(16)}`
    return (
      entry.messageName.toLowerCase().includes(needle) ||
      entry.signalName.toLowerCase().includes(needle) ||
      entry.key.toLowerCase().includes(needle) ||
      hex.includes(needle)
    )
  })
}

/** Numeric-only: Graph plots decode.signals numbers (mux gaps stay absent). */
export function numericDecodeSignals(
  decode: FrameDecode
): ReadonlyArray<readonly [string, number]> {
  const out: Array<readonly [string, number]> = []
  for (const [name, value] of Object.entries(decode.signals)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push([name, value])
    } else if (typeof value === 'boolean') {
      out.push([name, value ? 1 : 0])
    }
  }
  return out
}

export function decodeFromFrame(frame: FrameEvent): FrameDecode | null {
  return frame.decode
}
