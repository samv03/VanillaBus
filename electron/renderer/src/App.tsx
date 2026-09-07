import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  DISCONNECTED_ENGINE_INFO,
  type BusInterface,
  type BusListWarning,
  type EngineInfo
} from '../../../shared/engine'
import { parseAppTab, type AppTab } from '../../../shared/appTabs'
import {
  buildPersistSnapshot,
  dbcPathForBus,
  DEFAULT_PERSIST,
  jobsToDefinitions,
  rememberedEmptyListText,
  rememberedRestoreText,
  upsertBusHint,
  type PersistSnapshot
} from '../../../shared/persist'
import { useGraphModel } from './graph/useGraphModel'
import { GraphScreen } from './screens/GraphScreen'
import { TraceScreen } from './screens/TraceScreen'
import { TransmitScreen } from './screens/TransmitScreen'
import { AppShell } from './shell/AppShell'
import { SharedHeader } from './shell/SharedHeader'
import { remainingSelectedBus } from '../../../shared/multiBus'
import { type BusActionStatus, type OpenedBus } from './shell/types'
import { useTraceModel } from './trace/useTraceModel'
import { useTransmitModel } from './transmit/useTransmitModel'

const SAMPLE_DBC = 'fixtures/dbc/sample.dbc'
const PERSIST_DEBOUNCE_MS = 350

function readTab(): AppTab {
  return parseAppTab(window.location.hash)
}

export function App(): ReactElement {
  const api = window.vanillabus
  const [tab, setTab] = useState<AppTab>(readTab)
  const [info, setInfo] = useState<EngineInfo>(DISCONNECTED_ENGINE_INFO)
  const [interfaces, setInterfaces] = useState<readonly BusInterface[]>([])
  const [listWarnings, setListWarnings] = useState<readonly BusListWarning[]>([])
  const [opened, setOpened] = useState<OpenedBus[]>([])
  const [selectedBus, setSelectedBus] = useState(DEFAULT_PERSIST.lastBusName)
  const [dbcPath, setDbcPath] = useState(SAMPLE_DBC)
  const [remembered, setRemembered] = useState(DEFAULT_PERSIST.buses)
  const [busStatus, setBusStatus] = useState<BusActionStatus>({ kind: 'idle' })
  const [listing, setListing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [restored, setRestored] = useState(false)
  const persistRef = useRef<PersistSnapshot>(DEFAULT_PERSIST)
  const wasConnected = useRef(false)
  const persistLoaded = useRef(false)
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
    if (persistLoaded.current) {
      return
    }
    persistLoaded.current = true
    if (!api?.getPersist) {
      setRestored(true)
      return
    }
    void api
      .getPersist()
      .then((snapshot) => {
        persistRef.current = snapshot
        setSelectedBus(snapshot.lastBusName)
        setDbcPath(dbcPathForBus(snapshot, snapshot.lastBusName))
        setRemembered(snapshot.buses)
        trace.hydratePrefs(snapshot.trace)
        graph.hydratePrefs(snapshot.graph)
        transmit.hydratePrefs(snapshot.txRaw, snapshot.txDbc, snapshot.cyclicJobs)
        if (snapshot.buses.length > 0 || snapshot.lastBusName.length > 0) {
          setBusStatus({ kind: 'ok', text: rememberedRestoreText(snapshot) })
        }
      })
      .finally(() => {
        setRestored(true)
      })
  }, [api, graph.hydratePrefs, trace.hydratePrefs, transmit.hydratePrefs])

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
    if (!info.connected && wasConnected.current) {
      setInterfaces([])
      setListWarnings([])
      setOpened([])
      trace.reset()
      graph.reset()
      transmit.reset()
      setBusStatus({
        kind: 'ok',
        text: `Engine disconnected. ${rememberedRestoreText(persistRef.current)}`
      })
    }
    wasConnected.current = info.connected
  }, [graph.reset, info.connected, trace.reset, transmit.reset])

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
      setListWarnings(result.warnings ?? [])
      if (result.interfaces.length > 0 && !result.interfaces.some((iface) => iface.name === selectedBus)) {
        if (persistRef.current.buses.some((item) => item.name === selectedBus)) {
          // keep the remembered name so Connect can surface iface_down / iface_not_found
        } else {
          setSelectedBus(result.interfaces[0].name)
        }
      }
      setBusStatus({
        kind: 'ok',
        text:
          result.interfaces.length === 0
            ? rememberedEmptyListText(persistRef.current)
            : `Listed ${result.interfaces.length} interface${result.interfaces.length === 1 ? '' : 's'}. Remembered buses stay in the list until you Connect.`
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
      setRemembered((previous) => upsertBusHint(previous, name))
      const rememberedPath = dbcPathForBus(persistRef.current, name)
      setDbcPath(rememberedPath)
      setBusStatus({
        kind: 'ok',
        text: `Opened ${name} → busId ${result.busId}. Load the remembered DBC if the path is still valid.`
      })
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
    const target = opened.find((item) => item.busId === busId)
    setOpened((previous) =>
      previous.map((item) =>
        item.busId === busId
          ? { ...item, dbc: { path, messageCount: result.message_count, catalog: result.catalog } }
          : item
      )
    )
    setDbcPath(path)
    if (target) {
      setRemembered((previous) => upsertBusHint(previous, target.name, path))
    }
    graph.applyDbcCatalog(result.catalog)
    if (persistRef.current.graph.selected.length > 0) {
      graph.hydratePrefs({
        windowSec: graph.windowSec,
        selected: persistRef.current.graph.selected
      })
    }
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
    const nextSelected = remainingSelectedBus(opened, busId, selectedBus)
    setOpened((previous) => previous.filter((item) => item.busId !== busId))
    setSelectedBus(nextSelected)
    transmit.markBusClosed(busId)
    setBusStatus({ kind: 'ok', text: `Closed ${busId}` })
  }

  function selectHeaderBus(name: string): void {
    setSelectedBus(name)
    const open = opened.find((item) => item.name === name)
    if (open?.dbc) {
      setDbcPath(open.dbc.path)
      return
    }
    setDbcPath(dbcPathForBus(persistRef.current, name))
  }

  useEffect(() => {
    if (graph.demoRunning) {
      return
    }
    const open = opened.find((item) => item.name === selectedBus)
    graph.setActiveBus(open?.busId ?? null)
    if (open?.dbc) {
      graph.applyDbcCatalog(open.dbc.catalog)
      if (persistRef.current.graph.selected.length > 0) {
        graph.hydratePrefs({
          windowSec: graph.windowSec,
          selected: persistRef.current.graph.selected
        })
      }
    }
  }, [
    graph.applyDbcCatalog,
    graph.demoRunning,
    graph.hydratePrefs,
    graph.setActiveBus,
    graph.windowSec,
    opened,
    selectedBus
  ])

  useEffect(() => {
    if (!restored || !api?.setPersist) {
      return
    }
    const timer = window.setTimeout(() => {
      const snapshot = buildPersistSnapshot({
        lastBusName: selectedBus,
        lastDbcPath: dbcPath,
        buses: remembered,
        opened: opened.map((item) => ({ name: item.name, dbcPath: item.dbc?.path ?? null })),
        trace: {
          filter: trace.filter,
          paused: trace.paused,
          scrollLock: trace.scrollLock
        },
        graph: {
          windowSec: graph.windowSec,
          selected: graph.selected
        },
        txRaw: transmit.draft,
        txDbc: transmit.dbcDraft,
        cyclicJobs: jobsToDefinitions(transmit.jobs)
      })
      persistRef.current = snapshot
      void api.setPersist(snapshot)
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [
    api,
    dbcPath,
    graph.selected,
    graph.windowSec,
    opened,
    remembered,
    restored,
    selectedBus,
    trace.filter,
    trace.paused,
    trace.scrollLock,
    transmit.dbcDraft,
    transmit.draft,
    transmit.jobs
  ])

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
  const dropped = trace.engineDropped + trace.uiDropped + graph.store.engineDropped

  return (
    <AppShell
      tab={tab}
      onTabChange={selectTab}
      header={
        <SharedHeader
          engineConnected={connected}
          interfaces={interfaces}
          listWarnings={listWarnings}
          opened={opened}
          remembered={remembered}
          selectedBus={selectedBus}
          onSelectBus={selectHeaderBus}
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
          dropped={dropped}
        />
      }
    >
      {tab === 'trace' ? (
        <TraceScreen model={trace} rememberedName={selectedBus} engineConnected={connected} />
      ) : null}
      {tab === 'graph' ? (
        <GraphScreen
          model={graph}
          activeBusName={selectedOpen?.name ?? null}
          hasDbc={selectedOpen?.dbc !== null && selectedOpen?.dbc !== undefined}
        />
      ) : null}
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
