import type { ReactElement } from 'react'
import { formatGraphClock } from '../../../../shared/graphStats'
import type { GraphWindowSec } from '../../../../shared/graphWindow'

type GraphFooterProps = {
  readonly messageCount: number
  readonly rate: number | null
  readonly errors: number
  readonly windowSec: GraphWindowSec
  readonly updatedUs: number | null
}

export function GraphFooter({
  messageCount,
  rate,
  errors,
  windowSec,
  updatedUs
}: GraphFooterProps): ReactElement {
  return (
    <footer className="graph-footer">
      <p className="mono">
        Messages: {messageCount.toLocaleString()} · Rate:{' '}
        {rate === null ? '—' : `${Math.round(rate)} msg/s`} · Errors: {errors}
      </p>
      <p className="mono">
        Window: {windowSec}s · Updated: {formatGraphClock(updatedUs)}
      </p>
    </footer>
  )
}
