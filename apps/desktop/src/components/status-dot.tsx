import type { ComponentProps } from 'react'
import { memo } from 'react'

import { cn } from '@/lib/utils'

export type StatusTone = 'good' | 'muted' | 'warn' | 'bad'

const TONE_BG: Record<StatusTone, string> = {
  good: 'bg-primary',
  muted: 'bg-muted-foreground/40',
  warn: 'bg-warning',
  bad: 'bg-destructive'
}

/** The Workbench status vocabulary (DESIGN_PROPOSAL §3.5). Every surface
 *  paints a status from this one table — a per-page dot that disagrees with
 *  its neighbours is a bug, not a style. Mode colours (forensics=info,
 *  CTF=accentBright, project=success) ride the same 6px size but are kind
 *  markers, not states; they never replace a status state. */
export type StatusDotState = 'background' | 'failed' | 'needs-input' | 'running' | 'stalled'

export const STATUS_DOT_STATE_CLASS: Record<StatusDotState, string> = {
  // Grey ink — behind the scenes or finished; nothing is being asked of you.
  background: 'bg-(--ui-text-tertiary)',
  // Red — a run ended in failure.
  failed: 'bg-destructive',
  // Amber + breathe (the animation lives in styles.css, already registered in
  // the paused-animations list and the reduced-motion fallback) — a clarify or
  // approval is blocking the turn.
  'needs-input': 'status-dot-breathe bg-warning',
  // Blue — the turn is running.
  running: 'bg-info',
  // Hollow ring — authoritatively alive but quiet: open, not producing.
  stalled: 'border-[1.5px] border-(--ui-stroke-secondary)'
}

/** The dot a state paints, for surfaces that describe a status rather than
 *  render one (the sidebar's status filter, say). */
export const statusDotClassName = (state: StatusDotState): string => STATUS_DOT_STATE_CLASS[state]

interface StatusDotProps extends ComponentProps<'span'> {
  /** Legacy tone vocabulary (good/muted/warn/bad). Kept for the existing
   *  consumers outside the status surfaces; new call sites should pass
   *  `state` so the whole app shares the §3.5 states. */
  tone?: StatusTone
  state?: StatusDotState
}

export const StatusDot = memo(function StatusDot({ className, tone, state, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 rounded-full',
        state ? STATUS_DOT_STATE_CLASS[state] : tone ? TONE_BG[tone] : undefined,
        className
      )}
      {...props}
    />
  )
})
