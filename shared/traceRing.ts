import type { FrameEvent } from './engine'

/**
 * UI-side drop-oldest capacity. Engine `rx.batch.dropped` is separate.
 * 20_000 frames ≈ 10 s at 2 kfps; memory stays bounded under load.
 */
export const TRACE_RING_CAPACITY = 20_000

export type TraceEntry = {
  readonly seq: number
  readonly frame: FrameEvent
}

/** Chronological ring (index 0 = oldest). Append overwrites the oldest slot. */
export class FrameRing {
  readonly capacity: number
  private readonly slots: Array<TraceEntry | undefined>
  private head = 0
  private _size = 0
  private nextSeq = 1
  private _droppedOldest = 0

  constructor(capacity: number = TRACE_RING_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('FrameRing capacity must be a positive integer')
    }
    this.capacity = capacity
    this.slots = new Array<TraceEntry | undefined>(capacity)
  }

  get size(): number {
    return this._size
  }

  get droppedOldest(): number {
    return this._droppedOldest
  }

  at(index: number): TraceEntry {
    if (index < 0 || index >= this._size) {
      throw new RangeError(`FrameRing index ${index} out of range ${this._size}`)
    }
    return this.slots[(this.head + index) % this.capacity]!
  }

  append(frames: readonly FrameEvent[]): number {
    let dropped = 0
    for (const frame of frames) {
      if (this._size === this.capacity) {
        this.head = (this.head + 1) % this.capacity
        this._size -= 1
        dropped += 1
        this._droppedOldest += 1
      }
      const slot = (this.head + this._size) % this.capacity
      this.slots[slot] = { seq: this.nextSeq, frame }
      this.nextSeq += 1
      this._size += 1
    }
    return dropped
  }

  clear(): void {
    this.head = 0
    this._size = 0
  }
}
