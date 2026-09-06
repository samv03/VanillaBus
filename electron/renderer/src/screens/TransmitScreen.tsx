import type { ReactElement } from 'react'

export function TransmitScreen(): ReactElement {
  return (
    <section className="placeholder-screen">
      <p className="eyebrow">T12 / T13</p>
      <h2>Transmit — T12/T13</h2>
      <p className="lede">
        Single-shot and cyclic TX land in T12; DBC pack for TX is T13. Header
        Connect / DBC Load stay available on this screen.
      </p>
    </section>
  )
}
