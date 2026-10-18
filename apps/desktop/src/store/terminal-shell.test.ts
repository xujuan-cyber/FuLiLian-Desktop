import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalShellPref } from '@/global'
import { $wslCliDistro, selectWslCliDistro } from '@/store/wsl-cli'

import { $terminalShellPref, loadTerminalShellPref, setTerminalShellPref } from './terminal-shell'

const PREF: TerminalShellPref = { local: 'pwsh', wslDistro: 'kali-linux' }

const get = vi.fn()
const set = vi.fn()

function installBridge() {
  Object.defineProperty(window, 'fulilianDesktop', {
    configurable: true,
    value: {
      terminalShell: {
        get: () => get(),
        set: (patch: { local?: TerminalShellPref['local']; wslDistro?: null | string }) => set(patch)
      }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  $terminalShellPref.set(null)
  $wslCliDistro.set(null)
  get.mockResolvedValue(PREF)
  set.mockImplementation((patch: { local?: unknown; wslDistro?: unknown }) =>
    Promise.resolve({
      local: (patch.local === undefined ? PREF.local : patch.local) as TerminalShellPref['local'],
      wslDistro: (patch.wslDistro === undefined ? PREF.wslDistro : patch.wslDistro) as null | string
    } satisfies TerminalShellPref)
  )
  installBridge()
})

afterEach(() => {
  delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop
})

describe('terminal-shell store', () => {
  it('loads the preference and mirrors wslDistro into the rail distro atom', async () => {
    const state = await loadTerminalShellPref()

    expect(state).toEqual(PREF)
    expect($terminalShellPref.get()).toEqual(PREF)
    expect($wslCliDistro.get()).toBe('kali-linux')
  })

  it('loads without touching the distro atom when no wslDistro is persisted', async () => {
    get.mockResolvedValue({ local: 'cmd', wslDistro: null })

    await loadTerminalShellPref()

    expect($terminalShellPref.get()?.local).toBe('cmd')
    expect($wslCliDistro.get()).toBeNull()
  })

  it('merge-writes a patch and mirrors wslDistro on wslDistro patches', async () => {
    await setTerminalShellPref({ wslDistro: 'docker-desktop' })

    expect(set).toHaveBeenCalledWith({ wslDistro: 'docker-desktop' })
    expect($terminalShellPref.get()?.wslDistro).toBe('docker-desktop')
    expect($wslCliDistro.get()).toBe('docker-desktop')
  })

  it('a local-only patch does not clobber the rail distro atom', async () => {
    selectWslCliDistro('kali-linux')

    await setTerminalShellPref({ local: 'cmd' })

    expect(set).toHaveBeenCalledWith({ local: 'cmd' })
    expect($terminalShellPref.get()?.local).toBe('cmd')
    expect($wslCliDistro.get(), 'the rail pick stays untouched').toBe('kali-linux')
  })

  it('degrades silently when the bridge is absent or rejects', async () => {
    delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop

    await expect(loadTerminalShellPref()).resolves.toBeNull()
    await expect(setTerminalShellPref({ local: 'cmd' })).resolves.toBeNull()
    expect($terminalShellPref.get()).toBeNull()

    installBridge()
    get.mockRejectedValue(new Error('ipc down'))
    set.mockRejectedValue(new Error('ipc down'))

    await expect(loadTerminalShellPref()).resolves.toBeNull()
    await expect(setTerminalShellPref({ local: 'cmd' })).resolves.toBeNull()
    expect($terminalShellPref.get()).toBeNull()
  })
})
