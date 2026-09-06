export const APP_TABS: readonly ['trace', 'graph', 'transmit']

export type AppTab = (typeof APP_TABS)[number]

export function parseAppTab(hash: string): AppTab

export function tabHash(tab: AppTab): string
