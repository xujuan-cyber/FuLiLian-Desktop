import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $terminalShellPref } from '@/store/terminal-shell'
import { stubResizeObserver } from '@/test/jsdom'

import { TerminalShellSetting } from './terminal-shell-setting'

// N1/N2 settings surface:
//   - the page must show the REAL resolved shell path and warn on a fallback.
stubResizeObserver()

const get = vi.fn()
const set = vi.fn()

function basePref(overrides: Record<string, unknown> = {}) {
  return {
    local: 'pwsh',
    resolvedShell: {
      choice: 'pwsh',
      degraded: false,
      fallback: null,
      name: 'pwsh.exe',
      path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    },
    ...overrides
  }
}

function renderSetting() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <TerminalShellSetting />
    </I18nProvider>
  )
}

beforeEach(() => {
  get.mockReset().mockResolvedValue(basePref())
  set.mockReset().mockResolvedValue(basePref())
  $terminalShellPref.set(null)

  ;(window as unknown as { fulilianDesktop: unknown }).fulilianDesktop = {
    terminalShell: { get, set }
  }
})

afterEach(() => {
  cleanup()
  $terminalShellPref.set(null)
})

describe('TerminalShellSetting — R-4: the effective shell is visible', () => {
  it('shows the resolved shell name, its real path, and the startup side', async () => {
    renderSetting()

    await waitFor(() => expect(screen.getByText('pwsh.exe')).toBeTruthy())

    expect(screen.getByText('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeTruthy()
    expect(screen.getByText('Windows (local)')).toBeTruthy()
    // No warning when the requested shell really is installed.
    expect(screen.queryByText(/PowerShell 7 was not found/)).toBeNull()
  })

  it('warns explicitly when pwsh is missing instead of failing silently', async () => {
    get.mockResolvedValue(
      basePref({
        resolvedShell: {
          choice: 'pwsh',
          degraded: true,
          fallback: 'powershell',
          name: 'powershell.exe',
          path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        }
      })
    )

    renderSetting()

    await waitFor(() => expect(screen.getByText(/PowerShell 7 was not found/)).toBeTruthy())

    expect(screen.getByText('powershell.exe')).toBeTruthy()
    expect(screen.getByText('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBeTruthy()
  })
})
