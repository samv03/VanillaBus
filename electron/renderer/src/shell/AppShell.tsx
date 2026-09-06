import type { ReactElement, ReactNode } from 'react'
import type { AppTab } from '../../../../shared/appTabs'
import { TopNav } from './TopNav'

type AppShellProps = {
  readonly tab: AppTab
  readonly onTabChange: (tab: AppTab) => void
  readonly header: ReactNode
  readonly children: ReactNode
}

export function AppShell({ tab, onTabChange, header, children }: AppShellProps): ReactElement {
  return (
    <div className="app-shell">
      <div className="app-chrome">
        <TopNav tab={tab} onTabChange={onTabChange} />
        {header}
      </div>
      <main
        className={`app-body app-body-${tab}`}
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {children}
      </main>
    </div>
  )
}
