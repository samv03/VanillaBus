import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DBC_BROWSE_FILTERS,
  dbcBrowseDialogOptions,
  mapDbcBrowseDialogResult,
  resolveDbcBrowseDefaultPath
} from '../electron/main/dbcBrowse'

test('browse filters include *.dbc and all files', () => {
  assert.deepEqual(DBC_BROWSE_FILTERS, [
    { name: 'DBC files', extensions: ['dbc'] },
    { name: 'All files', extensions: ['*'] }
  ])
})

test('dialog options are openFile with a default path', () => {
  const home = mkdtempSync(join(tmpdir(), 'vanillabus-browse-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-browse-cwd-'))
  const options = dbcBrowseDialogOptions(undefined, { cwd, home })
  assert.equal(options.title, 'Open DBC')
  assert.deepEqual(options.properties, ['openFile'])
  assert.equal(options.filters[0]?.extensions[0], 'dbc')
  assert.equal(options.defaultPath, home)
})

test('default path prefers an existing current file, then fixtures, then home', () => {
  const home = mkdtempSync(join(tmpdir(), 'vanillabus-browse-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-browse-cwd-'))
  assert.equal(resolveDbcBrowseDefaultPath(undefined, { cwd, home }), home)

  const fixtures = join(cwd, 'fixtures', 'dbc')
  mkdirSync(fixtures, { recursive: true })
  assert.equal(resolveDbcBrowseDefaultPath(undefined, { cwd, home }), fixtures)

  const relative = join('fixtures', 'dbc', 'sample.dbc')
  writeFileSync(join(cwd, relative), 'VERSION ""\n')
  assert.equal(resolveDbcBrowseDefaultPath(relative, { cwd, home }), join(cwd, relative))

  const missing = join(cwd, 'fixtures', 'dbc', 'missing.dbc')
  assert.equal(resolveDbcBrowseDefaultPath(missing, { cwd, home }), fixtures)
})

test('mapDbcBrowseDialogResult treats cancel and empty as cancelled', () => {
  assert.deepEqual(mapDbcBrowseDialogResult({ canceled: true, filePaths: [] }), {
    ok: false,
    cancelled: true
  })
  assert.deepEqual(mapDbcBrowseDialogResult({ canceled: false, filePaths: [] }), {
    ok: false,
    cancelled: true
  })
  assert.deepEqual(mapDbcBrowseDialogResult({ canceled: false, filePaths: ['/home/sam/car.dbc'] }), {
    ok: true,
    path: '/home/sam/car.dbc'
  })
})
