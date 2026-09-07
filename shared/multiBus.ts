/**
 * T14 helpers for several concurrently open buses.
 * Pure — safe in renderer, tests, and Node without Electron.
 */

export type NamedOpenBus = {
  readonly busId: string
  readonly name: string
}

export function findOpenedByName<T extends NamedOpenBus>(
  opened: readonly T[],
  name: string
): T | undefined {
  return opened.find((item) => item.name === name)
}

export function formatBusOptionLabel(
  name: string,
  meta: { readonly kind?: string; readonly state?: string } | undefined,
  open: boolean
): string {
  const bits: string[] = []
  if (meta?.kind && meta.state) {
    bits.push(`${meta.kind}, ${meta.state}`)
  }
  if (open) {
    bits.push('open')
  }
  return bits.length > 0 ? `${name} (${bits.join(', ')})` : name
}

/** After closing busId, keep the current selection if it is still open. */
export function remainingSelectedBus(
  opened: readonly NamedOpenBus[],
  closedBusId: string,
  selectedName: string
): string {
  const remaining = opened.filter((item) => item.busId !== closedBusId)
  if (remaining.some((item) => item.name === selectedName)) {
    return selectedName
  }
  return remaining[0]?.name ?? selectedName
}

export function openBusNames(opened: readonly NamedOpenBus[]): readonly string[] {
  return opened.map((item) => item.name)
}
