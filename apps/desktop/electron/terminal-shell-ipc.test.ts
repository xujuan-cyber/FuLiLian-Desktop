// fulilian:terminal-shell:* channel tests (step17). electron + node:fs are
// stubbed: registration + handler delegation is observable without a real app
// and without touching a real userData directory.
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const { handle, getPath, memFiles } = vi.hoisted(() => ({
  handle: vi.fn(),
  getPath: vi.fn(() => 'C:\\userData'),
  memFiles: new Map<string, string>()
}))

vi.mock('electron', () => ({
  app: { getPath },
  ipcMain: { handle }
}))

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readFileSync: (filePath: string) => {
      if (!memFiles.has(String(filePath))) {
        throw new Error('missing')
      }

      return memFiles.get(String(filePath))
    },
    statSync: (filePath: string) => {
      if (!memFiles.has(String(filePath))) {
        throw new Error('missing')
      }

      return { mtimeMs: 1 }
    }
  }
}))

vi.mock('./hardening', () => ({
  writeSecretFileAtomic: (filePath: string, data: string) => {
    memFiles.set(String(filePath), data)
  }
}))

import { registerTerminalShellIpc, TERMINAL_SHELL_CHANNELS } from './terminal-shell-ipc'

function handlerFor(channel: string) {
  const call = handle.mock.calls.find(([name]) => name === channel)

  assert.ok(call, `expected ipcMain.handle registration for ${channel}`)

  return call[1] as (event: unknown, payload: unknown) => unknown
}

beforeEach(() => {
  handle.mockReset()
  getPath.mockClear()
  memFiles.clear()
})

test('both channels register and userData is configured once', () => {
  const api = registerTerminalShellIpc({ rememberLog: () => {} })

  assert.deepEqual(api.channels, TERMINAL_SHELL_CHANNELS)
  assert.deepEqual(
    handle.mock.calls.map(([name]) => name),
    ['fulilian:terminal-shell:get', 'fulilian:terminal-shell:set']
  )
  assert.equal(getPath.mock.calls.length, 1)
  assert.ok((getPath.mock.calls[0] as unknown[]).includes('userData'))
})

test('get returns the normalized preference', () => {
  registerTerminalShellIpc({ rememberLog: () => {} })

  const state = handlerFor('fulilian:terminal-shell:get')(null, undefined) as { local: string; wslDistro: null }

  assert.deepEqual(state, { local: 'auto', wslDistro: null })
})

test('set merges the patch, whitelists it, and returns the resulting state', () => {
  const rememberLog = vi.fn()

  registerTerminalShellIpc({ rememberLog })

  const state = handlerFor('fulilian:terminal-shell:set')(null, {
    local: 'pwsh',
    wslDistro: 'kali-linux'
  }) as { local: string; wslDistro: null | string }

  assert.deepEqual(state, { local: 'pwsh', wslDistro: 'kali-linux' })
  assert.equal(rememberLog.mock.calls.length, 1)

  // A hostile payload cannot smuggle an unknown choice or a path-y distro.
  const hostile = handlerFor('fulilian:terminal-shell:set')(null, {
    local: 'zsh',
    wslDistro: '../../etc'
  }) as { local: string; wslDistro: null | string }

  assert.deepEqual(hostile, { local: 'pwsh', wslDistro: null }, 'junk patch values keep the stored state')

  // A non-object payload degrades to a no-op merge.
  const noop = handlerFor('fulilian:terminal-shell:set')(null, 42) as { local: string }

  assert.equal(noop.local, 'pwsh')

  // Clearing the distro works (null patch value is applied).
  const cleared = handlerFor('fulilian:terminal-shell:set')(null, { wslDistro: null }) as {
    wslDistro: null | string
  }

  assert.equal(cleared.wslDistro, null)
})

test('an unwritable userData directory degrades to in-memory state, not a throw', () => {
  getPath.mockReturnValue('')

  registerTerminalShellIpc({ rememberLog: () => {} })

  const state = handlerFor('fulilian:terminal-shell:set')(null, { local: 'cmd' }) as { local: string }

  assert.equal(state.local, 'cmd', 'in-memory state still works without a real directory')
})
