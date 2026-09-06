import type { FrameEvent } from './engine'
import type { FrameRing } from './traceRing'

/** Pause freezes the view: incoming frames are not appended to the UI ring. */
export function applyRxBatch(
  ring: FrameRing,
  frames: readonly FrameEvent[],
  paused: boolean
): number {
  if (paused || frames.length === 0) {
    return 0
  }
  return ring.append(frames)
}
