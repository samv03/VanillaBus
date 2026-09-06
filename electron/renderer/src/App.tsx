import { useEffect, useState, type ReactElement } from 'react'
import {
  DISCONNECTED_ENGINE_INFO,
  type BusInterface,
  type EngineConnectionEvent,
  type EngineErrorPayload,
  type EngineInfo
} from '../../../shared/engine'

type EventLogItem = {
  readonly at: string
  readonly type: EngineConnectionEvent['type']
}

type OpenedBus = {
  readonly busId: string
  readonly name: string
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
    return () => {
      offStatus()
      offEvent()
    }
  }, [api])

  useEffect(() => {
    if (!info.connected) {
      setInterfaces([])
      setOpened([])
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
    setOpened((previous) => [...previous, { busId: result.busId, name }])
    setBusStatus({ kind: 'ok', text: `Opened ${name} → busId ${result.busId}` })
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
        <p className="eyebrow">T4 SocketCAN open</p>
        <h1>VanillaBus</h1>
        <p className="lede">
          <code>window.vanillabus</code> lists and opens SocketCAN interfaces through
          the engine. The renderer never binds CAN. Interfaces must already be{' '}
          <strong>UP</strong> — VanillaBus will not run <code>ip link set up</code>.
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
                </span>
                <button type="button" disabled={!connected} onClick={() => void closeNamed(item.busId)}>
                  Close
                </button>
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
