import { describe, expect, it, vi } from 'vitest'

import { $freshSessionRequest } from '@/store/profile'

import { startNewSession } from './command-palette-session'

// Step 16 · T8: the palette's new-session action. It rides the SAME ⌘N event
// the session.new keybind dispatches, while the real fresh-draft trigger is
// `$freshSessionRequest`. No container is fabricated — a new session is just a
// new session (the three work modes were removed in P1).

describe('startNewSession (T8 动作区)', () => {
  it('fires the new-session event exactly once', () => {
    const listener = vi.fn()
    window.addEventListener('fulilian:new-session-shortcut', listener)

    try {
      startNewSession()
    } finally {
      window.removeEventListener('fulilian:new-session-shortcut', listener)
    }

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('requests a fresh session draft (the real new-session flow)', () => {
    const before = $freshSessionRequest.get()

    startNewSession()

    expect($freshSessionRequest.get()).toBe(before + 1)
  })
})
