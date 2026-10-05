// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubResizeObserver } from '@/test/jsdom'

import { QuickCaptureApp, shortcutKeycapText } from './quick-capture-app'

stubResizeObserver()

const pushes = vi.hoisted(() => ({ onShown: undefined as undefined | (() => void), onState: undefined as undefined | ((payload: unknown) => void) }))

const submitMock = vi.hoisted(() => vi.fn())
const dismissMock = vi.hoisted(() => vi.fn())

vi.mock('@/fulilian', () => ({
  getFulilianConfigRecord: vi.fn().mockResolvedValue({ display: { language: 'en' } }),
  saveFulilianConfig: vi.fn().mockResolvedValue({ ok: true })
}))

type TestWindow = typeof window & { fulilianDesktop?: unknown }

const bridgeHost = (): { fulilianDesktop?: unknown } => window as unknown as { fulilianDesktop?: unknown }

const stubShell = () => {
  bridgeHost().fulilianDesktop = {
    quickEntry: {
      dismiss: dismissMock,
      getSettings: vi.fn().mockResolvedValue({ enabled: true, error: null, registered: true, shortcut: 'CommandOrControl+Shift+Space' }),
      // Main → window pushes, captured so tests can summon / push truth.
      onShown: (callback: () => void) => {
        pushes.onShown = callback

        return () => {
          pushes.onShown = undefined
        }
      },
      onState: (callback: (payload: unknown) => void) => {
        pushes.onState = callback

        return () => {
          pushes.onState = undefined
        }
      },
      submit: submitMock
    }
  }
}

const pushState = (connected: boolean, sessions: Array<{ id: string; title: string }>) => {
  pushes.onState?.({ connected, sessions })
}

beforeEach(() => {
  submitMock.mockClear()
  dismissMock.mockClear()
  stubShell()
})

afterEach(() => {
  cleanup()
  delete bridgeHost().fulilianDesktop
})

describe('QuickCaptureApp', () => {
  it('renders the capture surface: title, four mode chips, target picker fed by the push', async () => {
    render(<QuickCaptureApp />)
    pushState(true, [{ id: 's1', title: 'Fix the build' }])
    pushes.onShown?.()

    expect(screen.getByText('Quick capture')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Forensics/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /CTF/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Code/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Note/ })).toBeTruthy()

    const picker = await screen.findByLabelText('Record into')
    const options = Array.from((picker as HTMLSelectElement).options).map(option => option.value)
    expect(options).toEqual(['new', 's1'])

    // The keycap mirrors the LIVE chord (CommandOrControl resolved per platform).
    await waitFor(() => expect(screen.getByText('Ctrl Shift Space')).toBeTruthy())
  })

  it('↵ submits the trimmed draft to the new-draft slot (auto-hide rides main)', () => {
    render(<QuickCaptureApp />)
    pushState(true, [])

    fireEvent.change(screen.getByRole('textbox', { name: 'Quick capture' }), { target: { value: '  registry Run key  ' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Quick capture' }), { key: 'Enter' })

    expect(submitMock).toHaveBeenCalledTimes(1)
    expect(submitMock).toHaveBeenCalledWith({ mode: 'project', target: 'new', text: 'registry Run key' })
    // Auto-hide after ↵ is MAIN's job (its submit handler hides the window
    // before forwarding), so the renderer only sends — it must NOT also
    // dismiss, or a submit and a dismiss would race down the same channel.
    expect(dismissMock).not.toHaveBeenCalled()
  })

  it('Escape dismisses without sending anything', () => {
    render(<QuickCaptureApp />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Quick capture' }), { target: { value: 'never mind' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Quick capture' }), { key: 'Escape' })

    expect(submitMock).not.toHaveBeenCalled()
    expect(dismissMock).toHaveBeenCalledTimes(1)
  })

  it('the note chip switches to inbox routing and the container picker disappears', () => {
    render(<QuickCaptureApp />)
    pushState(true, [{ id: 's1', title: 'Fix the build' }])

    fireEvent.click(screen.getByRole('button', { name: /Note/ }))

    expect(screen.queryByLabelText('Record into')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Quick capture' }), { target: { value: 'buy milk' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Quick capture' }), { key: 'Enter' })

    expect(submitMock).toHaveBeenCalledWith({ mode: 'note', target: 'note', text: 'buy milk' })
  })

  it('the mode chip rides the payload and a picked session becomes the target', () => {
    render(<QuickCaptureApp />)
    pushState(true, [{ id: 's1', title: 'Fix the build' }])

    fireEvent.click(screen.getByRole('button', { name: /CTF/ }))
    fireEvent.change(screen.getByLabelText('Record into'), { target: { value: 's1' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick capture' }), { target: { value: 'rop gadget notes' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Quick capture' }), { key: 'Enter' })

    expect(submitMock).toHaveBeenCalledWith({ mode: 'ctf', target: 's1', text: 'rop gadget notes' })
  })

  it('an empty submit sends nothing and never hides the window', () => {
    render(<QuickCaptureApp />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Quick capture' }), { key: 'Enter' })

    expect(submitMock).not.toHaveBeenCalled()
    expect(dismissMock).not.toHaveBeenCalled()
  })
})

describe('shortcutKeycapText', () => {
  it('resolves CommandOrControl per platform and joins with spaces', () => {
    expect(shortcutKeycapText('CommandOrControl+Shift+Space', false)).toBe('Ctrl Shift Space')
    expect(shortcutKeycapText('CommandOrControl+Shift+Space', true)).toBe('⌘ Shift Space')
  })

  it('passes an already-explicit chord through untouched', () => {
    expect(shortcutKeycapText('Control+Alt+F9', false)).toBe('Control Alt F9')
  })
})
