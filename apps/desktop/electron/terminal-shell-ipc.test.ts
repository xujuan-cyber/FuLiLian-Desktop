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
import { resetShellDegradationLog } from './terminal-shell-resolve'

function handlerFor(channel: string) {
  const call = handle.mock.calls.find(([name]) => name === channel)

  assert.ok(call, `expected ipcMain.handle registration for ${channel}`)

  return call[1] as (event: unknown, payload: unknown) => unknown
}

beforeEach(() => {
  handle.mockReset()
  getPath.mockClear()
  memFiles.clear()
  resetShellDegradationLog()
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

test('get seeds and returns the normalized preference (N1 default: pwsh / windows)', () => {
  registerTerminalShellIpc({ rememberLog: () => {} })

  const { resolvedShell, ...state } = handlerFor('fulilian:terminal-shell:get')(null, undefined) as {
    local: string
    resolvedShell: { choice: string; degraded: boolean; path: null | string }
    wslDistro: null
  } & Record<string, unknown>

  assert.deepEqual(state, { envSide: 'windows', local: 'pwsh', wslDistro: null })
  // R-4: the effective shell rides along as an additive, read-only field.
  assert.equal(resolvedShell.choice, 'pwsh')
  assert.equal(typeof resolvedShell.degraded, 'boolean')
  assert.ok(resolvedShell.path === null || typeof resolvedShell.path === 'string')
})

test('a machine without PowerShell 7 reports the fallback and logs it once (R-4)', () => {
  const saved = {
    COMSPEC: process.env.COMSPEC,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir
  }

  // Simulate "pwsh not installed": empty PATH and a bogus Windows root so
  // neither pwsh nor the System32 5.1 binary can be found.
  process.env.PATH = ''
  process.env.SystemRoot = 'C:\\no-such-windows'
  delete process.env.windir
  process.env.COMSPEC = 'C:\\no-such-windows\\System32\\cmd.exe'

  try {
    const rememberLog = vi.fn()

    registerTerminalShellIpc({ rememberLog })

    const state = handlerFor('fulilian:terminal-shell:get')(null, undefined) as {
      local: string
      resolvedShell: { degraded: boolean; fallback: null | string; path: null | string }
    }

    assert.equal(state.local, 'pwsh', 'the stored choice is preserved')
    assert.equal(state.resolvedShell.degraded, true, 'the fallback is explicit, never silent')
    assert.equal(state.resolvedShell.fallback, 'cmd')
    assert.equal(state.resolvedShell.path, 'C:\\no-such-windows\\System32\\cmd.exe')
    assert.equal(
      rememberLog.mock.calls.some(([line]) => String(line).includes('pwsh unavailable')),
      true,
      'one desktop.log line explains the degradation'
    )

    // A second read (same degradation) must not spam the log.
    const loggedBefore = rememberLog.mock.calls.length

    handlerFor('fulilian:terminal-shell:get')(null, undefined)

    assert.equal(rememberLog.mock.calls.length, loggedBefore, 'the degradation line is emitted once')
  } finally {
    if (saved.PATH === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = saved.PATH
    }

    if (saved.windir === undefined) {
      delete process.env.windir
    } else {
      process.env.windir = saved.windir
    }

    process.env.SystemRoot = saved.SystemRoot
    process.env.COMSPEC = saved.COMSPEC
  }
})

test('set merges the patch, whitelists it, and returns the resulting state', () => {
  const rememberLog = vi.fn()

  registerTerminalShellIpc({ rememberLog })

  const { resolvedShell, ...state } = handlerFor('fulilian:terminal-shell:set')(null, {
    local: 'pwsh',
    wslDistro: 'kali-linux'
  }) as { local: string; resolvedShell: { choice: string }; wslDistro: null | string } & Record<string, unknown>

  assert.deepEqual(state, { envSide: 'windows', local: 'pwsh', wslDistro: 'kali-linux' })
  assert.equal(resolvedShell.choice, 'pwsh')
  assert.equal(
    rememberLog.mock.calls.some(([line]) => String(line) === '[terminal-shell] set local=pwsh wslDistro=kali-linux'),
    true,
    'the write is still logged as before'
  )

  // A hostile payload cannot smuggle an unknown choice or a path-y distro.
  const { resolvedShell: _ignored, ...hostile } = handlerFor('fulilian:terminal-shell:set')(null, {
    local: 'zsh',
    wslDistro: '../../etc'
  }) as { local: string; wslDistro: null | string } & Record<string, unknown>

  assert.deepEqual(hostile, { envSide: 'windows', local: 'pwsh', wslDistro: null }, 'junk patch values keep the stored state')

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
