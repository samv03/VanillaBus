import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter, join } from 'node:path'
import type {
  BusCloseOk,
  BusInterface,
  BusListOk,
  BusOpenOk,
  EngineHello,
  EngineStatus,
  RxBatch
} from '../../shared/engine'
import { EngineClient, EngineRequestError } from './engineClient'
import { createIpcSocketPath } from './ipcPath'

const RESTART_DELAY_MS = 750
const CONNECT_ATTEMPTS = 40
const CONNECT_GAP_MS = 100

export type StatusListener = (status: EngineStatus) => void
export type RxBatchListener = (batch: RxBatch) => void

function repoRoot(): string {
  return process.cwd()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export class EngineSupervisor {
  private child: ChildProcess | null = null
  private client: EngineClient | null = null
  private ipcPath: string | null = null
  private generation = 0
  private heartbeatLogGeneration = -1
  private stopping = false
  private restartTimer: NodeJS.Timeout | null = null
  private status: EngineStatus = { connected: false, hello: null }
  private readonly listeners = new Set<StatusListener>()
  private readonly rxListeners = new Set<RxBatchListener>()

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onRxBatch(listener: RxBatchListener): () => void {
    this.rxListeners.add(listener)
    return () => {
      this.rxListeners.delete(listener)
    }
  }

  getStatus(): EngineStatus {
    return this.status
  }

  async listBuses(): Promise<BusListOk> {
    const payload = await this.request('bus.list')
    const interfaces = parseInterfaces(payload.interfaces)
    if (interfaces === null) {
      throw new EngineRequestError('invalid_payload', 'bus.list response missing interfaces')
    }
    return { ok: true, interfaces }
  }

  async openBus(name: string, bitrate?: number): Promise<BusOpenOk> {
    const payload: Record<string, unknown> = { name }
    if (typeof bitrate === 'number') {
      payload.bitrate = bitrate
    }
    const result = await this.request('bus.open', payload)
    if (typeof result.busId !== 'string' || result.busId.length === 0) {
      throw new EngineRequestError('invalid_payload', 'bus.open response missing busId')
    }
    return { ok: true, busId: result.busId }
  }

  async closeBus(busId: string): Promise<BusCloseOk> {
    await this.request('bus.close', { busId })
    return { ok: true }
  }

  private request(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const client = this.client
    if (!client || !this.status.connected) {
      return Promise.reject(new EngineRequestError('engine_disconnected', 'engine is not connected'))
    }
    return client.request(type, payload)
  }

  /** Live engine PID, or null if no child is running. Used by the disconnect test. */
  getEnginePid(): number | null {
    const pid = this.child?.pid
    return typeof pid === 'number' ? pid : null
  }

  start(): void {
    if (process.platform !== 'linux') {
      console.warn('[vanillabus] engine IPC is Linux-only')
      return
    }
    this.stopping = false
    void this.launch()
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.generation += 1
    this.teardownClient()
    this.killChild()
    this.setStatus({ connected: false, hello: null })
  }

  private setStatus(next: EngineStatus): void {
    this.status = next
    for (const listener of this.listeners) {
      listener(next)
    }
  }

  private async launch(): Promise<void> {
    if (this.stopping) {
      return
    }

    const generation = ++this.generation
    this.teardownClient()
    this.killChild()

    try {
      this.ipcPath = createIpcSocketPath(process.pid)
    } catch (error) {
      console.error('[vanillabus] cannot create IPC path', error)
      this.scheduleRestart()
      return
    }

    const root = repoRoot()
    const engineRoot = join(root, 'engine')
    const pythonPath = [engineRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
    const args = ['-m', 'can_engine', '--ipc', this.ipcPath]

    console.log(`[vanillabus] spawning engine --ipc ${this.ipcPath}`)
    const child = spawn('python3', args, {
      cwd: root,
      env: { ...process.env, PYTHONPATH: pythonPath },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd()
      if (text) {
        console.log(`[engine] ${text}`)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd()
      if (text) {
        console.warn(`[engine] ${text}`)
      }
    })

    child.on('error', (error) => {
      console.error('[vanillabus] failed to spawn engine', error)
    })

    child.on('exit', (code, signal) => {
      if (generation !== this.generation) {
        return
      }
      console.warn(`[vanillabus] engine disconnected (exit code=${code} signal=${signal}); respawning`)
      this.teardownClient()
      this.setStatus({ connected: false, hello: null })
      this.scheduleRestart()
    })

    try {
      await this.connectWithRetry(generation)
    } catch (error) {
      if (generation !== this.generation || this.stopping) {
        return
      }
      console.warn('[vanillabus] engine connect failed', error)
      this.killChild()
    }
  }

  private async connectWithRetry(generation: number): Promise<void> {
    if (!this.ipcPath) {
      throw new Error('IPC path missing')
    }

    let lastError: unknown
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
      if (this.stopping || generation !== this.generation) {
        return
      }
      try {
        await this.attachClient(this.ipcPath, generation)
        return
      } catch (error) {
        lastError = error
        await sleep(CONNECT_GAP_MS)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('engine connect timed out')
  }

  private async attachClient(path: string, generation: number): Promise<void> {
    const client = new EngineClient(
      (hello: EngineHello) => {
        if (generation !== this.generation) {
          return
        }
        console.log('[vanillabus] engine.hello', hello)
        this.setStatus({ connected: true, hello })
      },
      (tsUs: number) => {
        if (generation !== this.generation) {
          return
        }
        // Receive every beat; log once per connection so disconnect/respawn stays visible.
        if (this.heartbeatLogGeneration !== generation) {
          this.heartbeatLogGeneration = generation
          console.log(`[vanillabus] engine.heartbeat ts_us=${tsUs}`)
        }
      },
      (reason: string) => {
        if (generation !== this.generation || this.stopping) {
          return
        }
        console.warn(`[vanillabus] engine IPC ${reason}; respawning`)
        this.setStatus({ connected: false, hello: null })
        this.killChild()
      },
      (batch: RxBatch) => {
        if (generation !== this.generation) {
          return
        }
        for (const listener of this.rxListeners) {
          listener(batch)
        }
      }
    )

    try {
      await client.connect(path)
    } catch (error) {
      client.close()
      throw error
    }
    this.client = client
    client.sendHello()
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) {
      return
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.launch()
    }, RESTART_DELAY_MS)
  }

  private teardownClient(): void {
    this.client?.close()
    this.client = null
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    if (!child || child.killed || child.exitCode !== null) {
      return
    }
    child.kill('SIGTERM')
  }
}

function parseInterfaces(raw: unknown): BusInterface[] | null {
  if (!Array.isArray(raw)) {
    return null
  }
  const interfaces: BusInterface[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string' || record.name.length === 0) {
      continue
    }
    const state = record.state === 'up' || record.state === 'down' ? record.state : 'down'
    interfaces.push({
      name: record.name,
      kind: typeof record.kind === 'string' && record.kind.length > 0 ? record.kind : 'socketcan',
      state
    })
  }
  return interfaces
}
