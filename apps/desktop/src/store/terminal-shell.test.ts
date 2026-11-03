import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalShellPref } from '@/global'

import { $terminalShellPref, loadTerminalShellPref, setTerminalShellPref } from './terminal-shell'

const PREF: TerminalShellPref = { local: 'pwsh' }

const get = vi.fn()
const set = vi.fn()

function installBridge() {
  Object.defineProperty(window, 'fulilianDesktop', {
    configurable: true,
    value: {
      terminalShell: {
        get: () => get(),
        set: (patch: { local?: TerminalShellPref['local'] }) => set(patch)
      }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  $terminalShellPref.set(null)
  get.mockResolvedValue(PREF)
  set.mockImplementation((patch: { local?: unknown }) =>
    Promise.resolve({
      local: (patch.local === undefined ? PREF.local : patch.local) as TerminalShellPref['local']
    } satisfies TerminalShellPref)
  )
  installBridge()
})

afterEach(() => {
  delete (window as unknown as { fulilianDesktop?: unknown }).fulilianDesktop
})

describe('terminal-shell store', () => {
  it('loads the preference', async () => {
    const state = await loadTerminalShellPref()

    expect(state).toEqual(PREF)
    expect($terminalShellPref.get()).toEqual(PREF)
  })

  it('merge-writes a local patch', async () => {
    await setTerminalShellPref({ local: 'cmd' })

    expect(set).toHaveBeenCalledWith({ local: 'cmd' })
    expect($terminalShellPref.get()?.local).toBe('cmd')
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
