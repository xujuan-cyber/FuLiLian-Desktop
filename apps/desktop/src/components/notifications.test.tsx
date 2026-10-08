import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearNotifications, notify } from '@/store/notifications'

import { NotificationStack, toastTitleClassName } from './notifications'

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
