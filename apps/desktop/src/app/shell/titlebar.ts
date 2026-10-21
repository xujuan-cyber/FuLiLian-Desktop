import type { FulilianConnection } from '@/global'

export const TITLEBAR_HEIGHT = 34

/**
 * The zone tab strip's row height (v3). The chrome is TWO rows that read as
 * one: this 34px title row plus a 30px tab row, sharing one surface and one
 * hairline at the bottom — never a rule between them (design §8.1 / §4.3).
 *
 * A single 44px row (design's ideal) would require hoisting every zone's tab
 * strip out of the pane tree: strips are per-zone (split tiles each own one,
 * each independently hideable, each a drag/drop target). Merging them into the
 * window row is a pane-shell re-architecture, not a restyle — so the shipped
 * shape is the 34+30 = 64px fallback the plan authorises.
 */
export const TITLEBAR_TAB_STRIP_HEIGHT = 30

/** Total chrome height — the value `--v3-chrome-height` publishes. */
export const TITLEBAR_CHROME_HEIGHT = TITLEBAR_HEIGHT + TITLEBAR_TAB_STRIP_HEIGHT

/**
 * Brand lane: the sidebar column, so brand and sidebar rows share one axis.
 * MUST match the CSS `--sidebar-width` (14.8125rem = 237px) — the lane is the
 * window's leading sidebar-width, and the tool clusters start after it. If the
 * sidebar ever widens (v3 target 252), change both together.
 */
export const TITLEBAR_BRAND_WIDTH = 237

/** Gap between the brand lane and the first left-cluster tool. */
export const TITLEBAR_BRAND_GAP = 8

export const MACOS_TRAFFIC_LIGHTS_HEIGHT = 14
/** Titlebar tool hit target (both axes). */
export const TITLEBAR_CONTROL_SIZE = 24
/** Codicon glyph box in titlebar clusters — optical match to traffic-light row. */
export const TITLEBAR_ICON_SIZE = 13.9
export const TITLEBAR_ICON_BADGE_SCALE = 0.65
export const TITLEBAR_CONTROL_OFFSET_X = 74
export const TITLEBAR_CONTROL_HEIGHT = TITLEBAR_CONTROL_SIZE
export const TITLEBAR_CONTROLS_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2

/** Inline font-size for titlebar Codicons — beats unlayered codicon.css `font: 16px`. */
export function titlebarIconSizeCss(scale = 1): string {
  return `${TITLEBAR_ICON_SIZE * scale}px`
}

export const TITLEBAR_FALLBACK_WINDOW_BUTTON_X = 24
// Edge inset used when no left-side native controls take up that space —
// Windows/Linux (native overlay is on the right) and macOS fullscreen
// (traffic lights are hidden). Matches the right-cluster's 0.75rem padding.
export const TITLEBAR_EDGE_INSET = 14

// macOS Tahoe = Darwin 25+. Keep in sync with electron/titlebar-overlay-width.ts.
export const MACOS_TAHOE_DARWIN_MAJOR = 25

// macOS traffic-light row only: nudge the left toolbar cluster down to sit on
// the same optical center as the native buttons on pre-Tahoe macOS. null
// windowButtonPosition means Windows/Linux, macOS fullscreen, or Tahoe.
export const TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE = 'calc(var(--spacing) * 0.9)'

export interface TitlebarChromeContext {
  darwinMajor?: number
  isFullscreen?: boolean
  windowButtonPosition?: FulilianConnection['windowButtonPosition']
}

export function titlebarControlsYNudge({
  darwinMajor = 0,
  isFullscreen = false,
  windowButtonPosition
}: TitlebarChromeContext = {}): string {
  if (isFullscreen || windowButtonPosition === null || darwinMajor >= MACOS_TAHOE_DARWIN_MAJOR) {
    return '0px'
  }

  return TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE
}

/** Right-cluster inset — WCO width when present; macOS fullscreen matches left edge inset. */
export function titlebarToolsRightCss(
  nativeOverlayWidth: number,
  { darwinMajor = 0, isFullscreen = false }: Pick<TitlebarChromeContext, 'darwinMajor' | 'isFullscreen'> = {}
): string {
  if (nativeOverlayWidth > 0) {
    return `${nativeOverlayWidth}px`
  }

  if (isFullscreen && darwinMajor > 0) {
    return `${TITLEBAR_EDGE_INSET}px`
  }

  return '0.75rem'
}

// Titlebar palette only. All sizing/radius/cursor/centering come from the
// shared <Button size="icon-titlebar"> (used polymorphically via asChild) —
// Button is the single source of button styling.
export const titlebarButtonClass =
  'rounded-md text-(--ui-text-tertiary) hover:bg-(--ui-bg-tertiary) hover:text-(--ui-text-primary)'

/** Shared flex shell for left/right/pane titlebar tool rows — no gap; 24px buttons abut. */
export const titlebarToolClusterClass =
  'fixed z-(--z-titlebar-chrome) flex flex-row items-center pointer-events-auto select-none [-webkit-app-region:no-drag]'

/** Width reserved for N abutting titlebar tool buttons. */
export function titlebarToolsWidthCss(toolCount: number): string {
  return `calc(${toolCount} * var(--titlebar-control-size))`
}

export const titlebarHeaderBaseClass =
  'pointer-events-none relative z-3 flex h-(--titlebar-height) w-full min-w-0 shrink-0 items-center justify-start gap-3 overflow-hidden border-b border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) px-[max(0.75rem,var(--titlebar-content-inset,0rem))] pr-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,0px)+0.75rem)]'

// Title row inside the header — must stay in the flex truncate chain.
export const titlebarHeaderTitleClass = 'min-w-0 flex-1 overflow-hidden'

export const titlebarHeaderShadowClass =
  "after:pointer-events-none after:absolute after:left-0 after:right-0 after:top-full after:h-4 after:bg-linear-to-b after:from-(--ui-chat-surface-background) after:to-transparent after:content-['']"

export function titlebarControlsPosition(
  windowButtonPosition: FulilianConnection['windowButtonPosition'] | undefined,
  isFullscreen = false
) {
  const top = Math.max(0, TITLEBAR_CONTROLS_TOP)
  // The brand lane owns the window's leading 252px (design §8.1), so the tool
  // cluster starts after it on every platform — otherwise the two overlap.
  const brandEdge = TITLEBAR_BRAND_WIDTH + TITLEBAR_BRAND_GAP

  // No left-side native controls to dodge:
  //   - Windows/Linux: native min/max/close render on the right via titleBarOverlay.
  //   - macOS fullscreen: traffic lights are hidden.
  // In both cases, pin the cluster to the brand lane's trailing edge.
  if (windowButtonPosition === null || isFullscreen) {
    return { left: brandEdge, top }
  }

  return {
    left: Math.max(
      brandEdge,
      (windowButtonPosition?.x ?? TITLEBAR_FALLBACK_WINDOW_BUTTON_X) + TITLEBAR_CONTROL_OFFSET_X
    ),
    top
  }
}
