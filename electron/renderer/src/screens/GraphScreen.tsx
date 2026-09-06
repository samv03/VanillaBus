import type { ReactElement } from 'react'

export function GraphScreen(): ReactElement {
  return (
    <section className="placeholder-screen">
      <p className="eyebrow">T11</p>
      <h2>Graph — T11</h2>
      <p className="lede">
        Live uPlot charts land in T11. The shared bus/DBC header stays mounted so
        switching here does not tear down the engine or an open bus.
      </p>
    </section>
  )
}
