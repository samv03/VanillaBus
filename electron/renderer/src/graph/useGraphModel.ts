import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbcCatalogMessage, RxBatch } from '../../../../shared/engine'
import { GRAPH_DEFAULT_HZ, type GraphWindowSec } from '../../../../shared/graphWindow'
import { GraphStore } from '../../../../shared/graphStore'
import { buildGraphDemoBatch } from './demoTraffic'

export type GraphModel = {
  readonly store: GraphStore
  readonly generation: number
  readonly paused: boolean
  readonly windowSec: GraphWindowSec
  readonly selected: readonly string[]
  readonly demoRunning: boolean
  readonly hz: number
  readonly activeBusId: string | null
  setPaused: (next: boolean) => void
  setWindowSec: (next: GraphWindowSec) => void
  toggleSelected: (key: string) => void
  setActiveBus: (busId: string | null) => void
  applyDbcCatalog: (messages: readonly DbcCatalogMessage[]) => void
  appendBatch: (batch: RxBatch) => void
  clear: () => void
  reset: () => void
  startDemo: () => void
  stopDemo: () => void
}

export function useGraphModel(): GraphModel {
  const storeRef = useRef(new GraphStore())
  const pausedRef = useRef(false)
  const demoTimerRef = useRef<number | null>(null)
  const demoPhaseRef = useRef(0)
  const [generation, setGeneration] = useState(0)
  const [paused, setPausedState] = useState(false)
  const [windowSec, setWindowState] = useState<GraphWindowSec>(storeRef.current.windowSec)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [demoRunning, setDemoRunning] = useState(false)
  const [activeBusId, setActiveBusId] = useState<string | null>(null)

  const publish = useCallback((): void => {
    setGeneration((current) => current + 1)
    setSelected([...storeRef.current.selectedKeys()])
    setWindowState(storeRef.current.windowSec)
    setPausedState(storeRef.current.paused)
  }, [])

  const appendBatch = useCallback(
    (batch: RxBatch): void => {
      storeRef.current.appendBatch(batch)
      if (!pausedRef.current) {
        publish()
      }
    },
    [publish]
  )

  const setPaused = useCallback(
    (next: boolean): void => {
      pausedRef.current = next
      storeRef.current.setPaused(next)
      publish()
    },
    [publish]
  )

  const setWindowSec = useCallback(
    (next: GraphWindowSec): void => {
      storeRef.current.setWindowSec(next)
      publish()
    },
    [publish]
  )

  const toggleSelected = useCallback(
    (key: string): void => {
      storeRef.current.toggleSelected(key)
      publish()
    },
    [publish]
  )

  const setActiveBus = useCallback(
    (busId: string | null): void => {
      if (storeRef.current.activeBusId === busId) {
        return
      }
      storeRef.current.setActiveBus(busId)
      setActiveBusId(storeRef.current.activeBusId)
      publish()
    },
    [publish]
  )

  const applyDbcCatalog = useCallback(
    (messages: readonly DbcCatalogMessage[]): void => {
      storeRef.current.applyDbcCatalog(messages)
      publish()
    },
    [publish]
  )

  const clear = useCallback((): void => {
    storeRef.current.clearSamples()
    publish()
  }, [publish])

  const stopDemo = useCallback((): void => {
    if (demoTimerRef.current !== null) {
      window.clearInterval(demoTimerRef.current)
      demoTimerRef.current = null
    }
    setDemoRunning(false)
  }, [])

  const reset = useCallback((): void => {
    stopDemo()
    pausedRef.current = false
    storeRef.current.reset()
    setActiveBusId(null)
    publish()
  }, [publish, stopDemo])

  const startDemo = useCallback((): void => {
    if (demoTimerRef.current !== null) {
      return
    }
    storeRef.current.setActiveBus('demo')
    setActiveBusId('demo')
    storeRef.current.applyDbcCatalog([
      {
        name: 'EngineStatus',
        can_id: 0x100,
        signals: [
          { name: 'EngineSpeed', unit: 'rpm' },
          { name: 'EngineTemp', unit: 'degC' },
          { name: 'OilPressure', unit: 'kPa' }
        ]
      },
      {
        name: 'VehicleSpeed',
        can_id: 0x101,
        signals: [{ name: 'Speed', unit: 'km/h' }]
      }
    ])
    if (storeRef.current.selectedKeys().length === 0) {
      storeRef.current.setSelected([
        'EngineStatus.EngineSpeed',
        'EngineStatus.EngineTemp',
        'VehicleSpeed.Speed'
      ])
    }
    demoPhaseRef.current = 0
    setDemoRunning(true)
    demoTimerRef.current = window.setInterval(() => {
      demoPhaseRef.current += 0.18
      storeRef.current.appendBatch(buildGraphDemoBatch(Date.now() * 1000, demoPhaseRef.current))
      if (!pausedRef.current) {
        publish()
      }
    }, 50)
    publish()
  }, [publish])

  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) {
        window.clearInterval(demoTimerRef.current)
      }
    }
  }, [])

  return {
    store: storeRef.current,
    generation,
    paused,
    windowSec,
    selected,
    demoRunning,
    hz: GRAPH_DEFAULT_HZ,
    activeBusId,
    setPaused,
    setWindowSec,
    toggleSelected,
    setActiveBus,
    applyDbcCatalog,
    appendBatch,
    clear,
    reset,
    startDemo,
    stopDemo
  }
}
