import { useEffect, useRef, type ReactElement } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { graphRedrawIntervalMs } from '../../../../shared/graphWindow'
import type { GraphStore } from '../../../../shared/graphStore'

type GraphPlotProps = {
  readonly store: GraphStore
  readonly generation: number
  readonly selected: readonly string[]
  readonly paused: boolean
  readonly hz: number
  readonly emptyHint?: string
}

const AXIS_STROKE = '#8b949e'
const GRID_STROKE = '#21262d'
const BG = '#0d1117'

function buildOptions(
  width: number,
  height: number,
  labels: readonly string[],
  colors: readonly string[],
  windowSec: number
): uPlot.Options {
  const scales: uPlot.Scales = {
    x: { time: false, auto: false, range: [-windowSec, 0] }
  }
  const axes: uPlot.Axis[] = [
    {
      scale: 'x',
      stroke: AXIS_STROKE,
      ticks: { stroke: GRID_STROKE },
      grid: { stroke: GRID_STROKE, width: 1 },
      values: (_u, splits) => splits.map((value) => `${Math.round(value)}s`)
    }
  ]
  const series: uPlot.Series[] = [{}]
  labels.forEach((label, index) => {
    const scale = `y${index}`
    const color = colors[index] ?? '#40c4ff'
    scales[scale] = { auto: true }
    series.push({
      label,
      scale,
      stroke: color,
      width: 1.6,
      spanGaps: true
    })
    axes.push({
      scale,
      stroke: color,
      ticks: { stroke: color },
      grid: { show: index === 0, stroke: GRID_STROKE, width: 1 },
      size: 46
    })
  })
  return {
    width: Math.max(120, width),
    height: Math.max(160, height),
    scales,
    series,
    axes,
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    padding: [8, 12, 4, 4]
  }
}

export function GraphPlot({
  store,
  generation,
  selected,
  paused,
  hz,
  emptyHint
}: GraphPlotProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const target = wrapRef.current
    if (!target) {
      return
    }

    const bundle = store.uplotBundle()
    const width = target.clientWidth || 640
    const height = target.clientHeight || 320
    const plot = new uPlot(
      buildOptions(width, height, bundle.labels, bundle.colors, store.windowSec),
      bundle.data as uPlot.AlignedData,
      target
    )
    plotRef.current = plot

    const observer = new ResizeObserver(() => {
      const next = wrapRef.current
      if (!next || !plotRef.current) {
        return
      }
      plotRef.current.setSize({
        width: Math.max(120, next.clientWidth),
        height: Math.max(160, next.clientHeight)
      })
    })
    observer.observe(target)

    const interval = window.setInterval(() => {
      if (pausedRef.current || !plotRef.current) {
        return
      }
      const next = store.uplotBundle()
      plotRef.current.setData(next.data as uPlot.AlignedData)
    }, graphRedrawIntervalMs(hz))

    return () => {
      window.clearInterval(interval)
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [store, selected.join('|'), store.windowSec, hz])

  useEffect(() => {
    if (paused || !plotRef.current) {
      return
    }
    plotRef.current.setData(store.uplotBundle().data as uPlot.AlignedData)
  }, [generation, paused, store])

  if (selected.length === 0) {
    return (
      <div className="graph-plot graph-plot-empty">
        <p className="muted">
          {emptyHint ?? 'Select DBC signals on the left to plot live series.'}
        </p>
      </div>
    )
  }

  return (
    <div className="graph-plot" style={{ background: BG }}>
      <div ref={wrapRef} className="graph-uplot" />
    </div>
  )
}
