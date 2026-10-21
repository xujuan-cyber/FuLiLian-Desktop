import { cn } from '@/lib/utils'

// Shared class names for the composer's control row, in a module of their own
// so both the row (`controls.tsx`) and the menus it renders can wear them
// without importing each other in a cycle.

// step 20 · v3 §10: icon buttons are 28×28 at radius 6, and keyboard focus is a
// neutral 2px ring — never a coloured one. The ring reuses the hairline token
// so it reads as structure, not as an accent state.
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--v3-line-strong)'

export const ICON_BTN = cn('size-7 shrink-0 rounded-md', FOCUS_RING)

export const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

// Send/voice-conversation primary: solid ink circle (reads as black-on-white in
// light mode, white-on-black in dark mode) to match the ZCode composer's
// high-contrast CTA — 32px, the one dark object in the row. Empty input parks it
// at 30% (v3 §8.5) instead of tinting the fill, and hover only shifts the fill.
export const PRIMARY_ICON_BTN = cn(
  'size-8 shrink-0 rounded-full p-0',
  'bg-(--v3-ink) text-(--v3-surface) hover:bg-(--v3-ink)/90',
  'disabled:opacity-30 disabled:hover:bg-(--v3-ink)',
  FOCUS_RING
)

/** A toggle that is currently ON — dictation, spoken replies, the wake word.
 *  Neutral grey, never accent: ZCode keeps the tool row colourless. */
export const ACTIVE_ICON_BTN =
  'bg-(--ui-bg-tertiary) text-foreground hover:bg-(--ui-bg-secondary) hover:text-foreground'
