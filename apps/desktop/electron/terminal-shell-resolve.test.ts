// Resolution tests for the local-shell preference (N2 / R-4).
//
// The resolver answers one question — "which binary will this preference
// actually spawn, and did we have to fall back?" — and it must do so WITHOUT
// spawning anything. `node:child_process` is mocked to a spy that throws, so a
// future refactor that reaches for `execFileSync` (the wsl.exe-style shortcut)
// fails loudly here instead of silently reintroducing a startup process.
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const execSpy = vi.fn(() => {
  throw new Error('terminal shell resolution must not spawn a process')
})

vi.mock('node:child_process', () => ({
  execFile: execSpy,
  execFileSync: execSpy,
  execSync: execSpy,
  spawn: execSpy,
  spawnSync: execSpy
}))

import { noteShellDegradation, resetShellDegradationLog, resolveTerminalShell, type ShellResolveDeps } from './terminal-shell-resolve'

function makeDeps(options: { isWindows?: boolean; paths?: Record<string, string> } = {}): ShellResolveDeps & {
  calls: string[]
} {
  const isWindows = options.isWindows ?? true
  const table = options.paths ?? {}
  const calls: string[] = []

  return {
    calls,
    env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATH: 'C:\\bin', SystemRoot: 'C:\\Windows' } as NodeJS.ProcessEnv,
    fileExists: filePath => {
      calls.push(filePath)

      return filePath in table || Object.values(table).includes(filePath)
    },
    findOnPath: command => {
      calls.push(`path:${command}`)

      return table[command] ?? null
    },
    isWindows
  }
}

beforeEach(() => {
  resetShellDegradationLog()
  execSpy.mockClear()
})

test('explicit pwsh resolves to the real path, not degraded', () => {
  const deps = makeDeps({ paths: { 'pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' } })
  const resolution = resolveTerminalShell('pwsh', deps)

  assert.equal(resolution.degraded, false)
  assert.equal(resolution.fallback, null)
  assert.equal(resolution.path, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  assert.equal(resolution.name, 'pwsh.exe')
  assert.equal(execSpy.mock.calls.length, 0, 'resolution never spawns')
})

test('pwsh missing degrades to Windows PowerShell 5.1 and says so', () => {
  const deps = makeDeps({
    paths: { 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }
  })

  const resolution = resolveTerminalShell('pwsh', deps)

  assert.equal(resolution.degraded, true)
  assert.equal(resolution.fallback, 'powershell')
  assert.equal(resolution.name, 'powershell.exe')
  assert.equal(execSpy.mock.calls.length, 0)
})

test('pwsh + 5.1 missing degrades all the way to cmd', () => {
  const resolution = resolveTerminalShell('pwsh', makeDeps())

  assert.equal(resolution.degraded, true)
  assert.equal(resolution.fallback, 'cmd')
  assert.equal(resolution.path, 'C:\\Windows\\System32\\cmd.exe')
})

test('auto is never degraded and prefers pwsh, then 5.1, then cmd', () => {
  const withPwsh = resolveTerminalShell('auto', makeDeps({ paths: { 'pwsh.exe': 'C:\\pwsh.exe' } }))

  assert.equal(withPwsh.degraded, false)
  assert.equal(withPwsh.name, 'pwsh.exe')

  const with51 = resolveTerminalShell(
    'auto',
    makeDeps({
      paths: { 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }
    })
  )

  assert.equal(with51.degraded, false)
  assert.equal(with51.name, 'powershell.exe')

  const withCmd = resolveTerminalShell('auto', makeDeps())

  assert.equal(withCmd.degraded, false)
  assert.equal(withCmd.name, 'cmd.exe')
})

test('an unknown choice behaves exactly like auto', () => {
  const resolution = resolveTerminalShell('zsh', makeDeps({ paths: { 'pwsh.exe': 'C:\\pwsh.exe' } }))

  assert.deepEqual(resolution, resolveTerminalShell('auto', makeDeps({ paths: { 'pwsh.exe': 'C:\\pwsh.exe' } })))
})

test('POSIX auto picks the first installed POSIX shell', () => {
  const deps = makeDeps({ isWindows: false })
  deps.fileExists = filePath => filePath === '/bin/bash' || filePath === '/bin/sh'

  const resolution = resolveTerminalShell('auto', deps)

  assert.equal(resolution.degraded, false)
  assert.equal(resolution.path, '/bin/bash')
})

test('POSIX cannot honor the Windows-only choices — it degrades to auto', () => {
  const deps = makeDeps({ isWindows: false })
  deps.fileExists = filePath => filePath === '/bin/zsh'

  const resolution = resolveTerminalShell('cmd', deps)

  assert.equal(resolution.degraded, true)
  assert.equal(resolution.path, '/bin/zsh')
  assert.equal(resolution.fallback, 'auto')
})

test('the degradation log is emitted once per change, then stays quiet', () => {
  const lines: string[] = []
  const log = (line: string) => lines.push(line)
  const resolution = resolveTerminalShell('pwsh', makeDeps())

  assert.equal(noteShellDegradation(resolution, log), true)
  assert.equal(noteShellDegradation(resolution, log), false)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\[terminal-shell\] pwsh unavailable; falling back to cmd\.exe /)

  // A successful resolution never logs.
  const ok = resolveTerminalShell('pwsh', makeDeps({ paths: { 'pwsh.exe': 'C:\\pwsh.exe' } }))

  assert.equal(noteShellDegradation(ok, log), false)
  assert.equal(lines.length, 1)
})
