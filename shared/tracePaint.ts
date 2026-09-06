import type { FrameDir } from './engine'
import { collectMatchingIndices, ringIndexAt, visibleCount } from './traceFilter'
import {
  formatCanIdPrefixed,
  formatDataHex,
  formatRateMs,
  formatTsUs,
  frameName
} from './traceFormat'
import type { FrameRing } from './traceRing'

/** Typical desktop viewport: ~24 rows. Virtualized Trace only paints these. */
export const TRACE_VISIBLE_ROW_BUDGET = 24

export type PaintedRow = {
  readonly seq: number
  readonly time: string
  readonly bus: string
  readonly id: string
  readonly name: string
  readonly dlc: number
  readonly data: string
  readonly rate: string
  readonly dir: FrameDir
}

export type FirstPaintOptions = {
  readonly filter?: string
  readonly visibleBudget?: number
  /** Default true: first paint is the newest page (scroll lock on). */
  readonly followNewest?: boolean
}

export function paintVisibleWindow(
  ring: FrameRing,
  options: FirstPaintOptions = {}
): PaintedRow[] {
  const budget = options.visibleBudget ?? TRACE_VISIBLE_ROW_BUDGET
  const indices = collectMatchingIndices(ring, options.filter ?? '')
  const count = visibleCount(ring, indices)
  if (count === 0 || budget <= 0) {
    return []
  }
  const followNewest = options.followNewest !== false
  const start = followNewest ? Math.max(0, count - budget) : 0
  const end = Math.min(count, start + budget)
  const rows: PaintedRow[] = []
  for (let visible = start; visible < end; visible += 1) {
    const entry = ring.at(ringIndexAt(indices, visible))
    const frame = entry.frame
    rows.push({
      seq: entry.seq,
      time: formatTsUs(frame.ts_us),
      bus: frame.ifName,
      id: formatCanIdPrefixed(frame.can_id, frame.is_eff),
      name: frameName(frame),
      dlc: frame.dlc,
      data: formatDataHex(frame.data),
      rate: formatRateMs(frame.rate_ms),
      dir: frame.dir
    })
  }
  return rows
}

/** Minimal HTML for the first visible page — N2 first-paint proxy. */
export function paintedRowsToHtml(rows: readonly PaintedRow[]): string {
  const body = rows
    .map((row) => {
      return `<tr data-seq="${row.seq}"><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.bus)}</td><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.name)}</td><td>${row.dlc}</td><td>${escapeHtml(row.data)}</td><td>${escapeHtml(row.rate)}</td><td>${row.dir}</td></tr>`
    })
    .join('')
  return `<table>${body}</table>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
