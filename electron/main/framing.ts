/** 4-byte big-endian length + UTF-8 JSON (same as engine/can_engine/framing.py). */

export const MAX_FRAME_BYTES = 1_048_576

export class ProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

export function encodeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProtocolError('payload_too_large', 'encoded JSON exceeds 1 MiB')
  }
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): Record<string, unknown>[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: Record<string, unknown>[] = []

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length <= 0) {
        throw new ProtocolError('invalid_length', `length must be > 0, got ${length}`)
      }
      if (length > MAX_FRAME_BYTES) {
        throw new ProtocolError('payload_too_large', `length ${length} exceeds 1 MiB`)
      }
      if (this.buffer.length < 4 + length) {
        break
      }
      const json = this.buffer.subarray(4, 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(4 + length)
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new ProtocolError('invalid_json', `JSON decode failed: ${detail}`)
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ProtocolError('invalid_message', 'JSON root must be an object')
      }
      const record = parsed as Record<string, unknown>
      if (typeof record.type !== 'string' || record.type.length === 0) {
        throw new ProtocolError('invalid_message', 'message type must be a non-empty string')
      }
      messages.push(record)
    }

    return messages
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}
