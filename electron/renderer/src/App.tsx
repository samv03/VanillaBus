import { useEffect, useState, type ReactElement } from 'react'
import {
  DISCONNECTED_ENGINE_INFO,
  type BusInterface,
  type EngineConnectionEvent,
  type EngineErrorPayload,
  type EngineInfo,
  type FrameDecode,
  type FrameEvent
} from '../../../shared/engine'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'
const MUX_DBC = 'fixtures/dbc/mux.dbc'

type EventLogItem = {
  readonly at: string
  readonly type: EngineConnectionEvent['type']
}

type OpenedDbc = {
  readonly path: string
  readonly messageCount: number
}

type OpenedBus = {
  readonly busId: string
  readonly name: string
  readonly dbc: OpenedDbc | null
}

type BusActionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'error'; readonly error: EngineErrorPayload }

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19)
}

function formatError(error: EngineErrorPayload): string {
  return `${error.code}: ${error.message}`
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

export function App(): ReactElement {
  const api = window.vanillabus
  const bridgeVersion = api?.version ?? 'unavailable'
  const [info, setInfo] = useState<EngineInfo>(DISCONNECTED_ENGINE_INFO)
  const [events, setEvents] = useState<EventLogItem[]>([])
  const [interfaces, setInterfaces] = useState<readonly BusInterface[]>([])
  const [opened, setOpened] = useState<OpenedBus[]>([])
  const [manualName, setManualName] = useState('vcan0')
  const [busStatus, setBusStatus] = useState<BusActionStatus>({ kind: 'idle' })
  const [listing, setListing] = useState(false)
  const [rxFrames, setRxFrames] = useState<FrameEvent[]>([])
  const [rxDropped, setRxDropped] = useState(0)

  useEffect(() => {
    if (!api) {
      return
    }
    void api.getEngineInfo().then(setInfo)
    const offStatus = api.onEngineStatus(setInfo)
    const offEvent = api.onEngineEvent((event) => {
      setEvents((previous) => [
        ...previous.slice(-9),
        { at: formatTime(new Date()), type: event.type }
      ])
    })
    const offRx = api.onRxBatch((batch) => {
      setRxDropped(batch.dropped)
      setRxFrames((previous) => [...batch.frames, ...previous].slice(0, 80))
    })
    return () => {
      offStatus()
      offEvent()
      offRx()
    }
  }, [api])

  useEffect(() => {
    if (!info.connected) {
      setInterfaces([])
      setOpened([])
      setRxFrames([])
      setRxDropped(0)
    }
  }, [info.connected])

  async function refreshList(): Promise<void> {
    if (!api) {
      return
    }
    setListing(true)
    try {
      const result = await api.listBuses()
      if (!result.ok) {
        setBusStatus({ kind: 'error', error: result.error })
        return
      }
      setInterfaces(result.interfaces)
      setBusStatus({
        kind: 'ok',
        text:
          result.interfaces.length === 0
            ? 'No SocketCAN interfaces. Bring up vcan0 with sudo ./scripts/setup-vcan.sh'
            : `Listed ${result.interfaces.length} interface${result.interfaces.length === 1 ? '' : 's'}`
      })
    } finally {
      setListing(false)
    }
  }

  async function openNamed(name: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.openBus(name)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) => [...previous, { busId: result.busId, name, dbc: null }])
    setBusStatus({ kind: 'ok', text: `Opened ${name} → busId ${result.busId}` })
  }

  async function loadNamedDbc(busId: string, path: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.loadDbc(busId, path)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) =>
      previous.map((item) =>
        item.busId === busId ? { ...item, dbc: { path, messageCount: result.message_count } } : item
      )
    )
    setBusStatus({
      kind: 'ok',
      text: `Loaded ${path} (${result.message_count} messages) on ${busId}`
    })
  }

  async function clearNamedDbc(busId: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.clearDbc(busId)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) =>
      previous.map((item) => (item.busId === busId ? { ...item, dbc: null } : item))
    )
    setBusStatus({ kind: 'ok', text: `Cleared DBC on ${busId}` })
  }

  async function closeNamed(busId: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.closeBus(busId)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) => previous.filter((item) => item.busId !== busId))
    setBusStatus({ kind: 'ok', text: `Closed ${busId}` })
  }

  const connected = info.connected
  const backends = info.backends.length > 0 ? info.backends.join(', ') : '—'

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">T7 DBC unpack</p>
        <h1>VanillaBus</h1>
        <p className="lede">
          After <code>bus.open</code>, load a DBC on that <code>busId</code>. Known
          IDs unpack via cantools onto <code>rx.batch</code>; unknown IDs stay raw.
          This list is a throwaway proof — not Trace. The renderer never parses DBC.
        </p>
      </header>

      <section className={`badge ${connected ? 'badge-ok' : 'badge-off'}`} aria-live="polite">
        <span className="badge-dot" aria-hidden="true" />
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
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
          <button type="button" disabled={!connected || listing} onClick={() => void refreshList()}>
            {listing ? 'Listing…' : 'List buses'}
          </button>
        </div>
        {interfaces.length === 0 ? (
          <p className="muted">
            No interfaces listed yet. Bring up vcan0, then List buses.
          </p>
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
                      onClick={() => void openNamed(iface.name)}
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
            void openNamed(manualName.trim())
          }}
        >
          <label>
            Open by name
            <input
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
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
                  <button
                    type="button"
                    disabled={!connected}
                    onClick={() => void loadNamedDbc(item.busId, SAMPLE_DBC)}
                  >
                    Sample DBC
                  </button>
                  <button
                    type="button"
                    disabled={!connected}
                    onClick={() => void loadNamedDbc(item.busId, MUX_DBC)}
                  >
                    Mux DBC
                  </button>
                  <button
                    type="button"
                    disabled={!connected || item.dbc === null}
                    onClick={() => void clearNamedDbc(item.busId)}
                  >
                    Clear DBC
                  </button>
                  <button type="button" disabled={!connected} onClick={() => void closeNamed(item.busId)}>
                    Close
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No open busIds.</p>
        )}

        <p
          className={
            busStatus.kind === 'error' ? 'bus-result bus-result-error' : 'bus-result'
          }
          aria-live="polite"
        >
          {busStatus.kind === 'idle'
            ? 'List or open an interface to see the engine result.'
            : busStatus.kind === 'ok'
              ? busStatus.text
              : formatError(busStatus.error)}
        </p>
        <p className="hint">
          Missing or down ifaces return structured <code>engine.error</code> (
          <code>iface_not_found</code> / <code>iface_down</code>). See{' '}
          <code>docs/privileges.md</code>.
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
                      <time>{formatTsUs(frame.ts_us)}</time>
                    </td>
                    <td className="rx-id">
                      <code>{formatCanId(frame.can_id, frame.is_eff)}</code>
                    </td>
                    <td className="rx-name">{frame.decode?.name ?? '—'}</td>
                    <td className="rx-rate">{formatRateMs(frame.rate_ms)}</td>
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
          Newest first, last 80 frames. Name/signals come from the DBC bound to
          that bus; unknown IDs stay raw. Not a virtualized Trace (T9).
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
                <time>{event.at}</time> {event.type}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
