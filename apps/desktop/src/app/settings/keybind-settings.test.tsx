import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { resetAllBindings, setBinding } from '@/store/keybinds'
import { stubResizeObserver } from '@/test/jsdom'

import { KeybindSettings } from './keybind-settings'

// Step 16 · T9 (方案 §3-T9): the keybinds settings page renders the SAME
// four-group layout and the SAME registry data as the ? cheat sheet, and
// flags duplicate bindings RED with a suggested free alternative.

stubResizeObserver()

function renderKeybindSettings() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <KeybindSettings />
    </I18nProvider>
  )
}

beforeEach(() => {
  resetAllBindings()
})

afterEach(() => {
  cleanup()
  resetAllBindings()
})

describe('KeybindSettings four-group layout (T9-1)', () => {
  it('renders the four plan group headers, in plan order', () => {
    renderKeybindSettings()

    const labels = ['Global', 'Sessions & approvals', 'Editing', 'Navigation & view']

    const positions = labels.map(label => {
      const el = screen.getByText(label)

      expect(el).toBeTruthy()

      return [...(el.closest('section')?.parentElement?.children ?? [])].indexOf(el.closest('section') as Element)
    })

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('shows the fixed T9 rows (tray trio / capture / approval trio) with reserved badges for unshipped chords', () => {
    renderKeybindSettings()

    // Fixed rows from the shared registry (fixedRowsForGroup): tray trio +
    // quick capture + approval trio + the reserved evidence quote.
    expect(screen.getByText('Quick capture')).toBeTruthy()
    expect(screen.getByText('Allow once')).toBeTruthy()
    expect(screen.getByText('Always allow this session')).toBeTruthy()
    expect(screen.getByText('Reject')).toBeTruthy()

    // Reserved honesty rows: tray Ctrl 1/2/3 (kind-aware consumer missing) and
    // Ctrl+E evidence quote (no handler chain yet).
    expect(screen.getAllByText('Reserved').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('New forensics case')).toBeTruthy()
    expect(screen.getByText('Quote evidence (forensics mode)')).toBeTruthy()
  })

  it('rebinds stay inside their registry group: nav.settings appears under Global', () => {
    renderKeybindSettings()

    act(() => {
      setBinding('nav.settings', ['mod+shift+s'])
    })

    const globalSection = document.querySelector('[data-group="global"]')

    expect(globalSection).not.toBeNull()
    expect(globalSection?.textContent).toContain('Open settings')
  })
})

describe('KeybindSettings conflict detection (T9-1 标红 + 替代建议)', () => {
  it('flags a duplicate binding with the red warning and a free alternative', () => {
    renderKeybindSettings()

    // mod+k collides with nav.commandPalette's shipped default.
    act(() => {
      setBinding('nav.settings', ['mod+k'])
    })

    const row = screen.getByText('Open settings').closest('div.group')

    expect(row?.querySelector('.text-destructive')).not.toBeNull()
    expect(row?.getAttribute('title') ?? row?.querySelector('[title]')?.getAttribute('title')).toContain(
      'Also bound to'
    )
    // The suggestion skips taken rungs: composer.sendQueued ships mod+shift+k,
    // so the free alternative is mod+alt+k → "Ctrl+Alt+K". (Multiple colliding
    // rows can share one suggestion text — assert count, not uniqueness.)
    expect(screen.getAllByText('Suggested alternative: Ctrl+Alt+K').length).toBeGreaterThanOrEqual(1)
  })

  it('surfaces the SHIPPED off-macOS collision (session.slot.N ctrl+N vs profile.switch.N mod+N) instead of hiding it', () => {
    // Pre-existing latent conflict: $comboIndex folds ctrl→mod off macOS and
    // dispatches first-wins, so Ctrl+1 has always been a physical collision
    // between the session slot and the profile slot. T9's detection renders
    // the truth: those rows carry the red warning + a suggested alternative.
    renderKeybindSettings()

    const warnings = document.querySelectorAll<HTMLElement>('.text-destructive[title]')

    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0]?.getAttribute('title')).toContain('Also bound to')
    expect(screen.getAllByText(/Suggested alternative: Ctrl\+/).length).toBeGreaterThanOrEqual(1)
  })
})
