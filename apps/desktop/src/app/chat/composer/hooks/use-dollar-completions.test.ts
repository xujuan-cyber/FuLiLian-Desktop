import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Unstable_TriggerAdapter } from '@assistant-ui/core'

import { useDollarCompletions } from './use-dollar-completions'

const mocks = vi.hoisted(() => ({
  getSkills: vi.fn()
}))

vi.mock('@/api/skills', () => ({
  getSkills: mocks.getSkills
}))

const SKILLS = [
  { name: 'zeta', description: 'last alphabetically', enabled: true, category: 'x' },
  { name: 'alpha', description: 'first', enabled: true, category: 'x' },
  { name: 'disabled-one', description: 'off', enabled: false, category: 'x' },
  { name: 'matcher', description: 'mentions gateway tuning', enabled: true, category: 'x' }
]

function setup() {
  return renderHook(() => useDollarCompletions({ enabled: true }))
}

/** The hook result shape the helper drives (adapter.search is optional on the
 *  Unstable_TriggerAdapter type, hence the `?.` with an empty-array floor). */
type HookResult = { current: { adapter: Unstable_TriggerAdapter; loading: boolean } }

async function search(result: HookResult, query: string) {
  act(() => {
    result.current.adapter.search?.(query)
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(120)
  })

  return (result.current.adapter.search?.(query) ?? []) as unknown as Array<{
    metadata: Record<string, string>
    label: string
  }>
}

// The module-level catalog cache lives for the whole file, so these tests run
// as one cache lifecycle: first fetch fails (cache must not poison), the
// retry succeeds, and every later query answers from that single fetch.
describe('R4 `$` skill-invocation completions (one cache lifecycle)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getSkills.mockReset()
    mocks.getSkills.mockRejectedValueOnce(new Error('down')).mockResolvedValue(SKILLS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders an empty list while the catalog is unreachable, then recovers on the next query', async () => {
    const { result } = setup()

    const failed = await search(result, '')

    expect(failed).toEqual([])

    // The adapter de-dupes on the query alone, so the retry is a NEW query —
    // exactly how typing more characters behaves in the popover.
    const recovered = await search(result, 'gateway')

    expect(recovered.map(item => item.label)).toEqual(['/matcher'])
    expect(mocks.getSkills).toHaveBeenCalledTimes(2)
  })

  it('answers every later query from cache with no new catalog fetch', async () => {
    const { result } = setup()

    const callsBefore = mocks.getSkills.mock.calls.length

    await search(result, 'ze')
    await search(result, 'ma')
    await search(result, 'dis')

    expect(mocks.getSkills.mock.calls.length).toBe(callsBefore)
  })

  it('lists enabled skills sorted by name, filtered by query across name and description', async () => {
    const { result } = setup()

    expect((await search(result, '')).map(item => item.label)).toEqual(['/alpha', '/matcher', '/zeta'])
    expect((await search(result, 'gateway')).map(item => item.label)).toEqual(['/matcher'])
  })

  it('inserts the skill slash command verbatim (rawText = `/name`)', async () => {
    const { result } = setup()

    const items = await search(result, '')

    expect(items[0].metadata.rawText).toBe('/alpha')
    expect(items[0].label).toBe('/alpha')
  })
})
