import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n/context'
import { TRANSLATIONS } from '@/i18n/catalog'
import {
  $sessionPreset,
  rememberSessionPreset,
  setActivePreset
} from '@/store/presets'

import { PresetChip } from './preset-chip'

// REV-13 §3-B13 — the chip must not pass the *pending* selection off as the
// gate an *existing* session actually runs under. A session with no recorded
// preset (created before presets existed, created by another surface, or one
// whose record was cleared) resolves its toolsets from the platform config;
// showing the picker's pending value there is a lie about its tools.
function renderChip(storedSessionId: null | string) {
  return render(
    <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
      <PresetChip storedSessionId={storedSessionId} />
    </I18nProvider>
  )
}

describe('PresetChip', () => {
  beforeEach(() => {
    setActivePreset(null)
    $sessionPreset.set({})
  })

  afterEach(() => {
    cleanup()
  })

  it('an existing session with no preset record never borrows the pending selection', () => {
    rememberSessionPreset('s', null)
    setActivePreset('dev')

    renderChip('s')

    const chip = screen.getByRole('button')
    expect(chip.textContent).toBe(TRANSLATIONS.en.presets.none)
    expect(chip.textContent).not.toContain(TRANSLATIONS.en.presets.names.dev.name)
  })
})
