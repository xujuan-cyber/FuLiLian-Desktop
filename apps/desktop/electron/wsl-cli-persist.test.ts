// Opt-in persistence tests (step09 v2 · T3/E4).
//
// E4 requires proof by *temporary userData directory* or by unit-testing the
// read/write functions directly — a real app restart is not reachable inside
// the sandbox. These tests use a real mkdtemp directory for the round-trip and
// an injected statSync for the deterministic mtime-cache assertions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test } from 'vitest'

import { WSL_CLI_NAMES } from './wsl-cli-probe'
import {
  normalizeWslCliOptinState,
  readWslCliOptinFile,
  resetWslCliPersistCache,
  WSL_CLI_OPTIN_FILE_NAME,
  wslCliOptinFilePath,
  writeWslCliOptinFile
} from './wsl-cli-persist'

const NAMES = [...WSL_CLI_NAMES]

let tempDir = ''

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fulilian-wsl-cli-persist-'))
}

/** Real file I/O, but with a caller-controlled mtime so cache hits/misses are
 *  deterministic (a real write can land on the same mtimeMs on Windows). */
function depsAt(mtime: null | number) {
  return {
    fs: {
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      statSync: (() => ({ mtimeMs: mtime })) as unknown as typeof fs.statSync
    }
  }
}

beforeEach(() => {
  resetWslCliPersistCache()
  tempDir = makeTempDir()
})

afterEach(() => {
  resetWslCliPersistCache()

  try {
    fs.rmSync(tempDir, { force: true, recursive: true })
  } catch {
    // temp cleanup is best-effort
  }
})

test('wslCliOptinFilePath joins userData with the frozen file name', () => {
  assert.equal(wslCliOptinFilePath('C:\\Users\\me\\AppData\\Roaming\\fulilian'), path.join('C:\\Users\\me\\AppData\\Roaming\\fulilian', WSL_CLI_OPTIN_FILE_NAME))
  assert.equal(WSL_CLI_OPTIN_FILE_NAME, 'wsl-cli.json')
})

test('normalizeWslCliOptinState always yields five keys, all false by default', () => {
  const state = normalizeWslCliOptinState(null, NAMES)
  assert.equal(Object.keys(state.optin).length, 5)
  assert.equal(state.probedAt, null)

  for (const name of NAMES) {
    assert.equal(state.optin[name as keyof typeof state.optin], false)
  }

  // A partial / hostile payload still produces the full five-key shape, and
  // only a literal `true` counts as opted in.
  const weird = normalizeWslCliOptinState({ optin: { claude: true, codex: 'yes', nope: true }, probedAt: 'x' }, NAMES)
  assert.equal(weird.optin.claude, true)
  assert.equal(weird.optin.codex, false)
  assert.equal(Object.keys(weird.optin).length, 5)
  assert.equal(weird.probedAt, null)
})

test('reading a missing file degrades to all-false without throwing', () => {
  const target = path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)
  const state = readWslCliOptinFile(target, NAMES)

  assert.equal(state.probedAt, null)
  assert.equal(Object.keys(state.optin).length, 5)
  assert.deepEqual(state.optin, normalizeWslCliOptinState(null, NAMES).optin)
})

test('reading a corrupt file degrades to all-false without throwing', () => {
  const target = path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)
  fs.writeFileSync(target, '{ this is not json')

  let state: ReturnType<typeof readWslCliOptinFile> | undefined
  assert.doesNotThrow(() => {
    state = readWslCliOptinFile(target, NAMES)
  })
  assert.equal(state?.probedAt, null)
  assert.equal(Object.keys(state!.optin).length, 5)
  assert.equal(state!.optin.hermes, false)
})

test('write then read round-trips through a real temp userData directory', () => {
  const target = path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)

  const written = writeWslCliOptinFile(
    target,
    { optin: { claude: true, codebuddy: false, codex: false, fulilian: false, hermes: true }, probedAt: 1_700_000_000_000 },
    NAMES
  )

  assert.equal(written.optin.claude, true)
  assert.equal(written.probedAt, 1_700_000_000_000)
  assert.ok(fs.existsSync(target), 'expected wsl-cli.json on disk')
  // The writer is temp-then-rename, so no temp file may survive.
  assert.equal(fs.existsSync(`${target}.tmp`), false)

  const onDisk = JSON.parse(fs.readFileSync(target, 'utf8'))
  assert.equal(onDisk.optin.claude, true)
  assert.equal(onDisk.optin.hermes, true)
  assert.equal(onDisk.optin.codex, false)
  assert.equal(Object.keys(onDisk.optin).length, 5)

  // A fresh process view (cache cleared) reads the same values back.
  resetWslCliPersistCache()
  const reread = readWslCliOptinFile(target, NAMES)
  assert.deepEqual(reread, written)
})

test('the mtime cache is reused on an unchanged file and invalidated when it changes', () => {
  const target = path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)

  const missing = readWslCliOptinFile(target, NAMES, depsAt(1000))
  assert.equal(missing.optin.claude, false)

  fs.writeFileSync(target, JSON.stringify({ optin: { claude: true }, probedAt: 42 }))

  // Same mtime → served from cache (same object identity, still the stale value).
  const cached = readWslCliOptinFile(target, NAMES, depsAt(1000))
  assert.equal(cached, missing)
  assert.equal(cached.optin.claude, false)

  // New mtime → re-read from disk.
  const fresh = readWslCliOptinFile(target, NAMES, depsAt(1001))
  assert.notEqual(fresh, cached)
  assert.equal(fresh.optin.claude, true)
  assert.equal(fresh.probedAt, 42)
})

test('a failing atomic writer never throws and still returns the state', () => {
  const target = path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)
  const deps = {
    writeAtomic: () => {
      throw new Error('EACCES: permission denied')
    }
  }

  const wanted = normalizeWslCliOptinState({ optin: { fulilian: true } }, NAMES)

  let state: ReturnType<typeof writeWslCliOptinFile> | undefined
  assert.doesNotThrow(() => {
    state = writeWslCliOptinFile(target, wanted, NAMES, deps)
  })
  assert.equal(state!.optin.fulilian, true)
  // Write-through cache keeps the value readable for the rest of the session.
  assert.equal(readWslCliOptinFile(target, NAMES, deps).optin.fulilian, true)
})

test('a null file path keeps everything in memory (no userData available)', () => {
  const written = writeWslCliOptinFile(null, normalizeWslCliOptinState({ optin: { codex: true }, probedAt: 7 }, NAMES), NAMES)
  assert.equal(written.optin.codex, true)
  assert.equal(readWslCliOptinFile(null, NAMES).optin.codex, true)
  assert.equal(readWslCliOptinFile(null, NAMES).probedAt, 7)
  assert.equal(fs.existsSync(path.join(tempDir, WSL_CLI_OPTIN_FILE_NAME)), false)
})
