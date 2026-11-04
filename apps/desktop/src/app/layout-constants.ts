// Responsive horizontal gutter for primary content bodies (settings right side,
// skills, artifacts, command center / sessions). Ratio-based so it scales with
// the window, but clamped so it never collapses on narrow widths or runs away
// on ultrawide displays. Headers/tabs intentionally keep their own tighter
// padding.
//
// NOTE: these must stay literal strings — Tailwind's scanner only picks up
// complete class names, so do not build them via template interpolation.
export const PAGE_INSET_X = 'px-[clamp(1.25rem,4vw,4rem)]'

// Matching negative inline-margin to bleed an element (e.g. a sticky header bar)
// out to the gutter edges before re-applying PAGE_INSET_X.
export const PAGE_INSET_NEG_X = '-mx-[clamp(1.25rem,4vw,4rem)]'

// Readable cap for overlay "inner page" bodies (settings, command center). Wide
// enough to breathe, tight enough that content doesn't sprawl on ultrawide
// displays. Pair with `mx-auto w-full` to center within the pane. Literal string
// for Tailwind's scanner (see PAGE_INSET_X note).
export const PAGE_MAX_W = 'max-w-[75rem]'

// Below this viewport width a docked sidebar leaves no room for content, so both
// rails auto-collapse into the hover-reveal overlay. Base floor of the collapse
// point — the effective threshold is computed per-sidebar-width below.
export const SIDEBAR_COLLAPSE_BREAKPOINT_PX = 768

// The workspace pane declares `minWidth: '22vw'` (contrib/controller.tsx), so a
// docked sidebar only fits while `innerWidth - sidebarW >= 0.22 * innerWidth`,
// i.e. `innerWidth >= sidebarW / (1 - 0.22)`. The sidebar width is user-draggable
// and persisted (180–640px), so the critical window width rises with it — e.g. a
// 640px sidebar breaks docked layout below ~821px, past the static 768 floor.
// That is exactly the "shrink the window and the layout tears" report: the
// collapse decision must therefore consume the sidebar's CURRENT width.
export const MAIN_PANE_MIN_RATIO = 0.22

export function sidebarCollapseThresholdPx(sidebarWidthPx: number): number {
  return Math.max(SIDEBAR_COLLAPSE_BREAKPOINT_PX, Math.ceil(sidebarWidthPx / (1 - MAIN_PANE_MIN_RATIO)))
}
