import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveWindowIcon } from '../electron/main/appIcon'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  assert.deepEqual(buf.subarray(0, 8), PNG_SIG)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('build/icon.png is a square PNG at least 512px', () => {
  const size = readPngSize(join(process.cwd(), 'build', 'icon.png'))
  assert.equal(size.width, size.height)
  assert.ok(size.width >= 512, `expected >= 512, got ${size.width}`)
})

test('linux icon set includes 512 and 1024 masters', () => {
  const icons = join(process.cwd(), 'build', 'icons')
  assert.deepEqual(readPngSize(join(icons, '512x512.png')), { width: 512, height: 512 })
  assert.deepEqual(readPngSize(join(icons, '1024x1024.png')), { width: 1024, height: 1024 })
})

test('resolveWindowIcon prefers repo build/icon.png when unpackaged', () => {
  const cwd = process.cwd()
  const path = resolveWindowIcon({
    cwd,
    env: { VANILLABUS_DEV: '1' },
    resourcesPath: '/opt/Electron/resources',
    defaultApp: true
  })
  assert.equal(path, join(cwd, 'build', 'icon.png'))
})

test('resolveWindowIcon uses resources/icon.png when packaged', () => {
  const resourcesPath = mkdtempSync(join(tmpdir(), 'vanillabus-res-icon-'))
  const packaged = join(resourcesPath, 'icon.png')
  writeFileSync(packaged, 'x')
  const path = resolveWindowIcon({
    cwd: mkdtempSync(join(tmpdir(), 'vanillabus-cwd-icon-')),
    env: {},
    resourcesPath,
    defaultApp: false
  })
  assert.equal(path, packaged)
})
