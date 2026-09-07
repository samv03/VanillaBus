/** Stable Graph series identity: DBC message + signal name. */

export function graphSignalKey(messageName: string, signalName: string): string {
  return `${messageName}.${signalName}`
}

/** High-contrast series strokes matching the locked Graph mockup. */
export const GRAPH_SERIES_COLORS = [
  '#40c4ff',
  '#ffab40',
  '#ab47bc',
  '#66bb6a',
  '#ef5350',
  '#26c6da',
  '#ffee58',
  '#8d6e63'
] as const

export function graphSeriesColor(index: number): string {
  const color = GRAPH_SERIES_COLORS[index % GRAPH_SERIES_COLORS.length]
  return color ?? GRAPH_SERIES_COLORS[0]
}
