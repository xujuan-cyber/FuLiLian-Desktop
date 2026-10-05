import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getFulilianConfigRecord = vi.fn()

vi.mock('@/fulilian', () => ({
  getFulilianConfigRecord: () => getFulilianConfigRecord(),
  profileScopeKey: (scope?: null | string) => (scope ?? '').trim() || 'default'
}))

import { FULILIAN_CONFIG_KEY, useFulilianConfigRecord } from './use-config-record'

// Step 17 · P4-A: the shared config record used to carry `staleTime: 0`, so
// every settings mount revalidated `GET /api/config` even when the cache was
// still valid. The fresh window is now 60 s (matching the app-wide default);
// these assertions pin that down: the record is not stale right after loading,
// and remounting inside the window serves cache instead of re-fetching.
describe('useFulilianConfigRecord caching (P4-A)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('treats the record as fresh for 60s and does not revalidate on remount', async () => {
    getFulilianConfigRecord.mockResolvedValue({ agent: {} })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const first = renderHook(() => useFulilianConfigRecord(), { wrapper })

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(getFulilianConfigRecord).toHaveBeenCalledTimes(1)

    const query = client.getQueryCache().find({ queryKey: FULILIAN_CONFIG_KEY })
    // `staleTime` lands on the resolved query options but is not exposed on the
    // public QueryOptions type, so read it through a narrow structural cast.
    const options = query?.options as { staleTime?: number } | undefined

    expect(options?.staleTime).toBe(60_000)
    expect(query?.isStale()).toBe(false)

    // Remount inside the fresh window must paint the cache, not re-fetch.
    // With `staleTime: 0` this second mount marks the record stale and fires a
    // second GET — the assertion below is what the tamper test flips red.
    first.unmount()
    const second = renderHook(() => useFulilianConfigRecord(), { wrapper })

    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(getFulilianConfigRecord).toHaveBeenCalledTimes(1)
  })
})
