import { type CSSProperties } from 'react'

import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { OverlaySidebar, OverlaySplitLayout } from './overlay-split-layout'

// Suspense fallback for the lazily-loaded SettingsView (step 17 · P3a).
//
// Before this, `wiring.tsx`'s settings block used `fallback={null}`: the real
// overlay only appears once the ~225KB settings chunk has downloaded and
// parsed, so the first open showed nothing at all — no backdrop, no card — and
// read as "clicked and nothing happened". This skeleton mounts the *same*
// frame the real SettingsView does (the OverlayView backdrop + the split
// layout) so the open is acknowledged instantly, then swaps to the real view
// with no size jump.
//
// It deliberately reuses OverlayView's / OverlaySplitLayout's own constants
// instead of re-declaring numbers, so the frame can never drift from the real
// overlay (see the class table in the step-17 P3a receipt):
//   - outer backdrop / card → mirrored from overlay-view.tsx:76-108
//   - split grid + sidebar  → OverlaySplitLayout / OverlaySidebar
//     (overlay-split-layout.tsx:44-80)
//
// Purely presentational by contract: no onClose, no Esc layer, no click-to-
// close, no search pill / nav copy. Those belong to the real SettingsView once
// it mounts; the skeleton must not claim (or duplicate) any of its
// interactions — only meaningless bars, so the swap never flashes a label the
// real view renders differently.
export function SettingsSkeleton() {
  return (
    <div
      className={cn(
        // Full-window backdrop — same veil + equidistant inset as the real
        // overlay (overlay-view.tsx:76-84). Kept in sync by construction: if
        // OverlayView's inset changes, this must change with it.
        'fixed inset-0 z-50 bg-black/22 backdrop-blur-[0.125rem]',
        'p-[calc(var(--titlebar-height)+0.625rem)]',
        'sm:p-[calc(var(--titlebar-height)+0.875rem)]'
      )}
      // No `data-overlay-surface`: while the chunk loads the real view is the
      // only interactive surface, and the composer underneath is still fading
      // out — the marker belongs to the mounted overlay, not this placeholder.
      data-testid="settings-skeleton"
      role="presentation"
      // Re-pin the real titlebar height at the overlay root: a fixed overlay
      // mounted inside a contrib zone would otherwise read the zeroed var and
      // bleed to the edges (mirrors overlay-view.tsx:103).
      style={{ '--titlebar-height': `${TITLEBAR_HEIGHT}px` } as CSSProperties}
    >
      <div className="relative h-full min-h-0">
        <div
          className={cn(
            // The card: same surface, radius, border and shadow as the real one
            // (overlay-view.tsx:108).
            'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background) shadow-md'
          )}
          // Raised-surface marker so window glass keeps the card near-opaque
          // during the swap (mirrors overlay-view.tsx:114).
          data-glass-raised=""
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--titlebar-height)+0.1875rem)] [-webkit-app-region:drag]">
            {/* Close button (top-right, floating on the titlebar strip) —
                placeholder for the real X. Decorative only: the skeleton owns
                no close handler, so no button, no aria-label, no i18n key. */}
            <div className="pointer-events-none absolute right-3 top-[calc(0.1875rem+var(--titlebar-height)/2)] flex -translate-y-1/2 items-center gap-1.5 [-webkit-app-region:no-drag]">
              <Skeleton className="size-6 rounded-md" />
            </div>
          </div>

          {/* Same split frame the real SettingsView renders, so the wide rail /
              narrow dropdown breakpoints and the sidebar fill match exactly. */}
          <OverlaySplitLayout>
            <OverlaySidebar className="max-[47.5rem]:hidden">
              <Bar className="h-5 w-24" />
              {NAV_ROWS.map((row, index) => (
                <Skeleton className={cn('h-7 w-full', row)} key={`${index}-${row}`} />
              ))}
              <Skeleton className="mt-auto h-5 w-20" />
            </OverlaySidebar>

            <div className="min-h-0 flex-1 overflow-hidden px-[clamp(0.8333rem,2.6667vw,2.6667rem)] pb-2 pt-[calc((var(--titlebar-height)/2+1rem)*2/3)] max-[47.5rem]:pt-[calc(0.5rem*2/3)]">
              <Bar className="h-7 w-48" />
              <Bar className="mt-6 h-32 w-full" />
              <Bar className="mt-4 h-32 w-full" />
            </div>
          </OverlaySplitLayout>
        </div>
      </div>
    </div>
  )
}

// Section header / body / row widths, cycled so the rail reads as 「a list of
// links」 rather than a striped block. Widths are the only thing that varies —
// every rail bar shares one height and radius.
const NAV_ROWS = ['w-4/5', 'w-3/5', 'w-4/5', 'w-2/3', 'w-4/5', 'w-3/5', 'w-4/5', 'w-2/3']

// A skeleton bar on the shared accent surface (Skeleton defaults to
// `animate-pulse rounded-md bg-accent`; a step-17 P3a skeleton never invents
// its own pulse animation).
function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn('shrink-0', className)} />
}
