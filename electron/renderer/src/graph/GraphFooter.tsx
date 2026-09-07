import type { ReactElement } from 'react'
import { formatGraphClock } from '../../../../shared/graphStats'
import type { GraphWindowSec } from '../../../../shared/graphWindow'

type GraphFooterProps = {
  readonly messageCount: number
  readonly rate: number | null
  readonly errors: number
  readonly windowSec: GraphWindowSec
  readonly updatedUs: number | null
  readonly dropped?: number
}

export function GraphFooter({
  messageCount,
  rate,
  errors,
  windowSec,
  updatedUs,
  dropped = 0
}: GraphFooterProps): ReactElement {
  return (
    <footer className="graph-footer">
      <p className="mono">
        Messages: {messageCount.toLocaleString()} · Rate:{' '}
        {rate === null ? '—' : `${Math.round(rate)} msg/s`} · Errors: {errors}
        {dropped > 0 ? ` · dropped ${dropped.toLocaleString()}` : ''}
      </p>
      <p className="mono">
        Window: {windowSec}s · Updated: {formatGraphClock(updatedUs)}
      </p>
    </footer>
  )
}
