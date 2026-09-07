import { useEffect, useState, type ReactElement } from 'react'
import { DISCONNECTED_ENGINE_INFO, type BusInterface, type EngineInfo } from '../../../shared/engine'
import { parseAppTab, type AppTab } from '../../../shared/appTabs'
import { useGraphModel } from './graph/useGraphModel'
import { GraphScreen } from './screens/GraphScreen'
import { TraceScreen } from './screens/TraceScreen'
import { TransmitScreen } from './screens/TransmitScreen'
import { AppShell } from './shell/AppShell'
import { SharedHeader } from './shell/SharedHeader'
import { type BusActionStatus, type OpenedBus } from './shell/types'
import { useTraceModel } from './trace/useTraceModel'
import { useTransmitModel } from './transmit/useTransmitModel'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'

function readTab(): AppTab {
  return parseAppTab(window.location.hash)
}

export function App(): ReactElement {
  const api = window.vanillabus
  const [tab, setTab] = useState<AppTab>(readTab)
  const [info, setInfo] = useState<EngineInfo>(DISCONNECTED_ENGINE_INFO)
  const [interfaces, setInterfaces] = useState<readonly BusInterface[]>([])
  const [opened, setOpened] = useState<OpenedBus[]>([])
  const [selectedBus, setSelectedBus] = useState('vcan0')
  const [dbcPath, setDbcPath] = useState(SAMPLE_DBC)
  const [busStatus, setBusStatus] = useState<BusActionStatus>({ kind: 'idle' })
  const [listing, setListing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const trace = useTraceModel()
  const graph = useGraphModel()
  const transmit = useTransmitModel(api)

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
    const offRx = api.onRxBatch((batch) => {
      trace.appendBatch(batch)
      graph.appendBatch(batch)
      transmit.noteBatch(batch)
    })
    return () => {
      offStatus()
      offRx()
    }
  }, [api, graph.appendBatch, trace.appendBatch, transmit.noteBatch])

  useEffect(() => {
    if (!info.connected) {
      setInterfaces([])
      setOpened([])
      trace.reset()
      graph.reset()
      transmit.reset()
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
    graph.applyDbcCatalog(result.catalog)
    setBusStatus({
      kind: 'ok',
      text: `Loaded ${path} (${result.message_count} messages) on ${busId}`
    })
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
    transmit.markBusClosed(busId)
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
          onSelectBus={setSelectedBus}
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
      {tab === 'trace' ? <TraceScreen model={trace} /> : null}
      {tab === 'graph' ? <GraphScreen model={graph} /> : null}
      {tab === 'transmit' ? (
        <TransmitScreen
          model={transmit}
          opened={opened}
          selectedBus={selectedBus}
          engineConnected={connected}
        />
      ) : null}
    </AppShell>
  )
}
