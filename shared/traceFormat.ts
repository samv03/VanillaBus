import type { FrameEvent, SignalValue } from './engine'

export function formatCanId(id: number, isEff: boolean): string {
  const hex = id.toString(16).toUpperCase()
  return isEff ? hex.padStart(8, '0') : hex.padStart(3, '0')
}

export function formatCanIdPrefixed(id: number, isEff: boolean): string {
  return `0x${formatCanId(id, isEff)}`
}

export function formatDataHex(hex: string): string {
  const clean = hex.toUpperCase()
  return clean.replace(/../g, '$& ').trim() || '—'
}

export function formatTsUs(tsUs: number): string {
  const date = new Date(tsUs / 1000)
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  const frac = String(Math.trunc(tsUs % 1_000_000)).padStart(6, '0')
  return `${hh}:${mm}:${ss}.${frac}`
}

export function formatRateMs(rateMs: number | null): string {
  if (rateMs === null || !Number.isFinite(rateMs)) {
    return '—'
  }
  return rateMs.toFixed(1)
}

export function formatSignalValue(value: SignalValue): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value)
    }
    return String(Math.round(value * 1000) / 1000)
  }
  return String(value)
}

export function frameName(frame: FrameEvent): string {
  return frame.decode?.name ?? '—'
}
