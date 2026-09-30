import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Unstable_TriggerAdapter } from '@assistant-ui/core'

import { $sessions } from '@/store/session'

import { useHashCompletions } from './use-hash-completions'

const mocks = vi.hoisted(() => ({
  searchSessions: vi.fn()
}))

vi.mock('@/api/sessions', () => ({
  searchSessions: mocks.searchSessions
}))

vi.mock('@/lib/chat-runtime', () => ({
  sessionTitle: (session: { title?: string; id: string }) => session.title ?? session.id
}))

function setSessions(sessions: Array<Record<string, unknown>>) {
  $sessions.set(sessions as never)
}

function setup(enabled = true) {
  const { result } = renderHook(() => useHashCompletions({ enabled }))

  return { result }
}

/** The hook result shape the helper drives (adapter.search is optional on the
 *  Unstable_TriggerAdapter type, hence the `?.` with an empty-array floor). */
type HookResult = { current: { adapter: Unstable_TriggerAdapter; loading: boolean } }

async function search(result: HookResult, query: string) {
  act(() => {
    result.current.adapter.search?.(query)
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })

  return (result.current.adapter.search?.(query) ?? []) as unknown as Array<{
    metadata: Record<string, string>
    label: string
  }>
}

const SESSIONS = [
  { id: 's-1', title: 'Refactor the gateway', preview: 'split handler registry' },
  { id: 's-2', title: '字体轮廓取证', preview: '' },
  { id: 's-3', title: 'Prep release notes', preview: 'v1.3 changelog' }
]

describe('R4 `#` session-reference completions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setSessions(SESSIONS)
    mocks.searchSessions.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('browses the local recent window on an empty query without a round trip', async () => {
    const { result } = setup()

    const items = await search(result, '')

    expect(mocks.searchSessions).not.toHaveBeenCalled()
    expect(items.map(item => item.label)).toEqual(['Refactor the gateway', '字体轮廓取证', 'Prep release notes'])
  })

  it('widens local matches with deep-search hits, deduped by session id', async () => {
    mocks.searchSessions.mockResolvedValue({
      results: [
        { session_id: 's-1', snippet: 'Refactor the gateway', model: 'm' },
        { session_id: 's-9', snippet: 'buried gateway hit', model: 'm' }
      ]
    })
    const { result } = setup()

    const items = await search(result, 'gateway')

    expect(mocks.searchSessions).toHaveBeenCalledWith('gateway')
    // s-1 arrives once (local wins), s-9 rides in from the search endpoint.
    expect(items.map(item => item.label)).toEqual(['Refactor the gateway', 'buried gateway hit'])
  })

  it('degrades to the local window when the search endpoint is unreachable', async () => {
    mocks.searchSessions.mockRejectedValue(new Error('down'))
    const { result } = setup()

    const items = await search(result, 'release')

    expect(items.map(item => item.label)).toEqual(['Prep release notes'])
    expect(result.current.loading).toBe(false)
  })

  it('carries the session id out-of-band and inserts the title verbatim', async () => {
    const { result } = setup()

    const items = await search(result, '')

    const first = items[0]

    expect(first.metadata.sessionId).toBe('s-1')
    expect(first.metadata.rawText).toBe('Refactor the gateway')
  })

  it('never fetches when disabled', async () => {
    const { result } = setup(false)

    const items = await search(result, 'anything')

    expect(items).toEqual([])
    expect(mocks.searchSessions).not.toHaveBeenCalled()
  })
})
