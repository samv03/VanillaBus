import type { FrameEvent } from './engine'
import { applyRxBatch } from './traceControl'
import { collectMatchingIndices, visibleCount } from './traceFilter'
import {
  paintVisibleWindow,
  paintedRowsToHtml,
  TRACE_VISIBLE_ROW_BUDGET,
  type PaintedRow
} from './tracePaint'
import type { FrameRing } from './traceRing'

/** N2: first paint of the visible Trace window at ≤2 kfps must stay under this. */
export const N2_FIRST_PAINT_MS = 50
export const N2_FPS = 2000
export const N2_BATCH_INTERVAL_MS = 16
export const N2_FRAMES_PER_BATCH = Math.ceil((N2_FPS * N2_BATCH_INTERVAL_MS) / 1000)

export type VisiblePaintMeasurement = {
  readonly elapsedMs: number
  readonly rows: readonly PaintedRow[]
  readonly html: string
  readonly visibleBudget: number
}

/**
 * Append a batch and paint only the visible window (~24 rows) + HTML proxy.
 * This is the N2 first-paint path used by `test:trace` and `test:smoke`.
 */
export function measureVisiblePaint(
  ring: FrameRing,
  frames: readonly FrameEvent[],
  filter = ''
): VisiblePaintMeasurement {
  const started = performance.now()
  applyRxBatch(ring, frames, false)
  const rows = paintVisibleWindow(ring, { filter, visibleBudget: TRACE_VISIBLE_ROW_BUDGET })
  const html = paintedRowsToHtml(rows)
  const elapsedMs = performance.now() - started
  const expected = Math.min(
    TRACE_VISIBLE_ROW_BUDGET,
    visibleCount(ring, collectMatchingIndices(ring, filter))
  )
  if (rows.length !== expected) {
    throw new Error(`visible paint row count ${rows.length} !== ${expected}`)
  }
  if (!html.startsWith('<table>')) {
    throw new Error('visible paint HTML proxy must start with <table>')
  }
  return { elapsedMs, rows, html, visibleBudget: TRACE_VISIBLE_ROW_BUDGET }
}

export function n2BudgetMessage(elapsedMs: number, detail: string): string {
  return `${detail} ${elapsedMs.toFixed(2)} ms exceeds ${N2_FIRST_PAINT_MS} ms`
}
