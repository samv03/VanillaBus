import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAppTab, tabHash } from '../shared/appTabs'

test('parseAppTab reads Trace / Graph / Transmit from the URL hash', () => {
  assert.equal(parseAppTab(''), 'trace')
  assert.equal(parseAppTab('#'), 'trace')
  assert.equal(parseAppTab('#unknown'), 'trace')
  assert.equal(parseAppTab('#trace'), 'trace')
  assert.equal(parseAppTab('#graph'), 'graph')
  assert.equal(parseAppTab('#transmit'), 'transmit')
  assert.equal(parseAppTab('graph'), 'graph')
  assert.equal(tabHash('transmit'), '#transmit')
})
