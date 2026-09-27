// Terminal WSL target tests (step09 v2 · T5/E6).
//
// electron + node-pty are stubbed, so the spawn is observable without a real
// PTY and without spawning anything. Three assertions are required by T5:
//   (a) the argv sequence is exactly `-d <distro> --cd <posix> -e bash -lc <cli>`
//   (b) a non-empty `wsl` short-circuits *before* SSH resolution
//   (c) the returned `shell` / `cwd` match contract §四 C #3
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const { handle, resolveSpy, spawnSpy } = vi.hoisted(() => ({
  handle: vi.fn(),
  resolveSpy: vi.fn(),
  spawnSpy: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? 'C:\\Users\\me' : ''),
    getVersion: () => '1.3.0'
  },
  ipcMain: { handle }
}))

vi.mock('node-pty', () => ({ default: { spawn: spawnSpy } }))

vi.mock('./connection-apply', () => ({
  resolveTerminalConnectionForSender: resolveSpy
}))

import { registerTerminalIpc } from './terminal-ipc'

function makePty() {
  return {
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    pid: 4242,
    resize: vi.fn(),
    write: vi.fn()
  }
}

function makeSender(id = 7) {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn()
  }
}

function handlerFor(channel: string) {
  const call = handle.mock.calls.find(([name]) => name === channel)

  assert.ok(call, `expected ipcMain.handle registration for ${channel}`)

  return call[1] as (event: unknown, payload: unknown) => Promise<unknown>
}

const sshTarget = {
  scope: 'connection:registry-ssh:profile:worker',
  ssh: { host: 'registry-box.test', port: 22, user: 'fulilian' }
}

beforeEach(() => {
  handle.mockReset()
  spawnSpy.mockReset()
  spawnSpy.mockImplementation(() => makePty())
  resolveSpy.mockReset()
  resolveSpy.mockResolvedValue(null)

  registerTerminalIpc({
    isWindows: true,
    findOnPath: () => null,
    rememberLog: () => {},
    activeSshTerminalTarget: () => null,
    ensureBackend: async () => undefined,
    getSshConnectionState: () => undefined
  })
})

test('T5/a a WSL target spawns wsl.exe -d <distro> --cd <posix> -e bash -lc <cli>', async () => {
  const result = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cols: 100, cwd: 'C:\\Users\\me\\proj', rows: 30, wsl: { cli: 'claude', distro: 'Ubuntu' } }
  )) as { cwd: null | string; id: string; shell: string }

  assert.equal(spawnSpy.mock.calls.length, 1)

  const [file, args, options] = spawnSpy.mock.calls[0]

  assert.equal(file, 'wsl.exe')
  assert.deepEqual(args, ['-d', 'Ubuntu', '--cd', '/mnt/c/Users/me/proj', '-e', 'bash', '-lc', 'claude'])
  assert.equal(args.filter((arg: string) => arg === '-d').length, 1, 'exactly one distro flag')

  assert.equal(options.cols, 100)
  assert.equal(options.rows, 30)
  assert.equal(options.name, 'xterm-256color')
  assert.equal(options.cwd, 'C:\\Users\\me')

  // env discipline is the shared terminalShellEnv(): no HOME / XDG / CLI-config
  // root is injected or overridden (contract §四 C #5).
  assert.equal(options.env.TERM, 'xterm-256color')
  assert.equal(options.env.COLORTERM, 'truecolor')
  assert.equal(options.env.TERM_PROGRAM, 'Fulilian')
  assert.equal(options.env.FULILIAN_DESKTOP_TERMINAL, '1')
  assert.equal('HOME' in options.env && options.env.HOME !== process.env.HOME, false)
  assert.equal('XDG_CONFIG_HOME' in options.env && options.env.XDG_CONFIG_HOME !== process.env.XDG_CONFIG_HOME, false)

  // (c) contract §四 C #3
  assert.equal(result.shell, 'claude')
  assert.equal(result.cwd, null)
  assert.equal(typeof result.id, 'string')
})

test('T5/b a non-empty wsl short-circuits before SSH resolution', async () => {
  resolveSpy.mockResolvedValue(sshTarget)

  await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: 'C:\\Users\\me\\proj', wsl: { cli: 'hermes', distro: 'Debian' } }
  )

  assert.equal(resolveSpy.mock.calls.length, 0, 'resolveTerminalConnectionForSender must not run for WSL')
  assert.equal(spawnSpy.mock.calls.length, 1)
  assert.equal(spawnSpy.mock.calls[0][0], 'wsl.exe')
  assert.equal(spawnSpy.mock.calls[0][1].includes('/mnt/c/Users/me/proj'), true)
  assert.equal(spawnSpy.mock.calls[0][1].includes('hermes'), true)
})

test('T5/b2 an SSH target is still resolved and spawned when wsl is absent (no regression)', async () => {
  resolveSpy.mockResolvedValue(sshTarget)

  const result = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: 'C:\\Users\\me\\proj' }
  )) as { cwd: null | string; shell: string }

  assert.equal(resolveSpy.mock.calls.length, 1)
  assert.equal(spawnSpy.mock.calls[0][0].endsWith('ssh.exe'), true)
  assert.equal(result.shell, 'ssh')
  assert.equal(result.cwd, null)
})

test('T5/c a WSL target without a translatable cwd omits --cd', async () => {
  const result = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { wsl: { cli: 'codex', distro: 'Ubuntu' } }
  )) as { cwd: null | string; shell: string }

  assert.deepEqual(spawnSpy.mock.calls[0][1], ['-d', 'Ubuntu', '-e', 'bash', '-lc', 'codex'])
  assert.equal(result.shell, 'codex')
  assert.equal(result.cwd, null)
})

test('T5/c2 a relative / already-POSIX cwd is handled without inventing a mount point', async () => {
  await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: 'relative\\path', wsl: { cli: 'fulilian', distro: 'Ubuntu' } }
  )

  assert.deepEqual(spawnSpy.mock.calls[0][1], ['-d', 'Ubuntu', '-e', 'bash', '-lc', 'fulilian'])

  await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: '/home/me/proj', wsl: { cli: 'fulilian', distro: 'Ubuntu' } }
  )

  assert.deepEqual(spawnSpy.mock.calls[1][1], [
    '-d',
    'Ubuntu',
    '--cd',
    '/home/me/proj',
    '-e',
    'bash',
    '-lc',
    'fulilian'
  ])
})

test('T5/c3 a malformed/hostile wsl payload degrades to the normal local spawn', async () => {
  for (const wsl of [null, {}, { distro: 'Ubuntu' }, { cli: 'claude' }, { cli: 'rm -rf /', distro: 'Ubuntu' }, 42]) {
    spawnSpy.mockClear()
    resolveSpy.mockClear()

    const result = (await handlerFor('fulilian:terminal:start')(
      { sender: makeSender() },
      { cwd: process.cwd(), wsl }
    )) as { cwd: null | string; shell: string }

    assert.equal(spawnSpy.mock.calls[0][0] === 'wsl.exe', false, `wsl=${JSON.stringify(wsl)} must not spawn wsl.exe`)
    assert.equal(resolveSpy.mock.calls.length, 1, 'the normal SSH resolution path is taken')
    assert.equal(typeof result.cwd, 'string', 'a local session reports a real cwd')
    assert.notEqual(result.shell, 'claude')
  }
})

test('T5/d fulilian:terminal:cwd returns null for a WSL session and for an SSH session', async () => {
  const wslSession = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { wsl: { cli: 'claude', distro: 'Ubuntu' } }
  )) as { id: string }

  const cwdHandler = handlerFor('fulilian:terminal:cwd') as unknown as (
    event: unknown,
    id: string
  ) => Promise<null | string>

  assert.equal(await cwdHandler(null, wslSession.id), null)

  resolveSpy.mockResolvedValue(sshTarget)

  const sshSession = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: process.cwd() }
  )) as { id: string }

  assert.equal(await cwdHandler(null, sshSession.id), null)
})

test('T5/d2 a WSL session is registered so dispose still tears it down', async () => {
  const session = (await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { wsl: { cli: 'claude', distro: 'Ubuntu' } }
  )) as { id: string }

  const pty = spawnSpy.mock.results[0].value

  const disposed = (await handlerFor('fulilian:terminal:dispose')(null, session.id)) as boolean

  assert.equal(disposed, true)
  assert.equal(pty.kill.mock.calls.length, 1)
  // the session was removed from the registry: a second dispose is a no-op
  assert.equal((await handlerFor('fulilian:terminal:dispose')(null, session.id)) as boolean, false)
})

test('T5/e wsl.exe is spawned directly, never through a shell wrapper', async () => {
  await handlerFor('fulilian:terminal:start')(
    { sender: makeSender() },
    { cwd: 'D:\\Work\\x', wsl: { cli: 'codebuddy', distro: 'Ubuntu-22.04' } }
  )

  const [file, args] = spawnSpy.mock.calls[0]

  assert.equal(file, 'wsl.exe')
  assert.equal(typeof args, 'object')
  // `bash -lc` receives the CLI as ONE argv element — no string concatenation
  // into a shell command line.
  assert.equal(args[args.length - 1], 'codebuddy')
  assert.equal(args[args.length - 2], '-lc')
  assert.equal(args[args.length - 3], 'bash')
  assert.deepEqual(args.slice(0, 4), ['-d', 'Ubuntu-22.04', '--cd', '/mnt/d/Work/x'])
})
