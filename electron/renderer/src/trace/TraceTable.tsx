import type { ReactElement } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { collectMatchingIndices, ringIndexAt, visibleCount } from '../../../../shared/traceFilter'
import type { FrameRing } from '../../../../shared/traceRing'
import { TraceRow } from './TraceRow'

type TraceTableProps = {
  readonly ring: FrameRing
  readonly size: number
  readonly generation: number
  readonly filter: string
  readonly scrollLock: boolean
  readonly expanded: ReadonlySet<number>
  readonly onToggle: (seq: number) => void
  readonly emptyHint?: string
}

export function TraceTable({
  ring,
  size,
  generation,
  filter,
  scrollLock,
  expanded,
  onToggle,
  emptyHint
}: TraceTableProps): ReactElement {
  const indices = collectMatchingIndices(ring, filter)
  const count = visibleCount(ring, indices)

  return (
    <div className="trace-table">
      <div className="trace-cols trace-head" role="row">
        <span />
        <span>Time</span>
        <span>Bus</span>
        <span>ID</span>
        <span>Name</span>
        <span>DLC</span>
        <span>Data</span>
        <span>Rate (ms)</span>
        <span>Dir</span>
      </div>
      <div className="trace-body">
        {count === 0 ? (
          <p className="trace-empty muted">
            {size === 0
              ? emptyHint ??
                'Connect a bus, then inject frames. Example: cansend vcan0 100#E8035A0A00000000'
              : 'No frames match this filter. Clear the filter or Pause/Resume to keep watching.'}
          </p>
        ) : (
          <Virtuoso
            className="trace-virtuoso"
            totalCount={count}
            computeItemKey={(index) => ring.at(ringIndexAt(indices, index)).seq}
            followOutput={scrollLock}
            overscan={12}
            increaseViewportBy={160}
            context={{ generation, size }}
            itemContent={(index) => {
              const entry = ring.at(ringIndexAt(indices, index))
              return (
                <TraceRow
                  entry={entry}
                  expanded={expanded.has(entry.seq)}
                  onToggle={onToggle}
                />
              )
            }}
          />
        )}
      </div>
    </div>
  )
}
