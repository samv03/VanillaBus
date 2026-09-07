/**
 * UI-side decimation: keep at most one sample per interval (latest wins).
 * Interval is derived from the 10–30 Hz clamp.
 */

export function shouldReplaceLastSample(
  lastTsUs: number | null,
  nextTsUs: number,
  intervalUs: number
): boolean {
  if (lastTsUs === null) {
    return false
  }
  return nextTsUs - lastTsUs < intervalUs
}

export type DecimatePoint = {
  readonly ts_us: number
  readonly value: number
}

/**
 * Fold a raw timestamped stream into a 10–30 Hz series.
 * Assumes `points` are sorted by `ts_us` ascending.
 */
export function decimatePoints(
  points: readonly DecimatePoint[],
  intervalUs: number
): DecimatePoint[] {
  const out: DecimatePoint[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last !== undefined && shouldReplaceLastSample(last.ts_us, point.ts_us, intervalUs)) {
      out[out.length - 1] = point
    } else {
      out.push(point)
    }
  }
  return out
}
