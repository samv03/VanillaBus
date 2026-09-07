/** T11 Graph time windows and UI-side decimation bounds. */

export const GRAPH_WINDOWS_SEC = [10, 30, 60] as const

export type GraphWindowSec = (typeof GRAPH_WINDOWS_SEC)[number]

export const GRAPH_DEFAULT_WINDOW_SEC: GraphWindowSec = 30

/** Inclusive UI redraw / sample-keep bounds. Engine may be much faster. */
export const GRAPH_MIN_HZ = 10
export const GRAPH_MAX_HZ = 30
export const GRAPH_DEFAULT_HZ = 20

export function isGraphWindowSec(value: number): value is GraphWindowSec {
  return (GRAPH_WINDOWS_SEC as readonly number[]).includes(value)
}

export function clampGraphHz(hz: number): number {
  if (!Number.isFinite(hz)) {
    return GRAPH_DEFAULT_HZ
  }
  return Math.min(GRAPH_MAX_HZ, Math.max(GRAPH_MIN_HZ, hz))
}

export function graphSampleIntervalUs(hz: number): number {
  return Math.round(1_000_000 / clampGraphHz(hz))
}

export function graphRedrawIntervalMs(hz: number): number {
  return Math.round(1000 / clampGraphHz(hz))
}

export function windowStartUs(nowUs: number, windowSec: GraphWindowSec): number {
  return nowUs - windowSec * 1_000_000
}

export function maxSamplesForWindow(windowSec: GraphWindowSec, hz: number): number {
  return windowSec * clampGraphHz(hz) + 2
}
