import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CatalogModule from './catalog'
import { type I18nConfigClient, I18nProvider, useI18n } from './context'
import type { Locale } from './types'

// N-4: the provider splits transient save/config flags into a second context
// (useI18nStatus). These tests pin the two behaviours the split exists for:
//
//   1. translation consumers re-render ONLY on the P16 single swap — the
//      isSavingLocale on/off toggles around every switch must not reach them;
//   2. rapid successive switches (5 rounds) never unmount/blank the tree and
//      the final committed locale is the LAST request (seq supersede).

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
  const actual = await importOriginal<typeof CatalogModule>()

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

function CountingProbe({ targets }: { targets: Locale[] }) {
  const { locale, setLocale, t } = useI18n()
  const renders = useRef(0)
  renders.current += 1
  const next = useRef(0)
  // If this subtree ever unmounted (white-screen class of failure), the probe
  // would leave the document and every screen assertion below would throw.
  useEffect(() => {
    if (targets.length > 0) {
      // touch ref so the closure keeps targets alive; no mount side effects
      void targets.length
    }
  }, [targets])

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="label">{t.language.label}</p>
      <p data-testid="renders">{renders.current}</p>
      <button
        onClick={() => {
          const target = targets[next.current]
          next.current += 1

          if (target) {
            void setLocale(target).catch(() => undefined)
          }
        }}
        type="button"
      >
        switch
      </button>
    </div>
  )
}

function residentConfigClient(saveConfig?: I18nConfigClient['saveConfig']): I18nConfigClient {
  return {
    getConfig: vi.fn().mockResolvedValue({ display: { language: 'en' } }),
    saveConfig: saveConfig ?? vi.fn().mockResolvedValue({ ok: true })
  }
}

describe('I18nProvider N-4 split (render isolation + rapid switching)', () => {
  afterEach(() => {
    cleanup()
    chunkGate.release()
    vi.restoreAllMocks()
  })

  it('does not re-render translation consumers while the save flags flip', async () => {
    render(
      <I18nProvider configClient={residentConfigClient()} initialLocale="en">
        <CountingProbe targets={['zh']} />
      </I18nProvider>
    )

    expect(screen.getByTestId('renders').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))

    // In flight: saving=true flipped the status context. The translation-only
    // consumer must NOT re-render — before the N-4 split this read the same
    // context value and rendered once per flag toggle.
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('renders').textContent).toBe('1')

    chunkGate.release()

    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe('zh'))
    expect(screen.getByTestId('label').textContent).toBe('语言')

    // Exactly one full re-render beyond mount: the P16 single swap.
    expect(screen.getByTestId('renders').textContent).toBe('2')
  })

  it('keeps five rapid switches mounted and lands on the last requested locale', async () => {
    const saveResolvers: Array<(result: { ok: boolean }) => void> = []

    const configClient = residentConfigClient(
      vi.fn(() => new Promise<{ ok: boolean }>(resolve => saveResolvers.push(resolve)))
    )

    render(
      <I18nProvider configClient={configClient} initialLocale="en">
        <CountingProbe targets={['zh', 'zh-hant', 'ja', 'en', 'ar']} />
      </I18nProvider>
    )

    // Five rounds with no await between them: every switch overlaps the ones
    // before it (the real switcher serializes via isSavingLocale, the provider
    // itself must stay correct even when it is not serialized).
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    }

    // Nothing committed while saves + chunk loads are pending: the screen
    // keeps the old language — no fallback flash, no blank frame.
    expect(screen.getByTestId('locale').textContent).toBe('en')
    expect(screen.getByTestId('label').textContent).toBe('Language')

    // Drain microtasks so every in-flight setLocale has reached its pending
    // saveConfig (five synchronous fireEvent clicks do not yield).
    await act(async () => {
      await Promise.resolve()
    })
    expect(saveResolvers).toHaveLength(5)

    // Settle OUT of order: the last request's save resolves first. The seq
    // guard must keep earlier transitions from overwriting the final locale.

    ;[...saveResolvers].reverse().forEach(resolve => resolve({ ok: true }))
    chunkGate.release()

    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe('ar'))
    expect(screen.getByTestId('label').textContent.length).toBeGreaterThan(0)

    // The tree was never unmounted (probe still answerable) and re-rendered
    // at least once for the swap.
    const renders = Number(screen.getByTestId('renders').textContent)
    expect(renders).toBeGreaterThanOrEqual(2)
  })
})
