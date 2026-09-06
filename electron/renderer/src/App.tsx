import type { ReactElement } from 'react'

export function App(): ReactElement {
  const bridgeVersion = window.vanillabus?.version ?? 'unavailable'

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">T1 scaffold</p>
        <h1>VanillaBus</h1>
        <p className="lede">
          SocketCAN-first desktop bus monitor. This window is the Electron + React
          hello path only — CAN I/O, DBC decode, and Trace/Graph/Transmit UI come
          later.
        </p>
      </header>
      <dl>
        <div>
          <dt>Preload bridge</dt>
          <dd>stub v{bridgeVersion}</dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd>install with pip install -e engine/</dd>
        </div>
      </dl>
    </main>
  )
}
