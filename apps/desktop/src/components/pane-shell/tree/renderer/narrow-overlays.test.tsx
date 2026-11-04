import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
  clearPaneWidthOverride('chat-sidebar')
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

// WorkBuddy-style explicit wake: pointer motion NEVER opens or closes the
// overlay. The only open path is PANE_TOGGLE_REVEAL_EVENT ('open'/'toggle',
// from ⌘B / ⌘G / titlebar buttons); the only close paths are the scrim, the
// Escape layer, and re-firing the toggle. The old hover edge-strip and
// mouse-leave close chains are gone.
describe('narrow overlay explicit wake (R1/R4)', () => {
  const fireToggle = (id: string, mode: 'close' | 'open' | 'toggle') => {
    act(() => {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id, mode } }))
    })
  }

  it('renders no edge hover strips anywhere in the document', () => {
    render(<NarrowOverlays />)

    revealPane('sessions')

    // The wake surface is the event (⌘B/⌘G/titlebar) only — no hover strip.
    expect(document.querySelectorAll('[data-narrow-overlay-edge]')).toHaveLength(0)
  })

  it("reveals via 'toggle' and closes via a second 'toggle'", () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    fireToggle('sessions', 'toggle')
    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(document.querySelector('[data-narrow-overlay-scrim]')).toBeTruthy()

    fireToggle('sessions', 'toggle')
    expect(queryByTestId('sessions-body')).toBeNull()
    expect(document.querySelector('[data-narrow-overlay-scrim]')).toBeNull()
  })

  it("honours explicit 'open' then 'close' intents", () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    fireToggle('sessions', 'close')
    // 'close' on an already-hidden pane is a no-op, not a flip.
    expect(queryByTestId('sessions-body')).toBeNull()

    fireToggle('sessions', 'open')
    expect(getByTestId('sessions-body')).toBeTruthy()

    fireToggle('sessions', 'close')
    expect(queryByTestId('sessions-body')).toBeNull()
  })

  it('never closes on pointer motion — mouse-leave is not a close path', () => {
    const { getByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')

    // Leaving INTO the window and leaving the WINDOW (relatedTarget null)
    // must both leave the overlay untouched — no grace timer, no re-entry
    // listener, nothing.
    act(() => {
      fireEvent.mouseLeave(overlayPanel()!, { relatedTarget: document.body })
    })
    expect(getByTestId('sessions-body')).toBeTruthy()

    act(() => {
      fireEvent.mouseLeave(overlayPanel()!, { relatedTarget: null })
    })
    expect(getByTestId('sessions-body')).toBeTruthy()

    // Real timers would only fire a stale grace timer if one existed; the
    // overlay is still up either way because no timer is ever scheduled.
    expect(getByTestId('sessions-body')).toBeTruthy()
  })

  it('closes via the Escape layer', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    revealPane('sessions')
    expect(getByTestId('sessions-body')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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

// F4 ground truth for the dynamic collapse threshold: the narrow mode must
// engage through the REAL signal path — a window resized into the anomaly
// interval (sidebar 640px persisted, window 800px) — with no manual atom pin.
// Inside [768, 821] the old static media query read "docked" while the docked
// main pane was crushed below its 22vw floor; now the sidebar auto-hides and
// the overlay mechanism takes over.
describe('narrow overlay via the dynamic resize signal (F4)', () => {
  const setInnerWidth = (px: number) =>
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })

  let originalInnerWidth: number

  beforeEach(() => {
    originalInnerWidth = window.innerWidth
  })

  afterEach(() => {
    setInnerWidth(originalInnerWidth)
  })

  it('auto-hides the sidebar when a resize lands inside [768, threshold]', () => {
    // Baseline: docked. The flip below must come from the resize path alone.
    $narrowViewport.set(false)

    act(() => {
      setPaneWidthOverride('chat-sidebar', 640)
      setInnerWidth(800)
      window.dispatchEvent(new Event('resize'))
    })

    // The dynamic signal — not the beforeEach manual pin — flipped narrow.
    expect($narrowViewport.get()).toBe(true)

    const { getByTestId } = render(<NarrowOverlays />)
    revealPane('sessions')

    // The grid dropped the collapsible panes and the overlay is reachable.
    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(document.querySelector('[data-narrow-overlay-scrim]')).toBeTruthy()
  })

  it('stays docked on a wide window with the same max-width sidebar (zero change)', () => {
    act(() => {
      setPaneWidthOverride('chat-sidebar', 640)
      setInnerWidth(1200)
      window.dispatchEvent(new Event('resize'))
    })

    expect($narrowViewport.get()).toBe(false)
  })
})
