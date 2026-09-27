import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WslCliName, WslCliOptin, WslCliProbeResult } from '@/global'

import {
  $wslCliEnabledClis,
  $wslCliOptin,
  $wslCliProbe,
  $wslCliSelected,
  loadWslCliOptin,
  probeWslClis,
  selectWslCli,
  setWslCliOptin
} from './wsl-cli'

const NAMES: WslCliName[] = ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']

function optinAll(value = false): WslCliOptin {
  return { claude: value, codebuddy: value, codex: value, fulilian: value, hermes: value }
}

/** Probe payload in contract shape: always 5 entries, in WSL_CLI_NAMES order. */
function probeResult(available: WslCliName[], error: null | string = null): WslCliProbeResult {
  return {
    distro: 'Ubuntu',
    distros: ['Ubuntu'],
    entries: NAMES.map(name => ({
      available: available.includes(name),
      name,
      posixPath: available.includes(name) ? `/usr/local/bin/${name}` : null,
      version: available.includes(name) ? `${name} 1.0.0` : null
    })),
    error,
    probedAt: 1_700_000_000_000
  }
}

const getOptin = vi.fn()
const probe = vi.fn()
const setOptin = vi.fn()

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
  $wslCliSelected.set(null)
  getOptin.mockResolvedValue({ optin: optinAll(false), probedAt: null })
  probe.mockResolvedValue(probeResult(['claude']))
  setOptin.mockImplementation((payload: { optin: Partial<WslCliOptin> }) =>
    Promise.resolve({ optin: { ...optinAll(false), ...payload.optin }, probedAt: 1_700_000_000_000 })
  )
  installBridge()
})

afterEach(() => {
  delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop
})

describe('wsl-cli store', () => {
  it('loads the opt-in table from the bridge into the store', async () => {
    getOptin.mockResolvedValue({ optin: { ...optinAll(false), claude: true }, probedAt: 42 })

    const state = await loadWslCliOptin()

    expect(state?.optin.claude).toBe(true)
    expect($wslCliOptin.get()?.optin.claude).toBe(true)
    expect($wslCliOptin.get()?.probedAt).toBe(42)
  })

  it('degrades silently (no throw) when the desktop bridge is missing', async () => {
    delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop

    await expect(loadWslCliOptin()).resolves.toBeNull()
    await expect(probeWslClis()).resolves.toBeNull()
    await expect(probeWslClis({ force: true })).resolves.toBeNull()
    await expect(setWslCliOptin({ claude: true })).resolves.toBeNull()

    expect($wslCliProbe.get()).toBeNull()
    expect($wslCliOptin.get()).toBeNull()
  })

  it('degrades silently when the bridge rejects', async () => {
    probe.mockRejectedValue(new Error('ipc down'))
    getOptin.mockRejectedValue(new Error('ipc down'))
    setOptin.mockRejectedValue(new Error('ipc down'))

    await expect(probeWslClis()).resolves.toBeNull()
    await expect(loadWslCliOptin()).resolves.toBeNull()
    await expect(setWslCliOptin({ claude: true })).resolves.toBeNull()
  })

  it('offers only opted-in AND available CLIs, in contract order', async () => {
    probe.mockResolvedValue(probeResult(['claude', 'hermes']))
    setOptin.mockResolvedValue({
      optin: { ...optinAll(false), claude: true, codex: true, hermes: true },
      probedAt: 7
    })

    await probeWslClis()
    await setWslCliOptin({ claude: true, codex: true, hermes: true })

    // codex was opted in but is not available — it must not be offered.
    expect($wslCliEnabledClis.get()).toEqual(['claude', 'hermes'])
  })

  it('a degraded probe never clears an existing opt-in', async () => {
    await setWslCliOptin({ claude: true, hermes: true })
    expect($wslCliOptin.get()?.optin.claude).toBe(true)

    probe.mockResolvedValue(probeResult([], 'stub:not-implemented'))
    await probeWslClis()

    expect($wslCliProbe.get()?.error).toBe('stub:not-implemented')
    // Opt-in survives: a failed probe is an availability problem, not a
    // preference reset.
    expect($wslCliOptin.get()?.optin.claude).toBe(true)
    expect($wslCliOptin.get()?.optin.hermes).toBe(true)
    // Nothing can be launched while availability is unknown.
    expect($wslCliEnabledClis.get()).toEqual([])
  })

  it('writes opt-in as a merge patch (only the changed key travels)', async () => {
    const state = await setWslCliOptin({ codex: true })

    expect(setOptin).toHaveBeenCalledWith({ optin: { codex: true } })
    expect(state?.optin.codex).toBe(true)
    expect($wslCliOptin.get()?.optin.codex).toBe(true)
  })

  it('passes probe options through and mirrors the snapshot', async () => {
    await probeWslClis({ distro: 'Ubuntu-22.04', force: true })

    expect(probe).toHaveBeenCalledWith({ distro: 'Ubuntu-22.04', force: true })
    expect($wslCliProbe.get()?.distro).toBe('Ubuntu')
  })

  it('mirrors the switcher pick and resets to local with null', () => {
    selectWslCli({ distro: 'Ubuntu', cli: 'claude' })
    expect($wslCliSelected.get()).toEqual({ distro: 'Ubuntu', cli: 'claude' })

    selectWslCli(null)
    expect($wslCliSelected.get()).toBeNull()
  })
})
