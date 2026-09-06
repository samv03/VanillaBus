/**
 * Typed facade for the T8 tab helpers.
 * Runtime lives in `appTabs.mjs` so `node scripts/test-shell-tabs.mjs` can
 * import it without tsx or `node --test`.
 */
export type AppTab = 'trace' | 'graph' | 'transmit'

export { APP_TABS, parseAppTab, tabHash } from './appTabs.mjs'
