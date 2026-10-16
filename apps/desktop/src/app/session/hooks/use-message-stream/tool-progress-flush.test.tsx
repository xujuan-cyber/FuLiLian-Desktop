import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'session-1'
const sessionStates = new Map<string, ClientSessionState>()
let stream: MessageStreamHarness
type UpdateSessionState = (
  sessionId: string,
  updater: (state: ClientSessionState) => ClientSessionState,
  storedSessionId?: string | null
) => ClientSessionState
let updateSessionState: ReturnType<typeof vi.fn<UpdateSessionState>>

function mountStream() {
  stream = renderMessageStream(SID, { states: sessionStates, updateSessionState })
}

function emit(type: RpcEventType, payload: Record<string, unknown> = {}, sessionId = SID) {
  act(() => stream.handleEvent({ payload, session_id: sessionId, type }))
}

type RpcEventType = 'tool.start' | 'tool.progress' | 'tool.complete'

function toolPart(sessionId = SID) {
  const parts = stream.state(sessionId).messages.at(-1)?.parts ?? []
  const part = parts.find(p => p.type === 'tool-call')

  return part && part.type === 'tool-call' ? part : null
}

describe('tool.progress batched through the adaptive-floor flush queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStates.clear()
    updateSessionState = vi.fn((sessionId: string, updater: (state: ClientSessionState) => ClientSessionState) => {
      const next = updater(sessionStates.get(sessionId) ?? createClientSessionState())
      sessionStates.set(sessionId, next)

      return next
    })
    vi.spyOn(performance, 'now').mockReturnValue(100)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    vi.spyOn(globalThis.document, 'hasFocus').mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    sessionStates.clear()
  })

  it('coalesces consecutive progress ticks into one write on the flush timer', async () => {
    mountStream()

    for (const line of ['line-1', 'line-2', 'line-3']) {
      emit('tool.progress', { args: { output: line }, name: 'terminal', tool_id: 'tool-1' })
    }

    // Nothing applied synchronously: the burst sits in the queue, and a single
    // flush timer is armed — the same adaptive-floor scheduler text uses.
    expect(toolPart()).toBeNull()
    expect(updateSessionState).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // One coalesced write carries the final tick's state.
    expect(updateSessionState).toHaveBeenCalledTimes(1)
    const part = toolPart()

    expect(part?.toolName).toBe('terminal')
    expect(part?.toolCallId).toBe('tool-1')
    expect(part?.argsText).toBe(JSON.stringify({ output: 'line-3' }))
  })

  it('keeps tool.start immediate while later progress is queued', () => {
    mountStream()

    emit('tool.start', { name: 'terminal', tool_id: 'tool-1' })

    // The row the UI waits on lands without any timer round trip.
    expect(toolPart()?.toolCallId).toBe('tool-1')
    expect(updateSessionState).toHaveBeenCalledTimes(1)

    emit('tool.progress', { args: { output: 'streaming' }, name: 'terminal', tool_id: 'tool-1' })

    // The progress tick is queued, not applied — no second write yet.
    expect(updateSessionState).toHaveBeenCalledTimes(1)
    expect(toolPart()?.argsText).toBe(JSON.stringify({}))
  })

  it('keeps tool.complete immediate and drains queued progress ahead of it', async () => {
    mountStream()

    emit('tool.start', { name: 'file_read', tool_id: 'tool-1' })
    emit('tool.progress', { args: { output: 'almost done' }, name: 'file_read', tool_id: 'tool-1' })
    emit('tool.complete', {
      name: 'file_read',
      result: { output: 'almost done' },
      tool_id: 'tool-1'
    })

    // The progress tick's flush timer may still be armed (flushing doesn't
    // clear it — same as the text-delta paths), but the drained queue makes
    // its runFlush a no-op: draining it must not produce extra writes.
    const writesAfterComplete = updateSessionState.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(updateSessionState).toHaveBeenCalledTimes(writesAfterComplete)
    const part = toolPart()

    expect(part?.toolName).toBe('file_read')
    expect(part?.result).toEqual({ output: 'almost done' })
    expect(part?.completedAt).toBeDefined()
  })

  it('applies queued progress after queued text, never ahead of it', async () => {
    mountStream()

    act(() => stream.appendDelta(SID, 'running the check'))
    emit('tool.progress', { args: { output: 'ok' }, name: 'terminal', tool_id: 'tool-1' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const parts = stream.state().messages.at(-1)?.parts ?? []
    const kinds = parts.map(p => p.type)
    const text = parts.find(p => p.type === 'text')

    expect(kinds).toEqual(['text', 'tool-call'])
    expect(text?.type === 'text' ? text.text : '').toBe('running the check')
    expect(toolPart()?.argsText).toBe(JSON.stringify({ output: 'ok' }))
  })
})
