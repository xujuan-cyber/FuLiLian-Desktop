// Unit tests for the terminal shell preference file (step17).
// fs / atomic writer are stubbed: no real userData directory is touched.
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

import {
  configureTerminalShellPrefPersistence,
  defaultTerminalShellPref,
  normalizeTerminalShellPref,
  readTerminalShellPref,
  readTerminalShellPrefFile,
  resetTerminalShellPrefCache,
  TERMINAL_SHELL_FILE_NAME,
  type TerminalShellPersistFs,
  terminalShellPrefFilePath,
  writeTerminalShellPref,
  writeTerminalShellPrefFile
} from './terminal-shell-pref'

function makeFs() {
  const impl = {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn<() => string>(() => {
      throw new Error('missing')
    }),
    statSync: vi.fn<() => { mtimeMs: number }>(() => {
      throw new Error('missing')
    })
  }

  // Intersection: keeps the Mock typing for assertions while satisfying the
  // injectable interface.
  return impl as typeof impl & TerminalShellPersistFs
}

beforeEach(() => {
  resetTerminalShellPrefCache()
  configureTerminalShellPrefPersistence(null)
})

test('terminalShellPrefFilePath joins the userData directory', () => {
  assert.equal(terminalShellPrefFilePath('C:\\userData'), `C:\\userData\\${TERMINAL_SHELL_FILE_NAME}`)
  assert.equal(terminalShellPrefFilePath(''), TERMINAL_SHELL_FILE_NAME, 'empty dir degrades to a bare name')
})

test('normalize whitelists the local shell choice and defaults everything else', () => {
  assert.deepEqual(normalizeTerminalShellPref(null), defaultTerminalShellPref())
  assert.deepEqual(normalizeTerminalShellPref(undefined), defaultTerminalShellPref())
  assert.deepEqual(normalizeTerminalShellPref('garbage'), defaultTerminalShellPref())
  assert.deepEqual(normalizeTerminalShellPref({ local: 'zsh' }), defaultTerminalShellPref())
  assert.deepEqual(normalizeTerminalShellPref({ local: 42, wslDistro: 7 }), defaultTerminalShellPref())

  for (const choice of ['auto', 'cmd', 'powershell', 'pwsh'] as const) {
    assert.equal(normalizeTerminalShellPref({ local: choice }).local, choice)
  }

  assert.deepEqual(normalizeTerminalShellPref({ local: 'pwsh', wslDistro: 'kali-linux' }), {
    local: 'pwsh',
    wslDistro: 'kali-linux'
  })

  // An explicit auto with a distro keeps the distro (they are independent).
  assert.deepEqual(normalizeTerminalShellPref({ local: 'auto', wslDistro: 'docker-desktop' }).wslDistro, 'docker-desktop')
})

test('normalize rejects hostile wslDistro shapes', () => {
  for (const bad of ['', '   ', '../etc', 'a;rm', 'x/y', 'Übuntu', 42, {}, null]) {
    assert.equal(normalizeTerminalShellPref({ wslDistro: bad }).wslDistro, null, `wslDistro=${String(JSON.stringify(bad))}`)
  }

  // Real-world `wsl -l -q` shapes all pass.
  for (const good of ['Ubuntu', 'kali-linux', 'docker-desktop', 'Ubuntu-22.04', 'openSUSE-Leap-15.6']) {
    assert.equal(normalizeTerminalShellPref({ wslDistro: good }).wslDistro, good)
  }

  // Surrounding whitespace is trimmed defensively (UTF-16 NUL included).
  assert.equal(normalizeTerminalShellPref({ wslDistro: '  Ubuntu-22.04  ' }).wslDistro, 'Ubuntu-22.04')
  assert.equal(normalizeTerminalShellPref({ wslDistro: 'U\x00buntu' }).wslDistro, null, 'NUL-padded names rejected')
})

test('a missing file reads back as the default and never throws', () => {
  const fsImpl = makeFs()

  assert.deepEqual(readTerminalShellPrefFile('C:\\x\\file.json', { fs: fsImpl }), defaultTerminalShellPref())
  assert.equal(fsImpl.statSync.mock.calls.length, 1)
})

test('a corrupt file degrades to the default', () => {
  const fsImpl = makeFs()

  fsImpl.statSync.mockReturnValue({ mtimeMs: 100 })
  fsImpl.readFileSync.mockReturnValue('{ not json')

  assert.deepEqual(readTerminalShellPrefFile('C:\\x\\file.json', { fs: fsImpl }), defaultTerminalShellPref())
})

test('the mtime cache serves repeat reads without re-reading the file', () => {
  const fsImpl = makeFs()

  fsImpl.statSync.mockReturnValue({ mtimeMs: 100 })
  fsImpl.readFileSync.mockReturnValue(JSON.stringify({ local: 'cmd', wslDistro: 'kali-linux' }))

  const first = readTerminalShellPrefFile('C:\\x\\file.json', { fs: fsImpl })

  assert.deepEqual(first, { local: 'cmd', wslDistro: 'kali-linux' })

  fsImpl.readFileSync.mockClear()

  assert.deepEqual(readTerminalShellPrefFile('C:\\x\\file.json', { fs: fsImpl }), first)
  assert.equal(fsImpl.readFileSync.mock.calls.length, 0, 'cache hit skips the read')

  fsImpl.statSync.mockReturnValue({ mtimeMs: 200 })

  assert.deepEqual(readTerminalShellPrefFile('C:\\x\\file.json', { fs: fsImpl }), first)
  assert.equal(fsImpl.readFileSync.mock.calls.length, 1, 'an mtime bump re-reads')
})

test('a null path is in-memory only and isolates from file-backed state', () => {
  const fsImpl = makeFs()
  const filePath = 'C:\\x\\file.json'

  fsImpl.statSync.mockReturnValue({ mtimeMs: 1 })
  fsImpl.readFileSync.mockReturnValue(JSON.stringify({ local: 'pwsh' }))

  assert.deepEqual(readTerminalShellPrefFile(filePath, { fs: fsImpl }), { local: 'pwsh', wslDistro: null })

  const written = writeTerminalShellPrefFile(null, { local: 'cmd' })

  assert.deepEqual(written, { local: 'cmd', wslDistro: null })
  // The null-path cache is keyed separately: the file-backed read is untouched.
  assert.deepEqual(readTerminalShellPrefFile(filePath, { fs: fsImpl }), { local: 'pwsh', wslDistro: null })
})

test('write merges over the current state, normalizes, and writes atomically', () => {
  const fsImpl = makeFs()
  const writeAtomic = vi.fn()
  const filePath = 'C:\\x\\file.json'

  fsImpl.statSync.mockReturnValue({ mtimeMs: 5 })
  fsImpl.readFileSync.mockReturnValue(JSON.stringify({ local: 'pwsh', wslDistro: 'kali-linux' }))

  const state = writeTerminalShellPrefFile(filePath, { wslDistro: 'docker-desktop' }, { fs: fsImpl, writeAtomic })

  assert.deepEqual(state, { local: 'pwsh', wslDistro: 'docker-desktop' })
  assert.equal(writeAtomic.mock.calls.length, 1)
  assert.equal(writeAtomic.mock.calls[0][0], filePath)
  assert.deepEqual(JSON.parse(writeAtomic.mock.calls[0][1]), state)
  assert.equal(fsImpl.mkdirSync.mock.calls.length, 1, 'the parent directory is ensured')

  // A patch with junk keys cannot smuggle an unknown choice into the file.
  const hostile = writeTerminalShellPrefFile(
    filePath,
    { local: 'zsh', wslDistro: '../../etc' } as unknown as { wslDistro?: unknown },
    { fs: fsImpl, writeAtomic }
  )

  assert.deepEqual(hostile, { local: 'pwsh', wslDistro: null })

  // A failed write is swallowed and the in-memory state still wins.
  const failing = vi.fn(() => {
    throw new Error('disk full')
  })

  const survived = writeTerminalShellPrefFile(filePath, { local: 'cmd' }, { fs: fsImpl, writeAtomic: failing })

  assert.deepEqual(survived, { local: 'cmd', wslDistro: null })
})

test('the configured surface reads and writes through the configured directory', () => {
  const fsImpl = makeFs()
  const writeAtomic = vi.fn()

  configureTerminalShellPrefPersistence('C:\\userData')

  // Both surfaces share one cache — stub the same fs through the configured
  // surface by writing first (mkdir/read are only needed for pre-existing files).
  const written = writeTerminalShellPref({ local: 'pwsh', wslDistro: 'Ubuntu' })

  assert.deepEqual(written, { local: 'pwsh', wslDistro: 'Ubuntu' })
  assert.deepEqual(readTerminalShellPref(), written, 'write-through serves the cached state')

  // Reconfiguring to another directory resets the cache (no stale bleed).
  resetTerminalShellPrefCache()
  configureTerminalShellPrefPersistence(null)

  assert.deepEqual(readTerminalShellPref(), defaultTerminalShellPref())
  assert.equal(fsImpl.readFileSync.mock.calls.length, 0)
})
