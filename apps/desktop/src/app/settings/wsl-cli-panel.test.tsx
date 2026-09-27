import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WslCliName, WslCliOptin, WslCliProbeResult } from '@/global'
import { $wslCliOptin, $wslCliProbe } from '@/store/wsl-cli'

const getOptin = vi.fn()
const probe = vi.fn()
const setOptin = vi.fn()

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))

const NAMES: WslCliName[] = ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']

function optinAll(value = false): WslCliOptin {
  return { claude: value, codebuddy: value, codex: value, fulilian: value, hermes: value }
}

function probeResult(available: WslCliName[], error: null | string = null): WslCliProbeResult {
  return {
    distro: 'Ubuntu',
    distros: ['Ubuntu'],
    entries: NAMES.map(name => ({
      available: available.includes(name),
      name,
      posixPath: available.includes(name) ? `/usr/local/bin/${name}` : null,
      version: available.includes(name) ? `${name} 9.9.9` : null
    })),
    error,
    probedAt: 1_700_000_000_000
  }
}

function installBridge() {
  Object.defineProperty(window, 'fulilianDesktop', {
    configurable: true,
    value: {
      wslCli: {
        getOptin: () => getOptin(),
        probe: (options?: { distro?: string; force?: boolean }) => probe(options),
        setOptin: (payload: { optin: Partial<WslCliOptin> }) => setOptin(payload)
      }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  $wslCliProbe.set(null)
  $wslCliOptin.set(null)
  getOptin.mockResolvedValue({ optin: optinAll(false), probedAt: null })
  probe.mockResolvedValue(probeResult(['claude', 'codex']))
  setOptin.mockImplementation((payload: { optin: Partial<WslCliOptin> }) =>
    Promise.resolve({ optin: { ...optinAll(false), ...payload.optin }, probedAt: 1_700_000_000_000 })
  )
  installBridge()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop
})

describe('WslCliPanel', () => {
  it('lists all five CLIs with availability pills after the first probe', async () => {
    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    expect(await screen.findByText('claude')).toBeTruthy()
    for (const name of NAMES) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // Two available, three genuinely missing.
    expect(screen.getAllByText('Available')).toHaveLength(2)
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    // version/posix summary is surfaced for available rows.
    expect(screen.getByText('claude 9.9.9')).toBeTruthy()
    expect(getOptin).toHaveBeenCalled()
    expect(probe).toHaveBeenCalled()
  })

  it('renders a degraded probe as UNKNOWN, never as unavailable', async () => {
    probe.mockResolvedValue(probeResult([], 'stub:not-implemented'))

    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    expect(await screen.findByText('Detection unavailable')).toBeTruthy()
    expect(screen.getByText(/stub:not-implemented/)).toBeTruthy()
    expect(screen.getAllByText('Unknown')).toHaveLength(5)
    expect(screen.queryByText('Unavailable')).toBeNull()
    // Unknown availability is not a dead state: toggles stay usable.
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle.getAttribute('disabled')).toBeNull()
    }
  })

  it('writes opt-in as a merge patch carrying only the changed key', async () => {
    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    fireEvent.click(await screen.findByRole('switch', { name: 'claude' }))

    await waitFor(() => expect(setOptin).toHaveBeenCalledWith({ optin: { claude: true } }))
    expect(setOptin).toHaveBeenCalledTimes(1)
  })

  it('disables the toggle for a CLI the probe confirmed missing', async () => {
    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    await screen.findByText('claude')
    // hermes is not in the available set.
    const hermes = screen.getByRole('switch', { name: 'hermes' })
    expect(hermes.hasAttribute('disabled')).toBe(true)
    fireEvent.click(hermes)
    expect(setOptin).not.toHaveBeenCalled()
  })

  it('re-probe requests a forced probe (cold start needs a loading state)', async () => {
    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    await screen.findByText('claude')
    probe.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Re-detect' }))

    await waitFor(() => expect(probe).toHaveBeenCalledWith({ force: true }))
  })

  it('falls back to a bridge hint when the desktop bridge is absent', async () => {
    delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop

    const { WslCliPanel } = await import('./wsl-cli-panel')
    render(<WslCliPanel />)

    expect(await screen.findByText(/only available in the desktop app/)).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })
})
