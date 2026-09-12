import { existsSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { DbcBrowseResult } from '../../shared/engine'

export type DbcBrowseDialogFilter = {
  readonly name: string
  readonly extensions: readonly string[]
}

export type DbcBrowseDialogOptions = {
  readonly title: string
  readonly properties: readonly ['openFile']
  readonly filters: readonly DbcBrowseDialogFilter[]
  readonly defaultPath: string
}

export type DbcBrowseDialogResult = {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

export const DBC_BROWSE_FILTERS: readonly DbcBrowseDialogFilter[] = [
  { name: 'DBC files', extensions: ['dbc'] },
  { name: 'All files', extensions: ['*'] }
]

export type DbcBrowsePathOptions = {
  readonly cwd?: string
  readonly home?: string
}

/**
 * Prefer the current field (file or its directory), then repo fixtures in
 * unpackaged dev, then $HOME (packaged allowlist root).
 */
export function resolveDbcBrowseDefaultPath(
  currentPath?: string,
  options: DbcBrowsePathOptions = {}
): string {
  const cwd = options.cwd ?? process.cwd()
  const home = options.home ?? osHomedir()
  const text = currentPath?.trim() ?? ''
  if (text.length > 0) {
    const candidate = isAbsolute(text) ? text : join(cwd, text)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(candidate)
    if (parent !== candidate && existsSync(parent)) {
      return parent
    }
  }
  const fixtures = join(cwd, 'fixtures', 'dbc')
  if (existsSync(fixtures)) {
    return fixtures
  }
  return home
}

export function dbcBrowseDialogOptions(
  currentPath?: string,
  options: DbcBrowsePathOptions = {}
): DbcBrowseDialogOptions {
  return {
    title: 'Open DBC',
    properties: ['openFile'],
    filters: DBC_BROWSE_FILTERS,
    defaultPath: resolveDbcBrowseDefaultPath(currentPath, options)
  }
}

export function mapDbcBrowseDialogResult(result: DbcBrowseDialogResult): DbcBrowseResult {
  const path = result.filePaths[0]
  if (result.canceled || typeof path !== 'string' || path.length === 0) {
    return { ok: false, cancelled: true }
  }
  return { ok: true, path }
}
