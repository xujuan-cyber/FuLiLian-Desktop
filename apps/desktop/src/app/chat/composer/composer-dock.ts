import { cn } from '@/lib/utils'

/**
 * The composer surface and the status/queue stack paint ONE shared
 * `--composer-fill` var. The state ladder (rest / scrolled) lives in styles.css
 * on `[data-slot='composer-root']`, so the layers can never disagree.
 *
 * ZCode pass: the main input card is opaque `bg-card` (no glass), so this fill
 * stays only for chrome that keeps riding the ladder (micro-action hover, the
 * show-earlier affordance).
 */
export const composerFill = 'bg-(--composer-fill)'

const composerDockEdge = (edge: 'bottom' | 'top') =>
  cn(
    'border border-(--dt-composer-ring)',
    edge === 'top' ? 'rounded-t-[var(--radius-input)] border-b-0' : 'rounded-b-[var(--radius-input)] border-t-0'
  )

/** Docked card — the status stack / queue. Opaque card surface so the stack
 *  reads as the same object as the input card beneath it; the two share one
 *  edge, one hairline, one radius family. */
export const composerDockCard = (edge: 'bottom' | 'top' = 'top') => cn(composerDockEdge(edge), 'bg-card')

/** Floating composer panel skin — the `/`·`@`·`?` completion drawer and the
 *  attach (`+`) menu. Opaque card, hairline border, card radius, smallest
 *  type, the signature elevation. Visual skin only — consumers add their own
 *  size/position/padding. */
export const composerPanelCard = cn(
  'rounded-xl border border-(--dt-composer-ring) bg-card shadow-signature text-[length:var(--conversation-tool-font-size)]'
)

/**
 * A quiet control floating over composer content — the micro-action pills above
 * the surface, the Open affordance on a hovered link inside it. Full radius,
 * hairline border, opaque card fill so the thread underneath never shows
 * through. Sized against the composer's control height so a pill lines up with
 * the chrome it floats above.
 *
 * Skin and size only; the call site owns position, width caps, and disabled
 * state.
 */
export const composerFloatingPill = cn(
  'inline-flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5',
  'border border-(--ui-stroke-tertiary) bg-card',
  'text-xs font-normal text-(--ui-text-secondary) transition-colors',
  'hover:bg-(--ui-bg-tertiary) hover:text-foreground'
)

/**
 * Shared grid for the chrome-free floating strips that bracket the composer —
 * the micro-action pills above the surface and the `composer.underside` slot
 * below it.
 *
 * Both are in-flow children of the composer DOCK, siblings of the composer
 * itself rather than children of it. That's deliberate: the pop-out drag
 * region is `absolute inset-0` inside the composer, so anything rendered in
 * there is inside the grab area by construction. Living outside makes that
 * impossible instead of something the gesture has to exclude.
 *
 * One parent and one constant means the two strips share a left edge without
 * anyone matching numbers across files. Vertical spacing stays at the call
 * site; the horizontal inset matches the composer's 5px grab margin so the
 * strips line up with the surface rather than the margin's outer edge.
 */
export const composerFloatingStrip = 'flex flex-wrap items-center gap-1.5'
