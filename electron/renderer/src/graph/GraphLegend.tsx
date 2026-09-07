import type { ReactElement } from 'react'
import { formatGraphNumber } from '../../../../shared/graphStats'
import type { GraphLegendRow } from '../../../../shared/graphStore'

type GraphLegendProps = {
  readonly rows: readonly GraphLegendRow[]
}

export function GraphLegend({ rows }: GraphLegendProps): ReactElement {
  return (
    <div className="graph-legend">
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>Value</th>
            <th>Min</th>
            <th>Max</th>
            <th>Mean</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                Select one or more signals to plot.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <span className="graph-legend-name">
                    <span
                      className="graph-swatch"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                    <span>
                      {row.messageName}.{row.signalName}
                    </span>
                  </span>
                </td>
                <td className="mono">{formatGraphNumber(row.stats.value)}</td>
                <td className="mono">{formatGraphNumber(row.stats.min)}</td>
                <td className="mono">{formatGraphNumber(row.stats.max)}</td>
                <td className="mono">{formatGraphNumber(row.stats.mean)}</td>
                <td className="mono">{row.unit || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
