import { cn } from '@/lib/utils'

// Shared class names for the composer's control row, in a module of their own
// so both the row (`controls.tsx`) and the menus it renders can wear them
// without importing each other in a cycle.

export const ICON_BTN = 'size-(--composer-control-size) shrink-0 rounded-lg'

export const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

// Send/voice-conversation primary: solid foreground-on-background circle
// (reads as black-on-white in light mode, white-on-black in dark mode) to
// match the ZCode composer's high-contrast CTA — 28px, the one dark object in
// the row. Keeps the pill itself neutral and lets the action dominate.
export const PRIMARY_ICON_BTN = cn(
  'size-7 shrink-0 rounded-full p-0',
  'bg-foreground text-background hover:opacity-90',
  'disabled:bg-foreground/30 disabled:text-background disabled:opacity-100'
)

/** A toggle that is currently ON — dictation, spoken replies, the wake word.
 *  Neutral grey, never accent: ZCode keeps the tool row colourless. */
export const ACTIVE_ICON_BTN =
  'bg-(--ui-bg-tertiary) text-foreground hover:bg-(--ui-bg-secondary) hover:text-foreground'
