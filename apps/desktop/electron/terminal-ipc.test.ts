import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import { resolveTerminalConnection, resolveTerminalConnectionForSender } from './connection-apply'
import {
  createTerminalOutputBuffer,
  TERMINAL_OUTPUT_FLUSH_BYTES,
  TERMINAL_OUTPUT_FLUSH_MS
} from './terminal-output-buffer'

afterEach(() => {
  vi.useRealTimers()
})

const ssh = {
  host: 'registry-box.test',
  user: 'fulilian'
}

test('terminal start preserves the selected SSH target and scope', async () => {
  const target = {
    ssh,
    scope: 'connection:registry-ssh:profile:worker'
  }

  const resolved = await resolveTerminalConnection(
    () => target,
    async () => {
      throw new Error('backend fallback must not run for an active SSH target')
    }
  )

  assert.equal(resolved, target)
  assert.equal(resolved?.ssh, ssh)
  assert.equal(resolved?.scope, 'connection:registry-ssh:profile:worker')
})

test('terminal start does not invent SSH when canonical routing selects local or remote HTTP', async () => {
  let backendChecks = 0

  const resolved = await resolveTerminalConnection(
    () => null,
    async () => {
      backendChecks += 1
    }
  )

  assert.equal(resolved, null)
  assert.equal(backendChecks, 0)
})

test('terminal start re-reads the SSH target after backend startup', async () => {
  const target = {
    ssh,
    scope: 'connection:registry-ssh'
  }

  let ready = false

  const resolved = await resolveTerminalConnection(
    () => (ready ? target : 'pending'),
    async () => {
      ready = true
    }
  )

  assert.equal(resolved, target)
  assert.equal(resolved?.scope, 'connection:registry-ssh')
})

test('keeps terminal routing isolated by renderer sender id', async () => {
  const targets = new Map([
    [11, { ssh, scope: 'conn:source-b::worker' }],
    [22, null]
  ])

  const getTarget = (webContentsId: number) => targets.get(webContentsId) ?? null
  const ensureBackend = async (_webContentsId: number) => undefined

  const windowB = await resolveTerminalConnectionForSender(11, getTarget, ensureBackend)
  const windowC = await resolveTerminalConnectionForSender(22, getTarget, ensureBackend)

  assert.equal(windowB?.scope, 'conn:source-b::worker')
  assert.equal(windowC, null)
})

// --- P8: PTY output coalescing -------------------------------------------
//
// The buffer is a pure module with an injectable clock, so these exercise the
// four send-path rules (window, byte threshold, flush-before-exit, teardown)
// without electron or node-pty. The wiring itself (that `data` is buffered and
// `exit` is not, and that the flush precedes the close) is covered in
// terminal-ipc.wsl-cli.test.ts.

test('P8/1 a burst of small chunks is coalesced into one message per window', () => {
  const sent: string[] = []
  const scheduled: Array<{ callback: () => void; ms: number }> = []

  const buffer = createTerminalOutputBuffer({
    clearTimer: () => {},
    flush: data => sent.push(data),
    setTimer: (callback, ms) => {
      scheduled.push({ callback, ms })

      return scheduled.length
    },
    thresholdBytes: TERMINAL_OUTPUT_FLUSH_BYTES,
    windowMs: TERMINAL_OUTPUT_FLUSH_MS
  })

  buffer.push('a')
  buffer.push('b')
  buffer.push('c')

  assert.deepEqual(sent, [], 'nothing crosses IPC before the window elapses')
  assert.equal(scheduled.length, 1, 'the window is armed once, not per chunk')
  assert.equal(scheduled[0].ms, TERMINAL_OUTPUT_FLUSH_MS, 'the injected window is honored exactly')
  assert.equal(buffer.pendingBytes, 3)

  scheduled[0].callback()

  assert.deepEqual(sent, ['abc'], 'three reads become one message')
  assert.equal(buffer.pendingBytes, 0, 'the buffer drains on flush')
})

test('P8/2 reaching the 64 KiB threshold flushes at once and cancels the window', () => {
  vi.useFakeTimers()

  const sent: string[] = []
  const buffer = createTerminalOutputBuffer({
    flush: data => sent.push(data),
    thresholdBytes: TERMINAL_OUTPUT_FLUSH_BYTES,
    windowMs: TERMINAL_OUTPUT_FLUSH_MS
  })

  buffer.push('x'.repeat(4096))
  assert.equal(vi.getTimerCount(), 1, 'a sub-threshold read arms the window')

  buffer.push('y'.repeat(TERMINAL_OUTPUT_FLUSH_BYTES - 4096))

  assert.equal(sent.length, 1, 'the threshold flushes immediately')
  assert.equal(sent[0].length, TERMINAL_OUTPUT_FLUSH_BYTES)
  assert.equal(sent[0].startsWith('x'.repeat(4096)), true, 'chunk order is preserved')
  assert.equal(vi.getTimerCount(), 0, 'the threshold flush cancelled its own window')

  vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 10)

  assert.equal(sent.length, 1, 'no stale timer re-emits an already-flushed burst')
})

test('P8/3 flush() is immediate and idempotent — the hook used before `exit`', () => {
  vi.useFakeTimers()

  const sent: string[] = []
  const buffer = createTerminalOutputBuffer({
    flush: data => sent.push(data),
    thresholdBytes: TERMINAL_OUTPUT_FLUSH_BYTES,
    windowMs: TERMINAL_OUTPUT_FLUSH_MS
  })

  buffer.push('tail')

  assert.deepEqual(sent, [])

  buffer.flush()

  assert.deepEqual(sent, ['tail'], 'flush delivers the pending tail without waiting for the window')
  assert.equal(vi.getTimerCount(), 0, 'flush disarms the window it supersedes')

  buffer.flush()

  assert.deepEqual(sent, ['tail'], 'a second flush has nothing to send')
})

test('P8/4 dispose drops the pending tail, sends nothing afterwards, and leaves no timer', () => {
  vi.useFakeTimers()

  const sent: string[] = []
  const buffer = createTerminalOutputBuffer({
    flush: data => sent.push(data),
    thresholdBytes: TERMINAL_OUTPUT_FLUSH_BYTES,
    windowMs: TERMINAL_OUTPUT_FLUSH_MS
  })

  buffer.push('pending')

  assert.equal(vi.getTimerCount(), 1)

  buffer.dispose()

  assert.equal(buffer.disposed, true)
  assert.deepEqual(sent, [], 'a torn-down session does not emit its tail')
  assert.equal(vi.getTimerCount(), 0, 'dispose disarms the timer (nothing left dangling)')

  buffer.push('after dispose')
  vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 10)

  assert.deepEqual(sent, [], 'a disposed buffer ignores later reads')
  assert.equal(vi.getTimerCount(), 0)
  assert.equal(buffer.pendingBytes, 0, 'no bytes are retained after dispose')
})

test('P8/5 one oversized chunk is sent whole and at once, never accumulated', () => {
  vi.useFakeTimers()

  const sent: string[] = []
  const buffer = createTerminalOutputBuffer({
    flush: data => sent.push(data),
    thresholdBytes: TERMINAL_OUTPUT_FLUSH_BYTES,
    windowMs: TERMINAL_OUTPUT_FLUSH_MS
  })

  const oversized = 'z'.repeat(TERMINAL_OUTPUT_FLUSH_BYTES * 3)

  buffer.push(oversized)

  assert.deepEqual(sent, [oversized], 'the oversized read is one message, byte-for-byte')
  assert.equal(vi.getTimerCount(), 0, 'no window is armed for it')
  assert.equal(buffer.pendingBytes, 0, 'nothing is retained (the buffer cannot grow past one read)')
})
