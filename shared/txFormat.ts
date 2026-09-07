/**
 * Raw TX helpers (T12). Hex / CAN-ID parse for the Transmit form, plus
 * cyclic period math used by tests when no vcan is present.
 */

export const TX_PERIOD_TOLERANCE = 0.1
export const TX_MAX_CLASSIC_DLC = 8
export const TX_MAX_FD_DLC = 64

export type ParseOk<T> = { readonly ok: true } & T
export type ParseErr = { readonly ok: false; readonly message: string }
export type ParseResult<T> = ParseOk<T> | ParseErr

const HEX_CLEAN = /[\s:_-]+/g

export function parseCanIdHex(raw: string): ParseResult<{ value: number; isEffHint: boolean }> {
  const text = raw.trim()
  if (text.length === 0) {
    return { ok: false, message: 'ID is required' }
  }
  const prefixed = text.toLowerCase().startsWith('0x')
  const digits = prefixed ? text.slice(2) : text
  if (!/^[0-9a-fA-F]+$/.test(digits)) {
    return { ok: false, message: 'ID must be hex (e.g. 0x7E0)' }
  }
  const value = Number.parseInt(digits, 16)
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, message: 'ID must be a non-negative hex integer' }
  }
  if (value > 0x1fffffff) {
    return { ok: false, message: 'ID exceeds 29-bit CAN range' }
  }
  return { ok: true, value, isEffHint: value > 0x7ff }
}

export function parseDataHex(raw: string): ParseResult<{ hex: string; bytes: number }> {
  const cleaned = raw.trim().replace(HEX_CLEAN, '')
  const stripped = cleaned.toLowerCase().startsWith('0x') ? cleaned.slice(2) : cleaned
  if (stripped.length === 0) {
    return { ok: true, hex: '', bytes: 0 }
  }
  if (stripped.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(stripped)) {
    return { ok: false, message: 'Data must be an even number of hex digits' }
  }
  return { ok: true, hex: stripped.toLowerCase(), bytes: stripped.length / 2 }
}

export function formatDataByteCount(bytes: number, isFd: boolean): string {
  const max = isFd ? TX_MAX_FD_DLC : TX_MAX_CLASSIC_DLC
  return `${bytes} / ${max} bytes`
}

export function periodErrorRatio(measured: number, expected: number): number {
  if (!(expected > 0) || !Number.isFinite(measured) || !Number.isFinite(expected)) {
    throw new Error('expected period must be positive')
  }
  return Math.abs(measured - expected) / expected
}

export function withinPeriodTolerance(
  measured: number,
  expected: number,
  tolerance = TX_PERIOD_TOLERANCE
): boolean {
  return periodErrorRatio(measured, expected) <= tolerance
}

/** Skip-missed-tick deadline used by the engine cyclic scheduler. */
export function nextCyclicDeadline(now: number, scheduled: number, period: number): number {
  if (!(period > 0)) {
    throw new Error('period must be positive')
  }
  const next = scheduled + period
  if (now <= next) {
    return next
  }
  const missed = Math.floor((now - scheduled) / period)
  return scheduled + (missed + 1) * period
}

export function formatLastTxStamp(tsUs: number): string {
  const date = new Date(tsUs / 1000)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  ].join(' ')
}
