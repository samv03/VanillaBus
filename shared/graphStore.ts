import {
  catalogEntriesFromDbc,
  catalogEntriesFromDecode,
  mergeCatalogEntry,
  numericDecodeSignals,
  type GraphCatalogEntry
} from './graphCatalog'
import { shouldReplaceLastSample, type DecimatePoint } from './graphDecimate'
import { graphSeriesColor, graphSignalKey } from './graphKeys'
import { computeSeriesStats, type GraphLegendStats } from './graphStats'
import {
  GRAPH_DEFAULT_HZ,
  GRAPH_DEFAULT_WINDOW_SEC,
  clampGraphHz,
  graphSampleIntervalUs,
  maxSamplesForWindow,
  windowStartUs,
  type GraphWindowSec
} from './graphWindow'
import type { DbcCatalogMessage, FrameEvent, RxBatch } from './engine'

export type GraphSample = DecimatePoint

export type GraphLegendRow = {
  readonly key: string
  readonly color: string
  readonly signalName: string
  readonly messageName: string
  readonly unit: string
  readonly stats: GraphLegendStats
}

export type GraphUplotBundle = {
  readonly labels: readonly string[]
  readonly colors: readonly string[]
  readonly data: ReadonlyArray<Array<number | null>>
}

class SeriesBuffer {
  samples: GraphSample[] = []
  private binStartUs: number | null = null

  append(tsUs: number, value: number, intervalUs: number): void {
    const last = this.samples[this.samples.length - 1]
    if (last && tsUs < last.ts_us) {
      return
    }
    if (shouldReplaceLastSample(this.binStartUs, tsUs, intervalUs)) {
      this.samples[this.samples.length - 1] = { ts_us: tsUs, value }
      return
    }
    this.samples.push({ ts_us: tsUs, value })
    this.binStartUs = tsUs
  }

  trim(startUs: number): void {
    let index = 0
    while (index < this.samples.length && this.samples[index]!.ts_us < startUs) {
      index += 1
    }
    if (index > 0) {
      this.samples = this.samples.slice(index)
    }
    if (this.samples.length === 0) {
      this.binStartUs = null
    }
  }

  clear(): void {
    this.samples = []
    this.binStartUs = null
  }
}

/**
 * Memory-bounded Graph series store.
 * Ingests full-rate rx.batch, keeps 10–30 Hz samples inside the time window.
 * Pause discards new samples without touching Trace.
 */
export class GraphStore {
  windowSec: GraphWindowSec = GRAPH_DEFAULT_WINDOW_SEC
  hz: number = GRAPH_DEFAULT_HZ
  paused = false
  engineDropped = 0
  messageCount = 0
  errorCount = 0
  updatedUs: number | null = null

  private readonly recentTs: number[] = []
  private readonly series = new Map<string, SeriesBuffer>()
  private readonly catalog = new Map<string, GraphCatalogEntry>()
  private readonly selected: string[] = []
  private readonly colors = new Map<string, string>()
  private colorIndex = 0
  private nowUs = 0
  private pausedNowUs: number | null = null

  setPaused(next: boolean): void {
    this.paused = next
    this.pausedNowUs = next ? this.plotNowUs() : null
  }

  setWindowSec(next: GraphWindowSec): void {
    this.windowSec = next
    this.trimAll()
  }

  setHz(next: number): void {
    this.hz = clampGraphHz(next)
    this.trimAll()
  }

  applyDbcCatalog(messages: readonly DbcCatalogMessage[]): void {
    const incoming = catalogEntriesFromDbc(messages)
    const next = new Map<string, GraphCatalogEntry>()
    for (const entry of incoming) {
      next.set(entry.key, mergeCatalogEntry(this.catalog.get(entry.key), entry))
    }
    for (const [key, entry] of this.catalog) {
      if (next.has(key)) {
        continue
      }
      if (entry.seen || this.selected.includes(key)) {
        next.set(key, entry)
      }
    }
    this.catalog.clear()
    for (const [key, entry] of next) {
      this.catalog.set(key, entry)
    }
  }

  setSelected(keys: readonly string[]): void {
    this.selected.length = 0
    const seen = new Set<string>()
    for (const key of keys) {
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      this.selected.push(key)
      this.ensureColor(key)
    }
  }

  toggleSelected(key: string): void {
    const index = this.selected.indexOf(key)
    if (index >= 0) {
      this.selected.splice(index, 1)
      return
    }
    this.selected.push(key)
    this.ensureColor(key)
  }

  selectedKeys(): readonly string[] {
    return this.selected
  }

  catalogEntries(): GraphCatalogEntry[] {
    return [...this.catalog.values()]
  }

  colorFor(key: string): string | null {
    return this.colors.get(key) ?? null
  }

  samples(key: string): readonly GraphSample[] {
    return this.series.get(key)?.samples ?? []
  }

  sampleCount(key: string): number {
    return this.series.get(key)?.samples.length ?? 0
  }

  maxSeriesLength(): number {
    let max = 0
    for (const buffer of this.series.values()) {
      if (buffer.samples.length > max) {
        max = buffer.samples.length
      }
    }
    return max
  }

  appendBatch(batch: RxBatch): void {
    this.engineDropped = batch.dropped
    if (this.paused || batch.frames.length === 0) {
      return
    }
    for (const frame of batch.frames) {
      this.ingestFrame(frame)
    }
    this.trimAll()
  }

  liveRate(): number | null {
    if (this.recentTs.length === 0) {
      return null
    }
    const newest = this.recentTs[this.recentTs.length - 1]!
    const cutoff = newest - 1_000_000
    let count = 0
    for (let index = this.recentTs.length - 1; index >= 0; index -= 1) {
      if (this.recentTs[index]! < cutoff) {
        break
      }
      count += 1
    }
    return count
  }

  clearSamples(): void {
    for (const buffer of this.series.values()) {
      buffer.clear()
    }
    this.messageCount = 0
    this.errorCount = 0
    this.updatedUs = null
    this.recentTs.length = 0
  }

  reset(): void {
    this.paused = false
    this.pausedNowUs = null
    this.windowSec = GRAPH_DEFAULT_WINDOW_SEC
    this.hz = GRAPH_DEFAULT_HZ
    this.engineDropped = 0
    this.series.clear()
    this.catalog.clear()
    this.selected.length = 0
    this.colors.clear()
    this.colorIndex = 0
    this.nowUs = 0
    this.clearSamples()
  }

  plotNowUs(): number {
    if (this.paused && this.pausedNowUs !== null) {
      return this.pausedNowUs
    }
    return this.nowUs
  }

  legendRows(): GraphLegendRow[] {
    return this.selected.map((key) => {
      const entry = this.catalog.get(key)
      return {
        key,
        color: this.ensureColor(key),
        signalName: entry?.signalName ?? key,
        messageName: entry?.messageName ?? key.split('.')[0] ?? key,
        unit: entry?.unit ?? '',
        stats: computeSeriesStats(this.samples(key))
      }
    })
  }

  uplotBundle(nowUs = this.plotNowUs()): GraphUplotBundle {
    const labels = this.selected.map((key) => this.catalog.get(key)?.signalName ?? key)
    const colors = this.selected.map((key) => this.ensureColor(key))
    const tsSet = new Set<number>()
    for (const key of this.selected) {
      for (const sample of this.samples(key)) {
        tsSet.add(sample.ts_us)
      }
    }
    const timestamps = [...tsSet].sort((a, b) => a - b)
    const x = timestamps.map((ts) => (ts - nowUs) / 1_000_000)
    const columns: Array<Array<number | null>> = [x]
    for (const key of this.selected) {
      const byTs = new Map<number, number>()
      for (const sample of this.samples(key)) {
        byTs.set(sample.ts_us, sample.value)
      }
      columns.push(timestamps.map((ts) => byTs.get(ts) ?? null))
    }
    return { labels, colors, data: columns }
  }

  capacityBound(): number {
    return maxSamplesForWindow(this.windowSec, this.hz)
  }

  private ingestFrame(frame: FrameEvent): void {
    this.messageCount += 1
    if (frame.is_err) {
      this.errorCount += 1
    }
    this.nowUs = Math.max(this.nowUs, frame.ts_us)
    this.updatedUs = frame.ts_us
    this.recentTs.push(frame.ts_us)
    const cutoff = frame.ts_us - 1_000_000
    while (this.recentTs.length > 0 && this.recentTs[0]! < cutoff) {
      this.recentTs.shift()
    }
    const decode = frame.decode
    if (decode === null) {
      return
    }
    for (const entry of catalogEntriesFromDecode(frame.can_id, decode)) {
      this.catalog.set(entry.key, mergeCatalogEntry(this.catalog.get(entry.key), entry))
    }
    const intervalUs = graphSampleIntervalUs(this.hz)
    for (const [signalName, value] of numericDecodeSignals(decode)) {
      const key = graphSignalKey(decode.name, signalName)
      let buffer = this.series.get(key)
      if (!buffer) {
        buffer = new SeriesBuffer()
        this.series.set(key, buffer)
      }
      buffer.append(frame.ts_us, value, intervalUs)
    }
  }

  private trimAll(): void {
    const start = windowStartUs(this.plotNowUs(), this.windowSec)
    for (const buffer of this.series.values()) {
      buffer.trim(start)
    }
  }

  private ensureColor(key: string): string {
    const existing = this.colors.get(key)
    if (existing) {
      return existing
    }
    const color = graphSeriesColor(this.colorIndex)
    this.colorIndex += 1
    this.colors.set(key, color)
    return color
  }
}
