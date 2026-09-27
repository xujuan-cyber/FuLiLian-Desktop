import { describe, expect, it } from 'vitest'

import { terminalStartOptions } from './start-options'

describe('terminalStartOptions', () => {
  it('keeps the pre-WSL payload shape for local tabs (no wsl key at all)', () => {
    expect(terminalStartOptions({ cols: 80, cwd: 'C:\\repo', rows: 24 })).toEqual({
      cols: 80,
      cwd: 'C:\\repo',
      rows: 24
    })
    expect(terminalStartOptions({ cols: 80, cwd: 'C:\\repo', rows: 24, wsl: null })).not.toHaveProperty('wsl')
  })

  it('carries the frozen WSL target for a WSL tab (contract §四 C)', () => {
    const payload = terminalStartOptions({
      cols: 100,
      cwd: 'C:\\repo',
      rows: 30,
      wsl: { cli: 'claude', distro: 'Ubuntu' }
    })

    expect(payload).toEqual({ cols: 100, cwd: 'C:\\repo', rows: 30, wsl: { cli: 'claude', distro: 'Ubuntu' } })
    expect(payload.wsl).not.toBeUndefined()
    // The renderer sends the Windows path untouched — the POSIX translation is
    // the main process's job (contract §四 C.4).
    expect(payload.cwd).toBe('C:\\repo')
  })

  it('prefers the restored cwd over the launch cwd (unchanged v1 behavior)', () => {
    const payload = terminalStartOptions({ cols: 80, cwd: 'C:\\repo', restoreCwd: '/home/dev/project', rows: 24 })

    expect(payload.cwd).toBe('/home/dev/project')
  })

  it('treats an empty restored cwd as absent', () => {
    expect(terminalStartOptions({ cols: 80, cwd: 'C:\\repo', restoreCwd: '', rows: 24 }).cwd).toBe('C:\\repo')
  })
})
