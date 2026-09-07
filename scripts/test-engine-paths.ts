import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  isPackagedElectron,
  looksLikeEngineRoot,
  planEngineLaunch,
  resolveEngineRoot,
  resolvePythonBin
} from '../electron/main/enginePaths'

function fakeEngineTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'vanillabus-engine-'))
  const pkg = join(root, 'can_engine')
  mkdirSync(pkg)
  writeFileSync(join(pkg, '__main__.py'), '# test\n')
  return root
}

test('looksLikeEngineRoot requires can_engine/__main__.py', () => {
  const root = fakeEngineTree()
  assert.equal(looksLikeEngineRoot(root), true)
  assert.equal(looksLikeEngineRoot(tmpdir()), false)
})

test('VANILLABUS_ENGINE_ROOT wins over cwd and resources', () => {
  const bundled = fakeEngineTree()
  const override = fakeEngineTree()
  const resourcesPath = mkdtempSync(join(tmpdir(), 'vanillabus-res-'))
  mkdirSync(join(resourcesPath, 'engine'), { recursive: true })
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-cwd-'))
  const resolved = resolveEngineRoot({
    cwd,
    resourcesPath,
    env: { VANILLABUS_ENGINE_ROOT: override }
  })
  assert.equal(resolved, override)
  assert.notEqual(resolved, bundled)
})

test('packaged layout uses resources/engine when the tree is present', () => {
  const engine = fakeEngineTree()
  const resourcesPath = mkdtempSync(join(tmpdir(), 'vanillabus-res-'))
  const bundled = join(resourcesPath, 'engine')
  mkdirSync(bundled, { recursive: true })
  mkdirSync(join(bundled, 'can_engine'))
  writeFileSync(join(bundled, 'can_engine', '__main__.py'), '# bundled\n')
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-cwd-'))
  mkdirSync(join(cwd, 'engine', 'can_engine'), { recursive: true })
  writeFileSync(join(cwd, 'engine', 'can_engine', '__main__.py'), '# cwd\n')

  const resolved = resolveEngineRoot({
    cwd,
    resourcesPath,
    defaultApp: false,
    env: {}
  })
  assert.equal(resolved, bundled)
  assert.notEqual(resolved, engine)
})

test('unpackaged electron (defaultApp) and node tests use cwd/engine', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-cwd-'))
  const expected = join(cwd, 'engine')
  assert.equal(
    resolveEngineRoot({
      cwd,
      resourcesPath: '/opt/Electron/resources',
      defaultApp: true,
      env: {}
    }),
    expected
  )
  assert.equal(resolveEngineRoot({ cwd, env: {} }), expected)
})

test('isPackagedElectron is false for node/tsx and electron .', () => {
  assert.equal(isPackagedElectron({ env: {}, resourcesPath: undefined }), false)
  assert.equal(
    isPackagedElectron({
      env: {},
      resourcesPath: '/opt/Electron/resources',
      defaultApp: true
    }),
    false
  )
  assert.equal(
    isPackagedElectron({
      env: { VANILLABUS_DEV: '1' },
      resourcesPath: '/opt/VanillaBus/resources',
      defaultApp: false
    }),
    false
  )
  assert.equal(
    isPackagedElectron({
      env: {},
      resourcesPath: '/opt/VanillaBus/resources',
      defaultApp: false
    }),
    true
  )
})

test('VANILLABUS_PYTHON and packaged XDG venv beat PATH python3', () => {
  assert.equal(resolvePythonBin({ env: { VANILLABUS_PYTHON: '/opt/py/bin/python3' } }), '/opt/py/bin/python3')

  const dataHome = mkdtempSync(join(tmpdir(), 'vanillabus-data-'))
  const venvBin = join(dataHome, 'vanillabus', 'venv', 'bin')
  mkdirSync(venvBin, { recursive: true })
  const venvPython = join(venvBin, 'python3')
  writeFileSync(venvPython, '#!/bin/sh\n')
  writeFileSync(join(venvBin, 'pip'), '#!/bin/sh\n')
  assert.equal(
    resolvePythonBin({
      env: { XDG_DATA_HOME: dataHome },
      resourcesPath: '/opt/VanillaBus/resources',
      defaultApp: false
    }),
    venvPython
  )
  assert.equal(resolvePythonBin({ env: { XDG_DATA_HOME: dataHome } }), 'python3')
  assert.equal(resolvePythonBin({ env: {} }), 'python3')
})

test('incomplete user venv (python symlink, no pip) is ignored', () => {
  const dataHome = mkdtempSync(join(tmpdir(), 'vanillabus-data-'))
  const venvBin = join(dataHome, 'vanillabus', 'venv', 'bin')
  mkdirSync(venvBin, { recursive: true })
  writeFileSync(join(venvBin, 'python3'), '#!/bin/sh\n')
  assert.equal(
    resolvePythonBin({
      env: { XDG_DATA_HOME: dataHome },
      resourcesPath: '/opt/VanillaBus/resources',
      defaultApp: false
    }),
    'python3'
  )
})

test('packaged spawn env sets PYTHONPATH, engine root, and VANILLABUS_ROOT=$HOME', () => {
  const resourcesPath = mkdtempSync(join(tmpdir(), 'vanillabus-res-'))
  const bundled = join(resourcesPath, 'engine')
  mkdirSync(join(bundled, 'can_engine'), { recursive: true })
  writeFileSync(join(bundled, 'can_engine', '__main__.py'), '# bundled\n')
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-cwd-'))
  const home = mkdtempSync(join(tmpdir(), 'vanillabus-home-'))

  const plan = planEngineLaunch({
    cwd,
    resourcesPath,
    defaultApp: false,
    homedir: home,
    env: { PATH: '/usr/bin', PYTHONPATH: '/already' }
  })

  assert.equal(plan.packaged, true)
  assert.equal(plan.engineRoot, bundled)
  assert.equal(plan.pythonBin, 'python3')
  assert.equal(plan.env.VANILLABUS_ENGINE_ROOT, bundled)
  assert.equal(plan.env.VANILLABUS_ROOT, home)
  assert.ok(plan.env.PYTHONPATH?.startsWith(`${bundled}:`))
  assert.ok(plan.env.PYTHONPATH?.endsWith('/already'))
})

test('packaged launch prefers the user venv python when present', () => {
  const resourcesPath = mkdtempSync(join(tmpdir(), 'vanillabus-res-'))
  const bundled = join(resourcesPath, 'engine')
  mkdirSync(join(bundled, 'can_engine'), { recursive: true })
  writeFileSync(join(bundled, 'can_engine', '__main__.py'), '# bundled\n')
  const dataHome = mkdtempSync(join(tmpdir(), 'vanillabus-data-'))
  const venvPython = join(dataHome, 'vanillabus', 'venv', 'bin', 'python3')
  mkdirSync(join(dataHome, 'vanillabus', 'venv', 'bin'), { recursive: true })
  writeFileSync(venvPython, '#!/bin/sh\n')
  writeFileSync(join(dataHome, 'vanillabus', 'venv', 'bin', 'pip'), '#!/bin/sh\n')

  const plan = planEngineLaunch({
    cwd: mkdtempSync(join(tmpdir(), 'vanillabus-cwd-')),
    resourcesPath,
    defaultApp: false,
    homedir: mkdtempSync(join(tmpdir(), 'vanillabus-home-')),
    env: { XDG_DATA_HOME: dataHome, PATH: '/usr/bin' }
  })
  assert.equal(plan.pythonBin, venvPython)
})

test('unpackaged spawn env does not override VANILLABUS_ROOT', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vanillabus-cwd-'))
  const plan = planEngineLaunch({
    cwd,
    defaultApp: true,
    env: { PATH: '/usr/bin' }
  })
  assert.equal(plan.packaged, false)
  assert.equal(plan.engineRoot, join(cwd, 'engine'))
  assert.equal(plan.env.VANILLABUS_ROOT, undefined)
})
