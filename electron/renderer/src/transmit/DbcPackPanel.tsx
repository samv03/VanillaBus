import { useEffect, useMemo, type ReactElement } from 'react'
import { formatCanIdPrefixed } from '../../../../shared/traceFormat'
import type { DbcCatalogMessage, DbcCatalogSignal, SignalValue } from '../../../../shared/engine'
import type { DbcPackDraft } from './useTransmitModel'

type DbcPackPanelProps = {
  readonly draft: DbcPackDraft
  readonly onChange: (next: DbcPackDraft) => void
  readonly catalog: readonly DbcCatalogMessage[]
  readonly dbcLoaded: boolean
  readonly ready: boolean
  readonly sending: boolean
  readonly starting: boolean
  readonly canStop: boolean
  readonly onSend: () => void
  readonly onStart: () => void
  readonly onStop: () => void
}

export function DbcPackPanel({
  draft,
  onChange,
  catalog,
  dbcLoaded,
  ready,
  sending,
  starting,
  canStop,
  onSend,
  onStart,
  onStop
}: DbcPackPanelProps): ReactElement {
  const selected = useMemo(
    () => catalog.find((message) => message.name === draft.message) ?? catalog[0],
    [catalog, draft.message]
  )

  useEffect(() => {
    if (!selected) {
      if (draft.message !== '') {
        onChange({ ...draft, message: '', values: {} })
      }
      return
    }
    if (draft.message === selected.name) {
      return
    }
    onChange({
      ...draft,
      message: selected.name,
      values: valuesForMessage(selected, {})
    })
  }, [draft, onChange, selected])

  const parsed = useMemo(() => parseSignalValues(selected, draft.values), [draft.values, selected])
  const formOk = selected !== undefined && parsed !== null && draft.periodMs >= 1

  return (
    <section className="tx-col tx-col-dbc">
      <h2>DBC pack</h2>
      {!dbcLoaded ? (
        <p className="tx-dbc-banner">Load a DBC in the header</p>
      ) : (
        <p className="tx-dbc-banner tx-dbc-banner-ok">cantools pack in engine</p>
      )}

      <label className="tx-field">
        <span>Message</span>
        <select
          className="mono"
          value={selected?.name ?? ''}
          disabled={!dbcLoaded || catalog.length === 0}
          onChange={(event) => {
            const message = catalog.find((item) => item.name === event.target.value)
            if (!message) {
              return
            }
            onChange({
              ...draft,
              message: message.name,
              values: valuesForMessage(message, {})
            })
          }}
          aria-label="DBC message"
        >
          {catalog.length === 0 ? <option value="">No messages</option> : null}
          {catalog.map((message) => (
            <option key={message.name} value={message.name}>
              {message.name} ({formatCanIdPrefixed(message.can_id, message.can_id > 0x7ff)})
            </option>
          ))}
        </select>
      </label>

      <div className="tx-dbc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {!selected || selected.signals.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {dbcLoaded ? 'No signals on this message' : 'Signals appear after DBC load'}
                </td>
              </tr>
            ) : (
              selected.signals.map((signal) => (
                <tr key={signal.name}>
                  <td className="mono">{signal.name}</td>
                  <td>
                    <input
                      className="mono tx-dbc-value"
                      value={draft.values[signal.name] ?? ''}
                      spellCheck={false}
                      disabled={!dbcLoaded}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          values: { ...draft.values, [signal.name]: event.target.value }
                        })
                      }
                      aria-label={`${signal.name} value`}
                    />
                  </td>
                  <td className="muted">{signal.unit || '—'}</td>
                  <td className="mono muted">{formatBound(signal.min)}</td>
                  <td className="mono muted">{formatBound(signal.max)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <label className="tx-field tx-dbc-period">
        <span>Period (ms)</span>
        <input
          className="mono"
          type="number"
          min={1}
          step={1}
          value={draft.periodMs}
          onChange={(event) =>
            onChange({ ...draft, periodMs: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })
          }
          aria-label="DBC cyclic period ms"
        />
      </label>

      <div className="tx-dbc-actions">
        <button
          type="button"
          className="tx-btn-outline"
          disabled={!ready || !formOk || sending}
          onClick={onSend}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="tx-send-btn" disabled={!ready || !formOk || starting} onClick={onStart}>
          {starting ? 'Starting…' : 'Start cyclic'}
        </button>
        <button type="button" disabled={!ready || !canStop} onClick={onStop}>
          Stop
        </button>
      </div>

      {!dbcLoaded ? (
        <p className="tx-hint muted">Connect a bus and Load a DBC. Pack happens in the engine.</p>
      ) : parsed === null ? (
        <p className="tx-hint tx-hint-err">Signal values must be numbers, booleans, or text.</p>
      ) : selected ? (
        <p className="tx-hint muted mono">
          {selected.name} · {formatCanIdPrefixed(selected.can_id, selected.can_id > 0x7ff)}
        </p>
      ) : null}
    </section>
  )
}

export function defaultSignalValue(signal: DbcCatalogSignal): string {
  if (typeof signal.initial === 'number' && Number.isFinite(signal.initial)) {
    return String(signal.initial)
  }
  if (typeof signal.min === 'number' && Number.isFinite(signal.min)) {
    return String(signal.min)
  }
  return '0'
}

export function valuesForMessage(
  message: DbcCatalogMessage,
  previous: Readonly<Record<string, string>>
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const signal of message.signals) {
    const existing = previous[signal.name]
    values[signal.name] = existing !== undefined ? existing : defaultSignalValue(signal)
  }
  return values
}

export function parseSignalValues(
  message: DbcCatalogMessage | undefined,
  raw: Readonly<Record<string, string>>
): Record<string, SignalValue> | null {
  if (!message) {
    return null
  }
  const signals: Record<string, SignalValue> = {}
  for (const signal of message.signals) {
    const text = (raw[signal.name] ?? '').trim()
    if (text === '') {
      return null
    }
    if (text === 'true' || text === 'false') {
      signals[signal.name] = text === 'true'
      continue
    }
    const numeric = Number(text)
    if (Number.isFinite(numeric)) {
      signals[signal.name] = numeric
      continue
    }
    signals[signal.name] = text
  }
  return signals
}

function formatBound(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}
