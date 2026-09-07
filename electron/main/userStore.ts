import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_PERSIST,
  PERSIST_FILENAME,
  sanitizePersist,
  type PersistSnapshot
} from '../../shared/persist'

export function persistFilePath(userDataDir: string): string {
  return join(userDataDir, PERSIST_FILENAME)
}

/**
 * JSON UI store under Electron userData (or VANILLABUS_STORE_PATH).
 * Atomic write: temp file + rename. Missing / corrupt files become defaults.
 */
export class UserStore {
  readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  static fromUserData(userDataDir: string): UserStore {
    return new UserStore(persistFilePath(userDataDir))
  }

  load(): PersistSnapshot {
    try {
      const text = readFileSync(this.filePath, 'utf8')
      return sanitizePersist(JSON.parse(text) as unknown)
    } catch {
      return DEFAULT_PERSIST
    }
  }

  save(snapshot: PersistSnapshot): PersistSnapshot {
    const next = sanitizePersist(snapshot)
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const tmp = `${this.filePath}.${process.pid}.tmp`
    const body = `${JSON.stringify(next, null, 2)}\n`
    writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 })
    try {
      renameSync(tmp, this.filePath)
    } catch {
      try {
        unlinkSync(this.filePath)
      } catch {
        // replace if the destination exists and rename cannot overwrite
      }
      renameSync(tmp, this.filePath)
    }
    return next
  }
}
