// Contract-shape assertions for the WSL CLI probe surface (step09 v1).
// These lock the frozen contract: 5 entries in WSL_CLI_NAMES order, all-false
// opt-in defaults, merge-write semantics. The stub must never spawn wsl.exe,
// so every probe call passes an explicit distro (no resolveDefaultWslDistro).
import assert from 'node:assert/strict'

import { afterEach, test } from 'vitest'

import {
  probeCacheInvalidate,
  probeWslClis,
  readWslCliOptin,
  readWslCliOptinState,
  WSL_CLI_NAMES,
  writeWslCliOptin
} from './wsl-cli-probe'

afterEach(() => {
  probeCacheInvalidate()
})

test('WSL_CLI_NAMES has exactly the five frozen CLIs in frozen order', () => {
  assert.equal(WSL_CLI_NAMES.length, 5)
  assert.deepEqual([...WSL_CLI_NAMES], ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian'])
})

test('probeWslClis returns every contract field with 5 ordered stub entries', () => {
  const result = probeWslClis({ distro: 'Ubuntu' })

  assert.equal(result.distro, 'Ubuntu')
  assert.deepEqual(result.distros, ['Ubuntu'])
  assert.equal(result.entries.length, 5)
  assert.deepEqual(
    result.entries.map(entry => entry.name),
    ['claude', 'codex', 'codebuddy', 'hermes', 'fulilian']
  )

  for (const entry of result.entries) {
    assert.equal(entry.available, false)
    assert.equal(entry.posixPath, null)
    assert.equal(entry.version, null)
  }

  assert.equal(typeof result.probedAt, 'number')
  assert.equal(typeof result.error, 'string')
  assert.ok(result.error)
})

test('probeWslClis entries are ordered even when probed without an explicit distro preference object', () => {
  // Explicit distro avoids the lazy resolveDefaultWslDistro() wsl.exe spawn.
  const result = probeWslClis({ distro: 'Ubuntu', force: true })
  assert.equal(result.entries[0].name, 'claude')
  assert.equal(result.entries[4].name, 'fulilian')
})

test('readWslCliOptin defaults to five keys, all false', () => {
  const optin = readWslCliOptin()
  assert.equal(Object.keys(optin).length, 5)

  for (const name of WSL_CLI_NAMES) {
    assert.equal(optin[name], false)
  }
})

test('writeWslCliOptin merges: toggling claude leaves the other four keys false', () => {
  const state = writeWslCliOptin({ claude: true })

  assert.equal(state.optin.claude, true)
  assert.equal(state.optin.codex, false)
  assert.equal(state.optin.codebuddy, false)
  assert.equal(state.optin.hermes, false)
  assert.equal(state.optin.fulilian, false)
})

test('writeWslCliOptin with an empty patch does not throw and keeps all five keys', () => {
  assert.doesNotThrow(() => writeWslCliOptin({}))

  const optin = readWslCliOptin()
  assert.equal(Object.keys(optin).length, 5)
})

test('readWslCliOptinState exposes the probedAt snapshot slot (null before any probe)', () => {
  const state = readWslCliOptinState()
  assert.equal(state.probedAt, null)
  assert.equal(Object.keys(state.optin).length, 5)
})
