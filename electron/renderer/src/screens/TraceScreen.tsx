import { useMemo, type ReactElement } from 'react'
import { collectMatchingIndices, visibleCount } from '../../../../shared/traceFilter'
import { TRACE_RING_CAPACITY } from '../../../../shared/traceRing'
import { buildDemoBatch } from '../trace/demoTraffic'
import { TraceTable } from '../trace/TraceTable'
import { TraceToolbar } from '../trace/TraceToolbar'
import type { TraceModel } from '../trace/useTraceModel'

type TraceScreenProps = {
  readonly model: TraceModel
  readonly rememberedName?: string
  readonly engineConnected?: boolean
}

export function TraceScreen({
  model,
  rememberedName,
  engineConnected = true
}: TraceScreenProps): ReactElement {
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
        emptyHint={
          !engineConnected
            ? 'Engine disconnected. Trace prefs (filter / pause / scroll lock) are remembered.'
            : rememberedName
              ? `No frames yet. Connect ${rememberedName} when it is UP, then inject traffic (cansend / cangen). Buses are not auto-opened.`
              : undefined
        }
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
