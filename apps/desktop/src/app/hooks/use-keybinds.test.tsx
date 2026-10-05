import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type KeybindRuntimeDeps, paletteOwnsNumberCombo, useKeybinds } from './use-keybinds'

import { I18nProvider } from '@/i18n'
import { $commandPaletteOpen } from '@/store/command-palette'
import { $keybindsSheetOpen } from '@/store/keybinds-registry'
import { $newChatProfile, $profiles } from '@/store/profile'
import { actionAllowedInInput } from '@/lib/keybinds/combo'

// Step 16 · T8: the Ctrl 1-9 zone-jump guard. While the ⌘K palette is open the
// profile/tab-slot switchers must yield mod+1..9 (the palette's input handler
// jumps to the Nth zone); closed, the same chords stay with the profile slots.
// Pure half asserted on the guard, behavioral half on the real dispatcher.

vi.mock('@/themes/context', () => ({
  useTheme: () => ({ resolvedMode: 'dark', setMode: vi.fn() })
}))

function KeybindHarness({ deps }: { deps: KeybindRuntimeDeps }) {
  useKeybinds(deps)

  return null
}

function renderKeybinds() {
  const deps: KeybindRuntimeDeps = {
    toggleCommandCenter: vi.fn(),
    startFreshSession: vi.fn(),
    openNewSessionTab: vi.fn(),
    toggleSelectedPin: vi.fn(),
    archiveSelectedSession: vi.fn()
  }

  render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider configClient={null} initialLocale="en">
        <KeybindHarness deps={deps} />
      </I18nProvider>
    </MemoryRouter>
  )

  return deps
}

describe('paletteOwnsNumberCombo (pure guard)', () => {
  it('Ctrl+K is globally dispatchable even from editable focus (T8-5 会话页聚焦可唤起)', () => {
    // The dispatcher consults actionAllowedInInput: a primary-modifier chord
    // (mod+k) is a deliberate two-key gesture that fires even while typing —
    // this is the seam that makes ⌘K work with the composer/session search
    // focused. (nav.commandPalette defaults: mod+k / mod+p.)
    expect(actionAllowedInInput('nav.commandPalette', 'mod+k')).toBe(true)
  })

  it.each(['mod+1', 'mod+5', 'mod+9'])('claims %s for the open palette', combo => {
    expect(paletteOwnsNumberCombo(combo)).toBe(true)
  })

  it.each(['mod+0', 'mod+10', 'mod+shift+1', 'mod+alt+1', 'mod+k', 'mod', '1'])(
    'does not claim %s (stays with the global dispatcher)',
    combo => {
      expect(paletteOwnsNumberCombo(combo)).toBe(false)
    }
  )
})

describe('useKeybinds dispatcher vs the open palette (T8)', () => {
  beforeEach(() => {
    // Two named profiles so the closed-palette mod+1 has a real target
    // (switchProfileToSlot picks the first non-default profile).
    $profiles.set([
      { has_env: false, is_default: true, model: null, name: 'default', path: '.', provider: null, skill_count: 0 },
      { has_env: false, is_default: false, model: null, name: 'alpha', path: '.', provider: null, skill_count: 0 }
    ])
  })

  afterEach(() => {
    cleanup()
    $profiles.set([])
    $newChatProfile.set(null)
    $commandPaletteOpen.set(false)
  })

  it('with the palette CLOSED, mod+1 still reaches the profile slot switch', () => {
    renderKeybinds()

    act(() => {
      fireEvent.keyDown(window, { code: 'Digit1', ctrlKey: true, key: '1' })
    })

    expect($newChatProfile.get()).toBe('alpha')
  })

  it('with the palette OPEN, mod+1 yields to the palette (no profile switch)', () => {
    renderKeybinds()
    $commandPaletteOpen.set(true)

    act(() => {
      fireEvent.keyDown(window, { code: 'Digit1', ctrlKey: true, key: '1' })
    })

    expect($newChatProfile.get()).toBeNull()
  })
})

// Step 16 · T9: the ? cheat sheet dispatch — '?' (shift+/) toggles on a
// non-editable target, Esc closes before any Esc-bound action fires
// underneath, and editable targets keep their literal '?'.
describe('useKeybinds dispatcher vs the ? cheat sheet (T9)', () => {
  afterEach(() => {
    cleanup()
    $keybindsSheetOpen.set(false)
  })

  it('? (shift+/) opens the sheet, and pressing ? again closes it', () => {
    renderKeybinds()
    expect($keybindsSheetOpen.get()).toBe(false)

    act(() => {
      fireEvent.keyDown(window, { code: 'Slash', key: '?', shiftKey: true })
    })
    expect($keybindsSheetOpen.get()).toBe(true)

    act(() => {
      fireEvent.keyDown(window, { code: 'Slash', key: '?', shiftKey: true })
    })
    expect($keybindsSheetOpen.get()).toBe(false)
  })

  it('Escape closes the open sheet before composer.cancel can fire underneath', () => {
    renderKeybinds()
    act(() => {
      $keybindsSheetOpen.set(true)
    })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect($keybindsSheetOpen.get()).toBe(false)
  })

  it('keeps the literal ? while an editable target holds focus', () => {
    renderKeybinds()

    const input = document.createElement('input')

    document.body.appendChild(input)

    try {
      act(() => {
        fireEvent.keyDown(input, { code: 'Slash', key: '?', shiftKey: true })
      })

      expect($keybindsSheetOpen.get()).toBe(false)
    } finally {
      input.remove()
    }
  })
})
