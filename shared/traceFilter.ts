import type { FrameEvent } from './engine'
import { formatCanId } from './traceFormat'
import type { FrameRing } from './traceRing'

/** Match CAN ID (hex with/without 0x, or decimal) and/or DBC message name. */
export function frameMatchesFilter(frame: FrameEvent, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return true
  }
  const hex = formatCanId(frame.can_id, frame.is_eff).toLowerCase()
  if (hex.includes(needle) || `0x${hex}`.includes(needle)) {
    return true
  }
  if (String(frame.can_id).includes(needle)) {
    return true
  }
  const name = frame.decode?.name
  if (name !== undefined && name.toLowerCase().includes(needle)) {
    return true
  }
  return false
}

/**
 * Indices into the ring that match `query`.
 * `null` means the filter is empty — use the ring directly (no extra array).
 */
export function collectMatchingIndices(ring: FrameRing, query: string): number[] | null {
  if (query.trim().length === 0) {
    return null
  }
  const matches: number[] = []
  for (let index = 0; index < ring.size; index += 1) {
    if (frameMatchesFilter(ring.at(index).frame, query)) {
      matches.push(index)
    }
  }
  return matches
}

export function visibleCount(ring: FrameRing, indices: number[] | null): number {
  return indices === null ? ring.size : indices.length
}

export function ringIndexAt(indices: number[] | null, visibleIndex: number): number {
  return indices === null ? visibleIndex : indices[visibleIndex]!
}
