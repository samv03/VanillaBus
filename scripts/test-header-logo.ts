/**
 * Header brand mark: concept-A PNGs (not the old CSS “VB” chip).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  assert.deepEqual(buf.subarray(0, 8), PNG_SIG)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('header mark assets are dedicated small concept-A PNGs', () => {
  const assets = join(process.cwd(), 'electron/renderer/src/assets')
  assert.deepEqual(readPngSize(join(assets, 'icon-64.png')), { width: 64, height: 64 })
  assert.deepEqual(readPngSize(join(assets, 'icon-128.png')), { width: 128, height: 128 })
})

test('TopNav uses the concept-A img, not the VB text chip', () => {
  const src = readFileSync(join(process.cwd(), 'electron/renderer/src/shell/TopNav.tsx'), 'utf8')
  assert.match(src, /icon-64\.png/)
  assert.match(src, /icon-128\.png/)
  assert.match(src, /<img[\s\S]*className="app-mark"/)
  assert.doesNotMatch(src, /<span className="app-mark">VB<\/span>/)
})

test('header mark CSS is an image box, not the blue VB chip', () => {
  const css = readFileSync(join(process.cwd(), 'electron/renderer/src/index.css'), 'utf8')
  const block = css.match(/\.app-mark \{[^}]+\}/)?.[0] ?? ''
  assert.match(block, /object-fit/)
  assert.doesNotMatch(block, /#1f6feb/)
  assert.doesNotMatch(block, /background:/)
})

test('vite emits header icons as files (CSP default-src self blocks data:)', () => {
  const cfg = readFileSync(join(process.cwd(), 'electron.vite.config.ts'), 'utf8')
  assert.match(cfg, /assetsInlineLimit:\s*0/)
})
