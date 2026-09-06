import { useEffect, useState, type ReactElement } from 'react'

type EngineStatus = Awaited<ReturnType<Window['vanillabus']['getEngineStatus']>>

const DISCONNECTED: EngineStatus = { connected: false, hello: null }

export function App(): ReactElement {
  const bridgeVersion = window.vanillabus?.version ?? 'unavailable'
  const [engine, setEngine] = useState<EngineStatus>(DISCONNECTED)

  useEffect(() => {
    if (!window.vanillabus) {
      return
    }
    void window.vanillabus.getEngineStatus().then(setEngine)
    return window.vanillabus.onEngineStatus(setEngine)
  }, [])

  const engineLabel = engine.connected
    ? `Connected · ${engine.hello?.name ?? 'vanillabus-engine'} ${engine.hello?.version ?? ''}`
    : 'Disconnected'

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">T2 IPC</p>
        <h1>VanillaBus</h1>
        <p className="lede">
          SocketCAN-first desktop bus monitor. Electron main speaks length-prefixed
          JSON to vanillabus-engine. CAN I/O, DBC decode, and Trace/Graph/Transmit
          UI are still later — none of that lives in this renderer.
        </p>
      </header>
      <dl>
        <div>
          <dt>Preload bridge</dt>
          <dd>v{bridgeVersion}</dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd className={engine.connected ? 'status-ok' : 'status-off'}>{engineLabel}</dd>
        </div>
      </dl>
    </main>
  )
}
