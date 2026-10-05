// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_DRAFTS_STORAGE_KEY, stashSessionDraft } from '@/store/composer'
import { QUICK_CAPTURE_INBOX_STORAGE_KEY } from '@/store/quick-capture-inbox'

import { useQuickEntryBridge } from './use-quick-entry-bridge'

type TestWindow = typeof window & { fulilianDesktop?: unknown }

let inboundHandler: ((payload: unknown) => void) | null = null

const submitText = vi.fn()
const startFreshSessionDraft = vi.fn()

function Harness(): null {
  useQuickEntryBridge({ startFreshSessionDraft, submitText })

  return null
}

const draftsFromStorage = (): Record<string, string> => {
  const raw = window.localStorage.getItem(SESSION_DRAFTS_STORAGE_KEY)

  return raw ? (JSON.parse(raw) as Record<string, string>) : {}
}

const inboxFromStorage = (): Array<{ text: string }> => {
  const raw = window.localStorage.getItem(QUICK_CAPTURE_INBOX_STORAGE_KEY)

  return raw ? (JSON.parse(raw) as Array<{ text: string }>) : []
}

const bridgeHost = (): { fulilianDesktop?: unknown } => window as unknown as { fulilianDesktop?: unknown }

beforeEach(() => {
  submitText.mockClear()
  startFreshSessionDraft.mockClear()
  inboundHandler = null
  window.localStorage.clear()
  bridgeHost().fulilianDesktop = {
    quickEntry: {
      getSettings: vi.fn().mockResolvedValue({ enabled: true, error: null, registered: true, shortcut: 'CommandOrControl+Shift+Space' }),
      onSubmit: (callback: (payload: unknown) => void) => {
        inboundHandler = callback

        return () => {
          inboundHandler = null
        }
      },
      onState: vi.fn().mockReturnValue(() => {}),
      onShown: vi.fn().mockReturnValue(() => {}),
      pushState: vi.fn(),
      submit: vi.fn(),
      dismiss: vi.fn()
    }
  }
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  delete bridgeHost().fulilianDesktop
})

describe('useQuickEntryBridge capture routing (step 16 · T7)', () => {
  it('routes a note capture into the no-container inbox and never sends a prompt', () => {
    render(<Harness />)

    inboundHandler?.({ mode: 'note', target: 'note', text: '  buy milk  ' })

    expect(inboxFromStorage().map(note => note.text)).toEqual(['buy milk'])
    expect(submitText).not.toHaveBeenCalled()
    expect(startFreshSessionDraft).not.toHaveBeenCalled()
  })

  it('writes a capture for the new-draft slot into the composer draft stash', () => {
    render(<Harness />)

    inboundHandler?.({ mode: 'project', target: 'new', text: 'spike the resolver' })

    const drafts = draftsFromStorage()
    expect(drafts['__new__']).toBe('spike the resolver')
    expect(submitText).not.toHaveBeenCalled()
  })

  it('MERGES into an existing target-session draft instead of clobbering it', () => {
    // Seed through the stash itself — the in-memory map is the read path, and
    // a raw localStorage write would not be seen after module load.
    stashSessionDraft('s1', 'already typed thoughts', [])
    render(<Harness />)

    inboundHandler?.({ mode: 'ctf', target: 's1', text: 'rop gadget notes' })

    const drafts = draftsFromStorage()
    expect(drafts.s1).toBe('already typed thoughts\n\nrop gadget notes')
    expect(submitText).not.toHaveBeenCalled()
  })

  it('a target that is not a real slot still lands as a draft keyed by its id', () => {
    render(<Harness />)

    inboundHandler?.({ mode: 'forensics', target: 's9', text: 'chain of custody' })

    expect(draftsFromStorage().s9).toBe('chain of custody')
  })

  it('the LEGACY payload (no mode) keeps the v1 prompt-send routing', () => {
    render(<Harness />)

    inboundHandler?.({ target: 'current', text: 'fire away' })

    expect(submitText).toHaveBeenCalledWith('fire away')
    expect(startFreshSessionDraft).not.toHaveBeenCalled()
    expect(draftsFromStorage()).toEqual({})
    expect(inboxFromStorage()).toEqual([])
  })

  it('the LEGACY new-session payload starts a fresh draft then submits', () => {
    render(<Harness />)

    inboundHandler?.({ target: 'new', text: 'legacy prompt' })

    expect(startFreshSessionDraft).toHaveBeenCalledTimes(1)
    expect(submitText).toHaveBeenCalledWith('legacy prompt')
    // Legacy routing must not pollute the capture draft stash.
    expect(draftsFromStorage()).toEqual({})
  })
})
