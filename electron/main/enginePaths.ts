import { existsSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const ENGINE_MAIN = join('can_engine', '__main__.py')

export type EngineLaunchPlan = {
  pythonBin: string
  engineRoot: string
  cwd: string
  env: NodeJS.ProcessEnv
  packaged: boolean
}

export type EnginePathOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  resourcesPath?: string | undefined
  defaultApp?: boolean
  homedir?: string
}

type ElectronProcess = NodeJS.Process & {
  resourcesPath?: string
  defaultApp?: boolean
}

function electronProcess(): ElectronProcess {
  return process as ElectronProcess
}

export function looksLikeEngineRoot(dir: string): boolean {
  return existsSync(join(dir, ENGINE_MAIN))
}

export function readResourcesPath(): string | undefined {
  const value = electronProcess().resourcesPath
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function isPackagedElectron(options: EnginePathOptions = {}): boolean {
  const env = options.env ?? process.env
  if (env.VANILLABUS_DEV === '1') {
    return false
  }
  const resourcesPath = options.resourcesPath ?? readResourcesPath()
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) {
    return false
  }
  const defaultApp = options.defaultApp ?? electronProcess().defaultApp === true
  return defaultApp !== true
}

export function resolveEngineRoot(options: EnginePathOptions = {}): string {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const override = env.VANILLABUS_ENGINE_ROOT?.trim()
  if (override) {
    return resolve(override)
  }

  const resourcesPath = options.resourcesPath ?? readResourcesPath()
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    const bundled = join(resourcesPath, 'engine')
    if (looksLikeEngineRoot(bundled)) {
      return bundled
    }
  }

  return join(cwd, 'engine')
}

export function resolvePythonBin(options: EnginePathOptions = {}): string {
  const env = options.env ?? process.env
  const override = env.VANILLABUS_PYTHON?.trim()
  if (override) {
    return override
  }

  // User venv is a packaged-app convenience. Unpackaged `npm run dev` / tests
  // keep using PATH python3 so a leftover venv cannot shadow the checkout.
  if (isPackagedElectron(options) || env.VANILLABUS_USE_USER_VENV === '1') {
    const dataHome =
      env.XDG_DATA_HOME?.trim() ||
      (env.HOME && env.HOME.length > 0 ? join(env.HOME, '.local', 'share') : '')
    if (dataHome) {
      const venvPython = join(dataHome, 'vanillabus', 'venv', 'bin', 'python3')
      if (existsSync(venvPython)) {
        return venvPython
      }
    }
  }

  return 'python3'
}

export function planEngineLaunch(options: EnginePathOptions = {}): EngineLaunchPlan {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const packaged = isPackagedElectron(options)
  const engineRoot = resolveEngineRoot(options)
  const pythonBin = resolvePythonBin(options)
  const home = options.homedir ?? osHomedir()

  const spawnEnv: NodeJS.ProcessEnv = { ...env }
  const pythonPathParts = [engineRoot, spawnEnv.PYTHONPATH].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  spawnEnv.PYTHONPATH = pythonPathParts.join(delimiter)
  spawnEnv.VANILLABUS_ENGINE_ROOT = engineRoot

  if (packaged && !(spawnEnv.VANILLABUS_ROOT && spawnEnv.VANILLABUS_ROOT.trim().length > 0)) {
    // DBC allowlist is project_root (+ fixtures). Packaged sources live under
    // resources/engine, which is not the user's DBC tree — use $HOME.
    spawnEnv.VANILLABUS_ROOT = home
  }

  return {
    pythonBin,
    engineRoot,
    cwd,
    env: spawnEnv,
    packaged
  }
}
