import { describe, expect, it } from 'vitest'

import {
  initialQuickComposerState,
  QUICK_TARGET_NEW,
  QUICK_TARGET_NOTE,
  type QuickComposerEvent,
  quickComposerReducer,
  type QuickComposerState,
  type QuickEntrySubmitPayload
} from './quick-entry'

// Drive the reducer like the window does, collecting every send it asked for.
function run(events: QuickComposerEvent[], from: QuickComposerState = initialQuickComposerState) {
  let state = from
  const sent: QuickEntrySubmitPayload[] = []

  for (const event of events) {
    const transition = quickComposerReducer(state, event)
    state = transition.state

    if (transition.send !== null) {
      sent.push(transition.send)
    }
  }

  return { sent, state }
}

// The primary renderer's push the quick window receives on open. Note that
// capture writes are LOCAL (draft stash / inbox), so `connected` no longer
// gates submit — it only drives the reconnect hint.
const connect: QuickComposerEvent = {
  connected: true,
  sessions: [
    { id: 's1', title: 'Fix the build' },
    { id: 's2', title: 'Research trip' }
  ],
  type: 'state'
}

describe('quickComposerReducer', () => {
  it('starts visible, empty, disconnected, in project mode, targeting the new-draft slot', () => {
    expect(initialQuickComposerState).toEqual({
      connected: false,
      draft: '',
      mode: 'project',
      sessions: [],
      submitting: false,
      target: QUICK_TARGET_NEW,
      visible: true
    })
  })

  it('submit sends the trimmed draft with its capture mode and target, clears it, and hides', () => {
    const { sent, state } = run([connect, { draft: '  ship it  ', type: 'edit' }, { type: 'submit' }])

    expect(sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'ship it' }])
    expect(state.draft).toBe('')
    expect(state.submitting).toBe(true)
    expect(state.visible).toBe(false)
  })

  it('an empty or whitespace-only submit sends nothing and stays open', () => {
    const blank = run([connect, { type: 'submit' }])
    expect(blank.sent).toEqual([])
    expect(blank.state.visible).toBe(true)

    const spaces = run([connect, { draft: '   ', type: 'edit' }, { type: 'submit' }])
    expect(spaces.sent).toEqual([])
    // A stray Enter must not make the window vanish out from under the user.
    expect(spaces.state.visible).toBe(true)
    expect(spaces.state.draft).toBe('   ')
  })

  it('capture works while the gateway is down — drafts land locally, never on the wire', () => {
    // The main window sits minimized to the tray; the push says the backend is
    // unreachable. A capture must still land (step 16 · T7 acceptance: capture
    // stays available from the tray-minimized state).
    const { sent, state } = run([{ draft: 'hello?', type: 'edit' }, { type: 'submit' }])

    expect(sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'hello?' }])
    expect(state.visible).toBe(false)
    expect(state.connected).toBe(false)
  })

  it('a second submit while already submitting cannot double-send', () => {
    const { sent, state } = run([connect, { draft: 'hello', type: 'edit' }, { type: 'submit' }, { type: 'submit' }])

    expect(sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'hello' }])
    expect(state.submitting).toBe(true)
  })

  it('a picked session target rides the submit payload', () => {
    const { sent } = run([
      connect,
      { target: 's2', type: 'target' },
      { draft: 'capture this there', type: 'edit' },
      { type: 'submit' }
    ])

    expect(sent).toEqual([{ mode: 'project', target: 's2', text: 'capture this there' }])
  })

  it('the chip carries its mode on the payload', () => {
    const { sent } = run([
      connect,
      { mode: 'ctf', type: 'mode' },
      { target: 's1', type: 'target' },
      { draft: 'rop gadget notes', type: 'edit' },
      { type: 'submit' }
    ])

    expect(sent).toEqual([{ mode: 'ctf', target: 's1', text: 'rop gadget notes' }])
  })

  it('the note chip routes to the no-container inbox regardless of the session picker', () => {
    const noted = run([connect, { mode: 'note', type: 'mode' }]).state

    expect(noted.mode).toBe('note')
    expect(noted.target).toBe(QUICK_TARGET_NOTE)

    // Even a stale picked target cannot redirect a note away from the inbox.
    const redirected = quickComposerReducer(noted, { target: 's1', type: 'target' }).state
    const submitted = run([{ draft: 'buy milk', type: 'edit' }, { type: 'submit' }], redirected)

    expect(submitted.sent).toEqual([{ mode: 'note', target: QUICK_TARGET_NOTE, text: 'buy milk' }])
  })

  it('leaving note mode returns the target to the new-draft slot', () => {
    const noted = run([connect, { mode: 'note', type: 'mode' }]).state
    const back = quickComposerReducer(noted, { mode: 'forensics', type: 'mode' }).state

    expect(back.mode).toBe('forensics')
    expect(back.target).toBe(QUICK_TARGET_NEW)
  })

  it('a picked session that vanishes from the pushed list falls back to the new-draft slot', () => {
    const { state } = run([
      connect,
      { target: 's2', type: 'target' },
      { connected: true, sessions: [{ id: 's1', title: 'Fix the build' }], type: 'state' }
    ])

    expect(state.target).toBe(QUICK_TARGET_NEW)
  })

  it('a state push that still contains the picked session keeps it', () => {
    const { state } = run([connect, { target: 's1', type: 'target' }, connect])

    expect(state.target).toBe('s1')
  })

  it('Escape dismisses without sending, discards the draft, and resets the target', () => {
    const { sent, state } = run([
      connect,
      { target: 's1', type: 'target' },
      { draft: 'never mind', type: 'edit' },
      { type: 'dismiss' }
    ])

    expect(sent).toEqual([])
    expect(state.draft).toBe('')
    expect(state.target).toBe(QUICK_TARGET_NEW)
    expect(state.visible).toBe(false)
  })

  it('blur dismisses without sending', () => {
    const { sent, state } = run([connect, { draft: 'clicked away', type: 'edit' }, { type: 'blur' }])

    expect(sent).toEqual([])
    expect(state.visible).toBe(false)
    expect(state.draft).toBe('')
  })

  it('the blur that follows a submit does not re-send or resurrect the draft', () => {
    const { sent, state } = run([connect, { draft: 'go', type: 'edit' }, { type: 'submit' }, { type: 'blur' }])

    expect(sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'go' }])
    expect(state.draft).toBe('')
    expect(state.submitting).toBe(false)
    expect(state.visible).toBe(false)
  })

  it('being re-summoned resets the capture surface but KEEPS the pushed gateway truth', () => {
    const afterSubmit = run([
      connect,
      { mode: 'note', type: 'mode' },
      { draft: 'first', type: 'edit' },
      { type: 'submit' }
    ]).state
    const { sent, state } = run([{ type: 'shown' }], afterSubmit)

    expect(sent).toEqual([])
    expect(state.draft).toBe('')
    expect(state.mode).toBe('project')
    expect(state.target).toBe(QUICK_TARGET_NEW)
    expect(state.visible).toBe(true)
    // The gateway did not disconnect just because the window was re-opened.
    expect(state.connected).toBe(true)
    expect(state.sessions).toHaveLength(2)
  })

  it('re-summoning after a dismiss never carries the old draft back', () => {
    const dismissed = run([connect, { draft: 'stale text', type: 'edit' }, { type: 'dismiss' }]).state
    const reopened = quickComposerReducer(dismissed, { type: 'shown' }).state

    expect(reopened.draft).toBe('')
    expect(reopened.visible).toBe(true)
  })

  it('editing keeps the window open and never sends', () => {
    const { sent, state } = run([
      connect,
      { draft: 'a', type: 'edit' },
      { draft: 'ab', type: 'edit' },
      { draft: 'abc', type: 'edit' }
    ])

    expect(sent).toEqual([])
    expect(state.draft).toBe('abc')
    expect(state.visible).toBe(true)
  })

  it('a full summon → type → submit → summon cycle sends exactly once per round', () => {
    const first = run([connect, { draft: 'one', type: 'edit' }, { type: 'submit' }])
    const second = run([{ type: 'shown' }, { draft: 'two', type: 'edit' }, { type: 'submit' }], first.state)

    expect(first.sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'one' }])
    expect(second.sent).toEqual([{ mode: 'project', target: QUICK_TARGET_NEW, text: 'two' }])
  })
})
