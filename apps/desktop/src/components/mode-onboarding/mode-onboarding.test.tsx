import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $modeOnboarding, requestModeOnboarding } from '@/store/mode-onboarding'

import { ModeOnboardingOverlay, NEW_SESSION_SHORTCUT_EVENT } from './mode-onboarding'

// Step 16 · T18-1: the first-use briefing overlay. The store owns the "seen
// once" marker; here we assert the render shape (forensics authorization +
// read-only guardrails / ctf flag vault / project never), the explicit-confirm
// gate, and the new-session trigger listener.

function renderOverlay() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <ModeOnboardingOverlay />
    </I18nProvider>
  )
}

function dispatchNewSession(kind: string) {
  window.dispatchEvent(new CustomEvent(NEW_SESSION_SHORTCUT_EVENT, { detail: { kind } }))
}

beforeEach(() => {
  window.localStorage.clear()
  $modeOnboarding.set({ status: 'closed' })
})

afterEach(() => {
  cleanup()
  $modeOnboarding.set({ status: 'closed' })
})

describe('ModeOnboardingOverlay', () => {
  it('renders nothing while closed', () => {
    const { container } = renderOverlay()

    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('forensics: authorization scope + read-only guardrails, confirm gated on the checkbox', () => {
    renderOverlay()

    act(() => requestModeOnboarding('forensics'))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Forensics mode/)).toBeTruthy()
    // 授权范围声明确认
    expect(screen.getByText(/I confirm I am authorized/)).toBeTruthy()
    // 只读护栏三项（只读挂载 / 高危二次确认 / 导入即算+引用前复验）
    expect(screen.getByText(/mounted read-only/)).toBeTruthy()
    expect(screen.getByText(/High-risk commands/)).toBeTruthy()
    expect(screen.getByText(/hashed \(SHA256\) on import/)).toBeTruthy()

    const confirm = screen.getByRole('button', { name: 'Confirm and continue' }) as HTMLButtonElement

    expect(confirm.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(confirm.disabled).toBe(false)
  })

  it('ctf: flag vault notice, no authorization gate', () => {
    renderOverlay()

    act(() => requestModeOnboarding('ctf'))

    expect(screen.getByText(/CTF mode/)).toBeTruthy()
    expect(screen.getByText('Flag vault')).toBeTruthy()
    expect(screen.getByText(/masked by default/)).toBeTruthy()
    expect(screen.getByText(/written to the audit log/)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()

    const confirm = screen.getByRole('button', { name: 'Confirm and continue' }) as HTMLButtonElement

    expect(confirm.disabled).toBe(false)
  })

  it('opens on a new-session shortcut kind, and never for project', () => {
    renderOverlay()

    act(() => dispatchNewSession('project'))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => dispatchNewSession('forensics'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('confirm writes the marker and closes — 首用只出现一次', () => {
    renderOverlay()

    act(() => requestModeOnboarding('ctf'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem('fulilian-desktop-mode-onboarding-v1-ctf')).toBe('1')

    // 重进不再展示（标记已置）。
    act(() => requestModeOnboarding('ctf'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
