/** Tab ids for the T8 shell. Keep in lockstep with `shared/appTabs.ts`. */
export const APP_TABS = Object.freeze(['trace', 'graph', 'transmit'])

export function parseAppTab(hash) {
  const raw = typeof hash === 'string' && hash.startsWith('#') ? hash.slice(1) : hash
  if (raw === 'graph' || raw === 'transmit' || raw === 'trace') {
    return raw
  }
  return 'trace'
}

export function tabHash(tab) {
  return `#${tab}`
}
