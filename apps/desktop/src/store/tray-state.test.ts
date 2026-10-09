import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'

import { $sessions } from './session'
import type { SessionDotState } from './session-dot-state'
import { clearAllSessionStates, publishSessionState } from './session-states'
import { trayCounts, traySnapshotFrom } from './tray-state'

const desktopWindow = window as unknown as { fulilianDesktop?: Window['fulilianDesktop'] }
const pushState = vi.fn()
const setCloseToTrayBridge = vi.fn()

const busy = (storedSessionId: string, isBusy: boolean) =>
  ({ busy: isBusy, needsInput: false, storedSessionId }) as unknown as ClientSessionState

const blocked = (storedSessionId: string) =>
  ({ busy: false, messages: [], needsInput: true, storedSessionId }) as unknown as ClientSessionState

const session = (id: string, title: null | string) => ({ id, title }) as (typeof $sessions.value)[number]

let setCloseToTray: (on: boolean) => void

beforeAll(async () => {
  desktopWindow.fulilianDesktop = { tray: { pushState, setCloseToTray: setCloseToTrayBridge } } as unknown as
    Window['fulilianDesktop']
  // The store subscribes at import time, so the bridge has to exist first.
  const store = await import('./tray-state')

  setCloseToTray = store.setCloseToTray
})

beforeEach(() => {
  clearAllSessionStates()
  $sessions.set([])
  pushState.mockClear()
  setCloseToTrayBridge.mockClear()
})

describe('traySnapshotFrom', () => {
  const byId = (entries: Record<string, SessionDotState>) => entries

  it('folds working and stalled into the running group and needs-input on its own', () => {
    const snapshot = traySnapshotFrom(
      byId({ s1: 'working', s2: 'stalled', s3: 'needs-input', s4: 'idle', s5: 'unread' }),
      [session('s1', 'A'), session('s2', 'B'), session('s3', 'C'), session('s4', 'D'), session('s5', 'E')]
    )

    expect(snapshot.running.map(row => row.id)).toEqual(['s1', 's2'])
    expect(snapshot.needsInput.map(row => row.id)).toEqual(['s3'])
    expect(trayCounts(snapshot)).toEqual({ needsInput: 1, running: 2 })
  })

  it('never fabricates a title — an untitled session falls back to its id', () => {
    const snapshot = traySnapshotFrom(byId({ s1: 'working' }), [session('s1', null)])

    expect(snapshot.running).toEqual([{ id: 's1', title: 's1' }])
  })

  it('ignores alias keys that are not listed rows', () => {
    const snapshot = traySnapshotFrom(byId({ ghost: 'working' }), [session('s1', 'A')])

    expect(trayCounts(snapshot)).toEqual({ needsInput: 0, running: 0 })
  })
})

describe('tray bridge', () => {
  it('pushes a running row when a session is busy', () => {
    $sessions.set([session('s1', 'Fix login')])
    publishSessionState('runtime-1', busy('s1', true))

    expect(pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({ needsInput: [], running: [{ id: 's1', title: 'Fix login' }] })
    )
    // Localized copy rides along; the main process has no i18n runtime.
    const payload = pushState.mock.calls.at(-1)?.[0] as { labels: Record<string, string> }

    expect(typeof payload.labels.openMainWindow).toBe('string')
    expect(payload.labels.openMainWindow.length).toBeGreaterThan(0)
  })

  it('pushes a needs-input row for a blocked session', () => {
    $sessions.set([session('s1', 'Needs approval')])
    publishSessionState('runtime-1', blocked('s1'))

    expect(pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({ needsInput: [{ id: 's1', title: 'Needs approval' }], running: [] })
    )
  })

  it('drops back to the empty snapshot when the turn ends', () => {
    $sessions.set([session('s1', 'Fix login')])
    publishSessionState('runtime-1', busy('s1', true))
    publishSessionState('runtime-1', busy('s1', false))

    expect(pushState).toHaveBeenLastCalledWith(expect.objectContaining({ needsInput: [], running: [] }))
  })

  it('does not re-send an unchanged payload', () => {
    $sessions.set([session('s1', 'Fix login')])
    publishSessionState('runtime-1', busy('s1', true))
    pushState.mockClear()

    $sessions.set([session('s1', 'Fix login'), session('s2', 'Idle chat')])

    expect(pushState).not.toHaveBeenCalled()
  })

  it('defaults the close-to-tray preference to on and mirrors changes to main', () => {
    expect(window.localStorage.getItem('fulilian.desktop.closeToTray.v1')).toBe('true')

    setCloseToTray(false)

    expect(setCloseToTrayBridge).toHaveBeenLastCalledWith(false)
    expect(window.localStorage.getItem('fulilian.desktop.closeToTray.v1')).toBe('false')

    setCloseToTray(true)

    expect(setCloseToTrayBridge).toHaveBeenLastCalledWith(true)
    expect(window.localStorage.getItem('fulilian.desktop.closeToTray.v1')).toBe('true')
  })
})
