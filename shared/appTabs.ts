/**
 * Typed facade for the T8 tab helpers.
 * Runtime lives in `appTabs.mjs` so `node --test` can import it without tsx.
 */
export type AppTab = 'trace' | 'graph' | 'transmit'

export { APP_TABS, parseAppTab, tabHash } from './appTabs.mjs'
