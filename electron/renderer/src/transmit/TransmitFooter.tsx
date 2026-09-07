import type { ReactElement } from 'react'
import { formatCanIdPrefixed } from '../../../../shared/traceFormat'
import { formatLastTxStamp } from '../../../../shared/txFormat'
import type { TransmitStats } from './useTransmitModel'

type TransmitFooterProps = {
  readonly stats: TransmitStats
}

export function TransmitFooter({ stats }: TransmitFooterProps): ReactElement {
  const last = stats.lastTx
  return (
    <footer className="tx-footer">
      <div className="tx-footer-left">
        <span className="tx-indicator" aria-hidden="true">
          TX
        </span>
        <span className="tx-stat">
          Tx Count <strong className="mono tx-accent">{stats.txCount.toLocaleString()}</strong>
        </span>
        <span className="tx-stat">
          Errors{' '}
          <strong className={`mono ${stats.errors === 0 ? 'tx-ok' : 'tx-err'}`}>
            {stats.errors.toLocaleString()}
          </strong>
        </span>
        <span className="tx-stat tx-last">
          Last Tx{' '}
          {last ? (
            <strong className="mono tx-accent">
              {formatLastTxStamp(last.tsUs)} · {formatCanIdPrefixed(last.canId, last.isEff)}
            </strong>
          ) : (
            <strong className="mono muted">—</strong>
          )}
        </span>
      </div>
      <span className="tx-client-label">CLIENT-SIDE</span>
    </footer>
  )
}
