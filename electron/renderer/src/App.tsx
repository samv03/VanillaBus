import { useEffect, useState, type ReactElement } from 'react'
import { DISCONNECTED_ENGINE_INFO, type BusInterface, type EngineInfo, type FrameEvent } from '../../../shared/engine'
import { parseAppTab, type AppTab } from '../../../shared/appTabs'
import { GraphScreen } from './screens/GraphScreen'
import { TraceScreen } from './screens/TraceScreen'
import { TransmitScreen } from './screens/TransmitScreen'
import { AppShell } from './shell/AppShell'
import { SharedHeader } from './shell/SharedHeader'
import {
  formatStatus,
  type BusActionStatus,
  type EventLogItem,
  type OpenedBus
} from './shell/types'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19)
}

function readTab(): AppTab {
  return parseAppTab(window.location.hash)
}

export function App(): ReactElement {
  const api = window.vanillabus
  const bridgeVersion = api?.version ?? 'unavailable'
  const [tab, setTab] = useState<AppTab>(readTab)
  const [info, setInfo] = useState<EngineInfo>(DISCONNECTED_ENGINE_INFO)
  const [events, setEvents] = useState<EventLogItem[]>([])
  const [interfaces, setInterfaces] = useState<readonly BusInterface[]>([])
  const [opened, setOpened] = useState<OpenedBus[]>([])
  const [selectedBus, setSelectedBus] = useState('vcan0')
  const [manualName, setManualName] = useState('vcan0')
  const [dbcPath, setDbcPath] = useState(SAMPLE_DBC)
  const [busStatus, setBusStatus] = useState<BusActionStatus>({ kind: 'idle' })
  const [listing, setListing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [rxFrames, setRxFrames] = useState<FrameEvent[]>([])
  const [rxDropped, setRxDropped] = useState(0)

  useEffect(() => {
    const onHashChange = (): void => {
      setTab(parseAppTab(window.location.hash))
    }
    window.addEventListener('hashchange', onHashChange)
    if (window.location.hash === '' || window.location.hash === '#') {
      window.location.replace('#trace')
    }
    return () => {
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    if (!api) {
      return
    }
    void api.getEngineInfo().then(setInfo)
    const offStatus = api.onEngineStatus(setInfo)
    const offEvent = api.onEngineEvent((event) => {
      setEvents((previous) => [
        ...previous.slice(-9),
        { at: formatTime(new Date()), type: event.type }
      ])
    })
    const offRx = api.onRxBatch((batch) => {
      setRxDropped(batch.dropped)
      setRxFrames((previous) => [...batch.frames, ...previous].slice(0, 80))
    })
    return () => {
      offStatus()
      offEvent()
      offRx()
    }
  }, [api])

  useEffect(() => {
    if (!info.connected) {
      setInterfaces([])
      setOpened([])
      setRxFrames([])
      setRxDropped(0)
    }
  }, [info.connected])

  async function refreshList(): Promise<void> {
    if (!api) {
      return
    }
    setListing(true)
    try {
      const result = await api.listBuses()
      if (!result.ok) {
        setBusStatus({ kind: 'error', error: result.error })
        return
      }
      setInterfaces(result.interfaces)
      if (result.interfaces.length > 0 && !result.interfaces.some((iface) => iface.name === selectedBus)) {
        setSelectedBus(result.interfaces[0].name)
      }
      setBusStatus({
        kind: 'ok',
        text:
          result.interfaces.length === 0
            ? 'No SocketCAN interfaces. Bring up vcan0 with sudo ./scripts/setup-vcan.sh'
            : `Listed ${result.interfaces.length} interface${result.interfaces.length === 1 ? '' : 's'}`
      })
    } finally {
      setListing(false)
    }
  }

  useEffect(() => {
    if (info.connected) {
      void refreshList()
    }
  }, [info.connected])

  async function openNamed(name: string): Promise<void> {
    if (!api) {
      return
    }
    setConnecting(true)
    try {
      const result = await api.openBus(name)
      if (!result.ok) {
        setBusStatus({ kind: 'error', error: result.error })
        return
      }
      setOpened((previous) => [...previous, { busId: result.busId, name, dbc: null }])
      setSelectedBus(name)
      setManualName(name)
      setBusStatus({ kind: 'ok', text: `Opened ${name} → busId ${result.busId}` })
    } finally {
      setConnecting(false)
    }
  }

  async function loadNamedDbc(busId: string, path: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.loadDbc(busId, path)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) =>
      previous.map((item) =>
        item.busId === busId ? { ...item, dbc: { path, messageCount: result.message_count } } : item
      )
    )
    setDbcPath(path)
    setBusStatus({
      kind: 'ok',
      text: `Loaded ${path} (${result.message_count} messages) on ${busId}`
    })
  }

  async function clearNamedDbc(busId: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.clearDbc(busId)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) =>
      previous.map((item) => (item.busId === busId ? { ...item, dbc: null } : item))
    )
    setBusStatus({ kind: 'ok', text: `Cleared DBC on ${busId}` })
  }

  async function closeNamed(busId: string): Promise<void> {
    if (!api) {
      return
    }
    const result = await api.closeBus(busId)
    if (!result.ok) {
      setBusStatus({ kind: 'error', error: result.error })
      return
    }
    setOpened((previous) => previous.filter((item) => item.busId !== busId))
    setBusStatus({ kind: 'ok', text: `Closed ${busId}` })
  }

  function selectTab(next: AppTab): void {
    if (parseAppTab(window.location.hash) !== next) {
      window.location.hash = next
      return
    }
    setTab(next)
  }

  function headerTargetBus(): OpenedBus | undefined {
    return opened.find((item) => item.name === selectedBus) ?? opened[0]
  }

  async function headerConnect(): Promise<void> {
    await openNamed(selectedBus.trim())
  }

  async function headerDisconnect(): Promise<void> {
    const target = headerTargetBus()
    if (!target) {
      return
    }
    await closeNamed(target.busId)
  }

  async function headerLoadDbc(): Promise<void> {
    const target = headerTargetBus()
    if (!target) {
      setBusStatus({
        kind: 'error',
        error: { code: 'bus_not_open', message: 'Connect a bus before loading a DBC.' }
      })
      return
    }
    await loadNamedDbc(target.busId, dbcPath.trim())
  }

  const connected = info.connected
  const selectedOpen = opened.find((item) => item.name === selectedBus)
  const busConnected = selectedOpen !== undefined

  return (
    <AppShell
      tab={tab}
      onTabChange={selectTab}
      header={
        <SharedHeader
          engineConnected={connected}
          interfaces={interfaces}
          selectedBus={selectedBus}
          onSelectBus={(name) => {
            setSelectedBus(name)
            setManualName(name)
          }}
          busConnected={busConnected}
          onConnect={() => void headerConnect()}
          onDisconnect={() => void headerDisconnect()}
          listing={listing}
          connecting={connecting}
          dbcPath={dbcPath}
          onDbcPathChange={setDbcPath}
          onLoadDbc={() => void headerLoadDbc()}
          loadedDbc={selectedOpen?.dbc ?? null}
          status={busStatus}
        />
      }
    >
      {tab === 'trace' ? (
        <TraceScreen
          bridgeVersion={bridgeVersion}
          info={info}
          events={events}
          interfaces={interfaces}
          opened={opened}
          manualName={manualName}
          onManualNameChange={setManualName}
          listing={listing}
          onRefreshList={() => void refreshList()}
          onOpenNamed={(name) => void openNamed(name)}
          onCloseNamed={(busId) => void closeNamed(busId)}
          onLoadDbc={(busId, path) => void loadNamedDbc(busId, path)}
          onClearDbc={(busId) => void clearNamedDbc(busId)}
          busStatusText={formatStatus(busStatus)}
          busStatusError={busStatus.kind === 'error'}
          rxFrames={rxFrames}
          rxDropped={rxDropped}
        />
      ) : null}
      {tab === 'graph' ? <GraphScreen /> : null}
      {tab === 'transmit' ? <TransmitScreen /> : null}
    </AppShell>
  )
}
