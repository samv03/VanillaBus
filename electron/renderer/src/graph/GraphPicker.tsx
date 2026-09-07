import { useMemo, useState, type ReactElement } from 'react'
import { filterCatalog, groupCatalogByMessage } from '../../../../shared/graphCatalog'
import { formatCanIdHex } from '../../../../shared/graphStats'
import type { GraphStore } from '../../../../shared/graphStore'

type GraphPickerProps = {
  readonly store: GraphStore
  readonly generation: number
  readonly selected: readonly string[]
  readonly onToggle: (key: string) => void
}

export function GraphPicker({
  store,
  generation,
  selected,
  onToggle
}: GraphPickerProps): ReactElement {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const entries = store.catalogEntries()
  const filtered = useMemo(
    () => filterCatalog(entries, query),
    [entries, query, generation]
  )
  const groups = useMemo(() => groupCatalogByMessage(filtered), [filtered])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  return (
    <aside className="graph-picker" aria-label="Signals from DBC">
      <header className="graph-picker-head">
        <h2>Signals (from DBC)</h2>
        <label className="graph-search">
          <span className="visually-hidden">Search signals</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search signals…"
            aria-label="Search signals"
          />
        </label>
      </header>
      <div className="graph-picker-tree">
        {groups.length === 0 ? (
          <p className="graph-picker-empty muted">
            Load a DBC on the header-selected bus to list signals, or wait for
            decoded RX. Last-session checks restore after Load. Graph only plots
            values present on <code>decode.signals</code>.
          </p>
        ) : (
          groups.map((group) => {
            const groupId = `${group.canId}:${group.messageName}`
            const isCollapsed = collapsed.has(groupId) && query.trim().length === 0
            return (
              <section key={groupId} className="graph-msg">
                <button
                  type="button"
                  className="graph-msg-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setCollapsed((previous) => {
                      const next = new Set(previous)
                      if (next.has(groupId)) {
                        next.delete(groupId)
                      } else {
                        next.add(groupId)
                      }
                      return next
                    })
                  }}
                >
                  <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="graph-msg-name">{group.messageName}</span>
                  <span className="mono graph-msg-id">{formatCanIdHex(group.canId)}</span>
                </button>
                {isCollapsed ? null : (
                  <ul className="graph-sig-list">
                    {group.signals.map((signal) => {
                      const checked = selectedSet.has(signal.key)
                      const color = store.colorFor(signal.key)
                      return (
                        <li key={signal.key} className="graph-sig">
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggle(signal.key)}
                            />
                            {checked && color ? (
                              <span
                                className="graph-swatch"
                                style={{ background: color }}
                                aria-hidden="true"
                              />
                            ) : (
                              <span className="graph-swatch graph-swatch-empty" aria-hidden="true" />
                            )}
                            <span>{signal.signalName}</span>
                            {signal.seen ? (
                              <span className="graph-seen muted">live</span>
                            ) : null}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })
        )}
      </div>
      <p className="graph-picker-count muted">
        {selected.length} / {entries.length} signals selected
      </p>
    </aside>
  )
}
