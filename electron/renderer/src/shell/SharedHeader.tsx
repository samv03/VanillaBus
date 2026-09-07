import type { ReactElement } from 'react'
import type { BusInterface } from '../../../../shared/engine'
import { formatBusOptionLabel } from '../../../../shared/multiBus'
import { formatStatus, type BusActionStatus, type OpenedBus, type OpenedDbc } from './types'

const DBC_PRESETS = ['fixtures/dbc/sample.dbc', 'fixtures/dbc/mux.dbc'] as const

type SharedHeaderProps = {
  readonly engineConnected: boolean
  readonly interfaces: readonly BusInterface[]
  readonly opened: readonly OpenedBus[]
  readonly selectedBus: string
  readonly onSelectBus: (name: string) => void
  readonly busConnected: boolean
  readonly onConnect: () => void
  readonly onDisconnect: () => void
  readonly listing: boolean
  readonly connecting: boolean
  readonly dbcPath: string
  readonly onDbcPathChange: (path: string) => void
  readonly onLoadDbc: () => void
  readonly loadedDbc: OpenedDbc | null
  readonly status: BusActionStatus
}

export function SharedHeader({
  engineConnected,
  interfaces,
  opened,
  selectedBus,
  onSelectBus,
  busConnected,
  onConnect,
  onDisconnect,
  listing,
  connecting,
  dbcPath,
  onDbcPathChange,
  onLoadDbc,
  loadedDbc,
  status
}: SharedHeaderProps): ReactElement {
  const names = interfaces.map((iface) => iface.name)
  const extra = opened.map((item) => item.name).filter((name) => !names.includes(name))
  const options =
    names.includes(selectedBus) || selectedBus.length === 0
      ? [...names, ...extra]
      : [selectedBus, ...names, ...extra.filter((name) => name !== selectedBus)]
  const uniqueOptions = [...new Set(options)]
  const selectedMeta = interfaces.find((iface) => iface.name === selectedBus)
  const openHint =
    opened.length === 0
      ? 'No bus open'
      : `Open: ${opened.map((item) => item.name).join(', ')} · active ${selectedBus || '—'}`

  return (
    <header className="shared-header">
      <div className="shared-header-row">
        <div className="header-group">
          <label className="header-field">
            <span>Bus</span>
            <select
              className="mono"
              value={selectedBus}
              disabled={!engineConnected || uniqueOptions.length === 0}
              onChange={(event) => onSelectBus(event.target.value)}
              aria-label="Bus"
            >
              {uniqueOptions.length === 0 ? (
                <option value="">No buses listed</option>
              ) : (
                uniqueOptions.map((name) => {
                  const iface = interfaces.find((item) => item.name === name)
                  const open = opened.some((item) => item.name === name)
                  return (
                    <option key={name} value={name}>
                      {formatBusOptionLabel(name, iface, open)}
                    </option>
                  )
                })
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={!engineConnected || selectedBus.length === 0 || busConnected || connecting}
            onClick={onConnect}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
          <button type="button" disabled={!engineConnected || !busConnected} onClick={onDisconnect}>
            Disconnect
          </button>
          <StatusPill
            ok={busConnected}
            okLabel="Connected"
            offLabel="Disconnected"
            hint={
              selectedMeta
                ? `${selectedMeta.name} ${selectedMeta.state} · ${openHint}`
                : busConnected
                  ? openHint
                  : openHint
            }
          />
        </div>

        <div className="header-group header-group-dbc">
          <label className="header-field header-field-wide">
            <span>DBC path</span>
            <input
              className="mono"
              list="dbc-presets"
              value={dbcPath}
              spellCheck={false}
              disabled={!engineConnected}
              onChange={(event) => onDbcPathChange(event.target.value)}
              aria-label="DBC path"
            />
            <datalist id="dbc-presets">
              {DBC_PRESETS.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            disabled={!engineConnected || !busConnected || dbcPath.trim().length === 0}
            onClick={onLoadDbc}
          >
            Load
          </button>
          {loadedDbc ? (
            <span className="header-dbc-meta mono muted">
              {loadedDbc.path} · {loadedDbc.messageCount} msgs
            </span>
          ) : (
            <span className="header-dbc-meta muted">No DBC loaded</span>
          )}
        </div>

        <div className="header-group header-group-engine">
          <StatusPill
            ok={engineConnected}
            okLabel="Engine Connected"
            offLabel="Engine Disconnected"
          />
        </div>
      </div>
      {opened.length > 0 ? (
        <div className="header-open-buses" role="group" aria-label="Open buses">
          <span className="header-open-label">Open</span>
          {opened.map((item) => {
            const active = item.name === selectedBus
            const dbcName = item.dbc ? item.dbc.path.split('/').pop() : null
            return (
              <button
                key={item.busId}
                type="button"
                className={active ? 'header-open-chip header-open-chip-active' : 'header-open-chip'}
                aria-pressed={active}
                onClick={() => onSelectBus(item.name)}
                title={`${item.name} · busId ${item.busId}${item.dbc ? ` · ${item.dbc.path}` : ''}`}
              >
                <span className="mono">{item.name}</span>
                {dbcName ? <span className="header-open-chip-dbc"> · {dbcName}</span> : null}
              </button>
            )
          })}
          <span className="header-open-hint muted">
            Select a chip or the dropdown, then Load / TX. Disconnect closes only the active bus.
          </span>
        </div>
      ) : null}
      <p
        className={status.kind === 'error' ? 'header-status header-status-error' : 'header-status'}
        aria-live="polite"
      >
        {listing && status.kind === 'idle' ? 'Listing buses…' : formatStatus(status)}
      </p>
    </header>
  )
}

function StatusPill({
  ok,
  okLabel,
  offLabel,
  hint
}: {
  readonly ok: boolean
  readonly okLabel: string
  readonly offLabel: string
  readonly hint?: string
}): ReactElement {
  return (
    <span
      className={`badge ${ok ? 'badge-ok' : 'badge-off'}`}
      aria-live="polite"
      title={hint}
    >
      <span className="badge-dot" aria-hidden="true" />
      <span>{ok ? okLabel : offLabel}</span>
    </span>
  )
}
