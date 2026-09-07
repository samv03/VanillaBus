import { useMemo, type ReactElement } from 'react'
import { formatCanIdPrefixed } from '../../../../shared/traceFormat'
import { formatDataByteCount, parseCanIdHex, parseDataHex } from '../../../../shared/txFormat'
import type { OpenedBus } from '../shell/types'

export type SendMode = 'oneshot' | 'cyclic'

export type RawSendDraft = {
  readonly busName: string
  readonly idHex: string
  readonly dataHex: string
  readonly mode: SendMode
  readonly periodMs: number
  readonly isEff: boolean
  readonly isRtr: boolean
  readonly isFd: boolean
}

type RawSendPanelProps = {
  readonly draft: RawSendDraft
  readonly onChange: (next: RawSendDraft) => void
  readonly opened: readonly OpenedBus[]
  readonly engineConnected: boolean
  readonly sending: boolean
  readonly starting: boolean
  readonly canStopRaw: boolean
  readonly onSend: () => void
  readonly onStart: () => void
  readonly onStop: () => void
}

export function RawSendPanel({
  draft,
  onChange,
  opened,
  engineConnected,
  sending,
  starting,
  canStopRaw,
  onSend,
  onStart,
  onStop
}: RawSendPanelProps): ReactElement {
  const parsedId = useMemo(() => parseCanIdHex(draft.idHex), [draft.idHex])
  const parsedData = useMemo(() => parseDataHex(draft.dataHex), [draft.dataHex])
  const maxBytes = draft.isFd ? 64 : 8
  const dataBytes = parsedData.ok ? parsedData.bytes : 0
  const busOpen = opened.some((item) => item.name === draft.busName)
  const ready = engineConnected && busOpen
  const formOk =
    parsedId.ok && parsedData.ok && dataBytes <= maxBytes && draft.periodMs >= 1
  const oneshot = draft.mode === 'oneshot'

  const busOptions = opened.length > 0 ? opened.map((item) => item.name) : [draft.busName]

  return (
    <section className="tx-col tx-col-raw">
      <h2>Raw send</h2>
      <label className="tx-field">
        <span>Bus</span>
        <select
          className="mono"
          value={draft.busName}
          disabled={!engineConnected || busOptions.length === 0}
          onChange={(event) => onChange({ ...draft, busName: event.target.value })}
          aria-label="Transmit bus"
        >
          {busOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="tx-field">
        <span>ID (hex)</span>
        <input
          className="mono"
          value={draft.idHex}
          spellCheck={false}
          onChange={(event) => {
            const idHex = event.target.value
            const parsed = parseCanIdHex(idHex)
            onChange({
              ...draft,
              idHex,
              isEff: parsed.ok ? parsed.isEffHint || draft.isEff : draft.isEff
            })
          }}
          aria-label="CAN ID hex"
        />
      </label>

      <label className="tx-field">
        <span>Data (hex)</span>
        <input
          className="mono"
          value={draft.dataHex}
          spellCheck={false}
          onChange={(event) => onChange({ ...draft, dataHex: event.target.value })}
          aria-label="CAN data hex"
        />
        <span className={`tx-byte-count mono ${dataBytes > maxBytes ? 'tx-byte-count-err' : ''}`}>
          {formatDataByteCount(dataBytes, draft.isFd)}
        </span>
      </label>

      <fieldset className="tx-mode">
        <legend>Send mode</legend>
        <label>
          <input
            type="radio"
            name="tx-mode"
            checked={oneshot}
            onChange={() => onChange({ ...draft, mode: 'oneshot' })}
          />
          Single-shot
        </label>
        <label>
          <input
            type="radio"
            name="tx-mode"
            checked={!oneshot}
            onChange={() => onChange({ ...draft, mode: 'cyclic' })}
          />
          Cyclic
        </label>
        <label className="tx-period">
          <span>Period (ms)</span>
          <input
            className="mono"
            type="number"
            min={1}
            step={1}
            value={draft.periodMs}
            disabled={oneshot}
            onChange={(event) =>
              onChange({ ...draft, periodMs: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })
            }
            aria-label="Cyclic period ms"
          />
        </label>
      </fieldset>

      <div className="tx-flags">
        <label>
          <input
            type="checkbox"
            checked={draft.isEff}
            onChange={(event) => onChange({ ...draft, isEff: event.target.checked })}
          />
          EFF
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.isRtr}
            onChange={(event) => onChange({ ...draft, isRtr: event.target.checked })}
          />
          RTR
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.isFd}
            onChange={(event) => onChange({ ...draft, isFd: event.target.checked })}
          />
          FD
        </label>
      </div>

      <div className="tx-raw-actions">
        <button
          type="button"
          className="tx-send-btn"
          disabled={!ready || !formOk || !oneshot || sending}
          onClick={onSend}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button type="button" disabled={!ready || !formOk || oneshot || starting} onClick={onStart}>
          {starting ? 'Starting…' : 'Start'}
        </button>
        <button type="button" disabled={!ready || oneshot || !canStopRaw} onClick={onStop}>
          Stop
        </button>
      </div>

      {!engineConnected ? (
        <p className="tx-hint muted">Engine disconnected.</p>
      ) : !busOpen ? (
        <p className="tx-hint muted">Connect a bus in the header to send.</p>
      ) : parsedId.ok ? (
        <p className="tx-hint muted mono">
          {formatCanIdPrefixed(parsedId.value, draft.isEff)} · {oneshot ? 'one-shot' : `cyclic ${draft.periodMs} ms`}
        </p>
      ) : (
        <p className="tx-hint tx-hint-err">{parsedId.message}</p>
      )}
    </section>
  )
}
