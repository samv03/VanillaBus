import { mkdirSync, mkdtempSync, chmodSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WORLD_WRITABLE = 0o002

function assertPrivateDir(dir: string): void {
  const mode = statSync(dir).mode
  if (mode & WORLD_WRITABLE) {
    throw new Error(
      `refusing world-writable socket directory ${dir} (use XDG_RUNTIME_DIR or a private mkstemp dir)`
    )
  }
}

/**
 * Socket path under XDG_RUNTIME_DIR, or a 0700 mkstemp directory.
 * Never a predictable world-writable /tmp path.
 */
export function createIpcSocketPath(pid: number): string {
  const xdg = process.env.XDG_RUNTIME_DIR
  if (xdg) {
    try {
      assertPrivateDir(xdg)
      const dir = join(xdg, 'vanillabus')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      chmodSync(dir, 0o700)
      assertPrivateDir(dir)
      const path = join(dir, `engine-${pid}.sock`)
      if (existsSync(path)) {
        unlinkSync(path)
      }
      return path
    } catch (error) {
      console.warn('[vanillabus] XDG_RUNTIME_DIR unusable, falling back to mkstemp:', error)
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'vanillabus-'))
  chmodSync(dir, 0o700)
  assertPrivateDir(dir)
  return join(dir, 'engine.sock')
}
