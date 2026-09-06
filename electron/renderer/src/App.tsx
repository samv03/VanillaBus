import { useEffect, useState, type ReactElement } from 'react'
import {
  DISCONNECTED_ENGINE_INFO,
  type EngineConnectionEvent,
  type EngineInfo
} from '../../../shared/engine'

type EventLogItem = {
  readonly at: string
  readonly type: EngineConnectionEvent['type']
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19)
}

export function App(): ReactElement {
  const api = window.vanillabus
  const bridgeVersion = api?.version ?? 'unavailable'
  const [info, setInfo] = useState<EngineInfo>(DISCONNECTED_ENGINE_INFO)
  const [events, setEvents] = useState<EventLogItem[]>([])

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

  const connected = info.connected
  const backends = info.backends.length > 0 ? info.backends.join(', ') : '—'

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">T3 preload bridge</p>
        <h1>VanillaBus</h1>
        <p className="lede">
          Electron renderer talks only to <code>window.vanillabus</code>. Engine
          identity comes from live <code>engine.hello</code>. SocketCAN, DBC, and
          Trace/Graph/Transmit stay out of this process.
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
        <p className="hint">
          Disconnected is reachable by killing the engine child (
          <code>pkill -f &apos;python3 -m can_engine&apos;</code>
          ). The badge flips to Disconnected, then Connected after respawn.
        </p>
      </section>
    </main>
  )
}
