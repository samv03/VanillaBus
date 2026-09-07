import { useMemo, type ReactElement } from 'react'
import { GraphFooter } from '../graph/GraphFooter'
import { GraphLegend } from '../graph/GraphLegend'
import { GraphPicker } from '../graph/GraphPicker'
import { GraphPlot } from '../graph/GraphPlot'
import { GraphToolbar } from '../graph/GraphToolbar'
import type { GraphModel } from '../graph/useGraphModel'

type GraphScreenProps = {
  readonly model: GraphModel
}

export function GraphScreen({ model }: GraphScreenProps): ReactElement {
  const rows = useMemo(
    () => model.store.legendRows(),
    [model.store, model.generation, model.selected]
  )

  return (
    <div className="graph-screen">
      <GraphPicker
        store={model.store}
        generation={model.generation}
        selected={model.selected}
        onToggle={model.toggleSelected}
      />
      <div className="graph-main">
        <GraphToolbar
          windowSec={model.windowSec}
          onWindowSec={model.setWindowSec}
          paused={model.paused}
          onPausedChange={model.setPaused}
          onClear={model.clear}
          onDemoToggle={
            import.meta.env.DEV
              ? () => {
                  if (model.demoRunning) {
                    model.stopDemo()
                  } else {
                    model.startDemo()
                  }
                }
              : undefined
          }
          demoRunning={model.demoRunning}
        />
        <GraphPlot
          store={model.store}
          generation={model.generation}
          selected={model.selected}
          paused={model.paused}
          hz={model.hz}
        />
        <GraphLegend rows={rows} />
        <GraphFooter
          messageCount={model.store.messageCount}
          rate={model.store.liveRate()}
          errors={model.store.errorCount}
          windowSec={model.windowSec}
          updatedUs={model.store.updatedUs}
        />
      </div>
    </div>
  )
}
