import { useCallback, useRef, useState } from 'react'
import type { RxBatch } from '../../../../shared/engine'
import { applyRxBatch } from '../../../../shared/traceControl'
import { paintVisibleWindow, TRACE_VISIBLE_ROW_BUDGET } from '../../../../shared/tracePaint'
import { FrameRing, TRACE_RING_CAPACITY } from '../../../../shared/traceRing'

export type TraceModel = {
  readonly ring: FrameRing
  readonly capacity: number
  readonly size: number
  readonly generation: number
  readonly paused: boolean
  readonly scrollLock: boolean
  readonly filter: string
  readonly uiDropped: number
  readonly engineDropped: number
  readonly expanded: ReadonlySet<number>
  readonly firstPaintMs: number | null
  setPaused: (next: boolean) => void
  setScrollLock: (next: boolean) => void
  setFilter: (next: string) => void
  toggleExpanded: (seq: number) => void
  appendBatch: (batch: RxBatch) => void
  clear: () => void
  reset: () => void
  hydratePrefs: (prefs: { readonly filter: string; readonly paused: boolean; readonly scrollLock: boolean }) => void
}

export function useTraceModel(): TraceModel {
  const ringRef = useRef(new FrameRing(TRACE_RING_CAPACITY))
  const pausedRef = useRef(false)
  const firstPaintRef = useRef<number | null>(null)
  const [paused, setPausedState] = useState(false)
  const [scrollLock, setScrollLock] = useState(true)
  const [filter, setFilter] = useState('')
  const [size, setSize] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [uiDropped, setUiDropped] = useState(0)
  const [engineDropped, setEngineDropped] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [firstPaintMs, setFirstPaintMs] = useState<number | null>(null)

  const publish = useCallback((): void => {
    setSize(ringRef.current.size)
    setGeneration((current) => current + 1)
  }, [])

  const appendBatch = useCallback(
    (batch: RxBatch): void => {
      setEngineDropped(batch.dropped)
      if (pausedRef.current || batch.frames.length === 0) {
        return
      }
      const started = firstPaintRef.current === null ? performance.now() : 0
      const overflow = applyRxBatch(ringRef.current, batch.frames, false)
      if (overflow > 0) {
        setUiDropped((current) => current + overflow)
      }
      if (firstPaintRef.current === null) {
        paintVisibleWindow(ringRef.current, { visibleBudget: TRACE_VISIBLE_ROW_BUDGET })
        const elapsed = performance.now() - started
        firstPaintRef.current = elapsed
        setFirstPaintMs(elapsed)
        if (import.meta.env.DEV) {
          console.debug(
            `[trace-n2] first-paint ${elapsed.toFixed(2)} ms (${batch.frames.length} frames, ring ${ringRef.current.size})`
          )
        }
      }
      publish()
    },
    [publish]
  )

  const clear = useCallback((): void => {
    ringRef.current.clear()
    firstPaintRef.current = null
    setUiDropped(0)
    setExpanded(new Set())
    setFirstPaintMs(null)
    publish()
  }, [publish])

  const reset = useCallback((): void => {
    ringRef.current.clear()
    firstPaintRef.current = null
    setUiDropped(0)
    setEngineDropped(0)
    setExpanded(new Set())
    setFirstPaintMs(null)
    publish()
  }, [publish])

  const hydratePrefs = useCallback(
    (prefs: { readonly filter: string; readonly paused: boolean; readonly scrollLock: boolean }): void => {
      pausedRef.current = prefs.paused
      setPausedState(prefs.paused)
      setScrollLock(prefs.scrollLock)
      setFilter(prefs.filter)
    },
    []
  )

  const setPaused = useCallback((next: boolean): void => {
    pausedRef.current = next
    setPausedState(next)
  }, [])

  const toggleExpanded = useCallback((seq: number): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(seq)) {
        next.delete(seq)
      } else {
        next.add(seq)
      }
      return next
    })
  }, [])

  return {
    ring: ringRef.current,
    capacity: TRACE_RING_CAPACITY,
    size,
    generation,
    paused,
    scrollLock,
    filter,
    uiDropped,
    engineDropped,
    expanded,
    firstPaintMs,
    setPaused,
    setScrollLock,
    setFilter,
    toggleExpanded,
    appendBatch,
    clear,
    reset,
    hydratePrefs
  }
}
