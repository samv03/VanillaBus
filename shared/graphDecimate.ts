/**
 * UI-side decimation: keep at most one sample per interval (latest wins).
 * Interval is derived from the 10–30 Hz clamp.
 */

export function shouldReplaceLastSample(
  binStartUs: number | null,
  nextTsUs: number,
  intervalUs: number
): boolean {
  if (binStartUs === null) {
    return false
  }
  return nextTsUs - binStartUs < intervalUs
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
  let binStartUs: number | null = null
  for (const point of points) {
    if (shouldReplaceLastSample(binStartUs, point.ts_us, intervalUs)) {
      out[out.length - 1] = point
    } else {
      out.push(point)
      binStartUs = point.ts_us
    }
  }
  return out
}
