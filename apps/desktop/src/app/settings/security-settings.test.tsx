// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  saveFulilianConfig: vi.fn(),
  confirm: vi.fn()
}))

vi.mock('@/fulilian', () => ({
  getFulilianConfigRecord: mocks.getFulilianConfigRecord,
  saveFulilianConfig: mocks.saveFulilianConfig
}))

vi.mock('@/store/confirm', () => ({ confirm: mocks.confirm }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

beforeEach(() => {
  mocks.saveFulilianConfig.mockResolvedValue({ ok: true })
  mocks.confirm.mockResolvedValue(false)
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

describe('EvidenceProtectionSettings (guardrail defaults)', () => {
  it('defaults all three protections ON when config.yaml is silent', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { EvidenceProtectionSettings } = await import('./evidence-protection-settings')

    await renderPage(<EvidenceProtectionSettings />)

    for (const name of ['Read-only evidence mount', 'Verify before reference', 'Lock writes on archive']) {
      const toggle = await screen.findByRole('switch', { name })
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    }
  })

  it('never drops the read-only mount silently: off requires an explicit confirm', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { EvidenceProtectionSettings } = await import('./evidence-protection-settings')

    await renderPage(<EvidenceProtectionSettings />)

    const toggle = await screen.findByRole('switch', { name: 'Read-only evidence mount' })

    // Confirm refused → the guardrail stays on.
    fireEvent.click(toggle)
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(mocks.saveFulilianConfig).not.toHaveBeenCalled()

    // Confirm accepted → the preference is persisted through the shared
    // config channel (debounced autosave).
    mocks.confirm.mockResolvedValue(true)
    fireEvent.click(toggle)
    await waitFor(
      () => {
        const saved = mocks.saveFulilianConfig.mock.calls.at(-1)?.[0] as FulilianConfigRecord | undefined
        expect((saved?.security as Record<string, unknown> | undefined)?.evidence_readonly).toBe(false)
      },
      { timeout: 2000 }
    )
  })
})

describe('AuditSettings (honest affordances)', () => {
  it('defaults logging on with a 90-day retention; export/clear stay disabled until the data layer lands', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({} as FulilianConfigRecord)
    const { AuditSettings } = await import('./audit-settings')

    await renderPage(<AuditSettings />)

    expect((await screen.findByRole('switch', { name: 'Audit logging' })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Retention period' }).textContent).toContain('90')

    // The audit store is a later-round data layer: the buttons say what they
    // will do but must not pretend to work today.
    expect(screen.getByRole('button', { name: 'Export' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Clear' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('SensitiveInfoSettings (existing-key wiring)', () => {
  it('rides the existing security.redact_secrets key and defaults the new guardrails on', async () => {
    mocks.getFulilianConfigRecord.mockResolvedValue({
      security: { redact_secrets: false }
    } as FulilianConfigRecord)
    const { SensitiveInfoSettings } = await import('./sensitive-info-settings')

    await renderPage(<SensitiveInfoSettings />)

    expect((await screen.findByRole('switch', { name: 'Redact secrets' })).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Redact flags' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Audit reveals' }).getAttribute('aria-checked')).toBe('true')
  })
})

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
