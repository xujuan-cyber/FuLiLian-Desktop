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

// The top-center stack's offset. It used to sit ~12px lower to clear the
// overlay chrome's centered edge pill (the settings search pill, `edgeBadge`);
// P1 replaced that pill with a real field in the settings rail, so the stack
// returned to the plain titlebar + 0.75rem slot. These constants spell the
// geometry out numerically so the test documents the reasoning, not a magic
// string.
const TITLEBAR_PX = 34
const STACK_OFFSET_PX = 12 // 0.75rem below the titlebar

// The class as written in notifications.tsx (Tailwind underscores = spaces;
// this calc has no spaces, so none are needed).
const TOP_CENTER_OFFSET_CLASS = 'top-[calc(var(--titlebar-height,34px)+0.75rem)]'

// The retired pill-clearance slot: titlebar + 0.875rem + half the control
// height + a 0.5rem gap = 68px, ~22px lower than needed once the pill was gone.
const RETIRED_PILL_CLEARANCE_CLASS =
  'top-[calc(var(--titlebar-height,34px)_+_0.875rem_+_var(--titlebar-control-height,24px)/2_+_0.5rem)]'

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

  it('opens at the plain titlebar offset, not the retired pill-clearance slot', () => {
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
    // …at the plain slot, never the pill-era clearance that pushed it ~22px
    // lower for a pill that no longer exists.
    expect(className).not.toContain(RETIRED_PILL_CLEARANCE_CLASS)
    expect(className).toContain(TOP_CENTER_OFFSET_CLASS)

    // 34px titlebar + 0.75rem(12px) = 46px: below the traffic lights, and at
    // the card's top edge where nothing else is drawn.
    expect(TITLEBAR_PX + STACK_OFFSET_PX).toBe(46)
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
