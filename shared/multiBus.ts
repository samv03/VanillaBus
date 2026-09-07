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
  meta:
    | {
        readonly kind?: string
        readonly state?: string
        readonly vendor?: string
        readonly blacklist?: boolean
      }
    | undefined,
  open: boolean
): string {
  const bits: string[] = []
  if (meta?.kind && meta.state) {
    bits.push(`${meta.kind}, ${meta.state}`)
  }
  if (meta?.vendor && meta.vendor !== 'unknown' && meta.vendor !== 'virtual' && meta.vendor !== meta.kind) {
    bits.push(meta.vendor)
  }
  if (meta?.blacklist) {
    bits.push('blacklisted')
  }
  if (open) {
    bits.push('open')
  }
  return bits.length > 0 ? `${name} (${bits.join(', ')})` : name
}

export function formatVendorHint(meta: {
  readonly kind?: string
  readonly vendor?: string
  readonly module?: string
  readonly driver?: string
} | undefined): string | null {
  if (!meta) {
    return null
  }
  const driver = meta.driver || meta.kind
  if (!driver || meta.vendor === 'virtual') {
    return null
  }
  if (meta.vendor && meta.vendor !== 'unknown' && meta.vendor !== driver) {
    return `${meta.vendor} · ${driver}`
  }
  return driver
}

export function busBlacklistWarning(
  interfaces: readonly { readonly blacklist?: boolean; readonly blacklist_reason?: string }[],
  warnings?: readonly { readonly message: string }[]
): string | null {
  const ifaceHit = interfaces.find((item) => item.blacklist)
  if (ifaceHit?.blacklist_reason) {
    return ifaceHit.blacklist_reason
  }
  if (warnings && warnings.length > 0) {
    return warnings[0].message
  }
  if (ifaceHit?.blacklist) {
    return 'A vendor SDK has blacklisted the mainline SocketCAN driver. See docs/socketcan-vendors.md.'
  }
  return null
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
