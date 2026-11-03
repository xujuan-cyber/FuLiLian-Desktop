import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $narrowViewport, isNarrowViewport } from '@/components/pane-shell/tree/store'
import { clearPaneWidthOverride, setPaneWidthOverride } from '@/store/panes'

import { MAIN_PANE_MIN_RATIO, SIDEBAR_COLLAPSE_BREAKPOINT_PX, sidebarCollapseThresholdPx } from './layout-constants'

describe('sidebarCollapseThresholdPx (F1: dynamic collapse threshold)', () => {
  it('keeps the static 768 floor for the default sidebar width (237px → critical 304 < 768)', () => {
    // Default docked sidebar: threshold must stay exactly the historical
    // breakpoint — wide-window behaviour is unchanged for everyone who never
    // dragged the sash.
    expect(sidebarCollapseThresholdPx(237)).toBe(SIDEBAR_COLLAPSE_BREAKPOINT_PX)
    expect(sidebarCollapseThresholdPx(0)).toBe(SIDEBAR_COLLAPSE_BREAKPOINT_PX)
  })

  it('rises with a dragged sidebar: 640px → 821 (the reported anomaly interval)', () => {
    // 640 / 0.78 = 820.51… → ceil 821. With the old static 768, every window
    // in [768, 820] docked a sidebar too wide to fit beside a 22vw main pane.
    expect(sidebarCollapseThresholdPx(640)).toBe(821)
  })

  it('is exact at the 22vw boundary: at the threshold the main pane just clears its floor', () => {
    const sidebarW = 640
    const threshold = sidebarCollapseThresholdPx(sidebarW)
    const mainAtThreshold = threshold - sidebarW
    expect(mainAtThreshold).toBeGreaterThanOrEqual(MAIN_PANE_MIN_RATIO * threshold)
  })

  it('is monotonically non-decreasing in sidebar width', () => {
    let prev = 0
    for (const w of [0, 180, 237, 240, 320, 480, 640, 1000]) {
      const t = sidebarCollapseThresholdPx(w)
      expect(t).toBeGreaterThanOrEqual(prev)
      expect(t).toBeGreaterThanOrEqual(SIDEBAR_COLLAPSE_BREAKPOINT_PX)
      prev = t
    }
  })
})

// F2/F4: the atom is a dynamic single source of truth — recomputed on window
// resize AND on chat-sidebar width changes, never fighting other panes' state.

const setInnerWidth = (px: number) => Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })

let originalInnerWidth: number

beforeEach(() => {
  originalInnerWidth = window.innerWidth
})

afterEach(() => {
  // Restore the jsdom default and let the real resize path settle the atom —
  // this also proves the resize listener stays alive across tests (no leak).
  setInnerWidth(originalInnerWidth)
  clearPaneWidthOverride('chat-sidebar')
  window.dispatchEvent(new Event('resize'))
  expect($narrowViewport.get()).toBe(false)
})

describe('$narrowViewport dynamic signal (F2: resize + paneStates, one source)', () => {
  it('starts docked in jsdom (1024 wide, default 240px sidebar → threshold 768)', () => {
    expect(window.innerWidth).toBe(1024)
    expect($narrowViewport.get()).toBe(false)
    expect(isNarrowViewport()).toBe(false)
  })

  it('flips narrow via window.resize inside the anomaly interval (F4: auto-hide engages)', () => {
    // The reported break: sidebar dragged to 640, window shrunk to 800. The
    // old static query stayed false while the docked main pane was crushed
    // below its 22vw floor (800-640=160 < 0.22*800=176). The dynamic signal
    // must collapse the sidebar here instead.
    setPaneWidthOverride('chat-sidebar', 640)
    setInnerWidth(800)
    window.dispatchEvent(new Event('resize'))

    expect($narrowViewport.get()).toBe(true)
    expect(isNarrowViewport()).toBe(true)
  })

  it('recomputes through the $paneStates channel without any resize event', () => {
    // Window already below the (future) threshold: dragging the sash wider —
    // which writes this exact channel — must collapse the sidebar on its own.
    setInnerWidth(800)
    window.dispatchEvent(new Event('resize'))
    expect($narrowViewport.get()).toBe(false) // 800 ≥ 768, default sidebar

    setPaneWidthOverride('chat-sidebar', 640)
    expect($narrowViewport.get()).toBe(true) // threshold became 821
  })

  it('holds docked at exactly the threshold and collapses one pixel below', () => {
    setPaneWidthOverride('chat-sidebar', 640)

    setInnerWidth(821)
    window.dispatchEvent(new Event('resize'))
    expect($narrowViewport.get()).toBe(false) // 821-640=181 ≥ 0.22*821≈180.6

    setInnerWidth(820)
    window.dispatchEvent(new Event('resize'))
    expect($narrowViewport.get()).toBe(true)
  })

  it('keeps wide-window behaviour unchanged even with a max-width sidebar', () => {
    setPaneWidthOverride('chat-sidebar', 640)
    setInnerWidth(1200)
    window.dispatchEvent(new Event('resize'))

    expect($narrowViewport.get()).toBe(false)

    // Clearing the override drops the threshold back to 768 — still docked.
    clearPaneWidthOverride('chat-sidebar')
    expect($narrowViewport.get()).toBe(false)
  })

  it('ignores width changes of other panes (filter: chat-sidebar key only)', () => {
    // Tests and features pin the atom directly (e.g. narrow-overlays); churn
    // from unrelated pane state must never clobber that.
    $narrowViewport.set(true)

    setPaneWidthOverride('sessions', 320)
    expect($narrowViewport.get()).toBe(true)

    // ...while a real chat-sidebar change still recomputes and unsets it.
    setInnerWidth(1024)
    setPaneWidthOverride('chat-sidebar', 640)
    expect($narrowViewport.get()).toBe(false) // 1024 ≥ 821
  })
})
