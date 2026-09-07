import type { DecimatePoint } from './graphDecimate'

export type GraphLegendStats = {
  readonly value: number | null
  readonly min: number | null
  readonly max: number | null
  readonly mean: number | null
}

export function computeSeriesStats(samples: readonly DecimatePoint[]): GraphLegendStats {
  if (samples.length === 0) {
    return { value: null, min: null, max: null, mean: null }
  }
  let min = samples[0]!.value
  let max = samples[0]!.value
  let sum = 0
  for (const sample of samples) {
    if (sample.value < min) {
      min = sample.value
    }
    if (sample.value > max) {
      max = sample.value
    }
    sum += sample.value
  }
  return {
    value: samples[samples.length - 1]!.value,
    min,
    max,
    mean: sum / samples.length
  }
}

export function formatGraphNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
}

export function formatGraphClock(tsUs: number | null): string {
  if (tsUs === null || !Number.isFinite(tsUs)) {
    return '—'
  }
  const date = new Date(tsUs / 1000)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function formatCanIdHex(canId: number): string {
  return `0x${canId.toString(16).toUpperCase()}`
}
