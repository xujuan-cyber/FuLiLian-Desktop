// Contract assertions for the fulilian:wsl-cli:* IPC registration (step09 v1).
// electron.ipcMain is mocked (no new deps); we assert the frozen channel
// names, the delegation wiring, and the defensive set-optin payload handling.
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle }
}))

// Hard constraint (step09 §九 2): the v1 suite must never spawn wsl.exe. A
// probe call without an explicit distro would hit resolveDefaultWslDistro(),
// so the bridge is mocked to a fixed distro for this file.
vi.mock('./wsl-path-bridge', () => ({
  resolveDefaultWslDistro: () => 'Ubuntu'
}))

import { registerWslCliIpc, WSL_CLI_CHANNELS } from './wsl-cli-ipc'
import { readWslCliOptinState, writeWslCliOptin } from './wsl-cli-probe'

/** Bind the registered handler with a stand-in IpcMainInvokeEvent as arg #1,
 *  mirroring how ipcMain.handle invokes it at runtime. */
function handlerFor(channel: string): (payload: unknown) => unknown {
  const call = handle.mock.calls.find(([name]) => name === channel)

  assert.ok(call, `expected ipcMain.handle registration for ${channel}`)

  const raw = call[1] as (event: unknown, payload: unknown) => unknown

  return payload => raw(null, payload)
}

beforeEach(() => {
  handle.mockReset()
})

test('WSL_CLI_CHANNELS are the three frozen channel names, verbatim', () => {
  assert.deepEqual([...WSL_CLI_CHANNELS], [
    'fulilian:wsl-cli:probe',
    'fulilian:wsl-cli:get-optin',
    'fulilian:wsl-cli:set-optin'
  ])
})

test('registerWslCliIpc registers exactly the three frozen channels', () => {
  const api = registerWslCliIpc({ rememberLog: () => {} })

  assert.deepEqual(
    handle.mock.calls.map(([name]) => name),
    [...WSL_CLI_CHANNELS]
  )
  assert.deepEqual([...api.channels], [...WSL_CLI_CHANNELS])
  assert.equal(typeof api.probeCacheInvalidate, 'function')
})

test('probe handler delegates to probeWslClis and returns the contract shape', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const result = handlerFor('fulilian:wsl-cli:probe')({ distro: 'Ubuntu' }) as ReturnType<
    typeof import('./wsl-cli-probe').probeWslClis
  >

  assert.equal(result.distro, 'Ubuntu')
  assert.deepEqual(result.distros, ['Ubuntu'])
  assert.equal(result.entries.length, 5)
  assert.equal(typeof result.probedAt, 'number')
})

test('probe handler tolerates a fully omitted payload', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const result = handlerFor('fulilian:wsl-cli:probe')(undefined) as { entries: unknown[]; error: string | null }

  assert.equal(result.entries.length, 5)
})

test('set-optin handler applies merge-write semantics and returns the state', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const state = handlerFor('fulilian:wsl-cli:set-optin')({ optin: { claude: true } }) as {
    optin: Record<string, boolean>
    probedAt: null | number
  }

  assert.equal(state.optin.claude, true)
  assert.equal(state.optin.codex, false)
  assert.deepEqual(state, readWslCliOptinState())

  writeWslCliOptin({ claude: false })
})

test('set-optin handler survives undefined / malformed payloads (defensive read)', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const setOptin = handlerFor('fulilian:wsl-cli:set-optin')

  assert.doesNotThrow(() => setOptin(undefined))
  assert.doesNotThrow(() => setOptin(null))
  assert.doesNotThrow(() => setOptin({}))

  const state = setOptin({}) as { optin: Record<string, boolean> }
  assert.equal(Object.keys(state.optin).length, 5)
})
