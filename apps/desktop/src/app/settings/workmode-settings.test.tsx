// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FulilianConfigRecord } from '@/types/fulilian'

import { stubResizeObserver } from '@/test/jsdom'

stubResizeObserver()

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

const lastSaved = () => mocks.saveFulilianConfig.mock.calls.at(-1)?.[0] as FulilianConfigRecord | undefined

describe('ForensicsSettings (work mode · forensics)', () => {
  it('renders the form structure with the documented defaults', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { ForensicsSettings } = await import('./forensics-settings')

    await renderPage(<ForensicsSettings />)

    // Case number template defaults to CASE-YYYY-NNN.
    expect(await screen.findByLabelText('Case number template')).toHaveProperty('value', 'CASE-YYYY-NNN')

    // All five report sections and all three timeline sources default on.
    for (const name of ['Overview', 'Evidence inventory', 'Analysis process', 'Conclusion', 'Appendix']) {
      expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true')
    }
    for (const name of ['Disk images', 'Logs', 'Packet captures']) {
      expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true')
    }
  })

  it('persists edits through the shared config channel (debounced autosave)', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { ForensicsSettings } = await import('./forensics-settings')

    await renderPage(<ForensicsSettings />)

    fireEvent.change(await screen.findByLabelText('Case number template'), {
      target: { value: 'CASE-2026-NNN' }
    })

    await waitFor(
      () => {
        expect(mocks.saveFulilianConfig).toHaveBeenCalled()
        expect((lastSaved()?.forensics as Record<string, unknown> | undefined)?.case_no_template).toBe(
          'CASE-2026-NNN'
        )
      },
      { timeout: 2000 }
    )
  })
})

describe('CtfSettings (work mode · CTF)', () => {
  it('renders flag regex, event timezone and retry limit with the documented defaults', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { CtfSettings } = await import('./ctf-settings')

    await renderPage(<CtfSettings />)

    expect(await screen.findByLabelText('Flag pattern')).toHaveProperty('value', 'flag\\{[^}]+\\}')
    expect(screen.getByLabelText('Default event timezone')).toHaveProperty('value', 'UTC')
    expect(screen.getByLabelText('Submission retry limit')).toHaveProperty('value', '3')
  })

  it('persists a timezone edit through the shared config channel', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { CtfSettings } = await import('./ctf-settings')

    await renderPage(<CtfSettings />)

    fireEvent.change(await screen.findByLabelText('Default event timezone'), {
      target: { value: 'Asia/Shanghai' }
    })

    await waitFor(
      () => {
        expect(mocks.saveFulilianConfig).toHaveBeenCalled()
        expect((lastSaved()?.ctf as Record<string, unknown> | undefined)?.default_timezone).toBe(
          'Asia/Shanghai'
        )
      },
      { timeout: 2000 }
    )
  })
})
