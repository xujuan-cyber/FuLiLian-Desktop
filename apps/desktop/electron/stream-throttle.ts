// Stream-aware background throttling for chat windows, scoped per window.
//
// Chat windows must paint the live transcript while blurred, occluded, or
// minimized — but a static `backgroundThrottling: false` in webPreferences
// costs far more than that feature needs: it pins the renderer's
// `document.visibilityState` to 'visible' for the life of the window, which
// turns every visibility-gated poll and clock tick in the renderer into an
// always-on timer. An idle, hidden Fulilian burned ~20% CPU forever.
//
// So throttling is a runtime dial instead: the renderers already report
// "which chats are mid-turn" for the quit guard (`fulilian:active-work`),
// one report per window. A window whose own report shows a turn in flight
// gets `setBackgroundThrottling(false)` — exactly the streaming behavior the
// static flag used to provide, but scoped to that window alone: idle
// background windows keep Chromium's default throttling and stay quiet.
// Once a window's last turn ends, a short trailing delay (so its tail
// flushes land at full cadence) restores the default for that window.
//
// Pure and Electron-free (timers + the WebContents surface are injected) so it
// can be unit-tested, mirroring session-windows.ts.

/** How long after a window's last turn ends before its throttling is
 * restored. Covers the stream queue's final coalesced flush and the settle
 * writes that trail a turn's completion, so re-throttling never strands a
 * visible delta. */
const RETHROTTLE_DELAY_MS = 5_000

export interface ThrottleWindowLike {
  isDestroyed(): boolean
  webContents?: {
    isDestroyed(): boolean
    setBackgroundThrottling(allowed: boolean): void
  } | null
}

interface TimersLike {
  clearTimeout(handle: unknown): void
  setTimeout(fn: () => void, ms: number): unknown
}

interface Entry {
  busy: boolean
  trailing: unknown
}

export interface StreamThrottle {
  /** True while any tracked window is currently unthrottled (streaming or
   * trailing). */
  isUnthrottled(): boolean
  /** Track a chat window; applies the current state immediately and stops
   * tracking on close. */
  register(win: ThrottleWindowLike & { on?: (event: string, fn: () => void) => void }): void
  /** Report whether a turn is in flight in this window's renderer. Unknown
   * (unregistered) windows are ignored — only chat windows are tracked. */
  update(win: ThrottleWindowLike, busy: boolean): void
}

export function createStreamThrottle(
  timers: TimersLike = { clearTimeout: handle => clearTimeout(handle as never), setTimeout },
  delayMs: number = RETHROTTLE_DELAY_MS
): StreamThrottle {
  const entries = new Map<ThrottleWindowLike, Entry>()

  function apply(win: ThrottleWindowLike, entry: Entry) {
    if (win.isDestroyed()) {
      drop(win)

      return
    }

    const contents = win.webContents

    if (!contents || contents.isDestroyed()) {
      return
    }

    try {
      contents.setBackgroundThrottling(!entry.busy)
    } catch {
      // A window mid-teardown can throw; it's about to leave the map anyway.
    }
  }

  function drop(win: ThrottleWindowLike) {
    const entry = entries.get(win)

    if (entry && entry.trailing !== null) {
      timers.clearTimeout(entry.trailing)
    }

    entries.delete(win)
  }

  return {
    isUnthrottled: () => {
      for (const entry of entries.values()) {
        if (entry.busy) {
          return true
        }
      }

      return false
    },

    register(win) {
      const entry: Entry = { busy: false, trailing: null }

      entries.set(win, entry)
      win.on?.('closed', () => drop(win))
      apply(win, entry)
    },

    update(win, busy) {
      const entry = entries.get(win)

      if (!entry || win.isDestroyed()) {
        return
      }

      if (busy) {
        if (entry.trailing !== null) {
          timers.clearTimeout(entry.trailing)
          entry.trailing = null
        }

        if (!entry.busy) {
          entry.busy = true
          apply(win, entry)
        }

        return
      }

      if (!entry.busy || entry.trailing !== null) {
        return
      }

      // Trailing edge: keep full cadence briefly so the final flush paints.
      entry.trailing = timers.setTimeout(() => {
        entry.trailing = null
        entry.busy = false
        apply(win, entry)
      }, delayMs)
    }
  }
}
