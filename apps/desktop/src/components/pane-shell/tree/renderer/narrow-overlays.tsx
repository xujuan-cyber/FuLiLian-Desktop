/**
 * Narrow-viewport overlays — the tree's take on the app's sidebar-collapse
 * breakpoint. Collapsible panes leave the grid below the breakpoint, and
 * PANE_TOGGLE_REVEAL_EVENT (⌘B / ⌘G / titlebar toggles route here on narrow)
 * slides the pane OVER the layout instead of squeezing it. Wake is explicit
 * only — event reveals are pinned and NO pointer motion ever opens or closes
 * the overlay (WorkBuddy-style: a click / keybind brings it up, a click on
 * the scrim / Escape / re-toggle takes it down).
 *
 * The overlay floats over a scrim, and its inner edge carries a drag sash
 * that writes the SAME pane-width override the docked sidebar sash does — so
 * narrow ↔ wide keeps one continuous width.
 */

import { useStore } from '@nanostores/react'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'

import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import type { Contribution } from '@/contrib/types'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { rafCoalesce } from '@/lib/raf-coalesce'
import { cn } from '@/lib/utils'
import { $sidebarWidth, CHAT_SIDEBAR_PANE_ID, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/store/layout'
import { $paneStates, clearPaneWidthOverride, setPaneWidthOverride } from '@/store/panes'

import { PANE_TOGGLE_REVEAL_EVENT } from '../..'
import { allPaneIds, findGroupOfPane } from '../model'
import { $hiddenTreePanes, $layoutTree, $narrowViewport } from '../store'

import { paneChrome } from './track-model'

/** Parse an authored px/rem length ("237px", "20rem"); anything else → fallback. */
const pxOf = (value: string | undefined, fallback: number): number => {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*(px|rem)?\s*$/)

  if (!match) {
    return fallback
  }

  const n = Number.parseFloat(match[1])

  return match[2] === 'rem' ? n * 16 : n
}

/** The pane-state id the overlay's width override is written through — the
 *  reveal aliases ARE the pane-state ids (chat-sidebar / file-browser / …),
 *  so a revealed pane shares its docked twin's width channel. */
const widthChannelOf = (pane: Contribution): string => paneChrome(pane).revealAliases?.[0] ?? pane.id

/** Drag bounds: the pane's authored clamps (falling back to the sidebar's
 *  store bounds), capped so the overlay never eats more than 85vw. */
const widthBoundsOf = (pane: Contribution): { max: number; min: number } => {
  const data = pane.data as { maxWidth?: string; minWidth?: string } | undefined
  const min = Math.max(SIDEBAR_MIN_WIDTH, pxOf(data?.minWidth, SIDEBAR_MIN_WIDTH))
  const vwCap = Math.max(min, Math.round(window.innerWidth * 0.85))
  const max = Math.max(min, Math.min(pxOf(data?.maxWidth, SIDEBAR_MAX_WIDTH), vwCap))

  return { max, min }
}

export function NarrowOverlays() {
  const narrow = useStore($narrowViewport)
  const tree = useStore($layoutTree)
  const panes = useContributions('panes')
  const hiddenPanes = useStore($hiddenTreePanes)
  const paneStates = useStore($paneStates)
  const sidebarWidth = useStore($sidebarWidth)
  const [reveal, setReveal] = useState<string | null>(null)

  // Own an Escape layer only while something is revealed, so Escape closes the
  // overlay only when it's the top layer (never under a dialog / edit mode).
  const revealActive = reveal !== null
  useEffect(() => (revealActive ? pushEscapeLayer(ESCAPE_PRIORITY.narrowOverlay) : undefined), [revealActive])

  const inTree = useMemo(() => new Set(tree ? allPaneIds(tree) : []), [tree])

  const collapsibles = useMemo(
    () => panes.filter(p => paneChrome(p).collapsible && inTree.has(p.id) && !hiddenPanes.has(p.id)),
    [panes, inTree, hiddenPanes]
  )

  const collapsiblesRef = useRef(collapsibles)
  collapsiblesRef.current = collapsibles

  // ⌘B / ⌘G's narrow branch dispatches the app's toggle-reveal event with the
  // REAL pane id — accept those via each contribution's revealAliases.
  useEffect(() => {
    if (!narrow) {
      setReveal(null)

      return
    }

    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; mode?: 'close' | 'open' | 'toggle' }>).detail
      const id = detail?.id

      if (!id) {
        return
      }

      const match = collapsiblesRef.current.find(p => p.id === id || paneChrome(p).revealAliases?.includes(id))

      if (!match) {
        return
      }

      // `open`/`close` are explicit intents (programmatic reveal, titlebar show);
      // `toggle` (default) is the ⌘B/⌘G flip.
      const mode = detail?.mode ?? 'toggle'
      setReveal(current => {
        if (mode === 'open') {
          return match.id
        }

        if (mode === 'close') {
          return current === match.id ? null : current
        }

        return current === match.id ? null : match.id
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
        return
      }

      event.preventDefault()
      setReveal(null)
    }

    window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, onToggle)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [narrow])

  if (!narrow || collapsibles.length === 0) {
    return null
  }

  const sideOf = (c: Contribution) => (paneChrome(c).placement === 'left' ? 'left' : 'right')
  const revealed = reveal ? collapsibles.find(p => p.id === reveal) : undefined

  // The overlay's live width: its channel's override (written by THIS sash or
  // the docked one — one shared state, so narrow ↔ wide is continuous), else
  // the shared sidebar width for the chat sidebar, else the authored width.
  const widthPxOf = (pane: Contribution): number => {
    const channel = widthChannelOf(pane)
    const override = paneStates[channel]?.widthOverride

    if (typeof override === 'number') {
      return override
    }

    if (channel === CHAT_SIDEBAR_PANE_ID) {
      return sidebarWidth
    }

    return pxOf((pane.data as { width?: string } | undefined)?.width, 240)
  }

  // Drag the overlay's inner edge to resize. Writes go through the pane's
  // width channel per frame (rafCoalesce), the same `setPaneWidthOverride`
  // path the docked sash uses; the overlay width reads that store, so the
  // panel tracks the pointer.
  const startWidthDrag = (event: ReactPointerEvent<HTMLDivElement>, pane: Contribution) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()

    const handle = event.currentTarget
    const { pointerId } = event
    const startX = event.clientX
    const startWidth = widthPxOf(pane)
    const { max, min } = widthBoundsOf(pane)
    const channel = widthChannelOf(pane)
    const restoreCursor = document.body.style.cursor
    const restoreSelect = document.body.style.userSelect

    try {
      handle.setPointerCapture?.(pointerId)
    } catch {
      // Synthetic events.
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const resize = rafCoalesce((width: number) => setPaneWidthOverride(channel, width))
    let done = false

    const cleanup = () => {
      if (done) {
        return
      }

      done = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      document.body.style.cursor = restoreCursor
      document.body.style.userSelect = restoreSelect
      resize.finish()
    }

    const onMove = (ev: PointerEvent) => {
      const delta = sideOf(pane) === 'left' ? ev.clientX - startX : startX - ev.clientX
      resize.push(Math.round(Math.max(min, Math.min(max, startWidth + delta))))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  // The revealed pane's ZONE-mates that also left the grid (the sessions zone
  // stacks SESSIONS | BOTS): the overlay mirrors the zone's tab strip so a
  // pane docked into a collapsed zone stays reachable on narrow viewports —
  // without this, only the zone's first pane ever surfaces again.
  const zonePanes = (() => {
    if (!revealed || !tree) {
      return [revealed].filter((p): p is Contribution => Boolean(p))
    }

    const zone = findGroupOfPane(tree, revealed.id)
    const mates = zone ? zone.panes.map(id => collapsibles.find(p => p.id === id)) : []
    const shown = mates.filter((p): p is Contribution => Boolean(p))

    return shown.length > 0 ? shown : [revealed]
  })()

  return (
    <>
      {/* Scrim between the layout and the overlay: makes "this is modal"
          legible and gives the overlay a plain click-to-close. Pointer
          motion never opens or closes the reveal — only this scrim, Escape,
          or re-firing the toggle event do. */}
      {reveal && (
        <div
          aria-hidden
          className="absolute inset-0 z-30 bg-black/25"
          data-narrow-overlay-scrim=""
          onPointerDown={() => {
            setReveal(null)
          }}
        />
      )}

      {revealed && (
        <div
          className={cn(
            'absolute inset-y-0 z-40 flex flex-col overflow-hidden bg-(--ui-sidebar-surface-background) shadow-2xl',
            sideOf(revealed) === 'left'
              ? 'left-0 border-r border-(--ui-stroke-secondary)'
              : 'right-0 border-l border-(--ui-stroke-secondary)'
          )}
          // Floats OVER the layout, so under glass its surface must mask the
          // panes beneath it — a see-through overlay reads as text bleeding
          // through text. Contract: `[data-glass-opaque]` in styles.css.
          data-glass-opaque=""
          data-narrow-overlay-panel=""
          style={{ width: `${Math.round(widthPxOf(revealed))}px` }}
        >
          {/* Zone-mates share the overlay through the zone's own tab strip
              (SESSIONS | BOTS) — a lone pane keeps the stripless form. */}
          {zonePanes.length > 1 && (
            <PaneTabStrip>
              {zonePanes.map(pane => (
                <PaneTab
                  active={pane.id === revealed.id}
                  aria-selected={pane.id === revealed.id}
                  data-narrow-overlay-tab={pane.id}
                  key={pane.id}
                  onPointerDown={event => {
                    if (event.button === 0) {
                      event.preventDefault()
                      setReveal(pane.id)
                    }
                  }}
                >
                  <PaneTabLabel>{pane.title ?? pane.id}</PaneTabLabel>
                </PaneTab>
              ))}
            </PaneTabStrip>
          )}
          <ContribBoundary id={revealed.id}>
            {revealed.render && <ContribRender render={revealed.render} />}
          </ContribBoundary>
          {/* Drag sash on the overlay's inner edge — the narrow counterpart
              of the docked sash (same width channel, same double-click
              reset; cursor and capture semantics match tree-split). */}
          <div
            aria-hidden
            className={cn(
              'absolute inset-y-0 z-10 w-1.5 cursor-col-resize',
              sideOf(revealed) === 'left' ? 'right-0' : 'left-0'
            )}
            data-narrow-overlay-sash=""
            onDoubleClick={() => {
              // Reset to the shared default — the docked sash's behavior.
              clearPaneWidthOverride(widthChannelOf(revealed))
            }}
            onPointerDown={event => startWidthDrag(event, revealed)}
          />
        </div>
      )}
    </>
  )
}
