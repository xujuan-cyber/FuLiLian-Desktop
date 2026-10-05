import { describe, expect, it, vi } from 'vitest'

import { $freshSessionRequest } from '@/store/profile'

import { PALETTE_SESSION_KINDS, startNewSessionWithKind } from './command-palette-kind'

// Step 16 · T8: the palette's three-mode new-session actions. The kind rides
// the SAME ⌘N event the session.new keybind dispatches — as recorded intent in
// `detail.kind` (the T6/T7 payload口径) — while the real fresh-draft trigger is
// `$freshSessionRequest`. No container is fabricated: the kind data layer does
// not exist yet, so the assertion is on the payload, not on any container row.

describe('startNewSessionWithKind (T8 动作区 新建三模式)', () => {
  it.each(PALETTE_SESSION_KINDS)('records kind %s as intent on the new-session event', kind => {
    const listener = vi.fn()
    window.addEventListener('fulilian:new-session-shortcut', listener)

    try {
      startNewSessionWithKind(kind)
    } finally {
      window.removeEventListener('fulilian:new-session-shortcut', listener)
    }

    expect(listener).toHaveBeenCalledTimes(1)

    const event = listener.mock.calls[0]?.[0] as CustomEvent<{ kind: string }>

    expect(event.detail).toEqual({ kind })
  })

  it('requests a fresh session draft (the real new-session flow)', () => {
    const before = $freshSessionRequest.get()

    startNewSessionWithKind('forensics')

    expect($freshSessionRequest.get()).toBe(before + 1)
  })
})
