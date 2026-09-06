import type { ReactElement } from 'react'
import type { BusInterface, EngineInfo, FrameDecode, FrameEvent } from '../../../../shared/engine'
import type { EventLogItem, OpenedBus } from '../shell/types'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'
const MUX_DBC = 'fixtures/dbc/mux.dbc'

type TraceScreenProps = {
  readonly bridgeVersion: string
  readonly info: EngineInfo
  readonly events: readonly EventLogItem[]
  readonly interfaces: readonly BusInterface[]
  readonly opened: readonly OpenedBus[]
  readonly manualName: string
  readonly onManualNameChange: (name: string) => void
  readonly listing: boolean
  readonly onRefreshList: () => void
  readonly onOpenNamed: (name: string) => void
  readonly onCloseNamed: (busId: string) => void
  readonly onLoadDbc: (busId: string, path: string) => void
  readonly onClearDbc: (busId: string) => void
  readonly busStatusText: string
  readonly busStatusError: boolean
  readonly rxFrames: readonly FrameEvent[]
  readonly rxDropped: number
}

function formatCanId(id: number, isEff: boolean): string {
  const hex = id.toString(16).toUpperCase()
  return isEff ? hex.padStart(8, '0') : hex.padStart(3, '0')
}

function formatDataHex(hex: string): string {
  const clean = hex.toUpperCase()
  return clean.replace(/../g, '$& ').trim() || '—'
}

function formatTsUs(tsUs: number): string {
  return new Date(tsUs / 1000).toISOString().slice(11, 23)
}

function formatRateMs(rateMs: number | null): string {
  if (rateMs === null || !Number.isFinite(rateMs)) {
    return '—'
  }
  return rateMs.toFixed(1)
}

function formatSignals(decode: FrameDecode | null): string {
  if (decode === null) {
    return '—'
  }
  const entries = Object.entries(decode.signals).slice(0, 3)
  if (entries.length === 0) {
    return '—'
  }
  return entries.map(([name, value]) => `${name}=${String(value)}`).join(' ')
}

export function TraceScreen({
  bridgeVersion,
  info,
  events,
  interfaces,
  opened,
  manualName,
  onManualNameChange,
  listing,
  onRefreshList,
  onOpenNamed,
  onCloseNamed,
  onLoadDbc,
  onClearDbc,
  busStatusText,
  busStatusError,
  rxFrames,
  rxDropped
}: TraceScreenProps): ReactElement {
  const connected = info.connected
  const backends = info.backends.length > 0 ? info.backends.join(', ') : '—'

  return (
    <div className="trace-screen">
      <section className="trace-intro">
        <p className="eyebrow">T8 shell · T5–T7 stub</p>
        <h2>Trace</h2>
        <p className="lede">
          Existing bus list / open / DBC Sample–Mux / RX stub live here. Production
          virtualized Trace is T9. The renderer never binds CAN or parses DBC.
        </p>
      </section>

      <dl>
        <div>
          <dt>Preload bridge</dt>
          <dd>
            <code>window.vanillabus</code> v{bridgeVersion}
          </dd>
        </div>
        <div>
          <dt>Engine name</dt>
          <dd>{connected ? (info.name ?? '—') : '—'}</dd>
        </div>
        <div>
          <dt>Engine version</dt>
          <dd>{connected ? (info.version ?? '—') : '—'}</dd>
        </div>
        <div>
          <dt>Backends</dt>
          <dd>{connected ? backends : '—'}</dd>
        </div>
      </dl>

      <section className="bus-panel">
        <div className="bus-head">
          <h2>SocketCAN interfaces</h2>
          <button type="button" disabled={!connected || listing} onClick={onRefreshList}>
            {listing ? 'Listing…' : 'List buses'}
          </button>
        </div>
        {interfaces.length === 0 ? (
          <p className="muted">No interfaces listed yet. Bring up vcan0, then List buses.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {interfaces.map((iface) => (
                <tr key={iface.name}>
                  <td>
                    <code>{iface.name}</code>
                  </td>
                  <td>{iface.kind}</td>
                  <td className={iface.state === 'up' ? 'state-up' : 'state-down'}>{iface.state}</td>
                  <td>
                    <button
                      type="button"
                      disabled={!connected || iface.state !== 'up'}
                      onClick={() => onOpenNamed(iface.name)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          className="manual-open"
          onSubmit={(event) => {
            event.preventDefault()
            onOpenNamed(manualName.trim())
          }}
        >
          <label>
            Open by name
            <input
              className="mono"
              value={manualName}
              onChange={(event) => onManualNameChange(event.target.value)}
              spellCheck={false}
              disabled={!connected}
            />
          </label>
          <button type="submit" disabled={!connected || manualName.trim().length === 0}>
            Open
          </button>
        </form>

        {opened.length > 0 ? (
          <ul className="open-list">
            {opened.map((item) => (
              <li key={item.busId}>
                <span>
                  <code>{item.name}</code> · {item.busId}
                  {item.dbc ? (
                    <span className="muted">
                      {' '}
                      · {item.dbc.path} ({item.dbc.messageCount} msgs)
                    </span>
                  ) : (
                    <span className="muted"> · no DBC</span>
                  )}
                </span>
                <span className="bus-actions">
                  <button type="button" disabled={!connected} onClick={() => onLoadDbc(item.busId, SAMPLE_DBC)}>
                    Sample DBC
                  </button>
                  <button type="button" disabled={!connected} onClick={() => onLoadDbc(item.busId, MUX_DBC)}>
                    Mux DBC
                  </button>
                  <button
                    type="button"
                    disabled={!connected || item.dbc === null}
                    onClick={() => onClearDbc(item.busId)}
                  >
                    Clear DBC
                  </button>
                  <button type="button" disabled={!connected} onClick={() => onCloseNamed(item.busId)}>
                    Close
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No open busIds.</p>
        )}

        <p className={busStatusError ? 'bus-result bus-result-error' : 'bus-result'} aria-live="polite">
          {busStatusText}
        </p>
        <p className="hint">
          Missing or down ifaces return structured <code>engine.error</code> (
          <code>iface_not_found</code> / <code>iface_down</code>). See <code>docs/privileges.md</code>.
        </p>
      </section>

      <section className="rx-stub">
        <div className="bus-head">
          <h2>RX stub</h2>
          <span className="muted">
            {rxFrames.length} shown
            {rxDropped > 0 ? ` · dropped ${rxDropped}` : ''}
          </span>
        </div>
        <div className="rx-log">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>ID</th>
                <th>Name</th>
                <th>Rate (ms)</th>
                <th>DLC</th>
                <th>Data</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {rxFrames.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Open a bus, load a DBC, then inject frames. Example:{' '}
                    <code>cansend vcan0 100#E8035A0A00000000</code>
                  </td>
                </tr>
              ) : (
                rxFrames.map((frame, index) => (
                  <tr key={`${frame.ts_us}-${frame.can_id}-${index}`}>
                    <td>
                      <time className="mono">{formatTsUs(frame.ts_us)}</time>
                    </td>
                    <td className="rx-id">
                      <code>{formatCanId(frame.can_id, frame.is_eff)}</code>
                    </td>
                    <td className="rx-name">{frame.decode?.name ?? '—'}</td>
                    <td className="rx-rate mono">{formatRateMs(frame.rate_ms)}</td>
                    <td>{frame.dlc}</td>
                    <td className="rx-data">
                      <code>{formatDataHex(frame.data)}</code>
                    </td>
                    <td className="rx-signals">{formatSignals(frame.decode)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Newest first, last 80 frames. Name/signals come from the DBC bound to that
          bus; unknown IDs stay raw. Not a virtualized Trace (T9).
        </p>
      </section>

      <section className="events">
        <h2>Connection events</h2>
        {events.length === 0 ? (
          <p className="muted">No connected / disconnected events yet.</p>
        ) : (
          <ol>
            {events.map((event, index) => (
              <li key={`${event.at}-${event.type}-${index}`} className={`event-${event.type}`}>
                <time className="mono">{event.at}</time> {event.type}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
