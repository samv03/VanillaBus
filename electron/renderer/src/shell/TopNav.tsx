import type { ReactElement } from 'react'
import { APP_TABS, type AppTab } from '../../../../shared/appTabs'
// Dedicated 64/128 exports of the concept-A mark (same art as the dock icon).
import mark128 from '../assets/icon-128.png'
import mark64 from '../assets/icon-64.png'

const TAB_LABELS: Record<AppTab, string> = {
  trace: 'Trace',
  graph: 'Graph',
  transmit: 'Transmit'
}

type TopNavProps = {
  readonly tab: AppTab
  readonly onTabChange: (tab: AppTab) => void
}

export function TopNav({ tab, onTabChange }: TopNavProps): ReactElement {
  return (
    <div className="app-nav">
      <div className="app-brand">
        <img
          className="app-mark"
          src={mark64}
          srcSet={`${mark64} 1x, ${mark128} 2x`}
          width={28}
          height={28}
          alt=""
          draggable={false}
        />
        <span className="app-title">VanillaBus</span>
      </div>
      <nav className="app-tabs" aria-label="Primary">
        <div role="tablist" className="app-tablist">
          {APP_TABS.map((item) => {
            const selected = item === tab
            return (
              <button
                key={item}
                type="button"
                role="tab"
                id={`tab-${item}`}
                aria-selected={selected}
                aria-controls={`panel-${item}`}
                className={selected ? 'app-tab app-tab-active' : 'app-tab'}
                onClick={() => onTabChange(item)}
              >
                {TAB_LABELS[item]}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
