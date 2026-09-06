import { createConnection, type Socket } from 'node:net'
import type { EngineHello } from '../../shared/engine'
import { encodeMessage, FrameDecoder, ProtocolError } from './framing'

export type { EngineHello, EngineStatus } from '../../shared/engine'

export type EngineMessage = {
  type: string
  id?: string
  payload?: Record<string, unknown>
}

export class EngineRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EngineRequestError'
    this.code = code
  }
}

type PendingRequest = {
  readonly type: string
  readonly resolve: (payload: Record<string, unknown>) => void
  readonly reject: (error: EngineRequestError) => void
  readonly timer: NodeJS.Timeout
}

function asHello(payload: unknown): EngineHello | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const record = payload as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.version !== 'string') {
    return null
  }
  const backends = Array.isArray(record.backends)
    ? record.backends.filter((item): item is string => typeof item === 'string')
    : []
  return { name: record.name, version: record.version, backends }
}

export class EngineClient {
  private socket: Socket | null = null
  private readonly decoder = new FrameDecoder()
  private closed = false
  private requestSeq = 0
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly onHello: (hello: EngineHello) => void,
    private readonly onHeartbeat: (tsUs: number) => void,
    private readonly onDisconnect: (reason: string) => void
  ) {}

  connect(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path })
      this.socket = socket
      let opened = false

      const onReady = (): void => {
        opened = true
        socket.off('error', onError)
        socket.on('error', (error) => {
          console.warn('[vanillabus] engine socket error', error)
        })
        resolve()
      }
      const onError = (error: Error): void => {
        socket.off('connect', onReady)
        reject(error)
      }

      socket.once('connect', onReady)
      socket.once('error', onError)

      socket.on('data', (chunk) => {
        try {
          for (const message of this.decoder.push(chunk)) {
            this.dispatch(message)
          }
        } catch (error) {
          const reason =
            error instanceof ProtocolError
              ? `${error.code}: ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error)
          console.warn('[vanillabus] dropping engine frames:', reason)
          this.close()
        }
      })

      socket.on('close', () => {
        if (this.closed) {
          return
        }
        this.closed = true
        this.rejectPending('engine_disconnected', 'engine connection closed')
        // Connect failures retry; only a live session should trigger respawn.
        if (opened) {
          this.onDisconnect('socket closed')
        }
      })
    })
  }

  sendHello(id = 'hello'): void {
    this.send({ type: 'engine.hello', id, payload: {} })
  }

  request(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 8000
  ): Promise<Record<string, unknown>> {
    if (!this.socket || this.socket.destroyed || this.closed) {
      return Promise.reject(new EngineRequestError('engine_disconnected', 'engine is not connected'))
    }
    const id = `req-${++this.requestSeq}-${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new EngineRequestError('timeout', `${type} timed out`))
      }, timeoutMs)
      this.pending.set(id, { type, resolve, reject, timer })
      try {
        this.send({ type, id, payload })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        const message = error instanceof Error ? error.message : String(error)
        reject(new EngineRequestError('send_failed', message))
      }
    })
  }

  send(message: EngineMessage): void {
    if (!this.socket || this.socket.destroyed) {
      return
    }
    this.socket.write(encodeMessage(message))
  }

  close(): void {
    this.closed = true
    this.decoder.reset()
    this.rejectPending('engine_disconnected', 'engine connection closed')
    const socket = this.socket
    this.socket = null
    if (socket && !socket.destroyed) {
      socket.destroy()
    }
  }

  private rejectPending(code: string, message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new EngineRequestError(code, message))
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const type = message.type
    const id = typeof message.id === 'string' ? message.id : undefined
    const payload =
      message.payload !== null && typeof message.payload === 'object' && !Array.isArray(message.payload)
        ? (message.payload as Record<string, unknown>)
        : undefined

    if (typeof type === 'string' && id && this.pending.has(id)) {
      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        if (type === 'engine.error') {
          const code = typeof payload?.code === 'string' ? payload.code : 'engine_error'
          const text = typeof payload?.message === 'string' ? payload.message : 'engine.error'
          pending.reject(new EngineRequestError(code, text))
          return
        }
        if (type !== pending.type) {
          pending.reject(
            new EngineRequestError('unexpected_type', `expected ${pending.type}, got ${type}`)
          )
          return
        }
        pending.resolve(payload ?? {})
        return
      }
    }

    if (type === 'engine.hello') {
      const hello = asHello(payload)
      if (hello) {
        this.onHello(hello)
      }
      return
    }

    if (type === 'engine.heartbeat') {
      const tsUs = payload?.ts_us
      if (typeof tsUs === 'number') {
        this.onHeartbeat(tsUs)
      }
      return
    }

    if (type === 'engine.error') {
      console.warn('[vanillabus] engine.error', payload)
    }
  }
}
