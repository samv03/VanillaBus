/**
 * T8 hash-tab smoke. No tsx, no `node --test` / `node:test`.
 * Runnable as: node scripts/test-shell-tabs.mjs
 */
import { parseAppTab, tabHash } from '../shared/appTabs.mjs'

function loadAssert() {
  return import('node:assert/strict')
    .then((mod) => mod.default || mod)
    .catch(() =>
      import('assert').then((mod) => {
        const loaded = mod.default || mod
        return loaded.strict || loaded
      })
    )
}

function run(assert) {
  assert.equal(parseAppTab(''), 'trace')
  assert.equal(parseAppTab('#'), 'trace')
  assert.equal(parseAppTab('#unknown'), 'trace')
  assert.equal(parseAppTab('#trace'), 'trace')
  assert.equal(parseAppTab('#graph'), 'graph')
  assert.equal(parseAppTab('#transmit'), 'transmit')
  assert.equal(parseAppTab('graph'), 'graph')
  assert.equal(tabHash('transmit'), '#transmit')
}

loadAssert()
  .then((assert) => {
    run(assert)
    console.log('PASS')
    process.exit(0)
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
