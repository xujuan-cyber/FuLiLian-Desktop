import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createStreamThrottle, type ThrottleWindowLike } from './stream-throttle'

function makeTimers() {
  const pending = new Map<number, () => void>()
  let nextId = 1

  return {
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number)
    },
    fire() {
      const jobs = [...pending.values()]
      pending.clear()

      for (const job of jobs) {
        job()
      }
    },
    get pendingCount() {
      return pending.size
    },
    setTimeout: (fn: () => void, _ms: number) => {
      const id = nextId++
      pending.set(id, fn)

      return id
    }
  }
}

function makeWindow() {
  const calls: boolean[] = []
  const listeners = new Map<string, () => void>()
  let destroyed = false

  const win = {
    calls,
    close() {
      destroyed = true
      listeners.get('closed')?.()
    },
    isDestroyed: () => destroyed,
    on(event: string, fn: () => void) {
      listeners.set(event, fn)
    },
    webContents: {
      isDestroyed: () => destroyed,
      setBackgroundThrottling(allowed: boolean) {
        calls.push(allowed)
      }
    }
  }

  return win
}

test('registering a window applies the current throttle state immediately', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const idle = makeWindow()
  throttle.register(idle)

  // Idle default: throttling allowed.
  assert.deepEqual(idle.calls, [true])

  // Another window streams — registration is per window, so a chat window
  // created mid-stream elsewhere still starts throttled.
  const streaming = makeWindow()
  throttle.register(streaming)
  throttle.update(streaming, true)

  const late = makeWindow()
  throttle.register(late)

  assert.deepEqual(late.calls, [true])
})

test('a turn in flight unthrottles only its own window; idle background windows stay throttled', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const busyWin = makeWindow()
  const idleWin = makeWindow()
  throttle.register(busyWin)
  throttle.register(idleWin)

  throttle.update(busyWin, true)

  assert.deepEqual(busyWin.calls, [true, false])
  assert.deepEqual(idleWin.calls, [true])
  assert.equal(throttle.isUnthrottled(), true)
})

test('a settled window re-throttles after the trailing delay without touching other windows', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const win = makeWindow()
  const other = makeWindow()
  throttle.register(win)
  throttle.register(other)

  throttle.update(win, true)
  assert.deepEqual(win.calls, [true, false])

  // Turn ends: not re-throttled synchronously — the tail flush needs full
  // cadence — only after the trailing timer fires.
  throttle.update(win, false)
  assert.deepEqual(win.calls, [true, false])
  assert.equal(throttle.isUnthrottled(), true)

  timers.fire()
  assert.deepEqual(win.calls, [true, false, true])
  assert.equal(throttle.isUnthrottled(), false)
  assert.deepEqual(other.calls, [true])
})

test('a new turn during the trailing window cancels the pending re-throttle', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const win = makeWindow()
  throttle.register(win)

  throttle.update(win, true)
  throttle.update(win, false)
  assert.equal(timers.pendingCount, 1)

  // Busy again before the delay elapses: stay unthrottled, timer cancelled.
  throttle.update(win, true)
  assert.equal(timers.pendingCount, 0)
  assert.equal(throttle.isUnthrottled(), true)

  // The cancelled timer firing late must be a no-op.
  timers.fire()
  assert.equal(throttle.isUnthrottled(), true)
})

test('repeated busy reports do not re-apply or stack timers', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const win = makeWindow()
  throttle.register(win)

  throttle.update(win, true)
  throttle.update(win, true)
  throttle.update(win, true)
  assert.deepEqual(win.calls, [true, false])

  throttle.update(win, false)
  throttle.update(win, false)
  assert.equal(timers.pendingCount, 1)
})

test('closed and destroyed windows drop out without throwing and leak no timers', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const closedWin = makeWindow()
  throttle.register(closedWin)
  closedWin.close()

  const gone: ThrottleWindowLike & { on?: never } = {
    isDestroyed: () => true,
    webContents: null
  }

  throttle.register(gone)

  throttle.update(closedWin, true)
  // Only the registration-time call landed; nothing after close.
  assert.deepEqual(closedWin.calls, [true])
  assert.equal(throttle.isUnthrottled(), false)

  // A window closed mid-stream drops its entry and cancels its trailing timer.
  const midStream = makeWindow()
  throttle.register(midStream)
  throttle.update(midStream, true)
  throttle.update(midStream, false)
  assert.equal(timers.pendingCount, 1)

  midStream.close()
  assert.equal(timers.pendingCount, 0)
  assert.equal(throttle.isUnthrottled(), false)
})

test('reports from unregistered windows are ignored', () => {
  const timers = makeTimers()
  const throttle = createStreamThrottle(timers)
  const stranger = makeWindow()

  throttle.update(stranger, true)
  assert.deepEqual(stranger.calls, [])
  assert.equal(throttle.isUnthrottled(), false)
})
