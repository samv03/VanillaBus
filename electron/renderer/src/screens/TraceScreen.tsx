import { useMemo, type ReactElement } from 'react'
import { collectMatchingIndices, visibleCount } from '../../../../shared/traceFilter'
import { TRACE_RING_CAPACITY } from '../../../../shared/traceRing'
import { buildDemoBatch } from '../trace/demoTraffic'
import { TraceTable } from '../trace/TraceTable'
import { TraceToolbar } from '../trace/TraceToolbar'
import type { TraceModel } from '../trace/useTraceModel'

type TraceScreenProps = {
  readonly model: TraceModel
}

export function TraceScreen({ model }: TraceScreenProps): ReactElement {
  const filteredCount = useMemo(() => {
    return visibleCount(model.ring, collectMatchingIndices(model.ring, model.filter))
  }, [model.ring, model.filter, model.generation, model.size])

  return (
    <div className="trace-screen">
      <TraceToolbar
        filter={model.filter}
        onFilterChange={model.setFilter}
        paused={model.paused}
        onPausedChange={model.setPaused}
        scrollLock={model.scrollLock}
        onScrollLockChange={model.setScrollLock}
        onClear={model.clear}
        onDemoTraffic={import.meta.env.DEV ? () => model.appendBatch(buildDemoBatch()) : undefined}
        size={model.size}
        capacity={model.capacity}
        filteredCount={filteredCount}
        engineDropped={model.engineDropped}
        uiDropped={model.uiDropped}
      />
      <TraceTable
        ring={model.ring}
        size={model.size}
        generation={model.generation}
        filter={model.filter}
        scrollLock={model.scrollLock}
        expanded={model.expanded}
        onToggle={model.toggleExpanded}
      />
      <p className="trace-footnote muted">
        Virtualized Trace — only visible rows render. The Bus column is the
        SocketCAN ifName for that frame&apos;s busId. Ring drops oldest at{' '}
        {TRACE_RING_CAPACITY.toLocaleString()} frames. Expand a named row for DBC
        signals (name / value / unit).
      </p>
    </div>
  )
}
