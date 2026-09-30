// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { atom } from 'nanostores'

import { $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $approvalModes, approvalModeForProfile } from '@/store/approval-mode'

import { ApprovalModePill } from './approval-mode-pill'

const mocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children, label }: { children: ReactNode; label: ReactNode }) => (
    <div>
      <div data-testid="tip-label">{label}</div>
      {children}
    </div>
  ),
  TipKeybindLabel: () => <span data-testid="tip-keybind" />
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      shell: {
        approvalMode: {
          title: '审批模式',
          manual: '手动确认',
          smart: '智能确认',
          off: '完全访问',
          manualDescription: '执行命令前需要确认',
          smartDescription: '低风险命令自动执行',
          offDescription: '所有命令自动执行',
          ariaLabel: (label: string) => `审批模式：${label}`
        }
      }
    }
  })
}))

async function renderPill() {
  render(<ApprovalModePill />)

  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('config.get', { key: 'approvals.mode' }))
}

describe('R5 approval-mode pill', () => {
  beforeEach(() => {
    // Echo the authoritative backend: config.get reads the stored default;
    // config.set reads back exactly what was written.
    mocks.request.mockReset()
    mocks.request.mockImplementation(async (_method: string, params?: Record<string, unknown>) => ({
      value: (params?.value as string) ?? 'smart'
    }))
    $approvalModes.set({})
    $activeGatewayProfile.set('default')
    $gateway.set({ request: mocks.request } as never)
  })

  it('shows the profile-level mode pulled from config.get on mount', async () => {
    await renderPill()

    expect(screen.getByText('智能确认')).toBeTruthy()
    // A5: the aria-label names the global scope copy and nothing claims
    // per-session scope anywhere in the pill.
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('审批模式：智能确认')
    expect(document.body.textContent).not.toContain('仅本会话')
    expect(document.body.textContent).not.toContain('session only')
  })

  it('cycles manual → smart → off through config.set approvals.mode (A5 往返)', async () => {
    await renderPill()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('config.set', { key: 'approvals.mode', value: 'off' })
    )

    // The store adopts the authoritative echo, so a config.get round trip
    // reads back exactly what was written.
    expect(approvalModeForProfile('default')).toBe('off')

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenLastCalledWith('config.set', { key: 'approvals.mode', value: 'manual' })
    )
  })

  it('keeps showing the failed mode when the write rolls back', async () => {
    mocks.request.mockImplementationOnce(() => Promise.resolve({ value: 'smart' }))
    mocks.request.mockRejectedValueOnce(new Error('offline'))

    await renderPill()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(approvalModeForProfile('default')).toBe('smart'))
  })
})
