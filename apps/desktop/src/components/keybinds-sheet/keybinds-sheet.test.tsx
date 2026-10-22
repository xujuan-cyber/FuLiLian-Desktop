import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $keybindsSheetOpen, setKeybindsSheetOpen, toggleKeybindsSheet } from '@/store/keybinds-registry'

import { KeybindsSheet } from './keybinds-sheet'

// Step 16 · T9 (方案 §3-T9): the ? cheat sheet is a pure read of the shared
// registry — open state lives in the store; '?'/Esc dispatch belongs to
// use-keybinds (asserted there). Here: render shape, the four plan groups, the
// reserved badges (T9-5 诚实落地), and the close affordances.

function renderSheet() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider configClient={null} initialLocale="en">
        <KeybindsSheet />
      </I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  setKeybindsSheetOpen(false)
})

afterEach(() => {
  cleanup()
  setKeybindsSheetOpen(false)
})

describe('KeybindsSheet', () => {
  it('renders nothing while closed', () => {
    const { container } = renderSheet()

    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from the store and shows all four plan groups', () => {
    renderSheet()

    act(() => {
      setKeybindsSheetOpen(true)
    })

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Global')).toBeTruthy()
    expect(screen.getByText('Sessions & approvals')).toBeTruthy()
    expect(screen.getByText('Editing')).toBeTruthy()
    expect(screen.getByText('Navigation & view')).toBeTruthy()

    // Plan-table rows resolved through the shared registry: palette + capture.
    expect(screen.getByText('Open command palette')).toBeTruthy()
    expect(screen.getByText('Quick capture')).toBeTruthy()
    // The approval trio (wired in tool/approval.tsx).
    expect(screen.getByText('Allow once')).toBeTruthy()
    expect(screen.getByText('Always allow this session')).toBeTruthy()
    expect(screen.getByText('Reject')).toBeTruthy()
  })

  it('marks unimplemented feature chords with the reserved badge (T9-5)', () => {
    renderSheet()

    act(() => {
      setKeybindsSheetOpen(true)
    })

    // Ctrl+1/2/3 kind-aware creation consumer missing; Ctrl+E evidence-quote
    // chain missing. Their rows must be labeled reserved, never plain.
    expect(screen.getAllByText('Reserved')).toHaveLength(4)
    expect(screen.getByText('New forensics case')).toBeTruthy()
    expect(screen.getByText('Quote evidence (forensics mode)')).toBeTruthy()
  })

  it('closes via the Esc button and via backdrop click', () => {
    renderSheet()

    act(() => {
      setKeybindsSheetOpen(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect($keybindsSheetOpen.get()).toBe(false)

    act(() => {
      setKeybindsSheetOpen(true)
    })

    // Portal mounts on document.body, not the test container.
    const backdrop = document.querySelector('[data-slot="keybinds-sheet-backdrop"]')

    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect($keybindsSheetOpen.get()).toBe(false)
  })

  it('toggles from the store atom (? dispatch path shared with use-keybinds)', () => {
    renderSheet()

    act(() => {
      toggleKeybindsSheet()
    })
    expect(screen.getByRole('dialog')).toBeTruthy()

    // Pressing ? again closes (再按关闭).
    act(() => {
      toggleKeybindsSheet()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus to the sheet card while open and shows the settings link', () => {
    renderSheet()

    act(() => {
      setKeybindsSheetOpen(true)
    })

    expect(document.activeElement?.getAttribute('data-slot')).toBe('keybinds-sheet-card')
    expect(screen.getByRole('button', { name: 'Keyboard settings' })).toBeTruthy()
    expect(screen.getByText(/rebindable in keyboard settings/)).toBeTruthy()
  })
})
