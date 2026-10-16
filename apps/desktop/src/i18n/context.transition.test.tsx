import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type I18nConfigClient, I18nProvider, useI18n } from './context'
import { getRuntimeI18nLocale, translateNow } from './runtime'
import type { Locale } from './types'

// P16: hold non-resident chunk loads so a test can observe the transition
// state between `setLocale` and the single swap render. Already-resident
// locales bypass the gate (the commit path and `setRuntimeI18nLocale` keep
// calling `loadTranslations` after the swap).
const chunkGate = vi.hoisted(() => {
  const pending: Array<() => void> = []

  return {
    holdLoad: () => new Promise<void>(resolve => pending.push(resolve)),
    release: () => {
      pending.splice(0).forEach(resolve => resolve())
    }
  }
})

vi.mock('./catalog', async importOriginal => {
  const actual = await importOriginal()

  return {
    ...actual,
    loadTranslations: vi.fn(async (locale: Locale) => {
      if (actual.hasTranslations(locale)) {
        return actual.loadTranslations(locale)
      }

      await chunkGate.holdLoad()

      return actual.loadTranslations(locale)
    })
  }
})

function TransitionProbe({ target = 'zh' }: { target?: Locale }) {
  const { locale, saveError, setLocale, t } = useI18n()
  const renders = useRef(0)
  renders.current += 1

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="label">{t.language.label}</p>
      <p data-testid="renders">{renders.current}</p>
      <p data-testid="save-error">{saveError?.message ?? ''}</p>
      <button onClick={() => void setLocale(target).catch(() => undefined)} type="button">
        switch
      </button>
    </div>
  )
}

describe('I18nProvider locale transition (P16)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps the previous locale on screen during the transition and swaps once when the chunk lands', async () => {
    render(
      <I18nProvider configClient={null}>
        <TransitionProbe />
      </I18nProvider>
    )

    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('renders').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))

    // Transition state: the zh chunk is still gated, so the screen must keep
    // showing the old locale — no English-fallback flash frame.
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('label').textContent).toBe('Language')

    chunkGate.release()

    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe('zh'))
    expect(screen.getByTestId('label').textContent).toBe('语言')

    // Single swap render: initial + the one commit. Committing immediately
    // used to add an English-fallback frame plus a chunk-landed bump (3).
    expect(screen.getByTestId('renders').textContent).toBe('2')

    // Module-level translators follow the committed locale (chunk resident by
    // swap time, so `translateNow` resolves the real language immediately).
    expect(getRuntimeI18nLocale()).toBe('zh')
    expect(translateNow('common.save')).toBe('保存')
  })

  it('keeps the old locale on screen when the config save fails mid-transition', async () => {
    const configClient: I18nConfigClient = {
      getConfig: vi.fn().mockResolvedValue({ display: { language: 'en' } }),
      saveConfig: vi.fn().mockRejectedValue(new Error('save failed'))
    }

    render(
      <I18nProvider configClient={configClient}>
        <TransitionProbe />
      </I18nProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    chunkGate.release()

    await waitFor(() => expect(screen.getByTestId('save-error').textContent).toBe('save failed'))

    // The swap never happened, so there is nothing to roll back.
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('label').textContent).toBe('Language')
  })
})
