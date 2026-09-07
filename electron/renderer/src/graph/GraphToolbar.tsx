import type { ReactElement } from 'react'
import { GRAPH_WINDOWS_SEC, type GraphWindowSec } from '../../../../shared/graphWindow'

type GraphToolbarProps = {
  readonly windowSec: GraphWindowSec
  readonly onWindowSec: (next: GraphWindowSec) => void
  readonly paused: boolean
  readonly onPausedChange: (next: boolean) => void
  readonly onClear: () => void
  readonly onDemoToggle?: () => void
  readonly demoRunning?: boolean
  readonly activeBusName?: string | null
}

export function GraphToolbar({
  windowSec,
  onWindowSec,
  paused,
  onPausedChange,
  onClear,
  onDemoToggle,
  demoRunning,
  activeBusName
}: GraphToolbarProps): ReactElement {
  return (
    <div className="graph-toolbar">
      <div className="graph-window-chips" role="group" aria-label="Time window">
        <span className="graph-toolbar-label">Time window</span>
        {GRAPH_WINDOWS_SEC.map((value) => (
          <button
            key={value}
            type="button"
            className={value === windowSec ? 'graph-chip graph-chip-active' : 'graph-chip'}
            aria-pressed={value === windowSec}
            onClick={() => onWindowSec(value)}
          >
            {value}s
          </button>
        ))}
      </div>
      <div className="graph-toolbar-actions">
        <button
          type="button"
          className={paused ? 'graph-tool-btn graph-tool-active' : 'graph-tool-btn'}
          aria-pressed={paused}
          onClick={() => onPausedChange(!paused)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="graph-tool-btn" onClick={onClear}>
          Clear
        </button>
        {onDemoToggle ? (
          <button
            type="button"
            className={demoRunning ? 'graph-tool-btn graph-tool-active' : 'graph-tool-btn'}
            onClick={onDemoToggle}
          >
            {demoRunning ? 'Stop demo' : 'Demo'}
          </button>
        ) : null}
      </div>
      <p className="graph-bus-hint muted">
        {activeBusName
          ? `Plotting ${activeBusName} (header-selected bus). Frames from other open buses stay in Trace.`
          : 'Connect a bus to plot that ifName only. Window length and selected signal names are remembered.'}
      </p>
    </div>
  )
}
