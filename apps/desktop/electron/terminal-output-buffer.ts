// Coalesce the embedded terminal's PTY output before it crosses the IPC
// boundary. A shell that floods stdout (a build log, `yes`, a large `cat`)
// otherwise costs one `webContents.send` per PTY read — hundreds per second —
// and every one of those is a main→renderer hop the renderer must service.
// Merging a burst into a single message cuts that by one to two orders of
// magnitude. The window stays below one 60 Hz frame (16.7 ms) so xterm paints
// the same bytes with no perceptible latency, while a large read is sent at
// once instead of idling out the window.
//
// Only the `data` stream is routed through here. Control messages (`exit`)
// stay immediate — see terminal-ipc.ts, which flushes this buffer *before*
// sending `exit`, so the renderer never sees the close before its last bytes.

// One 60 Hz frame is 16.7 ms; 12 ms lands inside a single frame so the added
// delay is not perceptible, yet it is long enough to gather a burst of small
// reads into one message.
export const TERMINAL_OUTPUT_FLUSH_MS = 12

// node-pty's reads top out around 64 KiB; flushing a full read at once means a
// big `cat` is never delayed by the window (the byte threshold and the timer
// race, whichever comes first).
export const TERMINAL_OUTPUT_FLUSH_BYTES = 64 * 1024

export interface TerminalOutputBufferOptions {
  // Emit the accumulated output now. Always called with a non-empty string.
  flush: (data: string) => void
  // Flush immediately once this many pending bytes have accumulated.
  thresholdBytes: number
  // Flush a pending buffer after at most this many milliseconds.
  windowMs: number
  // Byte length of one chunk (defaults to Buffer.byteLength).
  byteLength?: (data: string) => number
  // Injectable scheduler so tests can drive a fake clock.
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface TerminalOutputBuffer {
  push: (data: string) => void
  flush: () => void
  dispose: () => void
  readonly disposed: boolean
  readonly pendingBytes: number
}

export function createTerminalOutputBuffer({
  flush,
  thresholdBytes,
  windowMs,
  byteLength = data => Buffer.byteLength(data),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
}: TerminalOutputBufferOptions): TerminalOutputBuffer {
  let pending = ''
  let pendingBytes = 0
  let timer: unknown = null
  let disposed = false

  function clearTimerIfArmed() {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  // Emit whatever is pending (if anything) and disarm the window. Shared by the
  // timer, the byte threshold, and an explicit flush, so a threshold flush also
  // cancels its own timer.
  function emit() {
    clearTimerIfArmed()

    if (pending === '') {
      return
    }

    const data = pending

    pending = ''
    pendingBytes = 0

    flush(data)
  }

  function push(data: string) {
    if (disposed || !data) {
      return
    }

    pending += data
    pendingBytes += byteLength(data)

    // Threshold first: an oversized read (>= the threshold) goes out at once
    // and is never accumulated with a neighbour, so the buffer retains at most
    // one chunk's worth of bytes.
    if (pendingBytes >= thresholdBytes) {
      emit()

      return
    }

    if (timer === null) {
      timer = setTimer(emit, windowMs)
    }
  }

  // Teardown: disarm the window and drop the pending tail. A disposed session is
  // being closed — its renderer terminal is going away — so those bytes have no
  // consumer; dropping them guarantees nothing is sent after dispose and leaves
  // no timer dangling.
  function dispose() {
    disposed = true
    clearTimerIfArmed()
    pending = ''
    pendingBytes = 0
  }

  return {
    dispose,
    flush: emit,
    push,
    get disposed() {
      return disposed
    },
    get pendingBytes() {
      return pendingBytes
    }
  }
}
