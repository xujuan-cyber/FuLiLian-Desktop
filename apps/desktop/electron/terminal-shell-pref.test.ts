// Unit tests for the terminal shell preference file (step17).
// fs / atomic writer are stubbed: no real userData directory is touched.
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

import {
  configureTerminalShellPrefPersistence,
  defaultTerminalShellPref,
  ensureTerminalShellPrefFile,
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
    wslDistro: 'kali-linux',
    envSide: 'windows'
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

  assert.deepEqual(first, { local: 'cmd', wslDistro: 'kali-linux', envSide: 'windows' })

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

  const filePref = { local: 'pwsh', wslDistro: null, envSide: 'windows' } as const

  assert.deepEqual(readTerminalShellPrefFile(filePath, { fs: fsImpl }), filePref)

  const written = writeTerminalShellPrefFile(null, { local: 'cmd' })

  assert.deepEqual(written, { local: 'cmd', wslDistro: null, envSide: 'windows' })
  // The null-path cache is keyed separately: the file-backed read is untouched.
  assert.deepEqual(readTerminalShellPrefFile(filePath, { fs: fsImpl }), filePref)
})

test('write merges over the current state, normalizes, and writes atomically', () => {
  const fsImpl = makeFs()
  const writeAtomic = vi.fn()
  const filePath = 'C:\\x\\file.json'

  fsImpl.statSync.mockReturnValue({ mtimeMs: 5 })
  fsImpl.readFileSync.mockReturnValue(JSON.stringify({ local: 'pwsh', wslDistro: 'kali-linux' }))

  const state = writeTerminalShellPrefFile(filePath, { wslDistro: 'docker-desktop' }, { fs: fsImpl, writeAtomic })

  assert.deepEqual(state, { local: 'pwsh', wslDistro: 'docker-desktop', envSide: 'windows' })
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

  assert.deepEqual(hostile, { local: 'pwsh', wslDistro: null, envSide: 'windows' })

  // A failed write is swallowed and the in-memory state still wins.
  const failing = vi.fn(() => {
    throw new Error('disk full')
  })

  const survived = writeTerminalShellPrefFile(filePath, { local: 'cmd' }, { fs: fsImpl, writeAtomic: failing })

  assert.deepEqual(survived, { local: 'cmd', wslDistro: null, envSide: 'windows' })
})

test('the configured surface reads and writes through the configured directory', () => {
  const fsImpl = makeFs()
  const writeAtomic = vi.fn()

  configureTerminalShellPrefPersistence('C:\\userData')

  // Both surfaces share one cache — stub the same fs through the configured
  // surface by writing first (mkdir/read are only needed for pre-existing files).
  const written = writeTerminalShellPref({ local: 'pwsh', wslDistro: 'Ubuntu' })

  assert.deepEqual(written, { local: 'pwsh', wslDistro: 'Ubuntu', envSide: 'windows' })
  assert.deepEqual(readTerminalShellPref(), written, 'write-through serves the cached state')

  // Reconfiguring to another directory resets the cache (no stale bleed).
  resetTerminalShellPrefCache()
  configureTerminalShellPrefPersistence(null)

  assert.deepEqual(readTerminalShellPref(), defaultTerminalShellPref())
  assert.equal(fsImpl.readFileSync.mock.calls.length, 0)
})

// ── N1/N2: Windows-side default + envSide migration (idempotent) ─────

/**
 * An in-memory preference file: `readFileSync` throws while the file is
 * absent, `writeAtomic` stores the exact bytes the real writer would emit, and
 * `statSync` bumps a synthetic mtime on each write so the module's mtime cache
 * behaves like it would against a real file.
 */
function makeMemoryDir(initial: null | string) {
  let file: null | string = initial
  let mtime = initial === null ? 0 : 1

  const impl = {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn<() => string>(() => {
      if (file === null) {
        throw new Error('missing')
      }

      return file
    }),
    statSync: vi.fn<() => { mtimeMs: number }>(() => {
      if (file === null) {
        throw new Error('missing')
      }

      return { mtimeMs: mtime }
    })
  }

  const writeAtomic = vi.fn((_path: string, data: string) => {
    file = data
    mtime += 1
  })

  return {
    bytes: () => file,
    deps: { fs: impl as typeof impl & TerminalShellPersistFs, writeAtomic },
    readFileSync: impl.readFileSync,
    writeAtomic
  }
}

test('N1: a first run with no file seeds local=pwsh + envSide=windows', () => {
  const dir = makeMemoryDir(null)

  const state = ensureTerminalShellPrefFile('C:\\userData\\terminal-shell.json', dir.deps)

  assert.deepEqual(state, { local: 'pwsh', wslDistro: null, envSide: 'windows' })
  assert.equal(dir.writeAtomic.mock.calls.length, 1, 'the first read seeds the file')
  assert.deepEqual(JSON.parse(String(dir.bytes())), state)
})

test('N1: a pre-envSide file keeps its explicit local and gains envSide=windows', () => {
  const dir = makeMemoryDir(JSON.stringify({ local: 'cmd', wslDistro: 'Ubuntu-22.04' }))

  const state = ensureTerminalShellPrefFile('C:\\userData\\terminal-shell.json', dir.deps)

  assert.deepEqual(state, { local: 'cmd', wslDistro: 'Ubuntu-22.04', envSide: 'windows' })
  assert.deepEqual(JSON.parse(String(dir.bytes())), state, 'the file is rewritten once, on disk')
})

test('N1: an explicit local=auto is never overwritten by the new default', () => {
  const dir = makeMemoryDir(JSON.stringify({ local: 'auto', wslDistro: null }))

  assert.equal(ensureTerminalShellPrefFile('C:\\x\\terminal-shell.json', dir.deps).local, 'auto')
})

test('N1: migration is byte-idempotent across repeated boots', () => {
  const dir = makeMemoryDir(JSON.stringify({ local: 'pwsh', wslDistro: 'Ubuntu' }))

  ensureTerminalShellPrefFile('C:\\x\\terminal-shell.json', dir.deps)
  const firstBytes = dir.bytes()

  assert.ok(firstBytes, 'the first pass wrote the migrated file')

  for (let boot = 0; boot < 3; boot += 1) {
    resetTerminalShellPrefCache()

    const state = ensureTerminalShellPrefFile('C:\\x\\terminal-shell.json', dir.deps)

    assert.deepEqual(state, { local: 'pwsh', wslDistro: 'Ubuntu', envSide: 'windows' })
    assert.equal(dir.bytes(), firstBytes, `boot ${boot + 2} leaves the bytes untouched`)
  }

  assert.equal(dir.writeAtomic.mock.calls.length, 1, 'exactly one migration write, ever')
})

test('N1: envSide is whitelisted (wsl honored, junk collapses to windows)', () => {
  assert.equal(normalizeTerminalShellPref({ envSide: 'wsl' }).envSide, 'wsl')
  assert.equal(normalizeTerminalShellPref({ envSide: 'linux' }).envSide, 'windows')
  assert.equal(normalizeTerminalShellPref({ envSide: 42 }).envSide, 'windows')
  assert.equal(normalizeTerminalShellPref({}).envSide, 'windows')
})
