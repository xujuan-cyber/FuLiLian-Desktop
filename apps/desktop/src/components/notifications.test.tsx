import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearNotifications, dismissNotification, notify } from '@/store/notifications'

import { NotificationStack, toastTitleClassName } from './notifications'

// Mirrors notifications.tsx TOAST_EXIT_MS — the tests flush past the exit
// window instead of hardcoding the duration twice.
const TOAST_EXIT_MS = 180

const LONG_TITLE = 'This turn is no longer in server history (it may have been compressed away).'
const DETAIL = 'target user message is no longer in session history'

// The top-center stack's pill-clearance rule (P5), spelled out numerically so
// the test documents the geometry rather than a magic string alone: the
// overlay chrome's centered edge pill (settings' search pill, `edgeBadge` in
// app/overlays/overlay-view.tsx) hangs below the card's top edge — its center
// at titlebar + 0.875rem, half a --titlebar-control-height tall — so its
// bottom edge is 34 + 14 + 12 = 60px. The stack must open below that band.
const TITLEBAR_PX = 34
const CARD_INSET_PX = 14 // 0.875rem — the overlay card's ≥sm inset
const CONTROL_HEIGHT_PX = 24 // --titlebar-control-height
const PILL_BOTTOM_PX = TITLEBAR_PX + CARD_INSET_PX + CONTROL_HEIGHT_PX / 2
const GAP_PX = 8 // 0.5rem breathing gap below the pill's bottom edge

// The class as written in notifications.tsx (Tailwind underscores = spaces).
const TOP_CENTER_OFFSET_CLASS =
  'top-[calc(var(--titlebar-height,34px)_+_0.875rem_+_var(--titlebar-control-height,24px)/2_+_0.5rem)]'

// The retired slot: opened at titlebar + 0.75rem = 46px, directly on the pill
// band (36–60px) — the "toast covers the top-center pill" overlap.
const RETIRED_COLLIDING_CLASS = 'top-[calc(var(--titlebar-height,34px)+0.75rem)]'

describe('toast titles', () => {
  beforeEach(() => {
    clearNotifications()
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
  })

  it('drops the one-line clamp so a long error title can wrap', () => {
    const className = toastTitleClassName()

    expect(className).toMatch(/\bline-clamp-none\b/)
    expect(className).not.toMatch(/\bline-clamp-1\b/)
    expect(className).toMatch(/\bwhitespace-normal\b/)
    expect(className).toContain('max-h-[4.5em]')
    expect(className).toMatch(/\boverflow-y-auto\b/)
  })

  it('renders the full title and body instead of truncating them', () => {
    notify({ kind: 'error', title: LONG_TITLE, message: DETAIL })

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    const title = screen.getByText(LONG_TITLE)

    expect(title.textContent).toBe(LONG_TITLE)
    expect(title.getAttribute('title')).toBe(LONG_TITLE)
    expect(title.className).toMatch(/\bline-clamp-none\b/)
    expect(title.className).not.toMatch(/\bline-clamp-1\b/)
    expect(title.className).toMatch(/\boverflow-y-auto\b/)
    expect(screen.getByText(DETAIL)).toBeTruthy()
  })
})

describe('top-center stack placement', () => {
  beforeEach(() => {
    clearNotifications()
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
  })

  it('offsets below the centered edge pill instead of opening on top of it', () => {
    // Errors/warnings are the noisy top-center surface (the bottom-right
    // ambient stack is untouched by this rule).
    notify({ kind: 'error', message: 'placement probe' })

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    const region = screen.getByRole('region')
    const className = region.className

    // Still the horizontally centered top stack…
    expect(className).toContain('left-1/2')
    expect(className).toContain('-translate-x-1/2')
    // …but at the computed below-the-pill offset, never the retired slot.
    expect(className).not.toContain(RETIRED_COLLIDING_CLASS)
    expect(className).toContain(TOP_CENTER_OFFSET_CLASS)

    // The offset must clear the worst-case pill bottom with the breathing gap:
    // 34px titlebar + 0.875rem(14px) + half control(12px) + 0.5rem(8px) = 68px.
    const topPx = TITLEBAR_PX + CARD_INSET_PX + CONTROL_HEIGHT_PX / 2 + GAP_PX

    expect(topPx).toBeGreaterThan(PILL_BOTTOM_PX)
  })
})

// N-1 (v1.4.1): the stack used to swap toasts with zero transition — the
// abrupt unmount over an open overlay read as a flash/afterimage (U1). The
// dismissed toast now keeps a fading ghost in place for the exit window.
describe('toast exit ghosts', () => {
  beforeEach(() => {
    clearNotifications()
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
  })

  it('keeps a dismissed toast on screen for the exit window, then drops it', async () => {
    // The top-center stack renders only the LATEST toast (older collapse into
    // the +N expander), so the toast under test must be fired last.
    notify({ id: 'ghost-probe-2', kind: 'warning', message: 'GHOST-PROBE-TWO' })
    notify({ id: 'ghost-probe-1', kind: 'warning', message: 'GHOST-PROBE-ONE' })
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    expect(screen.getByText('GHOST-PROBE-ONE')).toBeTruthy()

    // act: the dismissal fires the ghost-push effect synchronously after the
    // commit — flushing it inside act keeps the update wrapped.
    await act(async () => {
      dismissNotification('ghost-probe-1')
    })

    // Immediately after dismissal the live item is gone; what remains is the
    // fading ghost, not a live announcement.
    const copies = screen.queryAllByText('GHOST-PROBE-ONE')

    expect(copies.length).toBe(1)
    expect(copies[0]?.closest('[aria-hidden="true"]')).toBeTruthy()
    expect(copies[0]?.closest('.fulilian-toast-leaving')).toBeTruthy()
    expect(screen.getAllByTestId('toast-exit-ghost').length).toBe(1)

    // …and once the exit window passes the ghost is removed, leaving nothing.
    // act: flush past the 180ms exit timer so the removal update is wrapped.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, TOAST_EXIT_MS + 120))
    })

    expect(screen.queryByText('GHOST-PROBE-ONE')).toBeNull()
    expect(screen.queryByTestId('toast-exit-ghost')).toBeNull()

    // The surviving toast is untouched.
    expect(screen.getByText('GHOST-PROBE-TWO')).toBeTruthy()
  })

  it('survives the last toast leaving the stack — ghost-only region must not crash', async () => {
    // U1's main path: a single top-center toast over the open settings page is
    // dismissed. The region keeps rendering (ghost fading out) with an EMPTY
    // notifications list — the live slot there is conditional, or the ghost
    // render crashes on `latest.kind` and tears the whole tree down (this test
    // caught exactly that).
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    await act(async () => {
      notify({ id: 'solo-probe', kind: 'warning', message: 'SOLO-PROBE' })
    })
    expect(await screen.findByText('SOLO-PROBE')).toBeTruthy()

    await act(async () => {
      dismissNotification('solo-probe')
    })

    expect(screen.getAllByTestId('toast-exit-ghost').length).toBe(1)

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, TOAST_EXIT_MS + 120))
    })

    expect(screen.queryByTestId('toast-exit-ghost')).toBeNull()
  })

  it('animates the entrance and mutes it inside ghosts', () => {
    notify({ kind: 'info', message: 'MOTION-PROBE' })

    render(
      <I18nProvider configClient={null} initialLocale="en">
        <NotificationStack />
      </I18nProvider>
    )

    // The scoped motion stylesheet rides the stack (component-local: styles.css
    // is single-writer territory and reduced-motion is handled inside it).
    // RTL text matchers ignore <style> nodes, so reach for the base element.
    const style = screen.getByText('MOTION-PROBE').ownerDocument.querySelector('style')

    expect(style?.textContent).toContain('fulilian-toast-in')
    expect(style?.textContent).toContain('prefers-reduced-motion')
    expect(style?.textContent).toContain('.fulilian-toast-leaving .fulilian-toast-enter')

    const item = screen.getByText('MOTION-PROBE').closest('[role="status"]')

    expect(item?.className).toContain('fulilian-toast-enter')
  })
})
