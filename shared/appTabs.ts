export const APP_TABS = ['trace', 'graph', 'transmit'] as const

export type AppTab = (typeof APP_TABS)[number]

export function parseAppTab(hash: string): AppTab {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw === 'graph' || raw === 'transmit' || raw === 'trace') {
    return raw
  }
  return 'trace'
}

export function tabHash(tab: AppTab): string {
  return `#${tab}`
}
