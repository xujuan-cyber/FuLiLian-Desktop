// Contract assertions for the fulilian:wsl-cli:* IPC registration (step09 v2).
//
// electron.ipcMain is mocked (no new deps); we assert the frozen channel names,
// the delegation wiring, the defensive payload handling (T6), and the opt-in
// disk round-trip through the real handlers (T3/E4). Every probe runs against a
// synthetic exec — no test may spawn wsl.exe.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test, vi } from 'vitest'

const { handle, holder } = vi.hoisted(() => ({
  handle: vi.fn(),
  // Mutable so beforeEach can point the opt-in store at a fresh temp userData
  // directory before registerWslCliIpc() resolves it.
  holder: { userDataDir: '' }
}))

vi.mock('electron', () => ({
  app: { getPath: () => holder.userDataDir },
  ipcMain: { handle }
}))

// A probe call without an explicit distro would hit resolveDefaultWslDistro(),
// which spawns `wsl.exe -l -q`. Pin it (T7: no real spawn in tests).
vi.mock('./wsl-path-bridge', () => ({
  resolveDefaultWslDistro: () => 'Ubuntu'
}))

import { registerWslCliIpc, WSL_CLI_CHANNELS } from './wsl-cli-ipc'
import {
  configureWslCliOptinPersistence,
  configureWslCliProbeExec,
  probeCacheInvalidate,
  readWslCliOptinState,
  WSL_CLI_PROBE_ERROR
} from './wsl-cli-probe'
import { resetWslCliPersistCache, WSL_CLI_OPTIN_FILE_NAME } from './wsl-cli-persist'

const DISTRO_LIST_OUTPUT = 'Ubuntu\nDebian\n'
const PROBE_OUTPUT = [
  'claude\t/usr/local/bin/claude\t2.1.0 (Claude Code)',
  'codex\t/usr/local/bin/codex\t',
  'codebuddy\t\t',
  'hermes\t/home/me/.local/bin/hermes\thermes 0.9.0',
  'fulilian\t/usr/bin/fulilian\tfulilian 1.3.0'
].join('\n')

function syntheticExec() {
  return {
    exec: (_file: string, args: string[]) => (args[0] === '-l' && args[1] === '-q' ? DISTRO_LIST_OUTPUT : PROBE_OUTPUT)
  }
}

/** Bind the registered handler with a stand-in IpcMainInvokeEvent as arg #1,
 *  mirroring how ipcMain.handle invokes it at runtime. The payload is optional
 *  because get-optin takes none. */
function handlerFor(channel: string): (payload?: unknown) => unknown {
  const call = handle.mock.calls.find(([name]) => name === channel)

  assert.ok(call, `expected ipcMain.handle registration for ${channel}`)

  const raw = call[1] as (event: unknown, payload: unknown) => unknown

  return payload => raw(null, payload)
}

beforeEach(() => {
  handle.mockReset()
  holder.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fulilian-wsl-cli-ipc-'))
  configureWslCliProbeExec(syntheticExec())
  probeCacheInvalidate()
})

afterEach(() => {
  configureWslCliProbeExec()
  probeCacheInvalidate()
  configureWslCliOptinPersistence(null)

  try {
    fs.rmSync(holder.userDataDir, { force: true, recursive: true })
  } catch {
    // temp cleanup is best-effort
  }
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
  assert.deepEqual(result.distros, ['Ubuntu', 'Debian'])
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']
  )
  assert.equal(result.error, null)
  assert.equal(typeof result.probedAt, 'number')
})

test('probe handler tolerates a fully omitted payload', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const result = handlerFor('fulilian:wsl-cli:probe')(undefined) as { entries: unknown[]; error: string | null }

  assert.equal(result.entries.length, 5)
})

test('T6/E7 probe handler ignores a non-string distro instead of throwing', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  const probe = handlerFor('fulilian:wsl-cli:probe')

  for (const hostile of [123, { distro: 'x' }, true, null, '']) {
    let result: { distro: string; entries: unknown[] } | undefined

    assert.doesNotThrow(() => {
      result = probe({ distro: hostile }) as { distro: string; entries: unknown[] }
    }, `distro=${JSON.stringify(hostile)} must not throw`)

    assert.equal(result!.entries.length, 5)
    assert.equal(result!.distro, 'Ubuntu', 'falls back to the default distro')
  }
})

test('probe handler surfaces a degraded result (never a rejected promise) when spawn is refused', () => {
  configureWslCliProbeExec({
    exec: () => {
      throw Object.assign(new Error('spawnSync wsl.exe EPERM'), { code: 'EPERM' })
    }
  })
  registerWslCliIpc({ rememberLog: () => {} })

  const result = handlerFor('fulilian:wsl-cli:probe')({ distro: 'Ubuntu' }) as {
    entries: unknown[]
    error: string | null
  }

  assert.equal(result.error, WSL_CLI_PROBE_ERROR.spawnFailed)
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
})

test('T3/E4 set-optin persists to userData/wsl-cli.json and get-optin reads it back cold', () => {
  registerWslCliIpc({ rememberLog: () => {} })

  handlerFor('fulilian:wsl-cli:set-optin')({ optin: { claude: true, hermes: true } })

  const file = path.join(holder.userDataDir, WSL_CLI_OPTIN_FILE_NAME)

  assert.ok(fs.existsSync(file), `expected ${WSL_CLI_OPTIN_FILE_NAME} under the temp userData dir`)

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))

  assert.equal(onDisk.optin.claude, true)
  assert.equal(onDisk.optin.hermes, true)
  assert.equal(onDisk.optin.codex, false)
  assert.equal(Object.keys(onDisk.optin).length, 5)

  // Simulate a fresh process: drop the mtime cache, then read through the IPC
  // handler again — the values must come back off disk, not from memory.
  resetWslCliPersistCache()

  const state = handlerFor('fulilian:wsl-cli:get-optin')() as { optin: Record<string, boolean> }

  assert.equal(state.optin.claude, true)
  assert.equal(state.optin.hermes, true)
  assert.equal(state.optin.codex, false)
  assert.equal(Object.keys(state.optin).length, 5)
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
