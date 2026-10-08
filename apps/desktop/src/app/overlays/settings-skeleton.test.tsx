import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsSkeleton } from './settings-skeleton'

// The SettingsView Suspense fallback (step 17 · P3a). What it must prove:
//   1. it actually renders (the pre-fix `fallback={null}` rendered nothing);
//   2. it carries the stable testid the wiring assertion keys on;
//   3. it is purely presentational — no buttons / links / nav rows, so the
//      swap to the real view can never flash a control the real view owns.
describe('SettingsSkeleton', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders a fallback node with the stable testid', () => {
    render(<SettingsSkeleton />)

    const skeleton = screen.getByTestId('settings-skeleton')
    expect(skeleton).toBeTruthy()
    // Background veil + rounded card frame, i.e. the OverlayView frame the real
    // SettingsView mounts into.
    expect(skeleton.className).toContain('bg-black/22')
    expect(skeleton.querySelector('.rounded-xl')).not.toBeNull()
  })

  it('is purely presentational — no interactive elements at all', () => {
    const { container } = render(<SettingsSkeleton />)

    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('a[href]')).toBeNull()
    // No page body — only the presentational split frame the real view later
    // fills (its `<main>` is intentionally absent here).
    expect(container.querySelector('main')).toBeNull()
    // The closing X and the search pill are the real view's chrome: no
    // aria-labelled control, and no actual nav row (they carry `role=button`
    // + copy). The sidebar *container* is present (layout), but it is empty of
    // the interactive children the real view owns.
    expect(container.querySelector('[aria-label]')).toBeNull()
    expect(container.querySelector('[role="button"]')).toBeNull()
    expect(container.querySelector('[data-tour^="nav-"]')).toBeNull()
  })

  it('shows no text — only bars — so nothing flashes before the real copy', () => {
    const { container } = render(<SettingsSkeleton />)

    expect(container.textContent?.trim()).toBe('')
  })
})
