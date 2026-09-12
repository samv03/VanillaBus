import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isPackagedElectron, readResourcesPath, type EnginePathOptions } from './enginePaths'

/**
 * Window / taskbar icon. Packaged builds copy build/icon.png to
 * resources/icon.png. Unpackaged `npm run dev` / `electron .` use the
 * repo master at build/icon.png.
 */
export function resolveWindowIcon(options: EnginePathOptions = {}): string | undefined {
  const cwd = options.cwd ?? process.cwd()
  const resourcesPath = options.resourcesPath ?? readResourcesPath()
  const candidates: string[] = []
  if (isPackagedElectron(options) && resourcesPath) {
    candidates.push(join(resourcesPath, 'icon.png'))
  }
  candidates.push(join(cwd, 'build', 'icon.png'))
  if (typeof __dirname === 'string' && __dirname.length > 0) {
    candidates.push(join(__dirname, '..', '..', 'build', 'icon.png'))
  }
  if (resourcesPath) {
    candidates.push(join(resourcesPath, 'icon.png'))
  }
  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }
  return undefined
}
