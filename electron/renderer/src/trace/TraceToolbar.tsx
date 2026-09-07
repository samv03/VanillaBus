import type { ReactElement } from 'react'

type TraceToolbarProps = {
  readonly filter: string
  readonly onFilterChange: (value: string) => void
  readonly paused: boolean
  readonly onPausedChange: (value: boolean) => void
  readonly scrollLock: boolean
  readonly onScrollLockChange: (value: boolean) => void
  readonly onClear: () => void
  readonly onDemoTraffic?: () => void
  readonly size: number
  readonly capacity: number
  readonly filteredCount: number
  readonly engineDropped: number
  readonly uiDropped: number
}

export function TraceToolbar({
  filter,
  onFilterChange,
  paused,
  onPausedChange,
  scrollLock,
  onScrollLockChange,
  onClear,
  onDemoTraffic,
  size,
  capacity,
  filteredCount,
  engineDropped,
  uiDropped
}: TraceToolbarProps): ReactElement {
  const dropped = engineDropped + uiDropped
  return (
    <div className="trace-toolbar">
      <label className="trace-filter">
        <span className="visually-hidden">Filter ID / name</span>
        <input
          className="mono"
          type="search"
          value={filter}
          placeholder="Filter ID / name"
          spellCheck={false}
          onChange={(event) => onFilterChange(event.target.value)}
          aria-label="Filter ID / name"
        />
      </label>

      <div className="trace-toolbar-actions">
        <button
          type="button"
          className={paused ? 'trace-tool-btn trace-tool-active' : 'trace-tool-btn'}
          onClick={() => onPausedChange(!paused)}
          aria-pressed={paused}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="trace-tool-btn" onClick={onClear}>
          <TrashIcon />
          Clear
        </button>
        {onDemoTraffic ? (
          <button type="button" className="trace-tool-btn" onClick={onDemoTraffic}>
            Demo traffic
          </button>
        ) : null}
        <div className="trace-scroll-lock">
          <LockIcon />
          <span>Scroll lock</span>
          <button
            type="button"
            role="switch"
            aria-checked={scrollLock}
            aria-label="Scroll lock"
            className={scrollLock ? 'trace-switch trace-switch-on' : 'trace-switch'}
            onClick={() => onScrollLockChange(!scrollLock)}
          >
            <span className="trace-switch-knob" />
          </button>
        </div>
      </div>

      <p className="trace-toolbar-meta mono" aria-live="polite">
        {filter.trim().length > 0 ? `${filteredCount}/${size}` : size} / {capacity}
        {dropped > 0 ? (
          <span className="trace-dropped">{` · dropped ${dropped.toLocaleString()}`}</span>
        ) : null}
        {paused ? ' · paused' : ''}
      </p>
    </div>
  )
}

function PauseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="2" width="4" height="12" rx="0.6" fill="currentColor" />
      <rect x="9" y="2" width="4" height="12" rx="0.6" fill="currentColor" />
    </svg>
  )
}

function PlayIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 2.6v10.8L13.2 8 4 2.6z" fill="currentColor" />
    </svg>
  )
}

function TrashIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6 2h4l.6 1H14v1.4H2V3h3.4L6 2zm.3 4.2h1.2v6H6.3v-6zm2.2 0h1.2v6H8.5v-6zM3.4 4.8h9.2l-.6 9.2H4l-.6-9.2z"
        fill="currentColor"
      />
    </svg>
  )
}

function LockIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 2.2a2.8 2.8 0 0 1 2.8 2.8V7H12v7H4V7h1.2V5a2.8 2.8 0 0 1 2.8-2.8zm0 1.4A1.4 1.4 0 0 0 6.6 5v2h2.8V5A1.4 1.4 0 0 0 8 3.6z"
        fill="currentColor"
      />
    </svg>
  )
}
