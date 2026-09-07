import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import type { BusInterface, BusListWarning } from '../../../../shared/engine'
import { busBlacklistWarning, formatVendorHint } from '../../../../shared/multiBus'
import {
  formatRememberedBusLabel,
  isRememberedName,
  mergeRememberedNames,
  type PersistedBusHint
} from '../../../../shared/persist'
import { formatStatus, type BusActionStatus, type OpenedBus, type OpenedDbc } from './types'

const DBC_PRESETS = ['fixtures/dbc/sample.dbc', 'fixtures/dbc/mux.dbc'] as const

type SharedHeaderProps = {
  readonly engineConnected: boolean
  readonly interfaces: readonly BusInterface[]
  readonly listWarnings?: readonly BusListWarning[]
  readonly opened: readonly OpenedBus[]
  readonly remembered?: readonly PersistedBusHint[]
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
  readonly dropped?: number
}

export function SharedHeader({
  engineConnected,
  interfaces,
  listWarnings,
  opened,
  remembered = [],
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
  status,
  dropped = 0
}: SharedHeaderProps): ReactElement {
  const names = interfaces.map((iface) => iface.name)
  const extra = opened.map((item) => item.name)
  const uniqueOptions = mergeRememberedNames([...names, ...extra], remembered, selectedBus)
  const selectedMeta = interfaces.find((iface) => iface.name === selectedBus)
  const vendorHint = formatVendorHint(selectedMeta)
  const blacklistWarning = busBlacklistWarning(interfaces, listWarnings)
  const openHint =
    opened.length === 0
      ? remembered.length > 0
        ? `No bus open · remembered ${remembered.map((item) => item.name).join(', ')}`
        : 'No bus open'
      : `Open: ${opened.map((item) => item.name).join(', ')} · active ${selectedBus || '—'}`
  const connectDisabled = !engineConnected || selectedBus.length === 0 || busConnected || connecting
  const connectTitle = !engineConnected
    ? 'Wait for Engine Connected'
    : busConnected
      ? `${selectedBus} is already open`
      : selectedBus.length === 0
        ? 'Select a bus first'
        : `Open ${selectedBus}. Does not bring a down iface up.`

  function onDbcKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      onLoadDbc()
    }
  }

  function onDbcSubmit(event: FormEvent): void {
    event.preventDefault()
    onLoadDbc()
  }

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
                      {formatRememberedBusLabel(
                        name,
                        iface,
                        open,
                        !open && isRememberedName(remembered, name)
                      )}
                    </option>
                  )
                })
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={connectDisabled}
            onClick={onConnect}
            title={connectTitle}
            aria-label={connecting ? 'Connecting' : 'Connect bus'}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
          <button
            type="button"
            disabled={!engineConnected || !busConnected}
            onClick={onDisconnect}
            title={busConnected ? `Close ${selectedBus}` : 'No open bus to disconnect'}
            aria-label="Disconnect bus"
          >
            Disconnect
          </button>
          <StatusPill
            ok={busConnected}
            okLabel="Connected"
            offLabel="Disconnected"
            hint={
              selectedMeta
                ? `${selectedMeta.name} ${selectedMeta.state}${vendorHint ? ` · ${vendorHint}` : ''} · ${openHint}`
                : openHint
            }
          />
          {vendorHint ? (
            <span className="header-vendor-hint mono muted" title={selectedMeta?.module}>
              {vendorHint}
            </span>
          ) : null}
        </div>

        <form className="header-group header-group-dbc" onSubmit={onDbcSubmit}>
          <label className="header-field header-field-wide">
            <span>DBC path</span>
            <input
              className="mono"
              list="dbc-presets"
              value={dbcPath}
              spellCheck={false}
              disabled={!engineConnected}
              onChange={(event) => onDbcPathChange(event.target.value)}
              onKeyDown={onDbcKeyDown}
              aria-label="DBC path"
              title="Remembered per bus. Enter or Load — does not parse DBC in the UI."
            />
            <datalist id="dbc-presets">
              {DBC_PRESETS.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </label>
          <button
            type="submit"
            disabled={!engineConnected || !busConnected || dbcPath.trim().length === 0}
            title={
              !busConnected
                ? 'Connect a bus before loading a DBC'
                : 'Load this DBC on the active bus'
            }
            aria-label="Load DBC"
          >
            Load
          </button>
          {loadedDbc ? (
            <span className="header-dbc-meta mono muted">
              {loadedDbc.path} · {loadedDbc.messageCount} msgs
            </span>
          ) : (
            <span className="header-dbc-meta muted">
              {dbcPath.trim().length > 0 ? 'DBC path remembered — Load after Connect' : 'No DBC loaded'}
            </span>
          )}
        </form>

        <div className="header-group header-group-engine">
          <StatusPill
            ok={engineConnected}
            okLabel="Engine Connected"
            offLabel="Engine Disconnected"
          />
          {dropped > 0 ? (
            <span
              className="header-drop-pill"
              title="Engine RX queue + Trace ring overflow (T16 drop-oldest)"
              aria-label={`Dropped ${dropped} frames`}
            >
              dropped {dropped.toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
      {remembered.length > 0 && opened.length === 0 ? (
        <div className="header-remembered" role="status">
          <span className="header-open-label">Remembered</span>
          {remembered.map((item) => {
            const dbcName = item.dbcPath ? item.dbcPath.split(/[\\/]/).pop() : null
            const listed = interfaces.find((iface) => iface.name === item.name)
            return (
              <button
                key={item.name}
                type="button"
                className="header-open-chip"
                onClick={() => onSelectBus(item.name)}
                title={
                  listed
                    ? `${item.name} is ${listed.state}. Connect does not auto-up a down iface.`
                    : `${item.name} is remembered and not listed. Connect after the iface is UP.`
                }
              >
                <span className="mono">{item.name}</span>
                {listed ? (
                  <span className={listed.state === 'up' ? 'header-open-chip-dbc' : 'header-remembered-down'}>
                    {' '}
                    · {listed.state}
                  </span>
                ) : (
                  <span className="header-remembered-down"> · not listed</span>
                )}
                {dbcName ? <span className="header-open-chip-dbc"> · {dbcName}</span> : null}
              </button>
            )
          })}
          <span className="header-open-hint muted">
            Last session only — VanillaBus does not auto-open buses or start cyclic TX.
          </span>
        </div>
      ) : null}
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
      {blacklistWarning ? (
        <p className="header-blacklist-warn" role="alert">
          SocketCAN blacklist: {blacklistWarning}
        </p>
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
