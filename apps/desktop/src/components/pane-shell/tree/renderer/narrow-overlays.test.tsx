import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { NARROW_OVERLAY_CLOSE_DELAY_MS } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { registry } from '@/contrib/registry'
import { $paneStates, clearPaneWidthOverride, setPaneWidthOverride } from '@/store/panes'
import { stubResizeObserver } from '@/test/jsdom'

import { group, split } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, declareDefaultTree } from '../store'

import { NarrowOverlays } from './narrow-overlays'

// Ground truth for "the Bots tab is still visible when the sessions sidebar
// collapses on a narrow window". A collapsible pane DOCKED into the sessions
// zone (SESSIONS | BOTS) must leave the grid with the zone, and the narrow
// edge overlay must mirror the zone's tab strip so the docked pane stays
// reachable — not just the zone's first pane.

beforeAll(() => {
  stubResizeObserver()
})

const disposers: (() => void)[] = []

const registerPane = (id: string, title: string, data: Record<string, unknown>, body: string) => {
  disposers.push(
    registry.register({
      area: 'panes',
      data,
      id,
      render: () => <div data-testid={`${id}-body`}>{body}</div>,
      title
    })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  $hiddenTreePanes.set(new Set())

  registerPane('sessions', 'sessions', { collapsible: true, placement: 'left', width: '237px' }, 'session rows')
  registerPane('bots', 'Bots', { collapsible: true, placement: 'left', width: '260px' }, 'bot roster')
  registerPane('workspace', 'workspace', { placement: 'main', uncloseable: true }, 'chat')

  declareDefaultTree(split('row', [group(['sessions', 'bots']), group(['workspace'])]))
  $narrowViewport.set(true)
})

afterEach(() => {
  cleanup()
  $narrowViewport.set(false)
  $layoutTree.set(null)
  clearPaneWidthOverride('sessions')
  clearPaneWidthOverride('bots')
  vi.useRealTimers()
  disposers.splice(0).forEach(dispose => dispose())
})

const revealPane = (id: string) => {
  act(() => {
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id, mode: 'open' } }))
  })
}

const overlayTab = (paneId: string) => document.querySelector<HTMLElement>(`[data-narrow-overlay-tab="${paneId}"]`)

describe('narrow overlay of a stacked zone', () => {
  it('mirrors the zone tab strip so every stacked collapsible stays reachable', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    // Both zone-mates surface as tabs; the revealed pane's body is on screen.
    expect(overlayTab('sessions')).toBeTruthy()
    expect(overlayTab('bots')).toBeTruthy()
    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(queryByTestId('bots-body')).toBeNull()

    // Clicking the BOTS tab swaps the overlay to the docked pane.
    fireEvent.pointerDown(overlayTab('bots')!, { button: 0 })
    expect(getByTestId('bots-body')).toBeTruthy()
    expect(queryByTestId('sessions-body')).toBeNull()
  })

  it('keeps the stripless form for a zone with a single collapsible', () => {
    // Direct set: declareDefaultTree only ADOPTS into an existing tree — it
    // would keep the beforeEach zone (with bots) instead of replacing it.
    $layoutTree.set(split('row', [group(['sessions']), group(['workspace'])]))

    const { getByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(overlayTab('sessions')).toBeNull()
  })
})

// Regression ground truth for the narrow-window fix: the overlay must be
// dismissible via a scrim, survive in-overlay interaction, and drag-resize
// through the SAME width channel the docked sidebar sash writes.

const edgeStrip = (side: 'left' | 'right') =>
  document.querySelector<HTMLElement>(`[data-narrow-overlay-edge="${side}"]`)

const overlayPanel = () => document.querySelector<HTMLElement>('[data-narrow-overlay-panel]')

const overlaySash = () => document.querySelector<HTMLElement>('[data-narrow-overlay-sash]')

/** jsdom has no layout, so a drag is simulated with window-level pointer
 *  events (the sash listens there during the gesture, like the docked sash). */
const dragSash = (fromX: number, toX: number) => {
  act(() => {
    fireEvent.pointerDown(overlaySash()!, { button: 0, clientX: fromX })
  })
  act(() => {
    fireEvent(window, new MouseEvent('pointermove', { clientX: toX }))
  })
  act(() => {
    fireEvent(window, new MouseEvent('pointerup', { clientX: toX }))
  })
}

describe('narrow overlay scrim (F1)', () => {
  it('renders a scrim under the overlay and clicking it closes the reveal', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    const scrim = document.querySelector<HTMLElement>('[data-narrow-overlay-scrim]')
    expect(scrim).toBeTruthy()
    expect(getByTestId('sessions-body')).toBeTruthy()

    act(() => {
      fireEvent.pointerDown(scrim!)
    })

    expect(queryByTestId('sessions-body')).toBeNull()
    expect(document.querySelector('[data-narrow-overlay-scrim]')).toBeNull()
  })
})

describe('narrow overlay interaction (F2)', () => {
  it('exposes a hover hit strip at least 12px wide', () => {
    render(<NarrowOverlays />)

    // jsdom does no layout, so assert the Tailwind width class (w-3 = 12px).
    expect(edgeStrip('left')?.className).toMatch(/w-3\b/)
  })

  it('keeps an un-pinned overlay up while the pointer is inside and only closes after it leaves', () => {
    vi.useFakeTimers()
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    // Hover reveal (un-pinned) through the edge strip.
    act(() => {
      fireEvent.mouseEnter(edgeStrip('left')!)
    })
    expect(getByTestId('sessions-body')).toBeTruthy()

    // Moving within the overlay (incl. entering it from the strip) keeps it up.
    act(() => {
      fireEvent.mouseEnter(overlayPanel()!)
    })
    expect(getByTestId('sessions-body')).toBeTruthy()

    // Leaving the overlay does NOT close it immediately — only after the
    // grace window, so scrollbar/jitter cannot kill it mid-interaction.
    act(() => {
      fireEvent.mouseLeave(overlayPanel()!)
    })
    expect(queryByTestId('sessions-body')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(NARROW_OVERLAY_CLOSE_DELAY_MS + 10)
    })
    expect(queryByTestId('sessions-body')).toBeNull()
  })
})

describe('narrow overlay drag resize (F3)', () => {
  it('drags the inner-edge sash and writes the shared pane width override', () => {
    render(<NarrowOverlays />)

    revealPane('sessions')

    expect(overlaySash()).toBeTruthy()
    // Contribution width is 237px, so the sash starts at x=237.
    dragSash(237, 400)

    expect($paneStates.get().sessions?.widthOverride).toBe(400)
    expect(overlayPanel()!.style.width).toBe('400px')
  })

  it('clamps the dragged width to [SIDEBAR_MIN_WIDTH, min(SIDEBAR_MAX_WIDTH, 85vw)]', () => {
    render(<NarrowOverlays />)

    revealPane('sessions')

    // jsdom innerWidth is 1024 → 85vw ≈ 870, so the 640 cap wins.
    dragSash(237, 5000)
    expect($paneStates.get().sessions?.widthOverride).toBe(640)

    dragSash(237, -5000)
    expect($paneStates.get().sessions?.widthOverride).toBe(180)
  })

  it('double-clicking the sash resets to the default width', () => {
    render(<NarrowOverlays />)

    revealPane('sessions')

    dragSash(237, 400)
    expect($paneStates.get().sessions?.widthOverride).toBe(400)

    act(() => {
      fireEvent.doubleClick(overlaySash()!)
    })

    expect($paneStates.get().sessions?.widthOverride).toBeUndefined()
    expect(overlayPanel()!.style.width).toBe('237px')
  })

  it('sizes the overlay from the shared width override set while docked', () => {
    act(() => {
      setPaneWidthOverride('sessions', 320)
    })

    render(<NarrowOverlays />)

    revealPane('sessions')

    expect(overlayPanel()!.style.width).toBe('320px')
  })
})
