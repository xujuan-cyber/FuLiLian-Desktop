import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $terminalShellPref } from '@/store/terminal-shell'
import { $wslCliProbe } from '@/store/wsl-cli'
import { stubResizeObserver } from '@/test/jsdom'

import { TerminalShellSetting } from './terminal-shell-setting'

// N1/N2 settings surface:
//   - mounting must NOT probe WSL (the eager `wsl.exe` call this batch removes);
//   - the page must show the REAL resolved shell path and warn on a fallback;
//   - the WSL probe is behind an explicit button.
stubResizeObserver()

const get = vi.fn()
const set = vi.fn()
const probe = vi.fn()
const getOptin = vi.fn()
const setOptin = vi.fn()

function basePref(overrides: Record<string, unknown> = {}) {
  return {
    envSide: 'windows',
    local: 'pwsh',
    wslDistro: null,
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
  probe.mockReset().mockResolvedValue({
    distro: 'Ubuntu',
    distros: ['Ubuntu'],
    entries: [],
    error: null,
    probedAt: 1
  })
  getOptin.mockReset()
  setOptin.mockReset()
  $terminalShellPref.set(null)
  $wslCliProbe.set(null)

  ;(window as unknown as { fulilianDesktop: unknown }).fulilianDesktop = {
    terminalShell: { get, set },
    wslCli: { getOptin, probe, setOptin }
  }
})

afterEach(() => {
  cleanup()
  $terminalShellPref.set(null)
  $wslCliProbe.set(null)
})

describe('TerminalShellSetting — N1: nothing touches WSL on mount', () => {
  it('loads the preference but never runs the WSL probe', async () => {
    renderSetting()

    await waitFor(() => expect(get).toHaveBeenCalled())

    // Give any stray effect a chance to fire before asserting "never".
    await act(async () => {
      await Promise.resolve()
    })

    expect(probe).not.toHaveBeenCalled()
    expect(screen.getByText('Detect WSL distros')).toBeTruthy()
    expect(screen.getByText(/WSL is never touched at startup/)).toBeTruthy()
  })

  it('runs the probe once the user asks for it', async () => {
    renderSetting()

    await waitFor(() => expect(get).toHaveBeenCalled())

    act(() => {
      screen.getByText('Detect WSL distros').click()
    })

    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
  })
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
