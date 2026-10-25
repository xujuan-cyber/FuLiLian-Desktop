// @vitest-environment jsdom
/**
 * N-3 (v1.4.1) — overlay top-control hit integrity.
 *
 * The overlay's top strip is a `-webkit-app-region: drag` band (window drag
 * from the card's titlebar row). Chromium subtracts from the draggable region
 * ONLY elements explicitly marked `no-drag`; anything unmarked whose box falls
 * inside the strip's rectangle drags the window instead of receiving the
 * click. The edge badge (settings' search pill) straddles the card's top edge
 * — its lower half sits INSIDE the strip's box (measured 117×11px overlap on
 * the real pill at 1440×900) — so it must carry `no-drag` itself. It cannot
 * inherit the strip's subtraction: it is a later sibling of the card, outside
 * the strip's subtree.
 *
 * jsdom cannot execute app-region hit-testing (that is an Electron/Blink
 * behavior); this test pins the CLASS CONTRACT the fix relies on. The
 * geometric overlap it compensates is asserted right below from the shipped
 * geometry (badge straddles top edge = half its height inside the strip).
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OverlayView } from './overlay-view'

const NO_DRAG = '[-webkit-app-region:no-drag]'
const DRAG = '[-webkit-app-region:drag]'

function renderOverlay() {
  // Minimal mount: OverlayView needs no providers (close label via
  // translateNow falls back to the active locale).
  const { container } = render(
    <OverlayView edgeBadge={<button type="button">edge-badge-probe</button>} onClose={() => {}}>
      <div>content</div>
    </OverlayView>
  )

  return container
}

describe('overlay top-control drag region contract', () => {
  it('marks the edge badge wrapper no-drag so its strip-overlapped half stays clickable', () => {
    const container = renderOverlay()

    // The badge wrapper is the only z-20 float (header/titlebar floats have no
    // z class of their own).
    const badgeWrapper = [...container.querySelectorAll('div')].find(
      el => String(el.className).includes('z-20') && String(el.className).includes('-translate-y-1/2')
    )

    expect(badgeWrapper).toBeTruthy()
    expect(badgeWrapper?.textContent).toContain('edge-badge-probe')
    // The fix: without this the pill's lower band (inside the drag strip's
    // box) started a window drag instead of opening the command palette.
    expect(String(badgeWrapper?.className)).toContain(NO_DRAG)
  })

  it('keeps the drag strip and the other top controls on their existing contract', () => {
    const container = renderOverlay()

    // The strip: the draggable band every top control must opt out of.
    const strip = [...container.querySelectorAll('div')].find(el =>
      String(el.className).includes(DRAG) && !String(el.className).includes('no-drag')
    )

    expect(strip).toBeTruthy()

    // Close button + titlebar actions live inside the strip and opt out.
    const noDragCount = [...container.querySelectorAll('div')].filter(el =>
      String(el.className).includes(NO_DRAG)
    ).length

    expect(noDragCount).toBeGreaterThanOrEqual(2)
  })
})
