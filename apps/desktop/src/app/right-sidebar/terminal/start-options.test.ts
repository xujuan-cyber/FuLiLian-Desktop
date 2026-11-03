import { describe, expect, it } from 'vitest'

import { terminalStartOptions } from './start-options'

describe('terminalStartOptions', () => {
  it('builds the plain local payload', () => {
    expect(terminalStartOptions({ cols: 80, cwd: 'C:\\repo', rows: 24 })).toEqual({
      cols: 80,
      cwd: 'C:\\repo',
      rows: 24
    })
  })

  it('prefers the restored cwd over the launch cwd (unchanged v1 behavior)', () => {
    const payload = terminalStartOptions({ cols: 80, cwd: 'C:\\repo', restoreCwd: '/home/dev/project', rows: 24 })

    expect(payload.cwd).toBe('/home/dev/project')
  })

  it('treats an empty restored cwd as absent', () => {
    expect(terminalStartOptions({ cols: 80, cwd: 'C:\\repo', restoreCwd: '', rows: 24 }).cwd).toBe('C:\\repo')
  })
})
