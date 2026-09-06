import type { KeyboardEvent, ReactElement } from 'react'
import type { FrameDecode } from '../../../../shared/engine'
import {
  formatCanIdPrefixed,
  formatDataHex,
  formatRateMs,
  formatSignalValue,
  formatTsUs,
  frameName
} from '../../../../shared/traceFormat'
import type { TraceEntry } from '../../../../shared/traceRing'

type TraceRowProps = {
  readonly entry: TraceEntry
  readonly expanded: boolean
  readonly onToggle: (seq: number) => void
}

export function TraceRow({ entry, expanded, onToggle }: TraceRowProps): ReactElement {
  const frame = entry.frame
  const decode = frame.decode
  const signals = decode ? Object.entries(decode.signals) : []
  const expandable = signals.length > 0

  function activate(): void {
    if (expandable) {
      onToggle(entry.seq)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <div className={expanded && expandable ? 'trace-row trace-row-open' : 'trace-row'}>
      <div
        className="trace-cols trace-row-main"
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
        <span className="trace-exp" aria-hidden="true">
          {expandable ? (expanded ? '▾' : '▸') : ''}
        </span>
        <time className="mono" dateTime={formatTsUs(frame.ts_us)}>
          {formatTsUs(frame.ts_us)}
        </time>
        <span className="mono">{frame.ifName}</span>
        <span className="mono trace-id">{formatCanIdPrefixed(frame.can_id, frame.is_eff)}</span>
        <span className="trace-name">{frameName(frame)}</span>
        <span className="mono">{frame.dlc}</span>
        <span className="mono trace-data">{formatDataHex(frame.data)}</span>
        <span className="mono trace-rate">{formatRateMs(frame.rate_ms)}</span>
        <span className={frame.dir === 'tx' ? 'trace-dir trace-dir-tx' : 'trace-dir trace-dir-rx'}>
          {frame.dir.toUpperCase()}
        </span>
      </div>
      {expanded && expandable && decode ? <SignalDetail decode={decode} /> : null}
    </div>
  )
}

function SignalDetail({ decode }: { readonly decode: FrameDecode }): ReactElement {
  const entries = Object.entries(decode.signals)
  return (
    <div className="trace-signals">
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>Value</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="mono">{formatSignalValue(value)}</td>
              <td className="mono">{decode.units[name] ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
