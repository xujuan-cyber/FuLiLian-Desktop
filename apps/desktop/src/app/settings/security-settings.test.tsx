// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FulilianConfigRecord } from '@/types/fulilian'

import { stubResizeObserver } from '@/test/jsdom'

stubResizeObserver()

// Radix Select calls scrollIntoView on its items when the content opens; jsdom
// doesn't implement it (nor hasPointerCapture / releasePointerCapture), so stub
// them to let the dropdown open in tests.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const mocks = vi.hoisted(() => ({
  getFulilianConfigRecord: vi.fn(),
  saveFulilianConfig: vi.fn()
}))

vi.mock('@/fulilian', () => ({
  getFulilianConfigRecord: mocks.getFulilianConfigRecord,
  saveFulilianConfig: mocks.saveFulilianConfig
}))

vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

beforeEach(() => {
  mocks.saveFulilianConfig.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderPage = async (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('ApprovalsPermissionsSettings (full-access badge)', () => {
  it('shows the FULL ACCESS badge only when the mode is off', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({
      approvals: { mode: 'off' }
    } as FulilianConfigRecord)
    const { ApprovalsPermissionsSettings } = await import('./approvals-permissions-settings')

    await renderPage(<ApprovalsPermissionsSettings />)

    expect(await screen.findByText('FULL ACCESS')).toBeTruthy()
    for (const label of ['Per-step', 'Semi-auto', 'Full access']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('hides the badge under a guardrailed mode', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({
      approvals: { mode: 'manual' }
    } as FulilianConfigRecord)
    const { ApprovalsPermissionsSettings } = await import('./approvals-permissions-settings')

    await renderPage(<ApprovalsPermissionsSettings />)

    await screen.findByRole('button', { name: 'Per-step' })
    expect(screen.queryByText('FULL ACCESS')).toBeNull()
  })
})
